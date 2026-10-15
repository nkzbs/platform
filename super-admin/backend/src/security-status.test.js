'use strict';
// Pannello "Sicurezza della piattaforma" (routes/security-status.js) — stato 2FA/passkey
// degli admin di Super Admin, modalità TLS di Cloudflare (se configurato), ultimi eventi
// sospetti da audit_log. Nessuna chiamata di rete vera verso Cloudflare: simulata.
//
// Eseguire con: node src/security-status.test.js (richiede la porta 34612 libera).

const path = require('path');
const os = require('os');
const crypto = require('crypto');

const TEST_PORT = 34612;
const BASE = 'http://localhost:' + TEST_PORT;

process.env.DB_PATH = path.join(os.tmpdir(), 'security-status-sa-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'security_status_test_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'security_status_test_internal_' + crypto.randomBytes(8).toString('hex');
process.env.ENCRYPTION_KEY = 'security_status_test_enc_' + crypto.randomBytes(8).toString('hex');

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
  throw new Error('Server Super Admin non pronto entro ' + timeoutMs + 'ms');
}

async function main() {
  require('./index.js');
  await waitForServer(10000);

  const db = require('./db');
  const bcrypt = require('bcryptjs');
  const passwordHash = bcrypt.hashSync('sec_status_test_pw', 10);
  db.prepare("INSERT INTO users (username, password_hash, role, active) VALUES ('sec_status_user', ?, 'admin', 1)").run(passwordHash);
  db.prepare("INSERT INTO users (username, password_hash, role, active) VALUES ('sec_status_disattivo', ?, 'admin', 0)").run(passwordHash);

  const loginRes = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'sec_status_user', password: 'sec_status_test_pw' }),
  });
  const auth = { Authorization: 'Bearer ' + (await loginRes.json()).token, 'Content-Type': 'application/json' };

  console.log('\n--- GET /api/security-status ---');

  await test('senza token -> 401', async () => {
    assertEq((await fetch(BASE + '/api/security-status')).status, 401);
  });

  const baselineActive = db.prepare('SELECT COUNT(*) AS n FROM users WHERE active = 1').get().n;

  await test('con token: utenti ATTIVI soltanto (l\'utente disattivato non conta), nessuna 2FA/passkey ancora', async () => {
    const r = await fetch(BASE + '/api/security-status', { headers: auth });
    const j = await r.json();
    assertEq(r.status, 200);
    assertEq(j.users.total, baselineActive, 'solo gli utenti attivi contano (esclude sec_status_disattivo)');
    assertEq(j.users.with_2fa, 0);
    assertEq(j.users.with_passkey, 0);
  });

  await test('Cloudflare non configurato (niente env) -> configured:false, ssl_mode:null', async () => {
    const j = await (await fetch(BASE + '/api/security-status', { headers: auth })).json();
    assertEq(j.cloudflare.configured, false);
    assertEq(j.cloudflare.ssl_mode, null);
  });

  await test('un utente con totp_enabled e una passkey registrata vengono contati', async () => {
    const user = db.prepare("SELECT id FROM users WHERE username = 'sec_status_user'").get();
    db.prepare('UPDATE users SET totp_enabled = 1 WHERE id = ?').run(user.id);
    db.prepare("INSERT INTO webauthn_credentials (user_id, credential_id, public_key) VALUES (?, 'cred-1', 'pk-1')").run(user.id);
    const j = await (await fetch(BASE + '/api/security-status', { headers: auth })).json();
    assertEq(j.users.with_2fa, 1);
    assertEq(j.users.with_passkey, 1);
  });

  await test('gli eventi sospetti recenti vengono dall\'audit_log reale, nei soli tipi previsti', async () => {
    db.prepare("INSERT INTO audit_log (actor, action, target) VALUES ('ignoto', 'auth.login_failed', 'qualcuno')").run();
    db.prepare("INSERT INTO audit_log (actor, action, target) VALUES ('sec_status_user', 'ai.key.admin.set', null)").run();
    const j = await (await fetch(BASE + '/api/security-status', { headers: auth })).json();
    assertTrue(j.recent_suspicious_events.some((e) => e.action === 'auth.login_failed' && e.target === 'qualcuno'));
    assertTrue(!j.recent_suspicious_events.some((e) => e.action === 'ai.key.admin.set'), 'un\'azione non sospetta non deve comparire qui');
  });

  console.log('\n--- Cloudflare configurato: sslMode() legge davvero la zona ---');

  await test('zona in modalità "flexible" -> il pannello la mostra com\'è, non assume "sicuro"', async () => {
    process.env.CLOUDFLARE_API_TOKEN = 'token-finto';
    process.env.CLOUDFLARE_ZONE_ID = 'zona-finta';
    process.env.CLOUDFLARE_ORIGIN_IP = '203.0.113.7';
    const realFetch = global.fetch;
    global.fetch = async (url) => {
      if (String(url).includes('/settings/ssl')) return { json: async () => ({ success: true, result: { value: 'flexible' } }) };
      return realFetch(url);
    };
    try {
      const j = await (await realFetch(BASE + '/api/security-status', { headers: auth })).json();
      assertEq(j.cloudflare.configured, true);
      assertEq(j.cloudflare.ssl_mode, 'flexible');
    } finally {
      global.fetch = realFetch;
      delete process.env.CLOUDFLARE_API_TOKEN; delete process.env.CLOUDFLARE_ZONE_ID; delete process.env.CLOUDFLARE_ORIGIN_IP;
    }
  });

  console.log(`\n${'='.repeat(60)}`);
  console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
  if (failed > 0) console.log('Falliti: ' + failures.join(', '));
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
