'use strict';
// Piano a rate creato a mano (piano-rata.js): l'importo della rata si calcola se manca. Eseguire con: node src/piano-rata.test.js (porta 34815).
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const TEST_PORT = 34815;
const BASE = 'http://localhost:' + TEST_PORT;
const dbPath = path.join(os.tmpdir(), 'piano-rata-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.DB_PATH = dbPath;
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'pr_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'pr_internal_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'pr_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-uploads-'));
process.env.SUPER_ADMIN_URL = 'http://localhost:1';
process.env.TENANT_SLUG = 'pr';

let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); console.log('  ✓ ' + name); passed++; } catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; } }
function assertEq(a, e, msg) { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${msg || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); }

const F = (key, label, type) => ({ id: 'f_' + key, block_type: 'field', key, label, type });

async function main() {
  require('./index.js');
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const db = require('./db');
  const roles = require('./module-roles');
  const add = (slug, steps) => db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES (?, ?, 'box', '#000', 1, 1, 70, ?)").run(slug, slug, JSON.stringify({ version: 3, steps }));
  add('spese_x', [F('descrizione', 'D', 'text'), F('importo', 'I', 'currency'), F('data', 'Data', 'date')]);
  add('piani_x', [F('nome', 'Nome', 'text'), F('importo_totale', 'Totale', 'currency'), F('n_rate', 'Rate', 'number'), F('importo_rata', 'Rata', 'currency'), F('data_prima_rata', 'Prima', 'date')]);
  add('altro', [F('nome', 'Nome', 'text'), F('importo_totale', 'Totale', 'currency'), F('n_rate', 'Rate', 'number'), F('importo_rata', 'Rata', 'currency')]);
  roles.set('spese_x', { kind: 'spesa', uses: ['avvisi'], roles: { importo: 'importo', data: 'data', descrizione: 'descrizione' }, avvisi: { states: { nuovo: 'n', da_fare: 'd' }, piano: { modulo: 'piani_x', campi: { nome: 'nome', importo_totale: 'importo_totale', n_rate: 'n_rate', importo_rata: 'importo_rata', data_prima_rata: 'data_prima_rata' } } } });
  const login = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: process.env.INITIAL_ADMIN_PASSWORD }) })).json();
  const H = { Authorization: 'Bearer ' + login.token, 'Content-Type': 'application/json' };
  const crea = async (slug, body) => (await (await fetch(BASE + '/api/records/' + slug, { method: 'POST', headers: H, body: JSON.stringify(body) })).json());

  await test('totale e numero di rate bastano: la rata si calcola (arrotondata ai centesimi)', async () => {
    assertEq((await crea('piani_x', { nome: 'A', importo_totale: 100, n_rate: 3, data_prima_rata: '2026-12-01' })).data.importo_rata, 33.33);
    assertEq((await crea('piani_x', { nome: 'B', importo_totale: 1109.5, n_rate: 11 })).data.importo_rata, 100.86);
  });
  await test('un importo della rata scritto a mano non si tocca', async () => {
    assertEq((await crea('piani_x', { nome: 'C', importo_totale: 1109.5, n_rate: 11, importo_rata: 100 })).data.importo_rata, 100);
  });
  await test('senza numero di rate, o senza totale, non si inventa niente', async () => {
    assertEq((await crea('piani_x', { nome: 'D', importo_totale: 775 })).data.importo_rata, undefined);
    assertEq((await crea('piani_x', { nome: 'E', n_rate: 3 })).data.importo_rata, undefined);
  });
  await test('un modulo che non è dichiarato come piano a rate non cambia', async () => {
    assertEq((await crea('altro', { nome: 'F', importo_totale: 100, n_rate: 4 })).data.importo_rata, undefined);
  });

  console.log(`\n${'='.repeat(60)}`);
  console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
  try { fs.unlinkSync(dbPath); } catch (e) {}
  process.exit(failed > 0 ? 1 : 0);
}
main().catch((e) => { console.error('Suite piano-rata fallita ad avviarsi:', e); process.exit(1); });
