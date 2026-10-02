'use strict';
// F9 (PLATFORM-MASTER-ROADMAP.md) — Observability Foundation: GET /api/audit-log/internal/
// monitoring-feed (routes/audit.js) ora espone anche business_events, letti da record_history
// (già esistente, popolato da records.js su create/update/delete/transition) — prima Super
// Admin vedeva solo audit_log/error_logs in questo feed, mai cosa succedeva ai record dei
// moduli (l'equivalente di "ordine/pagamento/fattura/stock" della roadmap, dato che questo
// sistema non ha entità business hardcoded). Stesso pattern di records-crud.test.js: server
// reale, DB temporaneo, richieste HTTP vere.
//
// Eseguire con: node src/audit-monitoring-feed.test.js (richiede porta 34569 libera).

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const TEST_PORT = 34569;
const BASE = 'http://localhost:' + TEST_PORT;
const dbPath = path.join(os.tmpdir(), 'audit-feed-test-' + crypto.randomBytes(6).toString('hex') + '.db');

process.env.DB_PATH = dbPath;
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'audit_feed_test_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'audit_feed_test_internal_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'audit_feed_test_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-feed-test-uploads-'));

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
function assertTrue(cond, msg) { if (!cond) throw new Error(msg || 'atteso true'); }

async function waitForServer(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(BASE + '/health');
      if (res.ok) return;
    } catch (e) { /* non ancora in ascolto */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Server Core non pronto entro ' + timeoutMs + 'ms');
}

async function main() {
  require('./index.js');
  await waitForServer(10000);

  const db = require('./db');

  const SLUG = 'audit_feed_test_modulo';
  const schema = { fields: [{ key: 'nome', type: 'text', label: 'Nome' }] };
  db.prepare('INSERT INTO modules (name, slug, icon, color, installed, sort_order, schema_json) VALUES (?, ?, ?, ?, 1, 99, ?)')
    .run('Modulo Test Audit Feed', SLUG, 'box', '#2563EB', JSON.stringify(schema));

  const loginRes = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: process.env.INITIAL_ADMIN_PASSWORD }),
  });
  const auth = { Authorization: 'Bearer ' + (await loginRes.json()).token, 'Content-Type': 'application/json' };
  const internalHeaders = { 'x-internal-secret': process.env.INTERNAL_API_SECRET, 'Content-Type': 'application/json' };

  console.log('\n--- routes/audit.js — internal/monitoring-feed espone business_events (F9) ---');

  await test('GET /internal/monitoring-feed senza secret -> 401', async () => {
    const res = await fetch(BASE + '/api/audit-log/internal/monitoring-feed');
    assertEq(res.status, 401);
  });

  let createdId = null;
  await test('creazione di un record produce un business_event con action="create"', async () => {
    const createRes = await fetch(BASE + '/api/records/' + SLUG, { method: 'POST', headers: auth, body: JSON.stringify({ nome: 'Prova' }) });
    createdId = (await createRes.json()).id;

    const feedRes = await fetch(BASE + '/api/audit-log/internal/monitoring-feed?limit=50', { headers: internalHeaders });
    const feed = await feedRes.json();
    assertEq(feedRes.status, 200);
    assertTrue(Array.isArray(feed.business_events), 'business_events deve essere un array');
    const ev = feed.business_events.find((e) => e.record_id === createdId && e.action === 'create');
    assertTrue(!!ev, 'deve esistere un evento create per il record appena creato');
    assertEq(ev.module_slug, SLUG);
    assertEq(ev.actor, 'admin');
  });

  await test('aggiornamento dello stesso record produce un SECONDO business_event, action="update"', async () => {
    await fetch(BASE + '/api/records/' + SLUG + '/' + createdId, { method: 'PUT', headers: auth, body: JSON.stringify({ nome: 'Prova modificata' }) });

    const feedRes = await fetch(BASE + '/api/audit-log/internal/monitoring-feed?limit=50', { headers: internalHeaders });
    const feed = await feedRes.json();
    const events = feed.business_events.filter((e) => e.record_id === createdId);
    assertTrue(events.some((e) => e.action === 'create'), 'l\'evento create originale deve restare');
    assertTrue(events.some((e) => e.action === 'update'), 'deve comparire anche l\'evento update');
  });

  await test('business_events non contiene before_data/after_data (solo cosa è successo, non i valori)', async () => {
    const feedRes = await fetch(BASE + '/api/audit-log/internal/monitoring-feed?limit=50', { headers: internalHeaders });
    const feed = await feedRes.json();
    const ev = feed.business_events.find((e) => e.record_id === createdId);
    assertTrue(ev.before_data === undefined && ev.after_data === undefined, 'i valori dei campi non devono uscire da questo feed aggregato');
  });

  console.log(`\n${'='.repeat(60)}`);
  console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
  if (failed > 0) console.log('Falliti: ' + failures.join(', '));
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Suite audit-monitoring-feed fallita ad avviarsi:', e);
  process.exit(1);
});
