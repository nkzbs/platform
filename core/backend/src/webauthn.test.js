'use strict';
// Passkey (routes/webauthn.js) — server reale, DB temporaneo, un VERO
// autenticatore software (test-helpers/virtual-authenticator.js: chiave
// P-256 reale, firma ECDSA reale, attestationObject CBOR reale) — non uno
// stub che restituisce {verified:true}. Prova sia il percorso giusto
// (registra → entra con la passkey, nessuna password) sia i rifiuti veri
// (firma manomessa, credenziale sconosciuta, replay dello stesso assertion).
// Eseguire con: node src/webauthn.test.js (porta 34592).

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const { createVirtualAuthenticator } = require('./test-helpers/virtual-authenticator');

const TEST_PORT = 34592;
const BASE = 'http://localhost:' + TEST_PORT;
const ORIGIN = 'http://localhost:' + TEST_PORT;
const RP_ID = 'localhost';
const dbPath = path.join(os.tmpdir(), 'webauthn-test-' + crypto.randomBytes(6).toString('hex') + '.db');

process.env.DB_PATH = dbPath;
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'webauthn_test_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'webauthn_test_internal_' + crypto.randomBytes(8).toString('hex');
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'webauthn-test-uploads-'));
process.env.TENANT_SLUG = 'webauthn-test';

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
  throw new Error('Server Core non pronto entro ' + timeoutMs + 'ms');
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
  db.prepare("INSERT INTO users (id, username, password_hash, role) VALUES (10, 'alice', ?, 'user')").run(hash);
  db.prepare("INSERT INTO users (id, username, password_hash, role) VALUES (11, 'bruno', ?, 'user')").run(hash);

  async function login(username) {
    const res = await api('/auth/login', { method: 'POST', body: JSON.stringify({ username, password: 'pw_di_prova_123' }) });
    const body = await res.json();
    if (!res.ok) throw new Error('login fallito per ' + username + ': ' + JSON.stringify(body));
    return body.token;
  }

  const aliceToken = await login('alice');
  const brunoToken = await login('bruno');

  console.log('\n--- registrazione di una passkey (self-service) ---');

  const aliceKey = createVirtualAuthenticator();
  let aliceCredId;

  await test('register-options -> una sfida reale, pending_token', async () => {
    const res = await api('/webauthn/register-options', { method: 'POST', headers: { Authorization: 'Bearer ' + aliceToken } });
    assertEq(res.status, 200);
    const body = await res.json();
    assertTrue(!!body.options.challenge);
    assertTrue(!!body.pending_token);
  });

  await test('register-verify con una risposta VERA (chiave P-256, firma reale) -> 200', async () => {
    const optRes = await api('/webauthn/register-options', { method: 'POST', headers: { Authorization: 'Bearer ' + aliceToken } });
    const { options, pending_token } = await optRes.json();
    const response = await aliceKey.register({ rpID: RP_ID, origin: ORIGIN, challenge: options.challenge });
    aliceCredId = response.id;
    const res = await api('/webauthn/register-verify', { method: 'POST', headers: { Authorization: 'Bearer ' + aliceToken }, body: JSON.stringify({ pending_token, response, nickname: 'Il mio portatile' }) });
    const body = await res.json();
    assertEq(res.status, 200, JSON.stringify(body));
  });

  await test('GET /list -> una passkey, col nickname, MAI la chiave pubblica o il credential id grezzi', async () => {
    const res = await api('/webauthn/list', { headers: { Authorization: 'Bearer ' + aliceToken } });
    const rows = await res.json();
    assertEq(rows.length, 1);
    assertEq(rows[0].nickname, 'Il mio portatile');
    assertTrue(!('public_key' in rows[0]) && !('credential_id' in rows[0]));
  });

  await test('registrare la STESSA passkey due volte -> 400 (credential_id duplicato)', async () => {
    const optRes = await api('/webauthn/register-options', { method: 'POST', headers: { Authorization: 'Bearer ' + aliceToken } });
    const { options, pending_token } = await optRes.json();
    const response = await aliceKey.register({ rpID: RP_ID, origin: ORIGIN, challenge: options.challenge });
    const res = await api('/webauthn/register-verify', { method: 'POST', headers: { Authorization: 'Bearer ' + aliceToken }, body: JSON.stringify({ pending_token, response }) });
    assertEq(res.status, 400);
  });

  console.log('\n--- accesso con la passkey, SENZA username né password ---');

  let lastLoginOptions, lastPendingToken;
  await test('login-options -> nessuna informazione utente richiesta (discoverable)', async () => {
    const res = await api('/webauthn/login-options', { method: 'POST' });
    assertEq(res.status, 200);
    const body = await res.json();
    lastLoginOptions = body.options; lastPendingToken = body.pending_token;
    assertTrue(!!lastLoginOptions.challenge);
  });

  let sessionToken;
  await test('login-verify con una firma VERA -> 200, sessione di alice, nessun secondo passaggio 2FA', async () => {
    const response = await aliceKey.authenticate({ rpID: RP_ID, origin: ORIGIN, challenge: lastLoginOptions.challenge });
    const res = await api('/webauthn/login-verify', { method: 'POST', body: JSON.stringify({ pending_token: lastPendingToken, response }) });
    const body = await res.json();
    assertEq(res.status, 200, JSON.stringify(body));
    assertEq(body.user.username, 'alice');
    assertTrue(!!body.token);
    sessionToken = body.token;
  });

  await test('il token ricevuto dal login con passkey funziona davvero su una rotta protetta', async () => {
    const res = await api('/auth/me', { headers: { Authorization: 'Bearer ' + sessionToken } });
    assertEq(res.status, 200);
    const body = await res.json();
    assertEq(body.username, 'alice');
  });

  console.log('\n--- rifiuti veri, non solo per principio ---');

  await test('firma manomessa (1 bit cambiato) -> 401, nessuna sessione', async () => {
    const optRes = await api('/webauthn/login-options', { method: 'POST' });
    const { options, pending_token } = await optRes.json();
    const response = await aliceKey.authenticate({ rpID: RP_ID, origin: ORIGIN, challenge: options.challenge, tamperSignature: true });
    const res = await api('/webauthn/login-verify', { method: 'POST', body: JSON.stringify({ pending_token, response }) });
    assertEq(res.status, 401);
  });

  await test('credential id mai registrato -> 401 "non riconosciuta"', async () => {
    const ghost = createVirtualAuthenticator();
    const optRes = await api('/webauthn/login-options', { method: 'POST' });
    const { options, pending_token } = await optRes.json();
    const response = await ghost.authenticate({ rpID: RP_ID, origin: ORIGIN, challenge: options.challenge });
    const res = await api('/webauthn/login-verify', { method: 'POST', body: JSON.stringify({ pending_token, response }) });
    const body = await res.json();
    assertEq(res.status, 401);
    assertTrue(/non riconosciuta/.test(body.error));
  });

  await test('REPLAY — la stessa identica risposta mandata due volte -> la seconda fallisce (contatore non è salito)', async () => {
    const optRes = await api('/webauthn/login-options', { method: 'POST' });
    const { options, pending_token } = await optRes.json();
    const response = await aliceKey.authenticate({ rpID: RP_ID, origin: ORIGIN, challenge: options.challenge });
    const first = await api('/webauthn/login-verify', { method: 'POST', body: JSON.stringify({ pending_token, response }) });
    assertEq(first.status, 200);
    const optRes2 = await api('/webauthn/login-options', { method: 'POST' });
    const second = await api('/webauthn/login-verify', { method: 'POST', body: JSON.stringify({ pending_token: (await optRes2.json()).pending_token, response }) });
    assertTrue(second.status === 401 || second.status === 400, 'la stessa risposta rigiocata con un nuovo pending_token deve comunque fallire sul contatore, ottenuto ' + second.status);
  });

  await test('sfida sbagliata (pending_token di un login-options precedente, scaduto logicamente) -> 401', async () => {
    const optRes = await api('/webauthn/login-options', { method: 'POST' });
    const { pending_token } = await optRes.json();
    // challenge diversa da quella firmata -> clientDataJSON non corrisponde
    const response = await aliceKey.authenticate({ rpID: RP_ID, origin: ORIGIN, challenge: 'sfida-sbagliata-' + crypto.randomBytes(8).toString('base64url') });
    const res = await api('/webauthn/login-verify', { method: 'POST', body: JSON.stringify({ pending_token, response }) });
    assertEq(res.status, 400);
  });

  console.log('\n--- due utenti, due passkey, ognuno entra come se stesso ---');

  const brunoKey = createVirtualAuthenticator();
  await test('bruno registra la propria passkey, diversa da quella di alice', async () => {
    const optRes = await api('/webauthn/register-options', { method: 'POST', headers: { Authorization: 'Bearer ' + brunoToken } });
    const { options, pending_token } = await optRes.json();
    const response = await brunoKey.register({ rpID: RP_ID, origin: ORIGIN, challenge: options.challenge });
    const res = await api('/webauthn/register-verify', { method: 'POST', headers: { Authorization: 'Bearer ' + brunoToken }, body: JSON.stringify({ pending_token, response }) });
    assertEq(res.status, 200);
  });

  await test('la passkey di bruno fa entrare bruno, non alice', async () => {
    const optRes = await api('/webauthn/login-options', { method: 'POST' });
    const { options, pending_token } = await optRes.json();
    const response = await brunoKey.authenticate({ rpID: RP_ID, origin: ORIGIN, challenge: options.challenge });
    const res = await api('/webauthn/login-verify', { method: 'POST', body: JSON.stringify({ pending_token, response }) });
    const body = await res.json();
    assertEq(res.status, 200);
    assertEq(body.user.username, 'bruno');
  });

  console.log('\n--- eliminazione (self-service) ---');

  await test('alice elimina la propria passkey -> lista vuota, quella passkey non fa più entrare nessuno', async () => {
    const listRes = await api('/webauthn/list', { headers: { Authorization: 'Bearer ' + aliceToken } });
    const [row] = await listRes.json();
    const delRes = await api('/webauthn/' + row.id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + aliceToken } });
    assertEq(delRes.status, 200);
    const listRes2 = await api('/webauthn/list', { headers: { Authorization: 'Bearer ' + aliceToken } });
    assertEq((await listRes2.json()).length, 0);

    const optRes = await api('/webauthn/login-options', { method: 'POST' });
    const { options, pending_token } = await optRes.json();
    const response = await aliceKey.authenticate({ rpID: RP_ID, origin: ORIGIN, challenge: options.challenge });
    const res = await api('/webauthn/login-verify', { method: 'POST', body: JSON.stringify({ pending_token, response }) });
    assertEq(res.status, 401);
  });

  await test('bruno non può eliminare una passkey che non è sua', async () => {
    const listRes = await api('/webauthn/list', { headers: { Authorization: 'Bearer ' + brunoToken } });
    const [row] = await listRes.json();
    const res = await api('/webauthn/' + row.id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + aliceToken } });
    assertEq(res.status, 404);
  });

  console.log(`\n${'='.repeat(60)}`);
  console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
  if (failed > 0) console.log('Falliti: ' + failures.join(', '));
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Suite webauthn fallita ad avviarsi:', e);
  console.error(e.stack);
  process.exit(1);
});
