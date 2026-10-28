'use strict';
// F0.1.7.1.C2 (PLATFORM-MASTER-ROADMAP.md) — motore generico record (records.js), priorità #1
// del piano di regression (docs/F0-REGRESSION-PLAN.md): è IL flusso più eseguito di tutta la
// piattaforma (vedi docs/FLOWS.md §1) e, prima di questo file, non aveva alcun test Integration
// o Unit — solo le viste specializzate (category-pivot, financial-statement, ecc.) lo erano.
// Stesso pattern di super-admin/backend/src/isolation.test.js: avvia il VERO server Express di
// core/backend (require di index.js, DB SQLite temporaneo dedicato) e fa richieste HTTP reali
// via fetch, non mock — è l'unico modo per verificare davvero create/read/update/delete, non
// solo la logica di validazione isolata.
//
// Eseguire con: node src/records-crud.test.js (richiede porta 34568 libera in locale).

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const TEST_PORT = 34568;
const BASE = 'http://localhost:' + TEST_PORT;
const dbPath = path.join(os.tmpdir(), 'records-crud-test-' + crypto.randomBytes(6).toString('hex') + '.db');

process.env.DB_PATH = dbPath;
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'records_crud_test_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'records_crud_test_internal_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'records_crud_test_admin_pw';
// upload-storage.js fa mkdirSync EAGERLY su UPLOAD_DIR al semplice require() (stesso motivo di
// SUPPORT_UPLOAD_DIR in isolation.test.js) — su un host senza /data questo boot fallirebbe.
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'records-crud-test-uploads-'));

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

  const db = require('./db'); // stesso singleton già istanziato da index.js (require cache)

  // ─── Fixture: un modulo di test con 3 campi (uno unique, uno con default) ────
  const SLUG = 'crud_test_modulo';
  const schema = {
    fields: [
      { key: 'nome', type: 'text', label: 'Nome', unique: true },
      { key: 'email', type: 'text', label: 'Email' },
      { key: 'note', type: 'text', label: 'Note', default_value: 'n/d' },
    ],
  };
  db.prepare('INSERT INTO modules (name, slug, icon, color, installed, sort_order, schema_json) VALUES (?, ?, ?, ?, 1, 99, ?)')
    .run('Modulo Test CRUD', SLUG, 'box', '#2563EB', JSON.stringify(schema));

  const loginRes = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: process.env.INITIAL_ADMIN_PASSWORD }),
  });
  const loginBody = await loginRes.json();
  const auth = { Authorization: 'Bearer ' + loginBody.token, 'Content-Type': 'application/json' };

  let createdId = null;

  console.log('\n--- records.js — CRUD generico (F0.1.7.1.C2) ---');

  await test('POST /:slug crea un record — 200, id assegnato, default_value applicato', async () => {
    const res = await fetch(BASE + '/api/records/' + SLUG, {
      method: 'POST', headers: auth, body: JSON.stringify({ nome: 'Mario Rossi', email: 'mario@test.it' }),
    });
    const body = await res.json();
    assertEq(res.status, 200);
    assertTrue(typeof body.id === 'number', 'id deve essere un numero');
    assertEq(body.data.nome, 'Mario Rossi');
    assertEq(body.data.note, 'n/d', 'default_value non applicato');
    createdId = body.id;
  });

  await test('POST /:slug senza auth -> 401', async () => {
    const res = await fetch(BASE + '/api/records/' + SLUG, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nome: 'X' }),
    });
    assertEq(res.status, 401);
  });

  await test('GET /:slug elenca il record appena creato', async () => {
    const res = await fetch(BASE + '/api/records/' + SLUG, { headers: auth });
    const body = await res.json();
    assertEq(res.status, 200);
    assertTrue(Array.isArray(body), 'la risposta deve essere un array');
    assertTrue(body.some((r) => r.id === createdId), 'il record creato deve comparire nella lista');
  });

  await test('GET /:slug/:id ritorna il singolo record con i dati corretti', async () => {
    const res = await fetch(BASE + '/api/records/' + SLUG + '/' + createdId, { headers: auth });
    const body = await res.json();
    assertEq(res.status, 200);
    assertEq(body.data.email, 'mario@test.it');
  });

  await test('GET /:slug/:id su un id inesistente -> 404', async () => {
    const res = await fetch(BASE + '/api/records/' + SLUG + '/999999', { headers: auth });
    assertEq(res.status, 404);
  });

  await test('POST /:slug con nome duplicato (campo unique) -> 400', async () => {
    const res = await fetch(BASE + '/api/records/' + SLUG, {
      method: 'POST', headers: auth, body: JSON.stringify({ nome: 'Mario Rossi', email: 'altro@test.it' }),
    });
    assertEq(res.status, 400);
  });

  await test('PUT /:slug/:id aggiorna il record e registra la cronologia', async () => {
    const res = await fetch(BASE + '/api/records/' + SLUG + '/' + createdId, {
      method: 'PUT', headers: auth, body: JSON.stringify({ nome: 'Mario Rossi', email: 'mario.nuovo@test.it', note: 'n/d' }),
    });
    const body = await res.json();
    assertEq(res.status, 200);
    assertEq(body.data.email, 'mario.nuovo@test.it');
    const history = db.prepare("SELECT * FROM record_history WHERE record_id = ? AND action = 'update'").all(createdId);
    assertEq(history.length, 1, 'PUT deve registrare esattamente una riga di cronologia update');
  });

  await test('PUT /:slug/:id su un id inesistente -> 404', async () => {
    const res = await fetch(BASE + '/api/records/' + SLUG + '/999999', {
      method: 'PUT', headers: auth, body: JSON.stringify({ nome: 'X' }),
    });
    assertEq(res.status, 404);
  });

  await test('DELETE /:slug/:id elimina il record, poi 404 su GET', async () => {
    const res = await fetch(BASE + '/api/records/' + SLUG + '/' + createdId, { method: 'DELETE', headers: auth });
    const body = await res.json();
    assertEq(res.status, 200);
    assertTrue(body.ok === true);
    const getRes = await fetch(BASE + '/api/records/' + SLUG + '/' + createdId, { headers: auth });
    assertEq(getRes.status, 404);
  });

  await test('DELETE /:slug/:id su un id già eliminato -> 404 (non idempotente-200)', async () => {
    const res = await fetch(BASE + '/api/records/' + SLUG + '/' + createdId, { method: 'DELETE', headers: auth });
    assertEq(res.status, 404);
  });

  // ─── Cancellare un piano a rate (Vista genitore-figli) in cascata, solo le rate NON pagate ──────────────
  console.log('\n--- DELETE in cascata delle righe collegate (piano a rate, Vista genitore-figli) ---');
  const PARENT_SLUG = 'crud_test_piano';
  const CHILD_SLUG = 'crud_test_rata';
  db.prepare('INSERT INTO modules (name, slug, icon, color, installed, sort_order, schema_json) VALUES (?, ?, ?, ?, 1, 98, ?)').run(
    'Piano Test', PARENT_SLUG, 'box', '#2563EB',
    JSON.stringify({ fields: [{ key: 'nome', type: 'text', label: 'Nome' }], parent_children_views: [{ key: 'rate', label: 'Rate', children_module: CHILD_SLUG, children_relation: 'piano', children_status_field: 'stato', children_status_done_value: 'pagata', amount_field: 'nome', child_amount_field: 'importo' }] })
  );
  db.prepare('INSERT INTO modules (name, slug, icon, color, installed, sort_order, schema_json) VALUES (?, ?, ?, ?, 1, 97, ?)').run(
    'Rata Test', CHILD_SLUG, 'box', '#2563EB',
    JSON.stringify({ fields: [{ key: 'importo', type: 'number', label: 'Importo' }, { key: 'stato', type: 'select', label: 'Stato', options: ['da_pagare', 'pagata'] }], relations: [{ key: 'piano', label: 'Piano', type: 'many_to_one', target_module: PARENT_SLUG }] })
  );
  let pianoId, rataNonPagataId, rataPagataId;
  await test('setup: creo il piano e due rate, una pagata una no', async () => {
    const p = await (await fetch(BASE + '/api/records/' + PARENT_SLUG, { method: 'POST', headers: auth, body: JSON.stringify({ nome: 'Piano A' }) })).json();
    pianoId = p.id;
    const r1 = await (await fetch(BASE + '/api/records/' + CHILD_SLUG, { method: 'POST', headers: auth, body: JSON.stringify({ importo: 100, stato: 'da_pagare', piano: pianoId }) })).json();
    rataNonPagataId = r1.id;
    const r2 = await (await fetch(BASE + '/api/records/' + CHILD_SLUG, { method: 'POST', headers: auth, body: JSON.stringify({ importo: 100, stato: 'pagata', piano: pianoId }) })).json();
    rataPagataId = r2.id;
    assertTrue(typeof pianoId === 'number' && typeof rataNonPagataId === 'number' && typeof rataPagataId === 'number');
  });

  await test('DELETE del piano elimina anche la rata non pagata collegata, non quella pagata', async () => {
    const res = await fetch(BASE + '/api/records/' + PARENT_SLUG + '/' + pianoId, { method: 'DELETE', headers: auth });
    const body = await res.json();
    assertEq(res.status, 200);
    assertEq(body.righe_collegate_eliminate, 1, 'deve eliminare esattamente 1 riga collegata (quella non pagata)');
    const getNonPagata = await fetch(BASE + '/api/records/' + CHILD_SLUG + '/' + rataNonPagataId, { headers: auth });
    assertEq(getNonPagata.status, 404, 'la rata non pagata deve essere stata eliminata');
    const getPagata = await fetch(BASE + '/api/records/' + CHILD_SLUG + '/' + rataPagataId, { headers: auth });
    assertEq(getPagata.status, 200, 'la rata già pagata NON deve essere toccata');
  });

  console.log(`\n${'='.repeat(60)}`);
  console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
  if (failed > 0) console.log('Falliti: ' + failures.join(', '));

  try { fs.unlinkSync(dbPath); } catch (e) {}
  try { fs.rmSync(process.env.UPLOAD_DIR, { recursive: true, force: true }); } catch (e) {}
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Suite CRUD record fallita ad avviarsi:', e);
  try { fs.unlinkSync(dbPath); } catch (e2) {}
  try { fs.rmSync(process.env.UPLOAD_DIR, { recursive: true, force: true }); } catch (e2) {}
  process.exit(1);
});
