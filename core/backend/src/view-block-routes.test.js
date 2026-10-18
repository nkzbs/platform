'use strict';
// Bug reale trovato dal vivo il 18/10 testando su Finance: le 5 route che calcolano i
// dati delle Viste (period-view, yearly-breakdown, category-pivot, weekly-breakdown,
// parent-children) cercavano il blocco SOLO negli array legacy (period_views,
// yearly_breakdowns, ecc.), mai nel nuovo array `views` (block_type unificato 'view',
// Builder semplificato fase 1) — un modulo che usa solo il nuovo block_type dava
// sempre 404 "Vista non trovata", anche con lo schema pubblicato correttamente.
//
// Eseguire con: node src/view-block-routes.test.js (richiede porta 34594 libera).

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const TEST_PORT = 34594;
const BASE = 'http://localhost:' + TEST_PORT;
const dbPath = path.join(os.tmpdir(), 'view-block-routes-test-' + crypto.randomBytes(6).toString('hex') + '.db');

process.env.DB_PATH = dbPath;
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'view_block_test_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'view_block_test_internal_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'view_block_test_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'view-block-routes-test-uploads-'));

let passed = 0, failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    console.log('  ✓ ' + name);
    passed++;
  } catch (e) {
    console.error('  ✗ ' + name);
    console.error('    ' + e.message);
    failed++;
    failures.push(name);
  }
}

function assertEq(actual, expected, msg) {
  if (actual !== expected) throw new Error(`${msg || ''}: atteso ${JSON.stringify(expected)}, ottenuto ${JSON.stringify(actual)}`);
}

async function waitForServer(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const res = await fetch(BASE + '/health'); if (res.ok) return; } catch (e) { /* non ancora in ascolto */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Server Core non pronto entro ' + timeoutMs + 'ms');
}

async function main() {
  require('./index.js');
  await waitForServer(10000);

  const db = require('./db');

  // Modulo con SOLO blocchi del nuovo block_type unificato 'view' — nessun blocco
  // legacy period_view/category_pivot/ecc., esattamente il caso che dava 404.
  const SLUG = 'view_block_test_modulo';
  const schema = {
    version: 3,
    steps: [
      { id: 'fld_data', block_type: 'field', key: 'data', label: 'Data', type: 'date' },
      { id: 'fld_importo', block_type: 'field', key: 'importo', label: 'Importo', type: 'number' },
      {
        id: 'vie_periodo', block_type: 'view', key: 'vista_periodo', label: 'Vista periodo',
        mode: 'period', placement: 'add', granularity: 'mese', date_field: 'data', breakdown: false,
        metrics: [{ key: 'tot', label: 'Totale', field: 'importo', func: 'sum', format: 'currency' }], filters: [],
      },
      {
        id: 'vie_annuale', block_type: 'view', key: 'vista_annuale', label: 'Vista annuale',
        mode: 'period', placement: 'add', date_field: 'data', breakdown: true,
        metrics: [{ key: 'tot', label: 'Totale', field: 'importo', func: 'sum', format: 'currency' }], filters: [],
      },
      {
        id: 'vie_pivot', block_type: 'view', key: 'vista_pivot', label: 'Vista pivot',
        mode: 'pivot', placement: 'add', date_field: 'data', group_by: 'importo',
        metric_field: 'importo', metric_func: 'sum', metric_format: 'currency', n_years: 2, filters: [],
      },
      {
        id: 'vie_semplice', block_type: 'view', key: 'vista_semplice', label: 'Vista semplice',
        mode: 'simple', placement: 'add', date_field: 'data',
        metric_field: 'importo', metric_func: 'sum', metric_format: 'currency', filters: [],
      },
    ],
  };
  db.prepare('INSERT INTO modules (name, slug, icon, color, installed, sort_order, schema_json) VALUES (?, ?, ?, ?, 1, 99, ?)')
    .run('Modulo Test Vista', SLUG, 'box', '#2563EB', JSON.stringify(schema));

  const loginRes = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: process.env.INITIAL_ADMIN_PASSWORD }),
  });
  const auth = { Authorization: 'Bearer ' + (await loginRes.json()).token, 'Content-Type': 'application/json' };

  console.log('\n--- records.js — le 5 route Vista trovano anche i blocchi del nuovo block_type \'view\' ---');

  await test('GET /:slug/period-view/:key su un blocco view mode:period (senza breakdown) -> 200, non 404', async () => {
    const res = await fetch(BASE + '/api/records/' + SLUG + '/period-view/vista_periodo', { headers: auth });
    assertEq(res.status, 200);
    const body = await res.json();
    assertEq(body.key, 'vista_periodo');
  });

  await test('GET /:slug/yearly-breakdown/:key su un blocco view mode:period con breakdown -> 200, non 404', async () => {
    const res = await fetch(BASE + '/api/records/' + SLUG + '/yearly-breakdown/vista_annuale', { headers: auth });
    assertEq(res.status, 200);
    const body = await res.json();
    assertEq(body.key, 'vista_annuale');
  });

  await test('GET /:slug/category-pivot/:key su un blocco view mode:pivot -> 200, non 404', async () => {
    const res = await fetch(BASE + '/api/records/' + SLUG + '/category-pivot/vista_pivot', { headers: auth });
    assertEq(res.status, 200);
    const body = await res.json();
    assertEq(body.key, 'vista_pivot');
  });

  await test('GET /:slug/weekly-breakdown/:key su un blocco view mode:simple -> 200, non 404', async () => {
    const res = await fetch(BASE + '/api/records/' + SLUG + '/weekly-breakdown/vista_semplice', { headers: auth });
    assertEq(res.status, 200);
    const body = await res.json();
    assertEq(body.key, 'vista_semplice');
  });

  await test('GET /:slug/period-view/:key con una chiave inesistente -> 404 reale (il fix non deve coprire tutto)', async () => {
    const res = await fetch(BASE + '/api/records/' + SLUG + '/period-view/non_esiste', { headers: auth });
    assertEq(res.status, 404);
  });

  console.log(`\n${'='.repeat(60)}`);
  console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
  if (failed > 0) console.log('Falliti: ' + failures.join(', '));

  try { fs.unlinkSync(dbPath); } catch (e) {}
  try { fs.rmSync(process.env.UPLOAD_DIR, { recursive: true, force: true }); } catch (e) {}
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Suite view-block-routes fallita ad avviarsi:', e);
  try { fs.unlinkSync(dbPath); } catch (e2) {}
  try { fs.rmSync(process.env.UPLOAD_DIR, { recursive: true, force: true }); } catch (e2) {}
  process.exit(1);
});
