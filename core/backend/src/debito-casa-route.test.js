'use strict';
// Rotta GET /api/debito-casa — stessa risposta già data dal bot, qui come API (per il
// server MCP, 25/10/2026). Server reale, login reale.
// Eseguire con: node src/debito-casa-route.test.js (porta 34825)

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const TEST_PORT = 34825;
const BASE = 'http://localhost:' + TEST_PORT;
const dbPath = path.join(os.tmpdir(), 'dc-route-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.DB_PATH = dbPath;
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'dc_route_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'dc_route_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-route-uploads-'));

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; }
}
function assertEq(a, e, msg) { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${msg || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); }

async function main() {
  require('./index.js');
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const login = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: process.env.INITIAL_ADMIN_PASSWORD }) })).json();
  const H = { Authorization: 'Bearer ' + login.token };

  await test('senza login -> 401', async () => {
    assertEq((await fetch(BASE + '/api/debito-casa')).status, 401);
  });
  await test('senza niente configurato -> attivo:false', async () => {
    const r = await (await fetch(BASE + '/api/debito-casa', { headers: H })).json();
    assertEq(r, { attivo: false });
  });

  console.log('\n--- con i moduli giusti configurati ---');
  const db = require('./db');
  const roles = require('./module-roles');
  const F = (key, label, type, extra = {}) => ({ id: 'f_' + key, block_type: 'field', key, label, type, ...extra });
  const addModule = (slug, name, steps) => db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES (?, ?, 'box', '#000', 1, 1, 50, ?)").run(name, slug, JSON.stringify({ version: 3, steps }));
  addModule('entrate', 'Entrate', [F('descrizione', 'Descrizione', 'text'), F('importo', 'Importo', 'currency'), F('data', 'Data', 'date'), F('categoria', 'Categoria', 'select', { options: ['Stipendio', 'Contributo Admin', 'Contributo Altro'] })]);
  roles.set('entrate', { kind: 'entrata', uses: [], roles: { importo: 'importo', data: 'data', categoria: 'categoria' } });
  addModule('spese_casa', 'Spese Casa', [F('descrizione', 'Descrizione', 'text'), F('importo', 'Importo', 'currency'), F('data', 'Data', 'date'), F('pagato_da', 'Pagato da', 'select', { options: ['Admin', 'Altro'] })]);
  roles.set('spese_casa', { kind: 'spesa', uses: [], roles: { pagato_da: 'pagato_da' } });
  require('./debito-casa').setQuote({ nome_a: 'Admin', nome_b: 'Altro', quota_a: 500, quota_b: 400 });
  const put = (slug, d) => db.prepare('INSERT INTO records (module_slug, user_id, data) VALUES (?, NULL, ?)').run(slug, JSON.stringify(d));
  put('entrate', { descrizione: 'contributo', importo: 500, data: '2026-09-27', categoria: 'Contributo Admin' });

  await test('con i moduli giusti: attivo:true e l\'html è la stessa risposta del bot', async () => {
    const r = await (await fetch(BASE + '/api/debito-casa', { headers: H })).json();
    assertEq(r.attivo, true);
    assertEq(typeof r.html, 'string');
    assertEq(r.html.length > 0, true);
  });

  console.log(`\n${passed} passati, ${failed} falliti su ${passed + failed} test.`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('ERRORE FATALE', e); process.exit(1); });
