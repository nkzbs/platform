'use strict';
// Installazione multipla dallo store (routes/modules.js, POST /registry/bulk-install): salta i moduli già presenti, installa le dipendenze, segnala i falliti.
// Super Admin simulato. Eseguire con: node src/registry-bulk-install.test.js (porta 34858 libera).
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const TEST_PORT = 34858, BASE = 'http://localhost:' + TEST_PORT;
process.env.DB_PATH = path.join(os.tmpdir(), 'vert-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'vv_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'vv_internal_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'vv_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vv-uploads-'));
process.env.SUPER_ADMIN_URL = 'http://sa.test';
process.env.TENANT_SLUG = 'officina';
let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); console.log('  ✓ ' + name); passed++; } catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; } }
const eq = (a, e, m) => { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${m || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m || 'atteso true'); };

const realFetch = global.fetch;
const sch = (rel) => JSON.stringify({ version: 3, steps: [{ id: 'f1', block_type: 'field', key: 'nome', label: 'Nome', type: 'text' }, ...(rel ? [{ id: 'r1', block_type: 'relation', key: 'cliente', label: 'Cliente', target_module: rel }] : [])] });
const LIB = [
  { id: 1, slug: 'clienti', name: 'Clienti', icon: 'users', color: '#111', version: 1, schema_json: sch(), source_tenant_slug: 'x' },
  { id: 2, slug: 'ordini', name: 'Ordini', icon: 'box', color: '#222', version: 1, schema_json: sch('clienti'), source_tenant_slug: 'x' },
  { id: 3, slug: 'ore', name: 'Ore', icon: 'clock', color: '#333', version: 1, schema_json: sch('mancante_in_libreria'), source_tenant_slug: 'x' },
];
const VERT = [{ id: 5, name: 'Officina', icon: 'tool', description: 'x', moduli: [{ id: 2, slug: 'ordini', name: 'Ordini' }, { id: 1, slug: 'clienti', name: 'Clienti' }] }, { id: 6, name: 'Con buco', icon: 'box', description: '', moduli: [{ id: 3, slug: 'ore', name: 'Ore' }] }];
global.fetch = async (url, opt) => {
  url = String(url); if (!url.startsWith('http://sa.test')) return realFetch(url, opt);
  const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
  if (url.includes('/public/verticals')) return json(VERT);
  if (url.includes('/public/modules?')) return json(LIB.map(({ schema_json, ...m }) => m));
  const m = url.match(/public\/modules\/(\d+)\/install/); if (m) { const x = LIB.find((l) => l.id === Number(m[1])); return x ? json(x) : json({ error: 'no' }, 404); }
  return json({}, 404);
};

async function main() {
  require('./index.js');
  for (let i = 0; i < 100; i++) { try { if ((await realFetch(BASE + '/health')).ok) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const db = require('./db');
  const login = await realFetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'vv_admin_pw' }) });
  const H = { Authorization: 'Bearer ' + (await login.json()).token, 'Content-Type': 'application/json' };
  const post = (ids) => realFetch(BASE + '/api/modules/registry/bulk-install', { method: 'POST', headers: H, body: JSON.stringify({ ids }) });
  const slugs = () => db.prepare("SELECT registry_slug FROM modules WHERE installed = 1 AND registry_slug IS NOT NULL ORDER BY registry_slug").all().map((r) => r.registry_slug);

  await test('serve essere admin e almeno un modulo', async () => {
    eq((await realFetch(BASE + '/api/modules/registry/bulk-install', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
    eq((await post([])).status, 400); eq((await post(['x'])).status, 400);
  });
  await test('installa i moduli scelti, con le dipendenze', async () => {
    const r = await (await post([2])).json(); eq(r.installati.sort(), ['clienti', 'ordini']); eq(r.falliti, []); eq(slugs(), ['clienti', 'ordini']);
  });
  await test('rilanciato: salta i presenti, non duplica; id doppi contano una volta', async () => {
    const r = await (await post([1, 2, 2])).json(); eq([r.installati.length, r.saltati.sort()], [0, ['clienti', 'ordini']]);
    eq(db.prepare("SELECT COUNT(*) c FROM modules WHERE registry_slug = 'clienti'").get().c, 1);
  });
  await test('una dipendenza che la Libreria non ha viene segnalata, il resto si installa; id sconosciuto segnalato', async () => {
    const r = await (await post([3, 99])).json(); eq(r.installati, ['ore']); ok(r.falliti.some((x) => x.startsWith('mancante_in_libreria')) && r.falliti.includes('#99'), JSON.stringify(r.falliti));
  });
  console.log(`\n${passed} passati, ${failed} falliti`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
