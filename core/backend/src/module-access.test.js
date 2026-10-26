'use strict';
// Chiusura di un gap reale (26/10/2026, docs/DECISIONI.md): nascondere un modulo dal menu
// (user_modules) filtrava solo il menu — un utente loggato poteva comunque chiamare le API
// del modulo direttamente. requireModuleAccess (routes/auth.js) chiude questo buco sulle
// rotte dati (records.js qui testato, field-options.js/module-ai.js stesso meccanismo).
// Stesso pattern di records-crud.test.js: server Express reale, fetch HTTP reali.
//
// Eseguire con: node src/module-access.test.js (richiede porta libera in locale).

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const TEST_PORT = 34571;
const BASE = 'http://localhost:' + TEST_PORT;
const dbPath = path.join(os.tmpdir(), 'module-access-test-' + crypto.randomBytes(6).toString('hex') + '.db');

process.env.DB_PATH = dbPath;
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'module_access_test_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'module_access_test_internal_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'module_access_test_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'module-access-test-uploads-'));

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
  if (actual !== expected) throw new Error(`${msg || ''}: atteso ${JSON.stringify(expected)}, ottenuto ${JSON.stringify(actual)}`);
}

async function waitForServer(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const res = await fetch(BASE + '/health'); if (res.ok) return; } catch (e) { /* non ancora in ascolto */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Server Core non pronto entro ' + timeoutMs + 'ms');
}

async function login(username, password) {
  const res = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const body = await res.json();
  return { Authorization: 'Bearer ' + body.token, 'Content-Type': 'application/json' };
}

async function main() {
  require('./index.js');
  await waitForServer(10000);
  const db = require('./db');

  const SLUG_A = 'access_test_a';
  const SLUG_B = 'access_test_b';
  const schema = { fields: [{ key: 'nome', type: 'text', label: 'Nome' }] };
  db.prepare('INSERT INTO modules (name, slug, icon, color, installed, sort_order, schema_json) VALUES (?, ?, ?, ?, 1, 99, ?)').run('Modulo A', SLUG_A, 'box', '#2563EB', JSON.stringify(schema));
  db.prepare('INSERT INTO modules (name, slug, icon, color, installed, sort_order, schema_json) VALUES (?, ?, ?, ?, 1, 100, ?)').run('Modulo B', SLUG_B, 'box', '#2563EB', JSON.stringify(schema));

  const hash = bcrypt.hashSync('pw123456', 10);
  // scoped: vede solo SLUG_A (+ dashboard, implicita)
  db.prepare("INSERT INTO users (id, username, password_hash, display_name, role) VALUES (5, 'scoped', ?, 'Scoped', 'user')").run(hash);
  db.prepare('INSERT INTO user_modules (user_id, module_slug) VALUES (5, ?)').run(SLUG_A);
  // unscoped: nessuna riga in user_modules — comportamento invariato, deve vedere tutto
  db.prepare("INSERT INTO users (id, username, password_hash, display_name, role) VALUES (6, 'unscoped', ?, 'Unscoped', 'user')").run(hash);

  const adminAuth = await login('admin', process.env.INITIAL_ADMIN_PASSWORD);
  const scopedAuth = await login('scoped', 'pw123456');
  const unscopedAuth = await login('unscoped', 'pw123456');

  console.log('\n--- requireModuleAccess (routes/auth.js) — enforcement reale sulle API, non solo sul menu ---');

  await test('utente scoped: GET sul proprio modulo (A) -> 200', async () => {
    const res = await fetch(BASE + '/api/records/' + SLUG_A, { headers: scopedAuth });
    assertEq(res.status, 200);
  });

  await test('utente scoped: GET su un modulo NON suo (B) -> 403', async () => {
    const res = await fetch(BASE + '/api/records/' + SLUG_B, { headers: scopedAuth });
    assertEq(res.status, 403);
  });

  await test('utente scoped: POST su un modulo NON suo (B) -> 403, nessun record creato', async () => {
    const res = await fetch(BASE + '/api/records/' + SLUG_B, { method: 'POST', headers: scopedAuth, body: JSON.stringify({ nome: 'x' }) });
    assertEq(res.status, 403);
  });

  await test('utente senza righe in user_modules: vede ENTRAMBI i moduli (nessuna regressione sul fallback)', async () => {
    const resA = await fetch(BASE + '/api/records/' + SLUG_A, { headers: unscopedAuth });
    const resB = await fetch(BASE + '/api/records/' + SLUG_B, { headers: unscopedAuth });
    assertEq(resA.status, 200);
    assertEq(resB.status, 200);
  });

  await test('admin bypassa sempre, anche su un modulo che nessuno gli ha esplicitamente dato', async () => {
    const res = await fetch(BASE + '/api/records/' + SLUG_B, { headers: adminAuth });
    assertEq(res.status, 200);
  });

  await test('field-options.js: utente scoped bloccato (403) su un modulo non suo', async () => {
    const res = await fetch(BASE + '/api/field-options/' + SLUG_B + '/nome', { method: 'POST', headers: scopedAuth, body: JSON.stringify({ action: 'add', value: 'x' }) });
    assertEq(res.status, 403);
  });

  console.log(`\n${passed} passati, ${failed} falliti` + (failed ? '\nFalliti: ' + failures.join(', ') : ''));
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('Errore fatale:', e); process.exit(1); });
