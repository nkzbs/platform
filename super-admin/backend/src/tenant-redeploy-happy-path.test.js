'use strict';
// P2 (collaudo operativo 2026-09-03) — redeploy-all-sandbox-exclusion.test.js punta DELIBERATAMENTE a PROVISIONER_URL
// chiuso: verificano solo che il guard blocchi/salti PRIMA di chiamare il provisioner,
// mai un redeploy che va davvero a buon fine. Questa suite copre il pezzo mancante: il
// percorso "felice" reale (status aggiornato, audit_log scritto) E il blocco per
// sessione attiva (con e senza force) — tutta logica di routes/tenants.js, mai
// esercitata prima, distinta da provisioner.test.js (che verifica solo la meccanica
// Docker sottostante contro un demone reale).
//
// Un finto docker-provisioner (http.Server locale, stesso principio già usato in
// tenant-status-reconciler.test.js) al posto del vero servizio — nessun Docker reale
// coinvolto qui, la meccanica del redeploy è già testata altrove.
//
// Eseguire con: node src/tenant-redeploy-happy-path.test.js (richiede le porte 34592/34593 libere).

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const Database = require('better-sqlite3');

const TEST_PORT = 34592;
const FAKE_PROVISIONER_PORT = 34593;
const BASE = 'http://localhost:' + TEST_PORT;
const dbPath = path.join(os.tmpdir(), 'redeploy-happy-test-' + crypto.randomBytes(6).toString('hex') + '.db');

process.env.DB_PATH = dbPath;
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'redeploy_happy_test_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'redeploy_happy_test_internal_' + crypto.randomBytes(8).toString('hex');
process.env.PROVISIONER_URL = 'http://127.0.0.1:' + FAKE_PROVISIONER_PORT;
process.env.SUPPORT_UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'redeploy-happy-test-uploads-'));

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

let redeployCalls = 0;
function startFakeProvisioner() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.method === 'POST' && /^\/tenants\/[^/]+\/redeploy$/.test(req.url)) {
        redeployCalls++;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      res.writeHead(404); res.end();
    });
    server.listen(FAKE_PROVISIONER_PORT, () => resolve(server));
  });
}

async function waitForServer(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const res = await fetch(BASE + '/health'); if (res.ok) return; } catch (e) { /* non ancora in ascolto */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Server Super Admin non pronto entro ' + timeoutMs + 'ms');
}

async function main() {
  const fakeProvisioner = await startFakeProvisioner();
  require('./index.js');
  await waitForServer(10000);

  const db = require('./db');
  const bcrypt = require('bcryptjs');
  const passwordHash = bcrypt.hashSync('redeploy_happy_pw', 10);
  db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('rh_core', ?, 'admin')").run(passwordHash);

  // Tenant reale nel DB di Super Admin, con un vero file .db (letto in sola lettura
  // dal guard di sessione attiva — vedi redeployTenant() in routes/tenants.js).
  const tenantDbPath = path.join(os.tmpdir(), 'rh-tenant-' + crypto.randomBytes(4).toString('hex') + '.db');
  const tdb = new Database(tenantDbPath);
  tdb.exec('CREATE TABLE sessions (username TEXT, last_active_at DATETIME)');
  tdb.close();
  db.prepare("INSERT INTO tenants (name, slug, port, db_path, status) VALUES ('RH Tenant', 'rh-tenant', 49850, ?, 'active')").run(tenantDbPath);

  const loginRes = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'rh_core', password: 'redeploy_happy_pw' }) });
  const auth = { Authorization: 'Bearer ' + (await loginRes.json()).token, 'Content-Type': 'application/json' };

  console.log('\n--- routes/tenants.js — redeploy: percorso felice reale (P2, prima mai esercitato) ---');

  await test('POST /:slug/redeploy senza sessioni attive -> 200, chiama davvero il provisioner, status resta active, audit_log scritto', async () => {
    const before = redeployCalls;
    const res = await fetch(BASE + '/api/tenants/rh-tenant/redeploy', { method: 'POST', headers: auth, body: JSON.stringify({}) });
    assertEq(res.status, 200);
    assertEq(redeployCalls, before + 1, 'il provisioner deve essere stato chiamato per davvero, non saltato');
    const tenant = db.prepare("SELECT status FROM tenants WHERE slug = 'rh-tenant'").get();
    assertEq(tenant.status, 'active');
    const entry = db.prepare("SELECT * FROM audit_log WHERE action = 'tenant.redeploy' AND target = 'rh-tenant' ORDER BY id DESC LIMIT 1").get();
    assertTrue(!!entry, 'deve esistere una riga audit_log tenant.redeploy');
    assertEq(JSON.parse(entry.details).forced, false);
  });

  await test('sessione attiva reale (last_active_at negli ultimi 3 minuti) -> 409, provisioner MAI chiamato', async () => {
    const tdb2 = new Database(tenantDbPath);
    tdb2.prepare("INSERT INTO sessions (username, last_active_at) VALUES ('utente_reale', datetime('now'))").run();
    tdb2.close();

    const before = redeployCalls;
    const res = await fetch(BASE + '/api/tenants/rh-tenant/redeploy', { method: 'POST', headers: auth, body: JSON.stringify({}) });
    assertEq(res.status, 409);
    const body = await res.json();
    assertEq(body.active_session.username, 'utente_reale');
    assertEq(redeployCalls, before, 'con una sessione attiva il provisioner non deve MAI essere chiamato');
  });

  await test('stessa sessione attiva, ma force:true -> 200, bypassa il blocco, provisioner chiamato', async () => {
    const before = redeployCalls;
    const res = await fetch(BASE + '/api/tenants/rh-tenant/redeploy', { method: 'POST', headers: auth, body: JSON.stringify({ force: true }) });
    assertEq(res.status, 200);
    assertEq(redeployCalls, before + 1);
    const entry = db.prepare("SELECT * FROM audit_log WHERE action = 'tenant.redeploy' AND target = 'rh-tenant' ORDER BY id DESC LIMIT 1").get();
    assertEq(JSON.parse(entry.details).forced, true);
  });

  fakeProvisioner.close();
  console.log(`\n${'='.repeat(60)}`);
  console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
  if (failed > 0) console.log('Falliti: ' + failures.join(', '));
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Suite tenant-redeploy-happy-path fallita ad avviarsi:', e);
  process.exit(1);
});
