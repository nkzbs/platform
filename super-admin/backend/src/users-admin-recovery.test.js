'use strict';
// Recupero di un admin bloccato (2026-10-14, richiesto dall'utente dopo aver
// notato che "Utenti" e "Password/2FA" in Impostazioni restavano slegati:
// nessun modo per un admin già dentro di sbloccare un collega che ha perso
// password+2FA insieme). Copre routes/users.js: reset-password e
// disable-2fa fatti da UN ALTRO admin (richiedono la password di chi esegue,
// mai quella del bersaglio), più rename (PATCH username) e delete.
//
// Eseguire con: node src/users-admin-recovery.test.js (richiede la porta 34589 libera).

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const TEST_PORT = 34589;
const BASE = 'http://localhost:' + TEST_PORT;
const dbPath = path.join(os.tmpdir(), 'users-admin-recovery-test-' + crypto.randomBytes(6).toString('hex') + '.db');

process.env.DB_PATH = dbPath;
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'users_admin_recovery_test_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'users_admin_recovery_test_internal_' + crypto.randomBytes(8).toString('hex');
process.env.SUPPORT_UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'users-admin-recovery-test-uploads-'));

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

async function login(username, password) {
  const res = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
  const body = await res.json();
  return { status: res.status, token: body.token };
}

async function main() {
  require('./index.js');
  await waitForServer(10000);

  const db = require('./db');
  const bcrypt = require('bcryptjs');
  db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('rescuer', ?, 'admin')").run(bcrypt.hashSync('rescuer_pw_123', 10));
  db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('locked_out', ?, 'admin')").run(bcrypt.hashSync('locked_out_pw_123', 10));

  const rescuer = await login('rescuer', 'rescuer_pw_123');
  const rescuerAuth = { Authorization: 'Bearer ' + rescuer.token, 'Content-Type': 'application/json' };
  const lockedOutId = db.prepare("SELECT id FROM users WHERE username = 'locked_out'").get().id;
  const rescuerId = db.prepare("SELECT id FROM users WHERE username = 'rescuer'").get().id;

  console.log('\n--- routes/users.js — reset password di un altro admin ---');

  await test('reset-password con la TUA password sbagliata -> 401, password del bersaglio invariata', async () => {
    const res = await fetch(BASE + `/api/users/${lockedOutId}/reset-password`, { method: 'POST', headers: rescuerAuth, body: JSON.stringify({ new_password: 'nuova_password_123', admin_password: 'sbagliata' }) });
    assertEq(res.status, 401);
    const still = await login('locked_out', 'locked_out_pw_123');
    assertEq(still.status, 200, 'la vecchia password deve ancora funzionare');
  });

  await test('reset-password su se stessi -> 400 (va fatto da Impostazioni → Password)', async () => {
    const res = await fetch(BASE + `/api/users/${rescuerId}/reset-password`, { method: 'POST', headers: rescuerAuth, body: JSON.stringify({ new_password: 'qualunque_password_1', admin_password: 'rescuer_pw_123' }) });
    assertEq(res.status, 400);
  });

  await test('reset-password con la TUA password giusta -> 200, il bersaglio accede con la nuova e non con la vecchia', async () => {
    const res = await fetch(BASE + `/api/users/${lockedOutId}/reset-password`, { method: 'POST', headers: rescuerAuth, body: JSON.stringify({ new_password: 'nuova_password_123', admin_password: 'rescuer_pw_123' }) });
    assertEq(res.status, 200);
    const withNew = await login('locked_out', 'nuova_password_123');
    assertEq(withNew.status, 200);
    const withOld = await login('locked_out', 'locked_out_pw_123');
    assertEq(withOld.status, 401);
    const entry = db.prepare("SELECT * FROM audit_log WHERE action = 'user.reset_password' AND target = 'locked_out' ORDER BY id DESC LIMIT 1").get();
    assertTrue(!!entry, 'deve restare una riga audit user.reset_password');
    assertEq(entry.actor, 'rescuer');
  });

  console.log('\n--- routes/users.js — disattivazione forzata del 2FA di un altro admin ---');

  await test('disable-2fa su un utente senza 2FA attivo -> 400', async () => {
    const res = await fetch(BASE + `/api/users/${lockedOutId}/disable-2fa`, { method: 'POST', headers: rescuerAuth, body: JSON.stringify({ admin_password: 'rescuer_pw_123' }) });
    assertEq(res.status, 400);
  });

  await test('disable-2fa dopo averlo attivato sul bersaglio -> 200, 2FA spento davvero', async () => {
    db.prepare('UPDATE users SET totp_enabled = 1 WHERE id = ?').run(lockedOutId);
    const res = await fetch(BASE + `/api/users/${lockedOutId}/disable-2fa`, { method: 'POST', headers: rescuerAuth, body: JSON.stringify({ admin_password: 'rescuer_pw_123' }) });
    assertEq(res.status, 200);
    const row = db.prepare('SELECT totp_enabled FROM users WHERE id = ?').get(lockedOutId);
    assertEq(!!row.totp_enabled, false);
    const entry = db.prepare("SELECT * FROM audit_log WHERE action = 'user.force_disable_2fa' AND target = 'locked_out' ORDER BY id DESC LIMIT 1").get();
    assertTrue(!!entry, 'deve restare una riga audit user.force_disable_2fa');
  });

  console.log('\n--- routes/users.js — rinominare (PATCH username) ---');

  await test('PATCH username -> 200, login funziona col nuovo username non col vecchio', async () => {
    const res = await fetch(BASE + `/api/users/${lockedOutId}`, { method: 'PATCH', headers: rescuerAuth, body: JSON.stringify({ username: 'rinominato' }) });
    assertEq(res.status, 200);
    const withNew = await login('rinominato', 'nuova_password_123');
    assertEq(withNew.status, 200);
    const withOld = await login('locked_out', 'nuova_password_123');
    assertEq(withOld.status, 401);
  });

  console.log('\n--- routes/users.js — eliminazione ---');

  await test('DELETE su se stessi -> 400', async () => {
    const res = await fetch(BASE + `/api/users/${rescuerId}`, { method: 'DELETE', headers: rescuerAuth, body: JSON.stringify({ admin_password: 'rescuer_pw_123' }) });
    assertEq(res.status, 400);
  });

  await test('DELETE con la TUA password sbagliata -> 401, utente ancora lì', async () => {
    const res = await fetch(BASE + `/api/users/${lockedOutId}`, { method: 'DELETE', headers: rescuerAuth, body: JSON.stringify({ admin_password: 'sbagliata' }) });
    assertEq(res.status, 401);
    assertTrue(!!db.prepare('SELECT id FROM users WHERE id = ?').get(lockedOutId), 'non deve essere stato cancellato');
  });

  await test('DELETE con la TUA password giusta su un altro admin -> 200, sparito davvero (non solo disattivato)', async () => {
    const res = await fetch(BASE + `/api/users/${lockedOutId}`, { method: 'DELETE', headers: rescuerAuth, body: JSON.stringify({ admin_password: 'rescuer_pw_123' }) });
    assertEq(res.status, 200);
    const gone = db.prepare('SELECT id FROM users WHERE id = ?').get(lockedOutId);
    assertTrue(!gone, 'la riga deve essere sparita, non solo disattivata');
    const entry = db.prepare("SELECT * FROM audit_log WHERE action = 'user.delete' ORDER BY id DESC LIMIT 1").get();
    assertTrue(!!entry && entry.actor === 'rescuer', 'deve restare una riga audit user.delete');
  });

  console.log(`\n${'='.repeat(60)}`);
  console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
  if (failed > 0) console.log('Falliti: ' + failures.join(', '));
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Suite users-admin-recovery fallita ad avviarsi:', e);
  process.exit(1);
});
