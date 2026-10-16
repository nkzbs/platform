'use strict';
// Pannello "Sicurezza della piattaforma" per-tenant (routes/security-status.js) —
// versione ridotta del gemello Super Admin: SOLO i dati di questo tenant (i suoi utenti,
// il suo audit_log), niente Cloudflare/TLS (infrastruttura condivisa, non di un tenant).
//
// Eseguire con: node src/security-status.test.js (richiede la porta 34613 libera).

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const TEST_PORT = 34613;
const BASE = 'http://localhost:' + TEST_PORT;
const dbPath = path.join(os.tmpdir(), 'security-status-core-test-' + crypto.randomBytes(6).toString('hex') + '.db');

process.env.DB_PATH = dbPath;
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'security_status_core_test_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'security_status_core_test_internal_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'security_status_core_test_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'security-status-core-test-uploads-'));

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; failures.push(name); }
}
function assertEq(a, e, msg) { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${msg || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); }
function assertTrue(c, msg) { if (!c) throw new Error(msg || 'atteso true'); }

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
  const bcrypt = require('bcryptjs');

  const loginAdmin = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: process.env.INITIAL_ADMIN_PASSWORD }),
  });
  const auth = { Authorization: 'Bearer ' + (await loginAdmin.json()).token, 'Content-Type': 'application/json' };

  const agentePasswordHash = bcrypt.hashSync('sec_status_agente_pw', 10);
  db.prepare("INSERT INTO users (username, password_hash, role, active) VALUES ('sec_status_agente', ?, 'agente', 1)").run(agentePasswordHash);
  const loginAgente = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'sec_status_agente', password: 'sec_status_agente_pw' }),
  });
  const authAgente = { Authorization: 'Bearer ' + (await loginAgente.json()).token, 'Content-Type': 'application/json' };

  console.log('\n--- GET /api/security-status ---');

  await test('senza token -> 401', async () => {
    assertEq((await fetch(BASE + '/api/security-status')).status, 401);
  });

  await test('un utente non-admin (agente) -> 403, pannello riservato agli admin del tenant', async () => {
    assertEq((await fetch(BASE + '/api/security-status', { headers: authAgente })).status, 403);
  });

  const baselineActive = db.prepare('SELECT COUNT(*) AS n FROM users WHERE active = 1').get().n;

  await test('con token admin: conta solo gli utenti attivi di QUESTO tenant', async () => {
    const r = await fetch(BASE + '/api/security-status', { headers: auth });
    const j = await r.json();
    assertEq(r.status, 200);
    assertEq(j.users.total, baselineActive);
    assertTrue(!('cloudflare' in j), 'il pannello ridotto non deve avere dati di piattaforma condivisa');
  });

  await test('un utente con totp_enabled e una passkey registrata vengono contati', async () => {
    const user = db.prepare("SELECT id FROM users WHERE username = 'admin'").get();
    db.prepare('UPDATE users SET totp_enabled = 1 WHERE id = ?').run(user.id);
    db.prepare("INSERT INTO webauthn_credentials (user_id, credential_id, public_key) VALUES (?, 'cred-core-1', 'pk-1')").run(user.id);
    const j = await (await fetch(BASE + '/api/security-status', { headers: auth })).json();
    assertEq(j.users.with_2fa, 1);
    assertEq(j.users.with_passkey, 1);
  });

  await test('gli eventi sospetti vengono dall\'audit_log di questo tenant, nei soli tipi previsti', async () => {
    db.prepare("INSERT INTO audit_log (actor, action, target) VALUES ('ignoto', 'auth.login_failed', 'qualcuno')").run();
    db.prepare("INSERT INTO audit_log (actor, action, target) VALUES ('admin', 'modules.install', 'x')").run();
    const j = await (await fetch(BASE + '/api/security-status', { headers: auth })).json();
    assertTrue(j.recent_suspicious_events.some((e) => e.action === 'auth.login_failed' && e.target === 'qualcuno'));
    assertTrue(!j.recent_suspicious_events.some((e) => e.action === 'modules.install'), 'un\'azione non sospetta non deve comparire qui');
  });

  console.log(`\n${'='.repeat(60)}`);
  console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
  if (failed > 0) console.log('Falliti: ' + failures.join(', '));
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
