'use strict';
// F12 (PLATFORM-MASTER-ROADMAP.md) — Measurement/Closed Loop: i due endpoint interni usati da
// Super Admin per misurare un intervento — GET /internal/resolve-module (trova lo slug locale
// di un modulo dato il suo registry_module_id) e GET /internal/module-cycle-time (tempo medio
// reale tra creazione e ultimo evento di un record, da record_history). Stesso pattern di
// audit-monitoring-feed.test.js: server reale, DB temporaneo, richieste HTTP vere — qui in più
// si verifica la matematica del calcolo con timestamp control tramite before_data/after_data
// diretti sul DB (creare record con `sleep` reali per testare ore di differenza non è
// praticabile in un test, quindi i created_at di record_history vengono scritti direttamente).
//
// Eseguire con: node src/module-cycle-time.test.js (richiede porta 34572 libera).

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const TEST_PORT = 34572;
const BASE = 'http://localhost:' + TEST_PORT;
const dbPath = path.join(os.tmpdir(), 'cycle-time-test-' + crypto.randomBytes(6).toString('hex') + '.db');

process.env.DB_PATH = dbPath;
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'cycle_test_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'cycle_test_internal_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'cycle_test_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cycle-test-uploads-'));

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
function assertEq(actual, expected, msg) { if (actual !== expected) throw new Error(`${msg || ''}: atteso ${JSON.stringify(expected)}, ottenuto ${JSON.stringify(actual)}`); }
function assertTrue(cond, msg) { if (!cond) throw new Error(msg || 'atteso true'); }
function assertClose(actual, expected, tolerance, msg) { if (Math.abs(actual - expected) > tolerance) throw new Error(`${msg || ''}: atteso ~${expected}, ottenuto ${actual}`); }

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
  const internalHeaders = { 'x-internal-secret': process.env.INTERNAL_API_SECRET };

  const SLUG = 'cycle_test_modulo';
  db.prepare('INSERT INTO modules (name, slug, icon, color, installed, sort_order, schema_json, registry_module_id) VALUES (?, ?, ?, ?, 1, 99, ?, ?)')
    .run('Modulo Test Cycle Time', SLUG, 'box', '#2563EB', '{}', 777);

  console.log('\n--- routes/audit.js — resolve-module + module-cycle-time (F12) ---');

  await test('GET /internal/resolve-module senza secret -> 401', async () => {
    const res = await fetch(BASE + '/api/audit-log/internal/resolve-module?registry_module_id=777');
    assertEq(res.status, 401);
  });

  await test('GET /internal/resolve-module trova lo slug per il registry_module_id installato', async () => {
    const res = await fetch(BASE + '/api/audit-log/internal/resolve-module?registry_module_id=777', { headers: internalHeaders });
    const body = await res.json();
    assertEq(res.status, 200);
    assertEq(body.slug, SLUG);
  });

  await test('GET /internal/resolve-module con un id mai installato -> slug null (non un errore)', async () => {
    const res = await fetch(BASE + '/api/audit-log/internal/resolve-module?registry_module_id=999999', { headers: internalHeaders });
    const body = await res.json();
    assertEq(res.status, 200);
    assertEq(body.slug, null);
  });

  // Timestamp diretti su record_history — 2 record: uno "chiuso" dopo 10 ore, uno mai più
  // toccato dopo la creazione (deve essere ESCLUSO dalla media, non contare come 0 ore).
  const base = new Date('2026-01-01T00:00:00.000Z');
  const iso = (hoursOffset) => new Date(base.getTime() + hoursOffset * 3600000).toISOString();
  db.prepare('INSERT INTO record_history (record_id, module_slug, actor, action, created_at) VALUES (?, ?, ?, ?, ?)').run(1, SLUG, 'tester', 'create', iso(0));
  db.prepare('INSERT INTO record_history (record_id, module_slug, actor, action, created_at) VALUES (?, ?, ?, ?, ?)').run(1, SLUG, 'tester', 'update', iso(10));
  db.prepare('INSERT INTO record_history (record_id, module_slug, actor, action, created_at) VALUES (?, ?, ?, ?, ?)').run(2, SLUG, 'tester', 'create', iso(2));
  // record 3: creato PRIMA della finestra since/until del test sotto — deve essere escluso.
  db.prepare('INSERT INTO record_history (record_id, module_slug, actor, action, created_at) VALUES (?, ?, ?, ?, ?)').run(3, SLUG, 'tester', 'create', iso(-100));
  db.prepare('INSERT INTO record_history (record_id, module_slug, actor, action, created_at) VALUES (?, ?, ?, ?, ?)').run(3, SLUG, 'tester', 'update', iso(-90));

  await test('GET /internal/module-cycle-time calcola la media SOLO sui record con un evento successivo, nella finestra', async () => {
    const since = iso(-1), until = iso(50);
    const res = await fetch(BASE + '/api/audit-log/internal/module-cycle-time?module_slug=' + SLUG + '&since=' + encodeURIComponent(since) + '&until=' + encodeURIComponent(until), { headers: internalHeaders });
    const body = await res.json();
    assertEq(res.status, 200);
    assertEq(body.sampleSize, 1, 'solo il record 1 ha un evento successivo dentro la finestra; il record 2 (mai più toccato) e il 3 (fuori finestra) esclusi');
    assertClose(body.averageHours, 10, 0.01, 'il record 1 impiega esattamente 10 ore tra create e update');
  });

  await test('GET /internal/module-cycle-time su un modulo senza storico -> averageHours null, sampleSize 0', async () => {
    const res = await fetch(BASE + '/api/audit-log/internal/module-cycle-time?module_slug=modulo_mai_esistito&since=' + encodeURIComponent(iso(0)) + '&until=' + encodeURIComponent(iso(100)), { headers: internalHeaders });
    const body = await res.json();
    assertEq(res.status, 200);
    assertEq(body.averageHours, null);
    assertEq(body.sampleSize, 0);
  });

  console.log(`\n${'='.repeat(60)}`);
  console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
  if (failed > 0) console.log('Falliti: ' + failures.join(', '));
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Suite module-cycle-time fallita ad avviarsi:', e);
  process.exit(1);
});
