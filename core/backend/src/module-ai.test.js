'use strict';
// Potenziamenti AI per modulo (module-ai.js): interruttori per modulo, ruoli richiesti, widget "spiegabile".
// Eseguire con: node src/module-ai.test.js

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const dbPath = path.join(os.tmpdir(), 'moduleai-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.DB_PATH = dbPath;
process.env.JWT_SECRET = 'mai_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'mai_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mai-uploads-'));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; }
}
function assertEq(a, e, msg) { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${msg || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); }

const db = require('./db');
const ai = require('./module-ai');
const roles = require('./module-roles');
db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES ('Spese casa', 'spese_casa', 'box', '#000', 1, 1, 50, '{}')").run();

ai.setMaster(true);
test('un modulo nuovo non ha nessun potenziamento', () => { assertEq(ai.get('spese_casa'), []); assertEq(ai.can('spese_casa', 'triage'), false); });
test('si accende solo quello che si sceglie; le chiavi strane sono ignorate', () => {
  assertEq(ai.set('spese_casa', ['triage', 'boh', 'explain']), ['triage', 'explain']);
  assertEq(ai.get('spese_casa'), ['triage', 'explain']);
});
test('acceso ma senza i ruoli che servono: non lavora, e dice cosa manca', () => {
  assertEq(ai.can('spese_casa', 'triage'), false);
  assertEq(ai.missing('spese_casa', 'triage'), ['importo', 'categoria', 'stato']);
});
test('con i ruoli dichiarati lavora', () => {
  roles.set('spese_casa', { kind: 'spesa', uses: ['avvisi'], roles: { importo: 'importo', categoria: 'categoria', stato: '_stato', data: 'data' } });
  assertEq(ai.can('spese_casa', 'triage'), true);
  assertEq(ai.can('spese_casa', 'import'), false, 'import non acceso');
});
test('spegnere toglie tutto', () => { ai.set('spese_casa', []); assertEq(ai.can('spese_casa', 'triage'), false); });
test('con l\'AI accesa un widget è spiegabile di default, e si spegne dalla sua configurazione', () => {
  assertEq(ai.widgetExplainable({ config: {} }), true);
  assertEq(ai.widgetExplainable({ config: '{"explainable":true}' }), true);
  assertEq(ai.widgetExplainable({ config: { explainable: false } }), false);
  assertEq(ai.widgetExplainable(null), false);
});
test('l\'interruttore generale spento ferma tutto: nessun potenziamento, nessun widget spiegabile', () => {
  roles.set('spese_casa', { kind: 'spesa', uses: [], roles: { importo: 'importo', categoria: 'categoria', stato: '_stato', data: 'data' } });
  ai.set('spese_casa', ['triage', 'explain']);
  assertEq(ai.can('spese_casa', 'triage'), true);
  ai.setMaster(false);
  assertEq(ai.masterOn(), false); assertEq(ai.can('spese_casa', 'triage'), false); assertEq(ai.widgetExplainable({ config: {} }), false);
  ai.setMaster(true);
});
test('"Potenzia" accende i potenziamenti collegati dove i ruoli lo permettono, e solo lì', () => {
  db.prepare("INSERT OR IGNORE INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES ('Entrate', 'entrate_t', 'box', '#000', 1, 1, 51, '{}')").run();
  roles.set('entrate_t', { kind: 'entrata', uses: [], roles: { importo: 'importo', data: 'data' } });
  ai.set('spese_casa', []);
  const out = ai.powerUp();
  assertEq(out.find((m) => m.slug === 'spese_casa').attivati, ['triage', 'explain']);
  assertEq(out.find((m) => m.slug === 'entrate_t').attivati, ['explain'], 'senza stato e categoria non si può smistare');
  assertEq(ai.powerUp(), [], 'rilanciare non cambia niente');
  assertEq(ai.overviewModules().find((m) => m.slug === 'entrate_t').features.find((f) => f.key === 'triage').missing_roles, ['categoria', 'stato']);
});

console.log(`\n${'='.repeat(60)}`);
console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
try { fs.unlinkSync(dbPath); } catch (e) {}
process.exit(failed > 0 ? 1 : 0);
