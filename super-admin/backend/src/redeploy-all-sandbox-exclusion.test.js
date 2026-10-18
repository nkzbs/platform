'use strict';
// Bug reale segnalato dall'utente (2026-08-28), scoperto guardando uno screenshot reale di
// UpdateManagerPage.jsx: "3 tenant aggiornati su 3" nel messaggio di esito, ma solo 2 tenant
// visibili nella lista sotto. Causa: POST /redeploy-all includeva anche i tenant sandbox
// (is_sandbox=1) nel conteggio/redeploy, mentre GET / (che alimenta la lista visibile) li
// esclude sempre — le due query non erano allineate.
//
// Ridotto 2026-09-27 con la rimozione del concetto Partner: esisteva un secondo
// blocco di test ("Core aggiorna solo i propri tenant diretti, mai quelli di
// un partner") — la guardia di ownership su /redeploy-all e /:slug/redeploy è
// stata rimossa (Pacchetto 2, requireTenantScope ora è solo un controllo di
// esistenza): con un solo operatore, ogni tenant è "proprio". Resta solo il
// bug fix originale, ancora reale e ancora testabile: l'esclusione sandbox.
//
// Eseguire con: node src/redeploy-all-sandbox-exclusion.test.js (richiede porta 34583 libera).

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');

const TEST_PORT = 34583;
const FAKE_PROVISIONER_PORT = 34584;
const BASE = 'http://localhost:' + TEST_PORT;
const dbPath = path.join(os.tmpdir(), 'redeploy-sandbox-test-' + crypto.randomBytes(6).toString('hex') + '.db');

process.env.DB_PATH = dbPath;
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'rsb_test_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'rsb_test_internal_' + crypto.randomBytes(8).toString('hex');
// POST /redeploy-all builda l'immagine una sola volta PRIMA del loop sui tenant
// (buildCoreImage(), 18/10): deve riuscire perché questo test verifichi il
// conteggio/esclusione sandbox a valle — /tenants/:slug/redeploy resta
// deliberatamente non gestito (404) così nessun redeploy per-tenant risulta
// mai davvero riuscito, come da intento originale di questo file.
process.env.PROVISIONER_URL = 'http://127.0.0.1:' + FAKE_PROVISIONER_PORT;
process.env.SUPPORT_UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rsb-test-uploads-'));

function startFakeProvisioner() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/images/build-core') {
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
        res.end(JSON.stringify({ done: true, ok: true, commit: 'deadbeef' }) + '\n');
        return;
      }
      res.writeHead(404); res.end();
    });
    server.listen(FAKE_PROVISIONER_PORT, () => resolve(server));
  });
}

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

async function waitForServer(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const res = await fetch(BASE + '/health'); if (res.ok) return; } catch (e) { /* non ancora in ascolto */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Server Super Admin non pronto entro ' + timeoutMs + 'ms');
}

async function main() {
  await startFakeProvisioner();
  require('./index.js');
  await waitForServer(10000);

  const db = require('./db');
  const bcrypt = require('bcryptjs');
  const passwordHash = bcrypt.hashSync('rsb_test_pw', 10);
  db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('rsb_core', ?, 'admin')").run(passwordHash);

  db.prepare("INSERT INTO tenants (name, slug, port, db_path, status, is_sandbox) VALUES ('Tenant Reale 1', 'rsb-reale-1', 49950, '/tmp/rsb1.db', 'active', 0)").run();
  db.prepare("INSERT INTO tenants (name, slug, port, db_path, status, is_sandbox) VALUES ('Tenant Reale 2', 'rsb-reale-2', 49951, '/tmp/rsb2.db', 'active', 0)").run();
  db.prepare("INSERT INTO tenants (name, slug, port, db_path, status, is_sandbox) VALUES ('Tenant Sandbox', 'rsb-sandbox', 49952, '/tmp/rsb3.db', 'active', 1)").run();

  const auth = { Authorization: 'Bearer ' + (await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'rsb_core', password: 'rsb_test_pw' }) })).json()).token, 'Content-Type': 'application/json' };

  console.log('\n--- tenants.js — redeploy-all esclude le sandbox, allineato a GET / (bug reale) ---');

  await test('GET / (lista visibile) mostra 2 tenant, non 3 — la sandbox è esclusa', async () => {
    const res = await fetch(BASE + '/api/tenants', { headers: auth });
    const list = await res.json();
    assertEq(list.length, 2);
  });

  await test('POST /redeploy-all: risultati coerenti con la lista visibile — 2, non 3', async () => {
    const res = await fetch(BASE + '/api/tenants/redeploy-all', { method: 'POST', headers: auth, body: JSON.stringify({}) });
    const body = await res.json();
    assertEq(res.status, 200);
    assertEq(body.results.length, 2, 'il conteggio di redeploy-all deve combaciare con GET / (2 tenant reali, sandbox esclusa)');
    assertEq(body.results.some((r) => r.slug === 'rsb-sandbox'), false, 'la sandbox non deve mai comparire nei risultati di redeploy-all');
  });

  console.log(`\n${'='.repeat(60)}`);
  console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
  if (failed > 0) console.log('Falliti: ' + failures.join(', '));
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Suite redeploy-all-sandbox-exclusion fallita ad avviarsi:', e);
  process.exit(1);
});
