'use strict';
// Liste di opzioni condivise tra campi select di moduli diversi (routes/option-lists.js).
// Server reale, DB temporaneo. Eseguire con: node src/option-lists.test.js (porta 34817).

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const TEST_PORT = 34817;
const BASE = 'http://localhost:' + TEST_PORT;
const dbPath = path.join(os.tmpdir(), 'liste-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.DB_PATH = dbPath;
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'liste_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'liste_internal_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'liste_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'liste-uploads-'));
process.env.SUPER_ADMIN_URL = 'http://localhost:1';
process.env.TENANT_SLUG = 'liste';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; }
}
function assertEq(a, e, msg) { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${msg || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); }
function assertTrue(c, msg) { if (!c) throw new Error(msg || 'atteso true'); }
const F = (key, label, type, extra = {}) => ({ id: 'f_' + key, block_type: 'field', key, label, type, ...extra });

async function main() {
  require('./index.js');
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const db = require('./db');
  const mk = (slug, steps) => db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES (?, ?, 'box', '#000', 1, 1, 70, ?)").run(slug, slug, JSON.stringify({ version: 3, steps }));
  const login = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: process.env.INITIAL_ADMIN_PASSWORD }) })).json();
  const H = { Authorization: 'Bearer ' + login.token, 'Content-Type': 'application/json' };
  const api = (method, path, body) => fetch(BASE + '/api/option-lists' + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const fieldOf = (slug, key) => JSON.parse(db.prepare('SELECT schema_json FROM modules WHERE slug = ?').get(slug).schema_json).steps.find((s) => s.key === key);
  const riga = (slug, campo, valore) => db.prepare("INSERT INTO records (module_slug, user_id, data) VALUES (?, 1, ?)").run(slug, JSON.stringify({ [campo]: valore })).lastInsertRowid;
  const valoreDi = (id, campo) => JSON.parse(db.prepare('SELECT data FROM records WHERE id = ?').get(id).data)[campo];

  console.log('\n--- creare e collegare ---');
  let listId;
  await test('crea una lista vuota', async () => {
    const r = await api('POST', '', { name: 'Stati pagamento' });
    assertEq(r.status, 200); const j = await r.json(); listId = j.id; assertEq(j.items, []);
  });
  await test('rifiuta nome vuoto o troppo lungo', async () => {
    assertEq((await api('POST', '', { name: '  ' })).status, 400);
    assertEq((await api('POST', '', { name: 'x'.repeat(61) })).status, 400);
  });

  mk('spese_test', [F('titolo', 'Titolo', 'text'), F('stato', 'Stato', 'select', { options: [], list_id: listId })]);
  mk('entrate_test', [F('importo', 'Importo', 'number'), F('stato', 'Stato', 'select', { options: [], list_id: listId })]);
  mk('note_test', [F('testo', 'Testo', 'text')]); // non collegato — non deve mai essere toccato

  console.log('\n--- aggiungere una voce: si propaga a entrambi i moduli collegati ---');
  await test('aggiunge in option_list_items e in field.options di spese ED entrate, non in note', async () => {
    const r = await api('POST', `/${listId}/items`, { value: 'Pagato' });
    assertEq(r.status, 200); const j = await r.json(); assertEq(j.moduli_aggiornati, 2);
    assertEq(fieldOf('spese_test', 'stato').options, ['Pagato']);
    assertEq(fieldOf('entrate_test', 'stato').options, ['Pagato']);
  });
  await test('una seconda voce con lo stesso nome si rifiuta', async () => {
    assertEq((await api('POST', `/${listId}/items`, { value: 'pagato' })).status, 409);
  });
  let secondoItemId;
  await test('una seconda voce distinta si aggiunge a entrambi, in ordine', async () => {
    const r = await api('POST', `/${listId}/items`, { value: 'Da pagare' });
    const detail = await (await api('GET', `/${listId}`)).json();
    secondoItemId = detail.items.find((i) => i.value === 'Da pagare').id;
    assertEq(fieldOf('spese_test', 'stato').options, ['Pagato', 'Da pagare']);
  });

  console.log('\n--- rinominare: propaga schema E righe già esistenti, in entrambi i moduli ---');
  await test('rinomina "Pagato" -> "Saldato": cambia options e le righe di spese+entrate, lascia note intatto', async () => {
    const a = riga('spese_test', 'stato', 'Pagato'), b = riga('entrate_test', 'stato', 'Pagato'), c = riga('note_test', 'testo', 'Pagato');
    const item = (await (await api('GET', `/${listId}`)).json()).items.find((i) => i.value === 'Pagato');
    const r = await api('PATCH', `/${listId}/items/${item.id}`, { value: 'Saldato' });
    assertEq(r.status, 200); const j = await r.json(); assertEq(j.righe, 2); assertEq(j.moduli_aggiornati, 2);
    assertEq(fieldOf('spese_test', 'stato').options, ['Saldato', 'Da pagare']);
    assertEq(fieldOf('entrate_test', 'stato').options, ['Saldato', 'Da pagare']);
    assertEq(valoreDi(a, 'stato'), 'Saldato'); assertEq(valoreDi(b, 'stato'), 'Saldato');
    assertEq(valoreDi(c, 'testo'), 'Pagato', 'un modulo non collegato non viene mai toccato');
  });
  await test('rinominare verso un nome già usato nella lista si rifiuta', async () => {
    const item = (await (await api('GET', `/${listId}`)).json()).items.find((i) => i.value === 'Saldato');
    assertEq((await api('PATCH', `/${listId}/items/${item.id}`, { value: 'Da pagare' })).status, 409);
  });

  console.log('\n--- togliere: bloccata se usata in uno qualunque dei moduli collegati ---');
  await test('non si può togliere "Saldato": è ancora usata in spese/entrate', async () => {
    const item = (await (await api('GET', `/${listId}`)).json()).items.find((i) => i.value === 'Saldato');
    const r = await api('DELETE', `/${listId}/items/${item.id}`);
    assertEq(r.status, 409); assertTrue(/usato/.test((await r.json()).error));
  });
  await test('si può togliere "Da pagare": nessuna riga la usa, sparisce da entrambi gli options', async () => {
    const r = await api('DELETE', `/${listId}/items/${secondoItemId}`);
    assertEq(r.status, 200);
    assertEq(fieldOf('spese_test', 'stato').options, ['Saldato']);
    assertEq(fieldOf('entrate_test', 'stato').options, ['Saldato']);
  });

  console.log('\n--- eliminare la lista: scollega i campi, NON cancella le loro options ---');
  await test('dopo l\'eliminazione i campi perdono list_id ma mantengono le options correnti', async () => {
    const r = await api('DELETE', `/${listId}`);
    assertEq(r.status, 200);
    assertEq(fieldOf('spese_test', 'stato').list_id, undefined);
    assertEq(fieldOf('spese_test', 'stato').options, ['Saldato']);
    assertEq((await api('GET', `/${listId}`)).status, 404);
  });

  console.log('\n--- un modulo salvato in v2 "classico" (fields[] piatto, come lo riscrive il Builder) ---');
  await test('una lista si collega e si propaga anche a un campo di un modulo v2, non solo v3', async () => {
    db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES (?, ?, 'box', '#000', 1, 1, 70, ?)")
      .run('v2_test', 'v2_test', JSON.stringify({ fields: [{ key: 'categoria', label: 'Categoria', type: 'select', options: ['Luce'], list_id: null }] }));
    const create = await api('POST', '', { name: 'Categoria v2' });
    const lid = (await create.json()).id;
    const campoV2 = () => JSON.parse(db.prepare('SELECT schema_json FROM modules WHERE slug = ?').get('v2_test').schema_json).fields.find((f) => f.key === 'categoria');
    db.prepare('UPDATE modules SET schema_json = ? WHERE slug = ?').run(JSON.stringify({ fields: [{ ...campoV2(), list_id: lid }] }), 'v2_test');
    const r = await api('POST', `/${lid}/items`, { value: 'Gas' });
    assertEq(r.status, 200); const j = await r.json(); assertEq(j.moduli_aggiornati, 1, 'il modulo v2 deve risultare collegato, non saltato');
    assertEq(campoV2().options, ['Luce', 'Gas']);
  });

  console.log('\n--- autenticazione ---');
  await test('senza token: 401', async () => {
    assertEq((await fetch(BASE + '/api/option-lists')).status, 401);
  });

  console.log(`\n${'='.repeat(60)}`);
  console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
  try { fs.unlinkSync(dbPath); } catch (e) {}
  process.exit(failed > 0 ? 1 : 0);
}
main().catch((e) => { console.error('Suite option-lists fallita ad avviarsi:', e); process.exit(1); });
