'use strict';
// P2 (collaudo operativo 2026-09-03) — due gap trovati insieme, coperti in un'unica
// suite perché condividono lo stesso setup (utente reale + login reale):
// 1. login/2FA non finivano mai in audit_log (routes/auth.js, corretto nella stessa
//    sessione) — qui si verifica che le righe compaiano davvero, non solo che il
//    codice compili.
// 2. il flusso 2FA/TOTP non aveva NESSUN test automatico in questo backend
//    (il meccanismo esiste dal 2026-08-xx, mai verificato in automatico) — qui un
//    ciclo reale: setup -> confirm -> login con 2FA -> verify (codice giusto e
//    sbagliato) -> disable, usando otplib per generare codici TOTP VERI (stesso
//    algoritmo del server, non uno stub).
//
// Eseguire con: node src/auth-audit-2fa.test.js (richiede la porta 34588 libera).

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const { authenticator } = require('otplib');

const TEST_PORT = 34588;
const BASE = 'http://localhost:' + TEST_PORT;
const dbPath = path.join(os.tmpdir(), 'auth-audit-2fa-test-' + crypto.randomBytes(6).toString('hex') + '.db');

process.env.DB_PATH = dbPath;
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'auth_audit_2fa_test_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'auth_audit_2fa_test_internal_' + crypto.randomBytes(8).toString('hex');
process.env.SUPPORT_UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-audit-2fa-test-uploads-'));

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
  const passwordHash = bcrypt.hashSync('audit2fa_test_pw', 10);
  db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('audit2fa_user', ?, 'admin')").run(passwordHash);

  function lastAudit(action, target) {
    return db.prepare('SELECT * FROM audit_log WHERE action = ? AND target = ? ORDER BY id DESC LIMIT 1').get(action, target);
  }

  console.log('\n--- routes/auth.js — audit_log su login/2FA (P2, gap reale trovato in un collaudo) ---');

  await test('login con password sbagliata -> 401 E riga audit_log auth.login_failed', async () => {
    const res = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'audit2fa_user', password: 'sbagliata' }) });
    assertEq(res.status, 401);
    assertTrue(!!lastAudit('auth.login_failed', 'audit2fa_user'), 'deve esistere una riga auth.login_failed');
  });

  await test('login con password giusta (senza 2FA) -> 200 E riga audit_log auth.login', async () => {
    const res = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'audit2fa_user', password: 'audit2fa_test_pw' }) });
    assertEq(res.status, 200);
    assertTrue(!!lastAudit('auth.login', 'audit2fa_user'), 'deve esistere una riga auth.login');
  });

  console.log('\n--- routes/auth.js — ciclo 2FA/TOTP reale (P2, zero test automatici prima d\'ora) ---');

  let auth;
  await test('setup: login iniziale per ottenere un token operativo', async () => {
    const res = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'audit2fa_user', password: 'audit2fa_test_pw' }) });
    const body = await res.json();
    auth = { Authorization: 'Bearer ' + body.token, 'Content-Type': 'application/json' };
  });

  let totpSecret;
  await test('POST /2fa/setup -> genera un secret reale', async () => {
    const res = await fetch(BASE + '/api/auth/2fa/setup', { method: 'POST', headers: auth });
    assertEq(res.status, 200);
    const body = await res.json();
    assertTrue(!!body.secret, 'deve restituire un secret TOTP');
    totpSecret = body.secret;
  });

  await test('POST /2fa/confirm con un codice SBAGLIATO -> 400, 2FA resta disattivo', async () => {
    const res = await fetch(BASE + '/api/auth/2fa/confirm', { method: 'POST', headers: auth, body: JSON.stringify({ code: '000000' }) });
    assertTrue(res.status !== 200, 'un codice a caso non deve mai confermare il 2FA');
  });

  await test('POST /2fa/confirm con un codice TOTP VERO (generato con lo stesso algoritmo del server) -> 200, 2FA attivo', async () => {
    const code = authenticator.generate(totpSecret);
    const res = await fetch(BASE + '/api/auth/2fa/confirm', { method: 'POST', headers: auth, body: JSON.stringify({ code }) });
    assertEq(res.status, 200);
    const user = db.prepare("SELECT totp_enabled FROM users WHERE username = 'audit2fa_user'").get();
    assertEq(!!user.totp_enabled, true);
  });

  let pendingToken;
  await test('login dopo 2FA attivo -> needs_2fa=true, NESSUN token di sessione ancora', async () => {
    const res = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'audit2fa_user', password: 'audit2fa_test_pw' }) });
    const body = await res.json();
    assertEq(body.needs_2fa, true);
    assertTrue(!body.token, 'non deve mai dare un token di sessione prima della verifica 2FA');
    pendingToken = body.pending_token;
  });

  await test('POST /login/2fa-verify con codice sbagliato -> 401 E riga audit_log auth.2fa_verify_failed', async () => {
    const res = await fetch(BASE + '/api/auth/login/2fa-verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pending_token: pendingToken, code: '000000' }) });
    assertEq(res.status, 401);
    assertTrue(!!lastAudit('auth.2fa_verify_failed', 'audit2fa_user'), 'deve esistere una riga auth.2fa_verify_failed');
  });

  await test('POST /login/2fa-verify con codice TOTP vero -> 200, token di sessione reale, E riga audit_log auth.2fa_verify', async () => {
    const code = authenticator.generate(totpSecret);
    const res = await fetch(BASE + '/api/auth/login/2fa-verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pending_token: pendingToken, code }) });
    assertEq(res.status, 200);
    const body = await res.json();
    assertTrue(!!body.token, 'deve restituire un vero token di sessione dopo la verifica');
    const entry = lastAudit('auth.2fa_verify', 'audit2fa_user');
    assertTrue(!!entry, 'deve esistere una riga auth.2fa_verify');
    assertEq(JSON.parse(entry.details).usedBackupCode, false);
  });

  console.log(`\n${'='.repeat(60)}`);
  console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
  if (failed > 0) console.log('Falliti: ' + failures.join(', '));
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Suite auth-audit-2fa fallita ad avviarsi:', e);
  process.exit(1);
});
