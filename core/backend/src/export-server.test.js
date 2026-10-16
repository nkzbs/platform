'use strict';
// «Distacca su un tuo server» lato tenant (routes/export-server.js): solo admin, password riconfermata, token firmato col segreto del tenant, solo i campi attesi verso Super Admin, già distaccato → rifiuto,
// credenziali mai nell'audit. Super Admin simulato. Eseguire con: node src/export-server.test.js (porta 34862 libera).
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const TEST_PORT = 34862, BASE = 'http://localhost:' + TEST_PORT;
process.env.DB_PATH = path.join(os.tmpdir(), 'exsrv-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'xs_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'xs_internal_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'xs_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'xs-uploads-'));
process.env.SUPER_ADMIN_URL = 'http://sa.test';
process.env.TENANT_SLUG = 'officina';
let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); console.log('  ✓ ' + name); passed++; } catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; } }
const eq = (a, e, m) => { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${m || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m || 'atteso true'); };

const realFetch = global.fetch; let richieste = []; let risposta = { status: 200, body: { ok: true } }; let giu = false;
global.fetch = async (url, opt) => {
  if (!String(url).startsWith('http://sa.test')) return realFetch(url, opt);
  if (giu) throw new Error('rete giù');
  richieste.push({ url: String(url), method: opt.method, headers: opt.headers, body: opt.body ? JSON.parse(opt.body) : null });
  return { ok: risposta.status < 400, status: risposta.status, json: async () => risposta.body };
};

async function main() {
  require('./index.js');
  for (let i = 0; i < 100; i++) { try { if ((await realFetch(BASE + '/health')).ok) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const db = require('./db'); const jwt = require('jsonwebtoken'); const bcrypt = require('bcryptjs');
  const login = async (u, p) => (await (await realFetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) })).json()).token;
  db.prepare("INSERT INTO users (username, password_hash, display_name, role) VALUES ('utente', ?, 'utente', 'user')").run(bcrypt.hashSync('utente_pw_1', 10));
  const HA = { Authorization: 'Bearer ' + await login('admin', 'xs_admin_pw'), 'Content-Type': 'application/json' };
  const HU = { Authorization: 'Bearer ' + await login('utente', 'utente_pw_1'), 'Content-Type': 'application/json' };
  const corpo = { password: 'xs_admin_pw', server: { host: 'srv.example.com', port: 22, username: 'nima', password: 'PASSWORD-SSH-SEGRETA', extra: 'NO' }, opzioni: { porta_web: 8090, cartella: 'platform-officina' }, ruolo: 'admin', altro: 'NO' };
  const post = (p, body, H = HA) => realFetch(BASE + '/api/export-server' + p, { method: 'POST', headers: H, body: JSON.stringify(body) });

  await test('solo admin loggato', async () => {
    eq((await post('/verifica', corpo, { 'Content-Type': 'application/json' })).status, 401); eq((await post('/verifica', corpo, HU)).status, 403);
    eq((await realFetch(BASE + '/api/export-server/stato/x', { headers: HU })).status, 403); eq(richieste.length, 0);
  });
  await test('password dell\'account sbagliata o mancante: niente parte verso Super Admin', async () => {
    eq((await post('/verifica', { ...corpo, password: 'sbagliata' })).status, 401); eq((await post('/avvia', { ...corpo, password: '' })).status, 401); eq(richieste.length, 0);
  });
  await test('verifica: token firmato col segreto del tenant, slug del tenant, solo i campi attesi; la risposta torna com\'è', async () => {
    risposta = { status: 200, body: { fingerprint: 'SHA256:x', ok: true, controlli: [] } };
    const r = await post('/verifica', corpo); eq(r.status, 200); eq((await r.json()).fingerprint, 'SHA256:x');
    const q = richieste[0]; eq([q.method, q.url], ['POST', 'http://sa.test/api/tenant-export/officina/verifica']);
    const t = jwt.verify(q.headers.Authorization.replace('Bearer ', ''), process.env.JWT_SECRET); eq([t.slug, t.purpose], ['officina', 'export']); ok(t.exp - t.iat <= 300, 'token breve');
    ok(!q.headers.Authorization.includes(process.env.INTERNAL_API_SECRET) && !JSON.stringify(q.headers).includes('x-internal-secret'), 'il segreto condiviso non serve');
    eq(Object.keys(q.body).sort(), ['opzioni', 'server']); eq(Object.keys(q.body.server).sort(), ['host', 'password', 'port', 'username'], 'solo i campi del server che servono'); eq(q.body.server.extra, undefined); eq(q.body.ruolo, undefined);
  });
  await test('avvia: porta l\'impronta confermata, risponde 202; lo stato si legge', async () => {
    richieste = []; risposta = { status: 202, body: { id: 'abc' } };
    const r = await post('/avvia', { ...corpo, fingerprint: 'SHA256:x' }); eq(r.status, 202); eq(richieste[0].body.fingerprint, 'SHA256:x');
    risposta = { status: 200, body: { fase: 'immagine', passi: [] } }; const s = await realFetch(BASE + '/api/export-server/stato/abc', { headers: HA }); eq((await s.json()).fase, 'immagine'); eq(richieste[1].url, 'http://sa.test/api/tenant-export/officina/stato/abc');
  });
  await test('gli errori di Super Admin arrivano chiari; se non risponde, lo dice', async () => {
    risposta = { status: 400, body: { error: 'Questo indirizzo non è ammesso (indirizzo locale).' } }; let r = await post('/verifica', corpo); eq(r.status, 400); ok(/non è ammesso/.test((await r.json()).error));
    giu = true; r = await post('/verifica', corpo); eq(r.status, 502); ok(/non è raggiungibile/.test((await r.json()).error)); giu = false;
  });
  await test('nell\'audit niente credenziali; solo chi e dove', async () => {
    const audit = JSON.stringify(db.prepare('SELECT * FROM audit_log').all()); ok(!audit.includes('PASSWORD-SSH-SEGRETA') && !audit.includes('xs_admin_pw'), 'credenziali nell\'audit'); ok(/export\.verify/.test(audit) && /export\.start/.test(audit));
  });
  await test('un tenant già distaccato non si copia di nuovo', async () => {
    process.env.DETACHED = '1'; richieste = []; const r = await post('/verifica', corpo); eq(r.status, 400); ok(/già distaccato/.test((await r.json()).error)); eq(richieste.length, 0); delete process.env.DETACHED;
  });

  console.log(`\n${passed} passati, ${failed} falliti`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
