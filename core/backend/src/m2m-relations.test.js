'use strict';
// F0.1.7.1.C2 (PLATFORM-MASTER-ROADMAP.md), priorità #6 del piano di regression
// (docs/F0-REGRESSION-PLAN.md) — relazioni many-to-many tra moduli (routes/m2m.js, tabella
// m2m_links). Prima di questo file: zero test, nonostante sia il motore di link/unlink usato
// da ogni relazione many-to-many della piattaforma.
//
// Stesso pattern di records-crud.test.js/records-workflow.test.js: server reale, DB
// temporaneo, richieste HTTP vere.
//
// Eseguire con: node src/m2m-relations.test.js (richiede porta 34574 libera in locale).

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const TEST_PORT = 34574;
const BASE = 'http://localhost:' + TEST_PORT;
const dbPath = path.join(os.tmpdir(), 'm2m-test-' + crypto.randomBytes(6).toString('hex') + '.db');

process.env.DB_PATH = dbPath;
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'm2m_test_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'm2m_test_internal_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'm2m_test_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'm2m-test-uploads-'));

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
  if (actual !== expected) {
    throw new Error(`${msg || ''}: atteso ${JSON.stringify(expected)}, ottenuto ${JSON.stringify(actual)}`);
  }
}
function assertTrue(cond, msg) {
  if (!cond) throw new Error(msg || 'atteso true');
}

async function waitForServer(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(BASE + '/health');
      if (res.ok) return;
    } catch (e) { /* non ancora in ascolto */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Server Core non pronto entro ' + timeoutMs + 'ms');
}

async function main() {
  require('./index.js');
  await waitForServer(10000);

  const loginRes = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: process.env.INITIAL_ADMIN_PASSWORD }),
  });
  const auth = { Authorization: 'Bearer ' + (await loginRes.json()).token, 'Content-Type': 'application/json' };

  const SOURCE = 'ordini', SOURCE_ID = 1, REL = 'prodotti_collegati';

  console.log('\n--- m2m.js — relazioni many-to-many (F0.1.7.1.C2) ---');

  await test('GET su una relazione senza link -> array vuoto (non 404)', async () => {
    const res = await fetch(BASE + '/api/m2m/' + SOURCE + '/' + SOURCE_ID + '/' + REL, { headers: auth });
    const body = await res.json();
    assertEq(res.status, 200);
    assertTrue(Array.isArray(body) && body.length === 0);
  });

  await test('POST senza target_module/target_id -> 400', async () => {
    const res = await fetch(BASE + '/api/m2m/' + SOURCE + '/' + SOURCE_ID + '/' + REL, { method: 'POST', headers: auth, body: JSON.stringify({}) });
    assertEq(res.status, 400);
  });

  await test('POST crea un link — 200, data persistito', async () => {
    const res = await fetch(BASE + '/api/m2m/' + SOURCE + '/' + SOURCE_ID + '/' + REL, {
      method: 'POST', headers: auth, body: JSON.stringify({ target_module: 'prodotti', target_id: 42, data: { quantita: 3 } }),
    });
    const body = await res.json();
    assertEq(res.status, 200);
    assertEq(body.target_module, 'prodotti');
    assertEq(body.data.quantita, 3);
  });

  await test('GET ora restituisce il link appena creato', async () => {
    const res = await fetch(BASE + '/api/m2m/' + SOURCE + '/' + SOURCE_ID + '/' + REL, { headers: auth });
    const body = await res.json();
    assertEq(body.length, 1);
    assertEq(body[0].target_id, 42);
  });

  await test('POST dello STESSO link (stessa source/relation/target) -> 400 (vincolo UNIQUE)', async () => {
    const res = await fetch(BASE + '/api/m2m/' + SOURCE + '/' + SOURCE_ID + '/' + REL, {
      method: 'POST', headers: auth, body: JSON.stringify({ target_module: 'prodotti', target_id: 42, data: {} }),
    });
    assertEq(res.status, 400);
  });

  await test('Lo stesso target_id su una relation_key DIVERSA è un link distinto, non un duplicato', async () => {
    const res = await fetch(BASE + '/api/m2m/' + SOURCE + '/' + SOURCE_ID + '/altra_relazione', {
      method: 'POST', headers: auth, body: JSON.stringify({ target_module: 'prodotti', target_id: 42, data: {} }),
    });
    assertEq(res.status, 200);
  });

  await test('PUT aggiorna il data di un link esistente', async () => {
    const res = await fetch(BASE + '/api/m2m/' + SOURCE + '/' + SOURCE_ID + '/' + REL + '/42', {
      method: 'PUT', headers: auth, body: JSON.stringify({ data: { quantita: 7 } }),
    });
    const body = await res.json();
    assertEq(res.status, 200);
    assertEq(body.data.quantita, 7);
  });

  await test('PUT su un link inesistente -> 404', async () => {
    const res = await fetch(BASE + '/api/m2m/' + SOURCE + '/' + SOURCE_ID + '/' + REL + '/999999', {
      method: 'PUT', headers: auth, body: JSON.stringify({ data: {} }),
    });
    assertEq(res.status, 404);
  });

  await test('DELETE rimuove il link — poi GET non lo elenca più', async () => {
    const res = await fetch(BASE + '/api/m2m/' + SOURCE + '/' + SOURCE_ID + '/' + REL + '/42', { method: 'DELETE', headers: auth });
    assertEq(res.status, 200);
    const listRes = await fetch(BASE + '/api/m2m/' + SOURCE + '/' + SOURCE_ID + '/' + REL, { headers: auth });
    const body = await listRes.json();
    assertEq(body.length, 0, 'il link eliminato non deve più comparire, ma "altra_relazione" (non toccata) sì altrove');
  });

  await test('DELETE su un link già assente -> comunque 200 {ok:true} (idempotente, mai un errore bloccante)', async () => {
    const res = await fetch(BASE + '/api/m2m/' + SOURCE + '/' + SOURCE_ID + '/' + REL + '/42', { method: 'DELETE', headers: auth });
    const body = await res.json();
    assertEq(res.status, 200);
    assertEq(body.ok, true);
  });

  await test('Endpoint senza auth -> 401', async () => {
    const res = await fetch(BASE + '/api/m2m/' + SOURCE + '/' + SOURCE_ID + '/' + REL);
    assertEq(res.status, 401);
  });

  console.log(`\n${'='.repeat(60)}`);
  console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
  if (failed > 0) console.log('Falliti: ' + failures.join(', '));

  try { fs.unlinkSync(dbPath); } catch (e) {}
  try { fs.rmSync(process.env.UPLOAD_DIR, { recursive: true, force: true }); } catch (e) {}
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Suite relazioni m2m fallita ad avviarsi:', e);
  process.exit(1);
});
