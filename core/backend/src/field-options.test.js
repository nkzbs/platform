'use strict';
// Cartelle (valori di un campo a scelta) modificabili: rinomina, aggiungi, togli (routes/field-options.js). Server reale, DB temporaneo.
// Server reale, DB temporaneo. Eseguire con: node src/field-options.test.js (porta 34816).

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const TEST_PORT = 34816;
const BASE = 'http://localhost:' + TEST_PORT;
const dbPath = path.join(os.tmpdir(), 'opzioni-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.DB_PATH = dbPath;
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'opzioni_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'opzioni_internal_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'opzioni_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'opzioni-uploads-'));
process.env.SUPER_ADMIN_URL = 'http://localhost:1';
process.env.TENANT_SLUG = 'opzioni';

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
  // 'doc': opzioni semplici; 'doc2': opzioni {value,label}; 'doc3': una regola che cita «Fattura»
  const mk = (slug, opts, extra = []) => db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES (?, ?, 'box', '#000', 1, 1, 70, ?)").run(slug, slug, JSON.stringify({ version: 3, steps: [F('titolo', 'Titolo', 'text'), F('tipo', 'Tipo', 'select', { options: opts }), F('report', 'Report', 'text'), ...extra] }));
  mk('doc', ['Contratto', 'Fattura', 'Report']);
  mk('doc2', [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]);
  mk('doc3', ['Contratto', 'Fattura'], [{ id: 'au', block_type: 'automation', label: 'Avvisa', trigger: { evento: 'nuovo_record', condizione: { campo: 'tipo', op: '==', valore: 'Fattura' } }, azioni: [] }]);
  const login = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: process.env.INITIAL_ADMIN_PASSWORD }) })).json();
  const H = { Authorization: 'Bearer ' + login.token, 'Content-Type': 'application/json' };
  const call = (slug, body, h = H, key = 'tipo') => fetch(BASE + '/api/field-options/' + slug + '/' + key, { method: 'POST', headers: h, body: JSON.stringify(body) });
  const riga = (slug, tipo) => db.prepare("INSERT INTO records (module_slug, user_id, data) VALUES (?, 1, ?)").run(slug, JSON.stringify({ titolo: 'x', tipo, report: 'r' })).lastInsertRowid;
  const opts = (slug) => JSON.parse(db.prepare('SELECT schema_json FROM modules WHERE slug = ?').get(slug).schema_json).steps.find((s) => s.key === 'tipo').options;
  const tipoDi = (id) => JSON.parse(db.prepare('SELECT data FROM records WHERE id = ?').get(id).data).tipo;

  console.log('\n--- rinominare ---');
  await test('rinomina nello schema e in tutte le righe che la usano, lasciando intatto il resto; resta una riga di cronologia', async () => {
    const a = riga('doc', 'Contratto'), b = riga('doc', 'Contratto'), c = riga('doc', 'Fattura');
    const r = await call('doc', { action: 'rename', from: 'Contratto', to: 'Contratti di casa' });
    assertEq(r.status, 200); const j = await r.json(); assertEq(j.righe, 2);
    assertEq(opts('doc'), ['Contratti di casa', 'Fattura', 'Report']); assertEq([tipoDi(a), tipoDi(b), tipoDi(c)], ['Contratti di casa', 'Contratti di casa', 'Fattura']);
    assertEq(JSON.parse(db.prepare('SELECT data FROM records WHERE id = ?').get(a).data).report, 'r', 'gli altri campi non cambiano');
    const m = db.prepare("SELECT id, schema_version v FROM modules WHERE slug = 'doc'").get();
    assertEq(db.prepare('SELECT COUNT(*) c FROM modules_schema_history WHERE module_id = ?').get(m.id).c, 1, 'cronologia'); assertTrue(m.v >= 2, 'versione aumentata');
  });
  await test('con opzioni {value,label} cambia sia il valore sia il nome mostrato', async () => {
    const id = riga('doc2', 'a'); assertEq((await call('doc2', { action: 'rename', from: 'a', to: 'Alfa' })).status, 200);
    assertEq(opts('doc2')[0], { value: 'Alfa', label: 'Alfa' }); assertEq(tipoDi(id), 'Alfa');
  });
  await test('si rifiuta: nome già preso (anche con maiuscole diverse), vuoto, troppo lungo, cartella inesistente', async () => {
    assertEq((await call('doc', { action: 'rename', from: 'Fattura', to: 'report' })).status, 409);
    assertEq((await call('doc', { action: 'rename', from: 'Fattura', to: '   ' })).status, 400);
    assertEq((await call('doc', { action: 'rename', from: 'Fattura', to: 'x'.repeat(61) })).status, 400);
    assertEq((await call('doc', { action: 'rename', from: 'Boh', to: 'Altro' })).status, 404);
  });
  await test('si rifiuta se il vecchio nome è usato in una regola del modulo (si romperebbe), e non cambia niente', async () => {
    const id = riga('doc3', 'Fattura');
    const r = await call('doc3', { action: 'rename', from: 'Fattura', to: 'Fatture' });
    assertEq(r.status, 409); assertTrue(/regole/.test((await r.json()).error)); assertEq(opts('doc3'), ['Contratto', 'Fattura']); assertEq(tipoDi(id), 'Fattura');
  });
  await test('un\'etichetta con lo stesso testo NON è una regola: rinominare «Report» funziona', async () => {
    assertEq((await call('doc', { action: 'rename', from: 'Report', to: 'Relazioni' })).status, 200); assertEq(opts('doc').includes('Relazioni'), true);
  });

  console.log('\n--- aggiungere e togliere ---');
  await test('aggiungere una cartella; un nome doppio si rifiuta', async () => {
    assertEq((await call('doc', { action: 'add', value: 'Assicurazioni' })).status, 200); assertEq(opts('doc').includes('Assicurazioni'), true);
    assertEq((await call('doc', { action: 'add', value: 'assicurazioni' })).status, 409);
  });
  await test('togliere: solo se è vuota (e dice quanti documenti contiene)', async () => {
    const r = await call('doc', { action: 'remove', value: 'Fattura' }); assertEq(r.status, 409); assertTrue(/1 documento/.test((await r.json()).error));
    assertEq((await call('doc', { action: 'remove', value: 'Assicurazioni' })).status, 200); assertEq(opts('doc').includes('Assicurazioni'), false);
  });

  console.log('\n--- cartelle annidate ---');
  await test('aggiungere una sottocartella ("Bollette/2026") funziona come un valore qualunque', async () => {
    assertEq((await call('doc', { action: 'add', value: 'Bollette' })).status, 200);
    assertEq((await call('doc', { action: 'add', value: 'Bollette/2026' })).status, 200);
    assertEq((await call('doc', { action: 'add', value: 'Bollette/2027' })).status, 200);
    assertTrue(opts('doc').includes('Bollette/2026') && opts('doc').includes('Bollette/2027'));
  });
  await test('rinominare una cartella rinomina anche le sue sottocartelle, e le righe di entrambe', async () => {
    const a = riga('doc', 'Bollette/2026'), b = riga('doc', 'Bollette/2027'), c = riga('doc', 'Bollette');
    const r = await call('doc', { action: 'rename', from: 'Bollette', to: 'Fatture' });
    assertEq(r.status, 200); const j = await r.json(); assertEq(j.righe, 3);
    assertTrue(opts('doc').includes('Fatture') && opts('doc').includes('Fatture/2026') && opts('doc').includes('Fatture/2027'));
    assertTrue(!opts('doc').includes('Bollette') && !opts('doc').includes('Bollette/2026'));
    assertEq([tipoDi(a), tipoDi(b), tipoDi(c)], ['Fatture/2026', 'Fatture/2027', 'Fatture']);
  });
  await test('togliere una cartella con sottocartelle si rifiuta, anche se vuota lei stessa', async () => {
    const r = await call('doc', { action: 'remove', value: 'Fatture' });
    assertEq(r.status, 409); assertTrue(/sottocartelle/.test((await r.json()).error));
  });

  console.log('\n--- chi può ---');
  await test('senza accesso 401; campo che non è una scelta 422; azione sconosciuta 400', async () => {
    assertEq((await fetch(BASE + '/api/field-options/doc/tipo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
    assertEq((await call('doc', { action: 'add', value: 'x' }, H, 'titolo')).status, 422);
    assertEq((await call('doc', { action: 'boh' })).status, 400);
  });

  console.log(`\n${'='.repeat(60)}`);
  console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
  try { fs.unlinkSync(dbPath); } catch (e) {}
  process.exit(failed > 0 ? 1 : 0);
}
main().catch((e) => { console.error('Suite field-options fallita ad avviarsi:', e); process.exit(1); });
