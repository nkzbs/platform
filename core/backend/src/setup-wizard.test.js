'use strict';
// I primi passi (routes/setup-wizard.js): si mostra solo a un tenant vuoto non ancora chiuso; si chiude; i numeri sono dati veri.
// Server vero. Eseguire con: node src/setup-wizard.test.js (porta 34859 libera).
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const TEST_PORT = 34859, BASE = 'http://localhost:' + TEST_PORT;
process.env.DB_PATH = path.join(os.tmpdir(), 'wizard-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'wz_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'wz_internal_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'wz_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wz-uploads-'));
let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); console.log('  ✓ ' + name); passed++; } catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; } }
const eq = (a, e, m) => { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${m || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); };

async function main() {
  require('./index.js');
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const db = require('./db');
  const login = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'wz_admin_pw' }) });
  const H = { Authorization: 'Bearer ' + (await login.json()).token, 'Content-Type': 'application/json' };
  const stato = async () => (await (await fetch(BASE + '/api/setup-wizard/stato', { headers: H })).json());

  await test('serve essere admin', async () => { eq((await fetch(BASE + '/api/setup-wizard/stato')).status, 401); });
  await test('tenant vuoto: si mostra; i numeri partono da zero', async () => {
    const s = await stato(); eq(s.mostra, true); eq([s.passi.moduli, s.passi.collegamenti, s.passi.utenti, s.passi.connessioni], [0, 0, 1, 0]);
  });
  await test('i numeri seguono i dati veri (moduli e collegamenti)', async () => {
    db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES ('Ordini', 'ordini', 'box', '#000', 1, 1, 50, ?)").run(JSON.stringify({ fields: [], relations: [{ key: 'c', label: 'C', type: 'many_to_one', target_module: 'clienti' }] }));
    const s = await stato(); eq([s.passi.moduli, s.passi.collegamenti], [1, 1]);
  });
  await test('con delle righe dentro non si mostra più, anche se non è mai stato chiuso', async () => {
    db.prepare("INSERT INTO records (module_slug, user_id, data) VALUES ('ordini', 1, '{}')").run(); eq((await stato()).mostra, false);
    db.prepare('DELETE FROM records').run(); eq((await stato()).mostra, true);
  });
  await test('chiudi: non si riapre da solo', async () => {
    eq((await fetch(BASE + '/api/setup-wizard/chiudi', { method: 'POST', headers: H, body: '{}' })).status, 200); eq((await stato()).mostra, false);
  });
  console.log(`\n${passed} passati, ${failed} falliti`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
