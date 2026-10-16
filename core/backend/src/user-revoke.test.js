'use strict';
// Disabilitare un utente o togliergli il ruolo admin deve valere subito, anche per un
// token già emesso (prima valeva fino alla scadenza, 24 ore). Server vero, richieste HTTP.
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const TEST_PORT = 34611;
const BASE = 'http://localhost:' + TEST_PORT;
process.env.DB_PATH = path.join(os.tmpdir(), 'user-revoke-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'user_revoke_test_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'user_revoke_internal_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'user_revoke_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'user-revoke-uploads-'));

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); passed++; } catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; }
}
function assertEq(a, b, msg) { if (a !== b) throw new Error((msg || '') + ': atteso ' + JSON.stringify(b) + ', ottenuto ' + JSON.stringify(a)); }

async function login(username, password) {
  const res = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
  return (await res.json()).token;
}
const h = (t) => ({ Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' });

async function main() {
  require('./index.js');
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch (e) {} await new Promise((r) => setTimeout(r, 100)); }

  const admin = await login('admin', 'user_revoke_admin_pw');
  const created = await (await fetch(BASE + '/api/users', { method: 'POST', headers: h(admin), body: JSON.stringify({ username: 'collega', password: 'collega_pw_123', role: 'admin' }) })).json();
  const userToken = await login('collega', 'collega_pw_123');

  await test('con il ruolo admin il token apre le rotte admin', async () => {
    assertEq((await fetch(BASE + '/api/users', { headers: h(userToken) })).status, 200);
  });
  await test('tolto il ruolo admin, lo stesso token riceve 403', async () => {
    await fetch(BASE + '/api/users/' + created.id, { method: 'PATCH', headers: h(admin), body: JSON.stringify({ role: 'user' }) });
    assertEq((await fetch(BASE + '/api/users', { headers: h(userToken) })).status, 403);
  });
  await test('disabilitato, lo stesso token riceve 401', async () => {
    await fetch(BASE + '/api/users/' + created.id, { method: 'PATCH', headers: h(admin), body: JSON.stringify({ active: 0 }) });
    assertEq((await fetch(BASE + '/api/auth/me', { headers: h(userToken) })).status, 401);
  });

  console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
  process.exit(failed > 0 ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
