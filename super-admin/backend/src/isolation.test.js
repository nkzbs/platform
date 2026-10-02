'use strict';
// Test di integrazione reale (server Express vero, DB SQLite temporaneo, HTTP
// via fetch) — a differenza degli altri *.test.js in questo repo (funzioni
// pure, nessun DB/HTTP reale).
//
// Rimozione del concetto Partner (2026-09-27): questa suite era G3
// (PLATFORM-0.6-GAP-ANALYSIS.md), interamente dedicata a verificare
// l'isolamento cross-partner (Partner A non vede/tocca i dati di Partner B).
// Con un solo operatore e un solo ruolo (admin) non esiste più un "altro" da
// isolare — la fixture a 2 partner e i ~19 test di ownership cross-partner
// (tenants/support/incidents/registry/verticals/monitoring/analytics/users,
// più il ruolo partner_viewer, ormai sparito) sono stati rimossi in blocco:
// testavano scenari non più possibili per costruzione, non un comportamento
// da preservare. Resta solo l'unico scenario che non era mai stato
// specificamente sull'ownership tra due identità, ma sullo stato
// dell'account: la revoca di sessione su un utente disabilitato.
//
// Eseguire con: node src/isolation.test.js (richiede porta 34567 libera in locale).

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const TEST_PORT = 34567;
const BASE = 'http://localhost:' + TEST_PORT;
const dbPath = path.join(os.tmpdir(), 'isolation-test-' + crypto.randomBytes(6).toString('hex') + '.db');

process.env.DB_PATH = dbPath;
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'isolation_test_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'isolation_test_internal_' + crypto.randomBytes(8).toString('hex');
process.env.SUPPORT_UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'isolation-test-uploads-'));

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
  if (actual !== expected) {
    throw new Error(`${msg || ''}: atteso ${JSON.stringify(expected)}, ottenuto ${JSON.stringify(actual)}`);
  }
}

async function waitForServer(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(BASE + '/health');
      if (res.ok) return;
    } catch (e) { /* non ancora in ascolto */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Server Super Admin non pronto entro ' + timeoutMs + 'ms');
}

async function main() {
  require('./index.js');
  await waitForServer(10000);

  const db = require('./db'); // stesso singleton già istanziato da index.js (require cache)
  const bcrypt = require('bcryptjs');

  const passwordHash = bcrypt.hashSync('isolation_test_pw', 10);
  db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('isotest_disableme', ?, 'admin')").run(passwordHash);

  async function login(username) {
    const res = await fetch(BASE + '/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: 'isolation_test_pw' }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error('Login fallito per ' + username + ': ' + JSON.stringify(data));
    return data.token;
  }

  // ─── REVOCA SESSIONE SU UTENTE DISABILITATO — buco trovato in F0.1.7.1.D1 ────────
  // Bug reale del 2026-08-23: disabilitare un utente non revocava le sessioni già
  // firmate, un JWT valido restava pienamente valido fino a scadenza (24h). Fix in
  // requireAuth (auth.js) verifica users.active ad ogni richiesta.
  console.log('\n--- auth.js (revoca sessione, F0.1.7.1.D2) ---');
  const tokenDisableme = await login('isotest_disableme');
  const authDisableme = { Authorization: 'Bearer ' + tokenDisableme };
  await test('Un token valido funziona PRIMA della disabilitazione — controllo positivo', async () => {
    const res = await fetch(BASE + '/api/tenants', { headers: authDisableme });
    assertEq(res.status, 200);
  });
  await test('Lo STESSO token, dopo aver disabilitato l\'utente, smette di funzionare -> 401', async () => {
    db.prepare("UPDATE users SET active = 0 WHERE username = 'isotest_disableme'").run();
    const res = await fetch(BASE + '/api/tenants', { headers: authDisableme });
    assertEq(res.status, 401);
  });

  console.log(`\n${'='.repeat(60)}`);
  console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
  if (failed > 0) console.log('Falliti: ' + failures.join(', '));

  try { fs.unlinkSync(dbPath); } catch (e) {}
  try { fs.rmSync(process.env.SUPPORT_UPLOAD_DIR, { recursive: true, force: true }); } catch (e) {}
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Suite di isolamento fallita ad avviarsi:', e);
  try { fs.unlinkSync(dbPath); } catch (e2) {}
  try { fs.rmSync(process.env.SUPPORT_UPLOAD_DIR, { recursive: true, force: true }); } catch (e2) {}
  process.exit(1);
});
