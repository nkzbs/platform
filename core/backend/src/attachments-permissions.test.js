'use strict';
// Falla reale trovata il 2026-10-14 (segnalata dall'utente): routes/uploads.js
// (GET/DELETE /:id) e le tre rotte allegati di routes/records.js avevano solo
// requireAuth, nessun controllo sul record a cui l'allegato appartiene — un
// utente con "solo propri" (view_own_only) poteva leggere/aggiungere/staccare
// allegati di un record altrui conoscendone slug+id, o leggere/cancellare un
// upload altrui indovinando l'id. Server reale, DB temporaneo, due utenti
// VERI con login HTTP reale (non simulato) — stesso principio richiesto per
// ogni fix di permessi da qui in poi: provare che un utente non autorizzato
// viene DAVVERO respinto, non solo che il codice compila.
// Eseguire con: node src/attachments-permissions.test.js (porta 34591).

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const TEST_PORT = 34591;
const BASE = 'http://localhost:' + TEST_PORT;
const dbPath = path.join(os.tmpdir(), 'attach-perm-test-' + crypto.randomBytes(6).toString('hex') + '.db');

process.env.DB_PATH = dbPath;
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'attach_perm_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'attach_perm_internal_' + crypto.randomBytes(8).toString('hex');
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'attach-perm-uploads-'));

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

async function login(username, password) {
  const res = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
  const body = await res.json();
  if (!res.ok) throw new Error('login fallito per ' + username + ': ' + JSON.stringify(body));
  return body.token;
}

async function uploadFile(token, filename, text) {
  const form = new FormData();
  form.append('file', new Blob([text], { type: 'text/plain' }), filename);
  const res = await fetch(BASE + '/api/uploads', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: form });
  const body = await res.json();
  return { status: res.status, body };
}

async function main() {
  require('./index.js');
  await waitForServer(10000);

  const db = require('./db');
  const bcrypt = require('bcryptjs');
  const hash = bcrypt.hashSync('pw_di_prova_123', 4);

  const SOLO_PROPRI = { id: 'p1', block_type: 'permissions', rules: [{ role: 'user', view: true, view_own_only: true, owner_field: '', create: true, edit: true, delete: true }] };
  const SCHEMA = { version: 3, steps: [{ id: 'f1', block_type: 'field', key: 'descrizione', label: 'Descrizione', type: 'text' }, SOLO_PROPRI] };
  db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES ('Spese test', 'spese_test', 'box', '#000', 1, 1, 70, ?)").run(JSON.stringify(SCHEMA));

  const mkUser = (id, username, role) => db.prepare("INSERT INTO users (id, username, password_hash, display_name, role) VALUES (?, ?, ?, ?, ?)").run(id, username, hash, username, role);
  mkUser(10, 'alice', 'user');
  mkUser(11, 'bruno', 'user');
  mkUser(12, 'capo', 'admin');

  const recAId = db.prepare("INSERT INTO records (module_slug, user_id, data) VALUES ('spese_test', 10, ?)").run(JSON.stringify({ descrizione: 'di Alice' })).lastInsertRowid;

  const aliceToken = await login('alice', 'pw_di_prova_123');
  const brunoToken = await login('bruno', 'pw_di_prova_123');
  const capoToken = await login('capo', 'pw_di_prova_123');

  console.log('\n--- allegare un file al proprio record (flusso normale) ---');

  let uploadAId;
  await test('alice carica un file -> 200, upload suo', async () => {
    const { status, body } = await uploadFile(aliceToken, 'nota.txt', 'contenuto di alice');
    assertEq(status, 200);
    uploadAId = body.id;
    assertTrue(!!uploadAId);
  });

  await test('alice allega il proprio upload al proprio record -> 200', async () => {
    const res = await fetch(BASE + `/api/records/spese_test/${recAId}/attachments`, { method: 'POST', headers: { Authorization: 'Bearer ' + aliceToken, 'Content-Type': 'application/json' }, body: JSON.stringify({ upload_id: uploadAId, tipo: null }) });
    assertEq(res.status, 200);
  });

  console.log('\n--- bruno (stesso ruolo, "solo propri", NON è il proprietario del record) ---');

  await test('bruno NON vede gli allegati del record di alice -> 403', async () => {
    const res = await fetch(BASE + `/api/records/spese_test/${recAId}/attachments`, { headers: { Authorization: 'Bearer ' + brunoToken } });
    assertEq(res.status, 403);
  });

  await test('bruno NON legge il file di alice per id diretto -> 403', async () => {
    const res = await fetch(BASE + `/api/uploads/${uploadAId}`, { headers: { Authorization: 'Bearer ' + brunoToken } });
    assertEq(res.status, 403);
  });

  await test('bruno NON cancella il file di alice -> 403, il file resta', async () => {
    const res = await fetch(BASE + `/api/uploads/${uploadAId}`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + brunoToken } });
    assertEq(res.status, 403);
    const stillThere = await fetch(BASE + `/api/uploads/${uploadAId}`, { headers: { Authorization: 'Bearer ' + aliceToken } });
    assertEq(stillThere.status, 200);
  });

  await test('bruno NON allega un upload (nemmeno il proprio) al record di alice -> 403 sul record, prima ancora di guardare l\'upload', async () => {
    const { body: own } = await uploadFile(brunoToken, 'bruno.txt', 'di bruno');
    const res = await fetch(BASE + `/api/records/spese_test/${recAId}/attachments`, { method: 'POST', headers: { Authorization: 'Bearer ' + brunoToken, 'Content-Type': 'application/json' }, body: JSON.stringify({ upload_id: own.id }) });
    assertEq(res.status, 403);
  });

  console.log('\n--- alice vede il proprio, come prima del fix ---');

  await test('alice legge il proprio upload -> 200', async () => {
    const res = await fetch(BASE + `/api/uploads/${uploadAId}`, { headers: { Authorization: 'Bearer ' + aliceToken } });
    assertEq(res.status, 200);
  });

  await test('alice vede gli allegati del proprio record -> 200, una riga', async () => {
    const res = await fetch(BASE + `/api/records/spese_test/${recAId}/attachments`, { headers: { Authorization: 'Bearer ' + aliceToken } });
    assertEq(res.status, 200);
    const rows = await res.json();
    assertEq(rows.length, 1);
  });

  console.log('\n--- non si può "rubare" un upload altrui collegandolo al proprio record ---');

  let recBId, uploadForBId;
  await test('setup: record di bruno + un upload NON di bruno (di alice)', async () => {
    recBId = db.prepare("INSERT INTO records (module_slug, user_id, data) VALUES ('spese_test', 11, ?)").run(JSON.stringify({ descrizione: 'di bruno' })).lastInsertRowid;
    const { body } = await uploadFile(aliceToken, 'solo_di_alice.txt', 'segreto di alice');
    uploadForBId = body.id;
  });

  await test('bruno prova ad allegare al PROPRIO record un upload caricato da alice -> 403, non collegato', async () => {
    const res = await fetch(BASE + `/api/records/spese_test/${recBId}/attachments`, { method: 'POST', headers: { Authorization: 'Bearer ' + brunoToken, 'Content-Type': 'application/json' }, body: JSON.stringify({ upload_id: uploadForBId }) });
    assertEq(res.status, 403);
    const stillUnlinked = db.prepare('SELECT COUNT(*) AS n FROM record_attachments WHERE upload_id = ?').get(uploadForBId).n;
    assertEq(stillUnlinked, 0);
  });

  console.log('\n--- un upload non tuo e non ancora collegato a niente: nessuno lo legge, nemmeno un admin ---');

  await test('capo (admin) NON legge un upload altrui non ancora collegato a nessun record -> 403', async () => {
    const res = await fetch(BASE + `/api/uploads/${uploadForBId}`, { headers: { Authorization: 'Bearer ' + capoToken } });
    assertEq(res.status, 403);
  });

  console.log('\n--- un admin vede gli allegati di un record che non è suo (nessuna regola esplicita per admin -> accesso pieno di default) ---');

  await test('capo (admin) vede gli allegati del record di alice -> 200', async () => {
    const res = await fetch(BASE + `/api/records/spese_test/${recAId}/attachments`, { headers: { Authorization: 'Bearer ' + capoToken } });
    assertEq(res.status, 200);
  });

  console.log(`\n${'='.repeat(60)}`);
  console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
  if (failed > 0) console.log('Falliti: ' + failures.join(', '));
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Suite attachments-permissions fallita ad avviarsi:', e);
  process.exit(1);
});
