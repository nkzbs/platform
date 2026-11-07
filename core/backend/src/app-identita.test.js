'use strict';
// L'identità dell'app (Impostazioni → Aspetto): il nome mostrato al posto di «Platform» e il logo dell'app. Server vero, DB temporaneo.
// Eseguire con: node src/app-identita.test.js (porta 34867 libera).
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const TEST_PORT = 34867, BASE = 'http://localhost:' + TEST_PORT;
process.env.DB_PATH = path.join(os.tmpdir(), 'identita-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'id_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'id_internal_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'id_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'id-uploads-'));

let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); console.log('  ✓ ' + name); passed++; } catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; } }
const eq = (a, e, m) => { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${m || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m || 'atteso true'); };

async function main() {
  require('./index.js');
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const login = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: process.env.INITIAL_ADMIN_PASSWORD }) })).json();
  const H = { Authorization: 'Bearer ' + login.token, 'Content-Type': 'application/json' };
  const put = (b, headers = H) => fetch(BASE + '/api/settings/azienda', { method: 'PUT', headers, body: JSON.stringify(b) });
  const get = async () => (await fetch(BASE + '/api/settings/azienda', { headers: H })).json();
  const info = async () => (await fetch(BASE + '/api/tenant-info')).json();
  const PNG = 'data:image/png;base64,' + Buffer.from('89504e470d0a1a0a', 'hex').toString('base64');

  await test('di partenza l\'app non ha un nome né un logo suoi: resta «Platform»', async () => {
    const a = await get(); eq([a.app_name, a.app_logo_url], [null, null]);
    const i = await info(); eq([i.app_name, i.app_logo_url], [null, null]);
  });
  await test('nome e logo dell\'app si salvano e si leggono anche dalla schermata di accesso (senza accesso)', async () => {
    const r = await put({ app_name: '  Studio Rossi  ', app_logo_url: PNG }); eq(r.status, 200);
    const a = await get(); eq([a.app_name, a.app_logo_url], ['Studio Rossi', PNG]);
    const i = await info(); eq([i.app_name, i.app_logo_url], ['Studio Rossi', PNG]);
  });
  await test('un client che rimanda la riga senza questi campi non li azzera; null o vuoto li toglie', async () => {
    eq((await put({ ragione_sociale: 'Agenzia' })).status, 200);
    let a = await get(); eq([a.ragione_sociale, a.app_name, a.app_logo_url], ['Agenzia', 'Studio Rossi', PNG]);
    eq((await put({ app_name: '', app_logo_url: null })).status, 200);
    a = await get(); eq([a.app_name, a.app_logo_url], [null, null]);
  });
  await test('il nome è una riga sola e corta; un logo non valido è rifiutato; solo l\'amministratore può cambiarli', async () => {
    await put({ app_name: 'Riga uno\nriga due ' + 'x'.repeat(80) });
    const n = (await get()).app_name; ok(!/\n/.test(n) && n.length <= 40, JSON.stringify(n));
    const male = await put({ app_logo_url: 'javascript:alert(1)' }); eq(male.status, 400); ok(/logo dell'app/.test((await male.json()).error));
    eq((await put({ app_logo_url: 'data:image/svg+xml;base64,AAAA' })).status, 400);
    eq((await put({ app_name: 'x' }, { 'Content-Type': 'application/json' })).status, 401);
  });

  console.log(`\n${passed} passati, ${failed} falliti`);
  try { fs.unlinkSync(process.env.DB_PATH); } catch (e) {}
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
