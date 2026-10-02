'use strict';
// G11 (PLATFORM-0.6-GAP-ANALYSIS.md) — "vittoria gratuita" identificata il 2026-08-22, mai
// spedita fino ad ora: il filtro `updated_since` (sync incrementale) confrontava `updated_at`
// in JS DOPO aver già letto/decrittato l'intero modulo dal .db — spostato in SQL
// (`datetime(updated_at) > datetime(?)`, colonna reale mai cifrata) così le righe scartate non
// vengono nemmeno lette. Nessun test esisteva prima per questo filtro, né per il comportamento
// nuovo né per quello vecchio.
//
// Eseguire con: node src/records-updated-since.test.js (richiede porta 34575 libera).

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const TEST_PORT = 34575;
const BASE = 'http://localhost:' + TEST_PORT;
const dbPath = path.join(os.tmpdir(), 'updated-since-test-' + crypto.randomBytes(6).toString('hex') + '.db');

process.env.DB_PATH = dbPath;
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'us_test_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'us_test_internal_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'us_test_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'us-test-uploads-'));

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
  const SLUG = 'updated_since_test_modulo';
  const schema = { fields: [{ key: 'nome', label: 'Nome', type: 'text' }] };
  db.prepare('INSERT INTO modules (name, slug, icon, color, installed, sort_order, schema_json) VALUES (?, ?, ?, ?, 1, 99, ?)')
    .run('Modulo Test Updated Since', SLUG, 'box', '#2563EB', JSON.stringify(schema));

  const loginRes = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: process.env.INITIAL_ADMIN_PASSWORD }),
  });
  const auth = { Authorization: 'Bearer ' + (await loginRes.json()).token, 'Content-Type': 'application/json' };

  console.log('\n--- records.js — GET /:slug?updated_since (G11, filtro spostato in SQL) ---');

  // Due record con updated_at scritti direttamente (evita di dipendere da un vero delay tra
  // due richieste HTTP, che renderebbe il test lento e fragile) — stesso principio già usato
  // in module-cycle-time.test.js per record_history.
  const now = Date.now();
  const oldRes = await fetch(BASE + '/api/records/' + SLUG, { method: 'POST', headers: auth, body: JSON.stringify({ nome: 'Vecchio' }) });
  const oldId = (await oldRes.json()).id;
  db.prepare('UPDATE records SET updated_at = ? WHERE id = ?').run(new Date(now - 3600000).toISOString(), oldId); // 1h fa

  const newRes = await fetch(BASE + '/api/records/' + SLUG, { method: 'POST', headers: auth, body: JSON.stringify({ nome: 'Nuovo' }) });
  const newId = (await newRes.json()).id;
  db.prepare('UPDATE records SET updated_at = ? WHERE id = ?').run(new Date(now + 3600000).toISOString(), newId); // fra 1h

  await test('senza updated_since -> entrambi i record (comportamento invariato)', async () => {
    const res = await fetch(BASE + '/api/records/' + SLUG, { headers: auth });
    const list = await res.json();
    assertEq(list.length, 2);
  });

  await test('con updated_since=adesso -> solo il record "nuovo" (updated_at nel futuro)', async () => {
    const res = await fetch(BASE + '/api/records/' + SLUG + '?updated_since=' + encodeURIComponent(new Date(now).toISOString()), { headers: auth });
    const list = await res.json();
    assertEq(list.length, 1);
    assertEq(list[0].id, newId);
  });

  await test('con updated_since nel lontano futuro -> nessun record', async () => {
    const res = await fetch(BASE + '/api/records/' + SLUG + '?updated_since=' + encodeURIComponent(new Date(now + 7200000).toISOString()), { headers: auth });
    const list = await res.json();
    assertEq(list.length, 0);
  });

  await test('con updated_since non valido -> ignorato silenziosamente (comportamento invariato), entrambi i record', async () => {
    const res = await fetch(BASE + '/api/records/' + SLUG + '?updated_since=non-una-data', { headers: auth });
    const list = await res.json();
    assertEq(list.length, 2);
  });

  await test('updated_since combinato con limit/offset (X-Total-Count riflette solo il post-filtro)', async () => {
    const res = await fetch(BASE + '/api/records/' + SLUG + '?updated_since=' + encodeURIComponent(new Date(now).toISOString()) + '&limit=10&offset=0', { headers: auth });
    const list = await res.json();
    assertEq(list.length, 1);
    assertEq(res.headers.get('x-total-count'), '1');
  });

  console.log(`\n${'='.repeat(60)}`);
  console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
  if (failed > 0) console.log('Falliti: ' + failures.join(', '));
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Suite records-updated-since fallita ad avviarsi:', e);
  process.exit(1);
});
