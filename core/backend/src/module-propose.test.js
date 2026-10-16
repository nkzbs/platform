'use strict';
// «Proponi alla Libreria» (routes/modules.js): parte SOLO lo schema, con il secret interno e il nome del tenant; i moduli di sistema e quelli non installati no; gli errori della Libreria si dicono chiari.
// Server vero, Super Admin simulato. Eseguire con: node src/module-propose.test.js (porta 34857 libera).
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const TEST_PORT = 34857, BASE = 'http://localhost:' + TEST_PORT;
process.env.DB_PATH = path.join(os.tmpdir(), 'propose-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'pp_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'pp_internal_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'pp_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-uploads-'));
process.env.SUPER_ADMIN_URL = 'http://sa.test';
process.env.TENANT_SLUG = 'officina';
let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); console.log('  ✓ ' + name); passed++; } catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; } }
const eq = (a, e, m) => { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${m || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m || 'atteso true'); };

const realFetch = global.fetch; let richieste = []; let risposta = { status: 200, body: { id: 7, status: 'pending' } }; let giu = false;
global.fetch = async (url, opt) => {
  if (!String(url).startsWith('http://sa.test')) return realFetch(url, opt);
  if (giu) throw new Error('rete giù');
  richieste.push({ url: String(url), headers: opt.headers, body: opt.body ? JSON.parse(opt.body) : null });
  return { ok: risposta.status < 400, status: risposta.status, json: async () => risposta.body };
};

async function main() {
  require('./index.js');
  for (let i = 0; i < 100; i++) { try { if ((await realFetch(BASE + '/health')).ok) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const db = require('./db');
  const login = await realFetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'pp_admin_pw' }) });
  const H = { Authorization: 'Bearer ' + (await login.json()).token, 'Content-Type': 'application/json' };
  const schema = JSON.stringify({ version: 3, steps: [{ id: 'f1', block_type: 'field', key: 'titolo', label: 'Titolo', type: 'text' }] });
  db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json, group_name) VALUES ('Lavori', 'lavori', 'tool', '#123', 1, 1, 70, ?, 'Officina')").run(schema);
  db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES ('Spento', 'spento', 'box', '#000', 0, 1, 71, ?)").run(schema);
  db.prepare("INSERT INTO records (module_slug, user_id, data) VALUES ('lavori', 1, ?)").run(JSON.stringify({ titolo: 'DATO RISERVATO DI UN CLIENTE' }));
  const post = (slug, body) => realFetch(BASE + '/api/modules/' + slug + '/propose-to-registry', { method: 'POST', headers: H, body: JSON.stringify(body || {}) });

  await test('invia SOLO lo schema, con il secret interno e il tenant; mai le righe', async () => {
    const r = await post('lavori', { description: 'Lavori di officina', note: 'ottimo' }); eq(r.status, 200); eq((await r.json()).id, 7);
    const q = richieste[0]; eq(q.url, 'http://sa.test/api/registry/public/proposals'); eq(q.headers['x-internal-secret'], process.env.INTERNAL_API_SECRET);
    eq([q.body.tenant_slug, q.body.module.slug, q.body.module.name, q.body.module.group_name, q.body.description, q.body.note], ['officina', 'lavori', 'Lavori', 'Officina', 'Lavori di officina', 'ottimo']);
    ok(!JSON.stringify(q.body).includes('RISERVATO'), 'nessun dato delle righe'); eq(q.body.module.schema_json, schema);
  });
  await test('serve essere admin; modulo inesistente, non installato o di sistema: rifiutato prima di chiamare la Libreria', async () => {
    richieste = [];
    eq((await realFetch(BASE + '/api/modules/lavori/propose-to-registry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
    eq((await post('nonesiste')).status, 404); eq((await post('spento')).status, 404); eq((await post('dashboard')).status >= 400, true); eq(richieste.length, 0);
  });
  await test('se la Libreria rifiuta o non risponde, lo dice chiaro', async () => {
    risposta = { status: 400, body: { error: 'Un modulo senza campi non serve alla Libreria.' } }; let r = await post('lavori'); eq(r.status, 400); ok(/senza campi/.test((await r.json()).error));
    risposta = { status: 500, body: {} }; eq((await post('lavori')).status, 502);
    giu = true; r = await post('lavori'); eq(r.status, 502); ok(/non è raggiungibile/.test((await r.json()).error)); giu = false; risposta = { status: 200, body: { id: 8 } };
  });
  await test('lo stato delle proposte passa dalla Libreria; se non risponde, elenco vuoto (non un errore)', async () => {
    richieste = []; risposta = { status: 200, body: [{ id: 7, name: 'Lavori', status: 'rejected', reason: 'Troppo specifico' }] };
    const l = await (await realFetch(BASE + '/api/modules/registry-proposals', { headers: H })).json(); eq(l[0].reason, 'Troppo specifico'); ok(/tenant_slug=officina/.test(richieste[0].url));
    giu = true; eq(await (await realFetch(BASE + '/api/modules/registry-proposals', { headers: H })).json(), []); giu = false;
  });

  console.log(`\n${'='.repeat(60)}\n${passed} passati, ${failed} falliti su ${passed + failed} test.`);
  try { fs.unlinkSync(process.env.DB_PATH); } catch (e) {}
  process.exit(failed > 0 ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
