'use strict';
// Token API personali (routes/api-tokens.js, requireAuth in routes/auth.js): per un
// client esterno (es. un server MCP, 25/10/2026) che agisce come un utente vero senza
// login/2FA ogni volta. Server reale, login reale.
// Eseguire con: node src/api-tokens.test.js (porta 34824)

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const TEST_PORT = 34824;
const BASE = 'http://localhost:' + TEST_PORT;
const dbPath = path.join(os.tmpdir(), 'api-tokens-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.DB_PATH = dbPath;
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'at_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'at_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'at-uploads-'));

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; }
}
function assertEq(a, e, msg) { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${msg || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); }

async function main() {
  require('./index.js');
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const db = require('./db');
  const bcrypt = require('bcryptjs');
  const hash = bcrypt.hashSync('pw_di_prova_123', 4);
  db.prepare("INSERT INTO users (id, username, password_hash, display_name, role) VALUES (6, 'fede', ?, 'Fede', 'user')").run(hash);

  const loginAs = async (username, password) => (await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) })).json()).token;
  const tokAdmin = await loginAs('admin', process.env.INITIAL_ADMIN_PASSWORD);
  const tokFede = await loginAs('fede', 'pw_di_prova_123');

  await test('senza nome -> 400', async () => {
    const r = await fetch(BASE + '/api/api-tokens', { method: 'POST', headers: { Authorization: 'Bearer ' + tokAdmin, 'Content-Type': 'application/json' }, body: JSON.stringify({ label: '  ' }) });
    assertEq(r.status, 400);
  });

  let tokenMCP;
  await test('si crea un token: il valore in chiaro arriva una volta sola, da qui non è più leggibile', async () => {
    const r = await fetch(BASE + '/api/api-tokens', { method: 'POST', headers: { Authorization: 'Bearer ' + tokAdmin, 'Content-Type': 'application/json' }, body: JSON.stringify({ label: 'MCP sul Mac' }) });
    const body = await r.json();
    assertEq(r.status, 200);
    assertEq(body.token.startsWith('plat_'), true);
    tokenMCP = body.token;
    const elenco = await (await fetch(BASE + '/api/api-tokens', { headers: { Authorization: 'Bearer ' + tokAdmin } })).json();
    assertEq(elenco.length, 1);
    assertEq(elenco[0].label, 'MCP sul Mac');
    assertEq('token' in elenco[0], false, 'il valore in chiaro non torna mai più, nemmeno nell\'elenco');
  });

  await test('il token funziona come Bearer su una rotta vera, autentica come chi l\'ha creato (admin)', async () => {
    const r = await fetch(BASE + '/api/users', { headers: { Authorization: 'Bearer ' + tokenMCP } });
    assertEq(r.status, 200, 'una rotta solo-admin risponde: il token porta i permessi reali di admin');
  });

  await test('un token di Fede non vede/non può revocare quello di admin (ognuno solo i propri)', async () => {
    const elenco = await (await fetch(BASE + '/api/api-tokens', { headers: { Authorization: 'Bearer ' + tokFede } })).json();
    assertEq(elenco.length, 0);
  });

  await test('un valore "plat_..." inventato -> 401, non un errore diverso', async () => {
    const r = await fetch(BASE + '/api/users', { headers: { Authorization: 'Bearer plat_' + 'f'.repeat(64) } });
    assertEq(r.status, 401);
  });

  await test('revocato: smette subito di funzionare', async () => {
    const elenco = await (await fetch(BASE + '/api/api-tokens', { headers: { Authorization: 'Bearer ' + tokAdmin } })).json();
    const id = elenco[0].id;
    const del = await fetch(BASE + '/api/api-tokens/' + id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + tokAdmin } });
    assertEq(del.status, 200);
    const r = await fetch(BASE + '/api/users', { headers: { Authorization: 'Bearer ' + tokenMCP } });
    assertEq(r.status, 401);
  });

  await test('un utente disattivato: il suo token smette di funzionare subito, non alla scadenza', async () => {
    const r1 = await fetch(BASE + '/api/api-tokens', { method: 'POST', headers: { Authorization: 'Bearer ' + tokFede, 'Content-Type': 'application/json' }, body: JSON.stringify({ label: 'test' }) });
    const { token } = await r1.json();
    db.prepare("UPDATE users SET active = 0 WHERE username = 'fede'").run();
    const r2 = await fetch(BASE + '/api/users', { headers: { Authorization: 'Bearer ' + token } });
    assertEq(r2.status, 401);
    db.prepare("UPDATE users SET active = 1 WHERE username = 'fede'").run();
  });

  console.log(`\n${passed} passati, ${failed} falliti su ${passed + failed} test.`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('ERRORE FATALE', e); process.exit(1); });
