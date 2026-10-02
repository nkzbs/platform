'use strict';
// F0.1.7.1.C2 (PLATFORM-MASTER-ROADMAP.md), priorità #2 del piano di regression
// (docs/F0-REGRESSION-PLAN.md) — transizioni di workflow (records.js, POST
// /:slug/:id/transition). Prima di questo file: zero test.
//
// Bug reale trovato e corretto in questa stessa sessione durante la scrittura di questo
// test (non solo documentato, come segnalato in docs/frontend-behavior/core-recorddetailmodal.md
// e in docs/F0-FEATURE-MATRIX.md): la risposta della transizione costruiva `attached.data`
// con `JSON.parse(record.data)` grezzo, saltando `decryptFields` — unico punto del motore
// record a farlo (create/update/get lo chiamano tutti). Un record con campi `encrypted`
// mostrava la stringa cifrata grezza subito dopo una transizione, finché non veniva
// ricaricato. Il test "campo encrypted decifrato correttamente" sotto è la regressione
// permanente su quel fix, non solo una verifica del comportamento nuovo.
//
// Stesso pattern di records-crud.test.js: server reale, DB temporaneo, richieste HTTP vere.
// Eseguire con: node src/records-workflow.test.js (richiede porta 34569 libera in locale).

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const TEST_PORT = 34569;
const BASE = 'http://localhost:' + TEST_PORT;
const dbPath = path.join(os.tmpdir(), 'records-workflow-test-' + crypto.randomBytes(6).toString('hex') + '.db');

process.env.DB_PATH = dbPath;
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'records_workflow_test_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'records_workflow_test_internal_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'records_workflow_test_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'records-workflow-test-uploads-'));

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

  const db = require('./db');

  // ─── Fixture: modulo con workflow (bozza -> confermato -> archiviato) e un campo
  // encrypted, per coprire sia le transizioni sia il bug della decifratura mancante ───
  const SLUG = 'workflow_test_modulo';
  const schema = {
    fields: [
      { key: 'titolo', type: 'text', label: 'Titolo' },
      { key: 'segreto', type: 'encrypted', label: 'Segreto' },
    ],
    workflow: {
      states: [{ key: 'bozza' }, { key: 'confermato' }, { key: 'archiviato' }],
      transitions: [
        { from: 'bozza', to: 'confermato' },
        { from: 'confermato', to: 'archiviato', roles: ['admin'] },
      ],
    },
  };
  db.prepare('INSERT INTO modules (name, slug, icon, color, installed, sort_order, schema_json) VALUES (?, ?, ?, ?, 1, 99, ?)')
    .run('Modulo Test Workflow', SLUG, 'box', '#2563EB', JSON.stringify(schema));

  const loginRes = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: process.env.INITIAL_ADMIN_PASSWORD }),
  });
  const loginBody = await loginRes.json();
  const auth = { Authorization: 'Bearer ' + loginBody.token, 'Content-Type': 'application/json' };

  async function createRecord(data) {
    const res = await fetch(BASE + '/api/records/' + SLUG, { method: 'POST', headers: auth, body: JSON.stringify(data) });
    return res.json();
  }

  console.log('\n--- records.js — transizioni workflow (F0.1.7.1.C2) ---');

  let recId = null;
  await test('Un record nuovo parte senza _stato (nessun default automatico)', async () => {
    const rec = await createRecord({ titolo: 'Pratica A', segreto: 'numero-di-conto-123' });
    recId = rec.id;
    assertEq(rec.data._stato, undefined);
  });

  await test('POST transition senza "to" -> 400', async () => {
    const res = await fetch(BASE + '/api/records/' + SLUG + '/' + recId + '/transition', { method: 'POST', headers: auth, body: JSON.stringify({}) });
    assertEq(res.status, 400);
  });

  await test('Transizione da uno stato senza corrispondenza (from=undefined, to=confermato) -> 422', async () => {
    const res = await fetch(BASE + '/api/records/' + SLUG + '/' + recId + '/transition', { method: 'POST', headers: auth, body: JSON.stringify({ to: 'archiviato' }) });
    assertEq(res.status, 422, 'non esiste una transizione undefined -> archiviato');
  });

  // Porta il record in bozza esplicitamente (nessuna transizione da 'undefined' a 'bozza'
  // nello schema — si simula lo stato iniziale scrivendo _stato direttamente, come farebbe
  // un form che imposta lo stato iniziale alla creazione).
  db.prepare("UPDATE records SET data = json_set(data, '$._stato', 'bozza') WHERE id = ?").run(recId);

  await test('Transizione ammessa (bozza -> confermato) — 200, _stato aggiornato', async () => {
    const res = await fetch(BASE + '/api/records/' + SLUG + '/' + recId + '/transition', { method: 'POST', headers: auth, body: JSON.stringify({ to: 'confermato' }) });
    const body = await res.json();
    assertEq(res.status, 200);
    assertEq(body.data._stato, 'confermato');
  });

  await test('La transizione registra una riga di cronologia action=transition', async () => {
    const history = db.prepare("SELECT * FROM record_history WHERE record_id = ? AND action = 'transition'").all(recId);
    assertEq(history.length, 1);
  });

  await test('REGRESSIONE — campo "encrypted" decifrato correttamente nella risposta della transizione (bug corretto in questa sessione)', async () => {
    const res = await fetch(BASE + '/api/records/' + SLUG + '/' + recId + '/transition', { method: 'POST', headers: auth, body: JSON.stringify({ to: 'archiviato' }) });
    const body = await res.json();
    assertEq(res.status, 200);
    assertEq(body.data.segreto, 'numero-di-conto-123', 'il campo encrypted deve tornare in chiaro, non come stringa cifrata grezza');
  });

  await test('Ri-tentare la STESSA transizione già eseguita (confermato -> archiviato, ora lo stato è già archiviato) -> 422', async () => {
    const res = await fetch(BASE + '/api/records/' + SLUG + '/' + recId + '/transition', { method: 'POST', headers: auth, body: JSON.stringify({ to: 'archiviato' }) });
    assertEq(res.status, 422, 'lo stato attuale è già archiviato, non più confermato: nessuna transizione archiviato -> archiviato definita');
  });

  // ─── Ruolo: la transizione confermato->archiviato richiede admin ───
  let recId2 = null;
  await test('Setup secondo record per test di ruolo', async () => {
    const rec = await createRecord({ titolo: 'Pratica B' });
    recId2 = rec.id;
    db.prepare("UPDATE records SET data = json_set(data, '$._stato', 'confermato') WHERE id = ?").run(recId2);
  });

  db.prepare("INSERT INTO users (username, password_hash, display_name, role) VALUES ('viewer_test', ?, 'Viewer', 'viewer')")
    .run(require('bcryptjs').hashSync('viewer_test_pw', 10));
  const loginViewer = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'viewer_test', password: 'viewer_test_pw' }),
  });
  const viewerToken = (await loginViewer.json()).token;
  const authViewer = { Authorization: 'Bearer ' + viewerToken, 'Content-Type': 'application/json' };

  await test('Un ruolo non incluso in transition.roles non può eseguire la transizione -> 403', async () => {
    const res = await fetch(BASE + '/api/records/' + SLUG + '/' + recId2 + '/transition', { method: 'POST', headers: authViewer, body: JSON.stringify({ to: 'archiviato' }) });
    assertEq(res.status, 403);
  });

  await test('Il ruolo admin (incluso in transition.roles) può eseguire la stessa transizione — controllo positivo', async () => {
    const res = await fetch(BASE + '/api/records/' + SLUG + '/' + recId2 + '/transition', { method: 'POST', headers: auth, body: JSON.stringify({ to: 'archiviato' }) });
    assertEq(res.status, 200);
  });

  await test('Modulo senza workflow -> 400 su qualunque transizione', async () => {
    const noWfSlug = 'no_workflow_test_modulo';
    db.prepare('INSERT INTO modules (name, slug, icon, color, installed, sort_order, schema_json) VALUES (?, ?, ?, ?, 1, 99, ?)')
      .run('Senza Workflow', noWfSlug, 'box', '#2563EB', JSON.stringify({ fields: [{ key: 'x', type: 'text' }] }));
    const rec = await (await fetch(BASE + '/api/records/' + noWfSlug, { method: 'POST', headers: auth, body: JSON.stringify({ x: '1' }) })).json();
    const res = await fetch(BASE + '/api/records/' + noWfSlug + '/' + rec.id + '/transition', { method: 'POST', headers: auth, body: JSON.stringify({ to: 'qualunque' }) });
    assertEq(res.status, 400);
  });

  console.log(`\n${'='.repeat(60)}`);
  console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
  if (failed > 0) console.log('Falliti: ' + failures.join(', '));

  try { fs.unlinkSync(dbPath); } catch (e) {}
  try { fs.rmSync(process.env.UPLOAD_DIR, { recursive: true, force: true }); } catch (e) {}
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Suite transizioni workflow fallita ad avviarsi:', e);
  try { fs.unlinkSync(dbPath); } catch (e2) {}
  try { fs.rmSync(process.env.UPLOAD_DIR, { recursive: true, force: true }); } catch (e2) {}
  process.exit(1);
});
