'use strict';
// Passkey per Super Admin (routes/webauthn.js) — stesso identico principio
// di prova del backend core (vedi core/backend/src/webauthn.test.js): un
// VERO autenticatore software (chiave P-256 reale, firma ECDSA reale,
// attestationObject CBOR reale), non uno stub. Qui copre anche il caso
// specifico di Super Admin: più account 'admin', ognuno entra con la
// propria passkey.
// Eseguire con: node src/webauthn.test.js (porta 34593).

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const { createVirtualAuthenticator } = require('./test-helpers/virtual-authenticator');

const TEST_PORT = 34593;
const BASE = 'http://localhost:' + TEST_PORT;
const ORIGIN = 'http://localhost:' + TEST_PORT;
const RP_ID = 'localhost';
const dbPath = path.join(os.tmpdir(), 'sa-webauthn-test-' + crypto.randomBytes(6).toString('hex') + '.db');

process.env.DB_PATH = dbPath;
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'sa_webauthn_test_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'sa_webauthn_test_internal_' + crypto.randomBytes(8).toString('hex');
process.env.ENCRYPTION_KEY = 'sa_webauthn_test_enc_' + crypto.randomBytes(8).toString('hex');
process.env.SUPPORT_UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-webauthn-test-uploads-'));

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.error('  ✗ ' + name); console.error('    ' + e.message); failed++; failures.push(name); }
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

function api(path, opts = {}) {
  return fetch(BASE + '/api' + path, { ...opts, headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...(opts.headers || {}) } });
}

async function main() {
  require('./index.js');
  await waitForServer(10000);

  const db = require('./db');
  const bcrypt = require('bcryptjs');
  const hash = bcrypt.hashSync('pw_di_prova_123', 4);
  db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('rescuer', ?, 'admin')").run(hash);
  db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('capo', ?, 'admin')").run(hash);

  async function login(username) {
    const res = await api('/auth/login', { method: 'POST', body: JSON.stringify({ username, password: 'pw_di_prova_123' }) });
    const body = await res.json();
    if (!res.ok) throw new Error('login fallito per ' + username + ': ' + JSON.stringify(body));
    return body.token;
  }

  const rescuerToken = await login('rescuer');
  const capoToken = await login('capo');

  console.log('\n--- registrazione e accesso con passkey (Super Admin) ---');

  const rescuerKey = createVirtualAuthenticator();

  await test('registrazione con una risposta VERA -> 200', async () => {
    const optRes = await api('/webauthn/register-options', { method: 'POST', headers: { Authorization: 'Bearer ' + rescuerToken } });
    const { options, pending_token } = await optRes.json();
    const response = await rescuerKey.register({ rpID: RP_ID, origin: ORIGIN, challenge: options.challenge });
    const res = await api('/webauthn/register-verify', { method: 'POST', headers: { Authorization: 'Bearer ' + rescuerToken }, body: JSON.stringify({ pending_token, response, nickname: 'YubiKey' }) });
    assertEq(res.status, 200);
  });

  let sessionToken;
  await test('login-verify con firma VERA -> 200, sessione di rescuer, senza username né password', async () => {
    const optRes = await api('/webauthn/login-options', { method: 'POST' });
    const { options, pending_token } = await optRes.json();
    const response = await rescuerKey.authenticate({ rpID: RP_ID, origin: ORIGIN, challenge: options.challenge });
    const res = await api('/webauthn/login-verify', { method: 'POST', body: JSON.stringify({ pending_token, response }) });
    const body = await res.json();
    assertEq(res.status, 200, JSON.stringify(body));
    assertEq(body.user.username, 'rescuer');
    sessionToken = body.token;
  });

  await test('il token funziona su una rotta protetta vera (GET /users)', async () => {
    const res = await api('/users', { headers: { Authorization: 'Bearer ' + sessionToken } });
    assertEq(res.status, 200);
  });

  await test('il login con passkey aggiorna last_login_at come il login con password', async () => {
    const row = db.prepare("SELECT last_login_at FROM users WHERE username = 'rescuer'").get();
    assertTrue(!!row.last_login_at);
  });

  console.log('\n--- rifiuti veri ---');

  await test('firma manomessa -> 401', async () => {
    const optRes = await api('/webauthn/login-options', { method: 'POST' });
    const { options, pending_token } = await optRes.json();
    const response = await rescuerKey.authenticate({ rpID: RP_ID, origin: ORIGIN, challenge: options.challenge, tamperSignature: true });
    const res = await api('/webauthn/login-verify', { method: 'POST', body: JSON.stringify({ pending_token, response }) });
    assertEq(res.status, 401);
  });

  await test('passkey mai registrata -> 401', async () => {
    const ghost = createVirtualAuthenticator();
    const optRes = await api('/webauthn/login-options', { method: 'POST' });
    const { options, pending_token } = await optRes.json();
    const response = await ghost.authenticate({ rpID: RP_ID, origin: ORIGIN, challenge: options.challenge });
    const res = await api('/webauthn/login-verify', { method: 'POST', body: JSON.stringify({ pending_token, response }) });
    assertEq(res.status, 401);
  });

  console.log('\n--- due admin, due passkey distinte ---');

  const capoKey = createVirtualAuthenticator();
  await test('capo registra la propria, diversa da quella di rescuer, ed entra come capo', async () => {
    const optRes = await api('/webauthn/register-options', { method: 'POST', headers: { Authorization: 'Bearer ' + capoToken } });
    const { options, pending_token } = await optRes.json();
    const response = await capoKey.register({ rpID: RP_ID, origin: ORIGIN, challenge: options.challenge });
    const regRes = await api('/webauthn/register-verify', { method: 'POST', headers: { Authorization: 'Bearer ' + capoToken }, body: JSON.stringify({ pending_token, response }) });
    assertEq(regRes.status, 200);

    const loginOptRes = await api('/webauthn/login-options', { method: 'POST' });
    const loginOpts = await loginOptRes.json();
    const loginResponse = await capoKey.authenticate({ rpID: RP_ID, origin: ORIGIN, challenge: loginOpts.options.challenge });
    const loginRes = await api('/webauthn/login-verify', { method: 'POST', body: JSON.stringify({ pending_token: loginOpts.pending_token, response: loginResponse }) });
    const body = await loginRes.json();
    assertEq(body.user.username, 'capo');
  });

  console.log('\n--- eliminazione (self-service, non quella di un altro admin) ---');

  await test('capo non può eliminare la passkey di rescuer', async () => {
    const list = await (await api('/webauthn/list', { headers: { Authorization: 'Bearer ' + rescuerToken } })).json();
    const res = await api('/webauthn/' + list[0].id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + capoToken } });
    assertEq(res.status, 404);
  });

  console.log(`\n${'='.repeat(60)}`);
  console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
  if (failed > 0) console.log('Falliti: ' + failures.join(', '));
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Suite webauthn (Super Admin) fallita ad avviarsi:', e);
  console.error(e.stack);
  process.exit(1);
});
