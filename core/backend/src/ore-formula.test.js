'use strict';
// Differenza tra due orari (formula.js, step 'arithmetic'): è un tempo trascorso. Una timbratura aperta (manca l'uscita) fa 0 e non un numero negativo; un turno che passa
// la mezzanotte non va in negativo; la sottrazione tra numeri normali resta quella di sempre. Eseguire con: node src/ore-formula.test.js
const path = require('path'); const os = require('os'); const crypto = require('crypto');
process.env.DB_PATH = path.join(os.tmpdir(), 'ore-test-' + crypto.randomBytes(6).toString('hex') + '.db'); process.env.UPLOAD_DIR = os.tmpdir();
let passed = 0, failed = 0;
function test(name, fn) { try { fn(); console.log('  ✓ ' + name); passed++; } catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; } }
const eq = (a, e, m) => { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${m || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); };

const db = require('./db'); const { attachComputedFields } = require('./computed-fields'); const { parseSchemaNormalized } = require('./schema-v3');
const F = (key, label, type, extra = {}) => ({ id: 'f_' + key, block_type: 'field', key, label, type, ...extra });
const DIFF = (a, b) => [{ id: 's1', type: 'own_field', field: a, label: a }, { id: 's2', type: 'own_field', field: b, label: b }, { id: 's3', type: 'arithmetic', op: '-', a: 's2', b: 's1', label: 'differenza' }];
const add = (slug, steps) => db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES (?, ?, 'box', '#000', 1, 1, 70, ?)").run(slug, slug, JSON.stringify({ version: 3, steps }));
add('timbrature', [F('data', 'Data', 'date'), F('entrata', 'Entrata', 'time'), F('uscita', 'Uscita', 'time'), F('durata_minuti', 'Durata', 'computed', { steps: DIFF('entrata', 'uscita') })]);
add('numeri', [F('a', 'A', 'number'), F('b', 'B', 'number'), F('d', 'D', 'computed', { steps: DIFF('a', 'b') })]);
const schema = (slug) => parseSchemaNormalized(db.prepare('SELECT schema_json FROM modules WHERE slug = ?').get(slug).schema_json);
const durata = (data) => attachComputedFields(db, { id: 1, data }, schema('timbrature'), 'timbrature').data.durata_minuti;

test('un turno normale: uscita − entrata', () => { eq(durata({ entrata: '07:00', uscita: '12:30' }), 330); eq(durata({ entrata: '16:00', uscita: '21:00' }), 300); });
test('un turno che passa la mezzanotte non va in negativo (22:00 → 01:00 = 3 ore; 14:00 → 00:30 = 10 ore e mezza)', () => { eq(durata({ entrata: '22:00', uscita: '01:00' }), 180); eq(durata({ entrata: '14:00', uscita: '00:30' }), 630); });
test('una timbratura ancora aperta (manca l\'uscita, o l\'entrata) fa 0, non −420', () => { eq(durata({ entrata: '07:00' }), 0); eq(durata({ entrata: '07:00', uscita: '' }), 0); eq(durata({ uscita: '12:30' }), 0); });
test('entrata e uscita uguali: 0', () => { eq(durata({ entrata: '22:13', uscita: '22:13' }), 0); });
test('la sottrazione tra numeri normali non cambia: resta negativa se il risultato lo è', () => {
  const d = (data) => attachComputedFields(db, { id: 1, data }, schema('numeri'), 'numeri').data.d;
  eq(d({ a: 10, b: 4 }), -6); eq(d({ a: 4, b: 10 }), 6); eq(d({ a: 5 }), -5);
});
console.log(`\n${'='.repeat(60)}\n${passed} passati, ${failed} falliti su ${passed + failed} test.`);
try { require('fs').unlinkSync(process.env.DB_PATH); } catch (e) {}
process.exit(failed > 0 ? 1 : 0);
