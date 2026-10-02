'use strict';
// P2 (collaudo operativo 2026-09-03) — /monitoring/timeline (la vista aggregata
// cross-tenant di Super Admin, diversa dal log per-tenant già paginato in una
// sessione precedente) aveva un tetto fisso a 500: oltre quello le azioni più
// vecchie diventavano irraggiungibili PER SEMPRE, non solo "non ancora caricate".
// Qui: cursore `before` reale, verificato su dati propri di Super Admin (audit_log)
// senza bisogno di un tenant Docker vero (fetchTenantMonitoringFeed fallisce in
// modo pulito su un tenant irraggiungibile, non fa fallire il test).
//
// Eseguire con: node src/monitoring-timeline-pagination.test.js (richiede la porta 34589 libera).

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const TEST_PORT = 34589;
const BASE = 'http://localhost:' + TEST_PORT;
const dbPath = path.join(os.tmpdir(), 'monitoring-pagination-test-' + crypto.randomBytes(6).toString('hex') + '.db');

process.env.DB_PATH = dbPath;
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'monitoring_pagination_test_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'monitoring_pagination_test_internal_' + crypto.randomBytes(8).toString('hex');
process.env.SUPPORT_UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'monitoring-pagination-test-uploads-'));

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
  throw new Error('Server Super Admin non pronto entro ' + timeoutMs + 'ms');
}

async function main() {
  require('./index.js');
  await waitForServer(10000);

  const db = require('./db');
  const bcrypt = require('bcryptjs');
  const passwordHash = bcrypt.hashSync('mon_pag_test_pw', 10);
  db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('mon_pag_core', ?, 'admin')").run(passwordHash);

  // 12 righe di audit_log con timestamp DISTINTI e crescenti (uno al secondo),
  // deliberatamente nel futuro (2030) — servono per poter tagliare in pagine di 5
  // in modo deterministico E restare sempre le righe più recenti nella timeline,
  // anche sopra la riga reale auth.login che il login qui sotto genera da sola
  // (P2-5, stessa sessione: /api/auth/login ora scrive in audit_log, col
  // timestamp vero di adesso — se i dati seminati fossero "oggi" l'ordine tra
  // le due diventerebbe non deterministico).
  const insert = db.prepare("INSERT INTO audit_log (actor, action, target, created_at) VALUES ('mon_pag_core', 'test.event', ?, ?)");
  const base = new Date('2030-01-01T00:00:00Z').getTime();
  for (let i = 0; i < 12; i++) {
    insert.run('evt-' + i, new Date(base + i * 1000).toISOString().replace('T', ' ').replace('Z', ''));
  }

  const loginRes = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'mon_pag_core', password: 'mon_pag_test_pw' }) });
  const auth = { Authorization: 'Bearer ' + (await loginRes.json()).token };

  console.log('\n--- monitoring.js — /timeline: cursore before reale (P2, prima un tetto fisso a 500) ---');

  let firstPageOldest;
  await test('prima pagina (limit=5) -> 5 righe, has_more=true (12 righe totali seminate)', async () => {
    const res = await fetch(BASE + '/api/monitoring/timeline?limit=5', { headers: auth });
    assertEq(res.status, 200);
    const body = await res.json();
    assertTrue(Array.isArray(body.rows), 'la risposta deve avere .rows, non essere un array nudo');
    assertEq(body.rows.length, 5);
    assertEq(body.has_more, true);
    // Le nostre 12 righe di test sono le più recenti seminate (created_at 2026, il
    // resto del DB di test è vuoto) — le 5 più recenti sono evt-11..evt-7.
    assertEq(body.rows[0].target, 'evt-11', 'la riga più recente deve essere la prima');
    firstPageOldest = body.rows[body.rows.length - 1].created_at;
  });

  await test('seconda pagina (before=la più vecchia della prima) -> le 5 righe SUCCESSIVE, nessuna sovrapposizione', async () => {
    const res = await fetch(BASE + '/api/monitoring/timeline?limit=5&before=' + encodeURIComponent(firstPageOldest), { headers: auth });
    const body = await res.json();
    assertEq(body.rows.length, 5);
    assertEq(body.rows[0].target, 'evt-6', 'deve riprendere esattamente da dove si era fermata la prima pagina');
    const overlap = body.rows.some((r) => r.target === 'evt-11' || r.target === 'evt-7');
    assertTrue(!overlap, 'nessuna riga della prima pagina deve ricomparire nella seconda');
  });

  await test('terza pagina (before=la più vecchia della seconda) -> evt-1 ed evt-0 (più la riga reale auth.login di questo stesso test, inevitabilmente più vecchia di tutte le righe sintetiche 2030), has_more=false', async () => {
    const res2 = await fetch(BASE + '/api/monitoring/timeline?limit=5&before=' + encodeURIComponent(firstPageOldest), { headers: auth });
    const secondOldest = (await res2.json()).rows.slice(-1)[0].created_at;
    const res = await fetch(BASE + '/api/monitoring/timeline?limit=5&before=' + encodeURIComponent(secondOldest), { headers: auth });
    const body = await res.json();
    const testEvents = body.rows.filter((r) => r.target && r.target.startsWith('evt-'));
    assertEq(testEvents.length, 2, 'restano solo evt-1 ed evt-0 (12 seminate - 5 - 5)');
    assertEq(testEvents[0].target, 'evt-1'); assertEq(testEvents[1].target, 'evt-0');
    assertEq(body.has_more, false, 'meno righe del limit richiesto -> nessun\'altra pagina');
  });

  await test('senza `before` (comportamento invariato per chi non pagina) -> stessa forma {rows, has_more}', async () => {
    const res = await fetch(BASE + '/api/monitoring/timeline', { headers: auth });
    const body = await res.json();
    assertTrue(Array.isArray(body.rows));
    assertTrue(typeof body.has_more === 'boolean');
  });

  console.log(`\n${'='.repeat(60)}`);
  console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
  if (failed > 0) console.log('Falliti: ' + failures.join(', '));
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Suite monitoring-timeline-pagination fallita ad avviarsi:', e);
  process.exit(1);
});
