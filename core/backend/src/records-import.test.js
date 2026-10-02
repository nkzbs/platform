'use strict';
// F15 (PLATFORM-MASTER-ROADMAP.md) — Migration Engine: prima generazione realistica senza
// fabbricare connettori per sistemi specifici (gestionali di terze parti, nessuna conoscenza
// verificabile del loro formato) — CSV generico con Discover/Profile/Map resi reali
// (routes/records.js: POST /:slug/import/preview, nuovo) sopra l'Extract/Validate/Migrate/
// Reconcile che esistevano già (POST /:slug/import, mai testato prima d'ora). Stesso pattern
// di records-crud.test.js: server reale, DB temporaneo, richieste HTTP vere.
//
// Eseguire con: node src/records-import.test.js (richiede porta 34574 libera).

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const TEST_PORT = 34574;
const BASE = 'http://localhost:' + TEST_PORT;
const dbPath = path.join(os.tmpdir(), 'records-import-test-' + crypto.randomBytes(6).toString('hex') + '.db');

process.env.DB_PATH = dbPath;
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'import_test_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'import_test_internal_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'import_test_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'import-test-uploads-'));

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
  throw new Error('Server Core non pronto entro ' + timeoutMs + 'ms');
}

async function main() {
  require('./index.js');
  await waitForServer(10000);

  const db = require('./db');
  const SLUG = 'import_test_modulo';
  const schema = {
    fields: [
      { key: 'nome', label: 'Nome', type: 'text', required: true },
      { key: 'email', label: 'Email', type: 'text' },
      { key: 'citta', label: 'Città', type: 'text' },
    ],
  };
  db.prepare('INSERT INTO modules (name, slug, icon, color, installed, sort_order, schema_json) VALUES (?, ?, ?, ?, 1, 99, ?)')
    .run('Modulo Test Import', SLUG, 'box', '#2563EB', JSON.stringify(schema));

  const loginRes = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: process.env.INITIAL_ADMIN_PASSWORD }),
  });
  const auth = { Authorization: 'Bearer ' + (await loginRes.json()).token, 'Content-Type': 'application/json' };

  console.log('\n--- records.js — import CSV con Discover/Profile/Map (F15) ---');

  await test('POST /import con header ESATTI (comportamento storico, invariato) -> match automatico', async () => {
    const csv = 'Nome,Email,Città\nMario Rossi,mario@test.it,Roma\nLuca Bianchi,luca@test.it,Milano\n';
    const res = await fetch(BASE + '/api/records/' + SLUG + '/import', { method: 'POST', headers: auth, body: JSON.stringify({ csv }) });
    const body = await res.json();
    assertEq(res.status, 200);
    assertEq(body.created, 2);
    assertEq(body.errors.length, 0);
  });

  await test('POST /import/preview su header NON esatti (maiuscole/accenti diversi) -> suggerisce comunque una mappatura', async () => {
    const csv = 'NOME COMPLETO,indirizzo email,CITTA\nAnna Verdi,anna@test.it,Torino\n';
    // "NOME COMPLETO" non normalizza a "nome" (parole diverse) -> deve restare in unmatchedFields per 'nome'.
    const res = await fetch(BASE + '/api/records/' + SLUG + '/import/preview', { method: 'POST', headers: auth, body: JSON.stringify({ csv }) });
    const body = await res.json();
    assertEq(res.status, 200);
    assertEq(body.headers.length, 3);
    assertEq(body.totalRows, 1);
    assertEq(body.sampleRows[0][0], 'Anna Verdi');
    // "CITTA" (senza accento) normalizza uguale a "Città" -> suggerito per indice 2.
    assertEq(body.suggestedMap[2], 'citta', 'match normalizzato (accento/maiuscole ignorati) deve suggerire "citta"');
    assertTrue(body.unmatchedFields.some((f) => f.key === 'nome'), '"NOME COMPLETO" non deve auto-matchare "nome" (nomi diversi, non solo accenti/maiuscole)');
  });

  await test('POST /import/preview NON scrive alcun record (solo anteprima)', async () => {
    const before = (await (await fetch(BASE + '/api/records/' + SLUG, { headers: auth })).json()).length;
    await fetch(BASE + '/api/records/' + SLUG + '/import/preview', { method: 'POST', headers: auth, body: JSON.stringify({ csv: 'NOME COMPLETO,indirizzo email,CITTA\nAnna Verdi,anna@test.it,Torino\n' }) });
    const after = (await (await fetch(BASE + '/api/records/' + SLUG, { headers: auth })).json()).length;
    assertEq(after, before, 'una preview non deve mai creare record');
  });

  await test('POST /import con field_map ESPLICITO (mappatura confermata dall\'utente dopo la preview) -> usa quella, non il match automatico', async () => {
    const csv = 'NOME COMPLETO,indirizzo email,CITTA\nAnna Verdi,anna@test.it,Torino\n';
    const field_map = { 0: 'nome', 1: 'email', 2: 'citta' }; // l'utente ha confermato/corretto a mano
    const res = await fetch(BASE + '/api/records/' + SLUG + '/import', { method: 'POST', headers: auth, body: JSON.stringify({ csv, field_map }) });
    const body = await res.json();
    assertEq(res.status, 200);
    assertEq(body.created, 1);

    const list = await (await fetch(BASE + '/api/records/' + SLUG, { headers: auth })).json();
    const anna = list.find((r) => r.data.nome === 'Anna Verdi');
    assertTrue(!!anna, 'il record deve esistere con "nome" popolato via field_map esplicito, mai possibile col solo match automatico su questi header');
    assertEq(anna.data.citta, 'Torino');
  });

  await test('senza auth -> 401 su preview e import', async () => {
    const r1 = await fetch(BASE + '/api/records/' + SLUG + '/import/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ csv: 'a\nb' }) });
    const r2 = await fetch(BASE + '/api/records/' + SLUG + '/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ csv: 'a\nb' }) });
    assertEq(r1.status, 401); assertEq(r2.status, 401);
  });

  console.log(`\n${'='.repeat(60)}`);
  console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
  if (failed > 0) console.log('Falliti: ' + failures.join(', '));
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Suite records-import fallita ad avviarsi:', e);
  process.exit(1);
});
