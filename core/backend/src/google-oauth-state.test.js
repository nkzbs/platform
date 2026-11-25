'use strict';
// Collegamento Google (routes/google-oauth.js): il parametro `state` si emette casuale e si pretende uguale, una volta sola e non scaduto.
// Server reale, DB temporaneo, nessuna chiamata a Google (con un state sbagliato non parte). Eseguire con: node src/google-oauth-state.test.js (porta 34816).
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const TEST_PORT = 34816;
const BASE = 'http://localhost:' + TEST_PORT;
const dbPath = path.join(os.tmpdir(), 'oauth-state-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.DB_PATH = dbPath;
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'os_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'os_internal_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'os_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'os-uploads-'));
process.env.SUPER_ADMIN_URL = 'http://localhost:1';
process.env.TENANT_SLUG = 'os';

let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); console.log('  ✓ ' + name); passed++; } catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; } }
function assertEq(a, e, msg) { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${msg || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); }
function assertTrue(c, msg) { if (!c) throw new Error(msg || 'atteso true'); }

async function main() {
  require('./index.js');
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const db = require('./db');
  const sealed = require('./secrets-at-rest');
  const leggi = () => { const r = db.prepare("SELECT credentials FROM connections WHERE integration_id = 'google'").get(); return r ? sealed.unseal(r.credentials) || {} : {}; };
  const login = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: process.env.INITIAL_ADMIN_PASSWORD }) })).json();
  const H = { Authorization: 'Bearer ' + login.token, 'Content-Type': 'application/json' };
  await fetch(BASE + '/api/integrazioni/google/config', { method: 'PUT', headers: H, body: JSON.stringify({ client_id: 'id-prova', client_secret: 'segreto-prova' }) });
  const avvia = async () => { const r = await fetch(BASE + '/api/integrazioni/google/oauth/start', { method: 'POST', headers: H, body: '{}' }); return new URL((await r.json()).url).searchParams.get('state'); };
  const callback = (state) => fetch(BASE + '/api/integrazioni/google/oauth/callback?code=codice-finto' + (state === undefined ? '' : '&state=' + encodeURIComponent(state)), { redirect: 'manual' });

  await test('senza login (o da non admin) l\'avvio è rifiutato: nessuno può procurarsi uno state valido (audit M1)', async () => {
    const senza = await fetch(BASE + '/api/integrazioni/google/oauth/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assertEq(senza.status, 401, 'senza login');
    const vecchia = await fetch(BASE + '/api/integrazioni/google/oauth/start', { redirect: 'manual' });
    assertTrue(vecchia.status === 404 || vecchia.status === 401, 'la vecchia GET non deve più avviare il flusso: ' + vecchia.status);
  });
  await test('il state è casuale (48 caratteri esadecimali) e diverso a ogni richiesta', async () => {
    const a = await avvia(), b = await avvia();
    assertTrue(/^[0-9a-f]{48}$/.test(a), a); assertTrue(a !== b, 'due richieste uguali');
  });
  await test('un state diverso, vuoto o mancante rifiuta il collegamento: nessun token salvato, nessuna chiamata a Google', async () => {
    for (const s of ['sbagliato', '', undefined]) {
      await avvia();
      const r = await callback(s);
      assertTrue(/google_error=/.test(r.headers.get('location')), 'va in errore: ' + r.headers.get('location'));
      assertEq(!!leggi().access_token, false, 'nessun collegamento');
    }
  });
  await test('un state scaduto (oltre 10 minuti) è rifiutato', async () => {
    const st = await avvia(); const c = leggi();
    db.prepare("UPDATE connections SET credentials = ? WHERE integration_id = 'google'").run(sealed.seal({ ...c, oauth_state_at: Date.now() - 11 * 60 * 1000 }));
    const r = await callback(st);
    assertTrue(/google_error=/.test(r.headers.get('location')));
  });
  await test('il state si consuma anche se sbagliato: lo stesso state giusto, dopo un tentativo sbagliato, non vale più', async () => {
    const st = await avvia();
    await callback('sbagliato');
    const r = await callback(st);
    assertTrue(/google_error=/.test(r.headers.get('location')), 'il vecchio state è stato bruciato');
    assertEq(leggi().oauth_state, undefined);
  });

  console.log(`\n${'='.repeat(60)}`);
  console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
  try { fs.unlinkSync(dbPath); } catch (e) {}
  process.exit(failed > 0 ? 1 : 0);
}
main().catch((e) => { console.error('Suite google-oauth-state fallita ad avviarsi:', e); process.exit(1); });
