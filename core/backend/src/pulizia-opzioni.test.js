'use strict';
// Pulizia delle scelte doppie o di prova (pulizia-opzioni.js). Eseguire con: node src/pulizia-opzioni.test.js
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const dbPath = path.join(os.tmpdir(), 'pulizia-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.DB_PATH = dbPath;
process.env.JWT_SECRET = 'pu_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'pu_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pu-uploads-'));

let passed = 0, failed = 0;
function test(name, fn) { try { fn(); console.log('  ✓ ' + name); passed++; } catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; } }
function assertEq(a, e, msg) { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${msg || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); }
function assertTrue(c, msg) { if (!c) throw new Error(msg || 'atteso true'); }

const db = require('./db');
const pu = require('./pulizia-opzioni');
const OPZ = ['Bolletta', 'Ricevuta di pagamento', 'Ricevute', 'Prova', 'Altro'];
const v2 = (opzioni = OPZ) => ({ fields: [{ key: 'tipo', label: 'Tipo', type: 'select', options: opzioni }, { key: 'titolo', label: 'T', type: 'text' }] });
const v3 = (opzioni = OPZ) => ({ version: 3, steps: [{ id: 'f1', block_type: 'field', key: 'tipo', label: 'Tipo', type: 'select', options: opzioni }] });
const add = (slug, schema, draft = null) => db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json, schema_json_draft) VALUES (?, ?, 'box', '#000', 1, 1, 70, ?, ?)").run(slug, slug, JSON.stringify(schema), draft ? JSON.stringify(draft) : null);
const riga = (slug, d) => db.prepare('INSERT INTO records (module_slug, user_id, data) VALUES (?, NULL, ?)').run(slug, JSON.stringify(d)).lastInsertRowid;
const dati = (id) => JSON.parse(db.prepare('SELECT data FROM records WHERE id = ?').get(id).data);
const opzioni = (slug, draft = false) => { const r = db.prepare('SELECT schema_json, schema_json_draft FROM modules WHERE slug = ?').get(slug); const s = JSON.parse(draft ? r.schema_json_draft : r.schema_json); return (s.steps ? s.steps[0] : s.fields[0]).options; };
const REGOLE = (slug) => ({ [slug]: { tipo: { unisci: { Ricevute: 'Ricevuta di pagamento' }, togli_se_inutilizzata: ['Prova'] } } });

test('«Ricevute» passa a «Ricevuta di pagamento» (righe e scelte), «Prova» esce se nessuno la usa; le altre righe non cambiano; vale per schema v2 e v3', () => {
  for (const [slug, schema] of [['d2', v2()], ['d3', v3()]]) {
    add(slug, schema);
    const a = riga(slug, { titolo: 'a', tipo: 'Ricevute' }), b = riga(slug, { titolo: 'b', tipo: 'Ricevuta di pagamento' }), c = riga(slug, { titolo: 'c', tipo: 'Bolletta' });
    const v0 = db.prepare('SELECT schema_version v FROM modules WHERE slug = ?').get(slug).v;
    assertEq(pu.apply(REGOLE(slug)), 2);
    assertEq([dati(a).tipo, dati(b).tipo, dati(c).tipo], ['Ricevuta di pagamento', 'Ricevuta di pagamento', 'Bolletta']);
    assertEq(opzioni(slug), ['Bolletta', 'Ricevuta di pagamento', 'Altro']);
    assertEq(db.prepare('SELECT schema_version v FROM modules WHERE slug = ?').get(slug).v, v0 + 1);
    assertEq(db.prepare('SELECT COUNT(*) c FROM modules_schema_history WHERE module_id = (SELECT id FROM modules WHERE slug = ?)').get(slug).c, 1);
    const copia = db.prepare('SELECT valore_prima p, valore_dopo d FROM pulizia_opzioni_copia WHERE module_slug = ?').all(slug);
    assertEq(copia, [{ p: 'Ricevute', d: 'Ricevuta di pagamento' }], 'la copia ha il valore di prima');
    assertEq(pu.apply(REGOLE(slug)), 0, 'il secondo avvio non fa niente');
  }
});
test('una scelta usata da qualche riga non si toglie; se poi nessuno la usa più, al prossimo avvio esce', () => {
  add('d4', v2()); const p = riga('d4', { titolo: 'x', tipo: 'Prova' });
  assertEq(pu.apply({ d4: { tipo: { togli_se_inutilizzata: ['Prova'] } } }), 0); assertEq(opzioni('d4').includes('Prova'), true);
  db.prepare('UPDATE records SET data = ? WHERE id = ?').run(JSON.stringify({ titolo: 'x', tipo: 'Altro' }), p);
  assertEq(pu.apply({ d4: { tipo: { togli_se_inutilizzata: ['Prova'] } } }), 1); assertEq(opzioni('d4').includes('Prova'), false);
});
test('se la destinazione non esiste tra le scelte non si unisce niente (e si riprova)', () => {
  add('d5', v2(['Bolletta', 'Ricevute'])); const a = riga('d5', { titolo: 'a', tipo: 'Ricevute' });
  assertEq(pu.apply(REGOLE('d5')), 0); assertEq(dati(a).tipo, 'Ricevute'); assertEq(opzioni('d5'), ['Bolletta', 'Ricevute']);
});
test('la bozza si ripulisce insieme e resta una bozza; modulo assente o schema illeggibile: niente', () => {
  add('d6', v2(), v2(OPZ.concat('Extra')));
  assertEq(pu.apply(REGOLE('d6')), 2);
  assertEq(opzioni('d6', true), ['Bolletta', 'Ricevuta di pagamento', 'Altro', 'Extra']);
  assertEq(pu.apply(REGOLE('non_esiste')), 0);
  db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES ('x', 'd7', 'box', '#000', 1, 1, 70, '{rotto')").run();
  assertEq(pu.apply(REGOLE('d7')), 0); assertEq(db.prepare("SELECT schema_json s FROM modules WHERE slug = 'd7'").get().s, '{rotto');
});
test('le pulizie dichiarate davvero (seeds/pulizia-opzioni.json) sono ben formate', () => {
  for (const [slug, campi] of Object.entries(pu.PULIZIE)) for (const [k, r] of Object.entries(campi)) {
    assertTrue(slug && k, 'modulo e campo');
    for (const [a, b] of Object.entries(r.unisci || {})) assertTrue(a && b && a !== b, slug + '.' + k + ': unisci');
    assertTrue(Array.isArray(r.togli_se_inutilizzata || []), slug + '.' + k);
  }
});

console.log(`\n${'='.repeat(60)}`);
console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
try { fs.unlinkSync(dbPath); } catch (e) {}
process.exit(failed > 0 ? 1 : 0);
