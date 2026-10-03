'use strict';
// Ruoli dei moduli (module-roles.js): valori di partenza per Finance, scelta dal Builder, e funzioni che li leggono
// (Come sta andando, regole Gmail). Eseguire con: node src/module-roles.test.js

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const dbPath = path.join(os.tmpdir(), 'roles-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.DB_PATH = dbPath;
process.env.JWT_SECRET = 'roles_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'roles_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'roles-uploads-'));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; }
}
function assertEq(a, e, msg) { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${msg || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); }

const db = require('./db');
const roles = require('./module-roles');
const insights = require('./insights');
const addModule = (slug, name, order) => db.prepare("INSERT OR IGNORE INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES (?, ?, 'box', '#000', 1, 1, ?, '{}')").run(name, slug, order);

console.log('\n--- valori di partenza ---');
test('senza moduli di finanza non dichiara niente', () => { assertEq(roles.seedIfEmpty(), 0); assertEq(roles.list(), []); });

addModule('spese_personali', 'Spese personali', 50); addModule('spese_casa', 'Spese casa', 51); addModule('entrate', 'Entrate', 52);
db.prepare("INSERT INTO gmail_rules (mittente, descrizione, gruppo, categoria, attiva) VALUES ('a@b.it', 'A', 'Casa', 'Luce', 1), ('c@d.it', 'C', 'Personale', 'Altro', 1)").run();

test('con i moduli di finanza dichiara i tre moduli con i nomi di prima', () => {
  assertEq(roles.seedIfEmpty(), 3);
  assertEq(roles.list({ kind: 'spesa' }).map((m) => m.module_slug), ['spese_personali', 'spese_casa']);
  assertEq(roles.list({ kind: 'entrata' }).map((m) => m.module_slug), ['entrate']);
  assertEq(roles.field('spese_casa', 'importo'), 'importo');
  assertEq(roles.field('spese_personali', 'stato'), '_stato');
});
test('le regole Gmail già esistenti si agganciano al loro modulo', () => {
  assertEq(db.prepare('SELECT modulo FROM gmail_rules ORDER BY id').all().map((r) => r.modulo), ['spese_casa', 'spese_personali']);
});
test('rilanciare non cambia una scelta già fatta', () => {
  roles.set('spese_casa', { kind: 'spesa', uses: ['avvisi'], roles: { importo: 'valore' } });
  assertEq(roles.seedIfEmpty(), 0);
  assertEq(roles.field('spese_casa', 'importo'), 'valore');
});

console.log('\n--- scelta dal Builder ---');
test('un valore strano viene ripulito', () => {
  const out = roles.set('entrate', { kind: 'altro', uses: ['riepiloghi', 'boh'], roles: { importo: ' totale ', inventato: 'x', data: 5 } });
  assertEq(out.kind, null); assertEq(out.uses, ['riepiloghi']); assertEq(out.roles, { importo: 'totale' });
});
test('un modulo senza tipo non compare negli elenchi', () => { assertEq(roles.list({ kind: 'entrata' }), []); });
test('un modulo non installato non compare', () => {
  roles.set('entrate', { kind: 'entrata', uses: ['riepiloghi'], roles: { importo: 'importo' } });
  db.prepare("UPDATE modules SET installed = 0 WHERE slug = 'entrate'").run();
  assertEq(roles.list({ kind: 'entrata' }), []);
  db.prepare("UPDATE modules SET installed = 1 WHERE slug = 'entrate'").run();
});

console.log('\n--- le funzioni leggono i ruoli ---');
test('"Come sta andando" usa i moduli e i campi dichiarati', () => {
  roles.set('spese_personali', { kind: 'spesa', uses: ['riepiloghi'], roles: { importo: 'totale', data: 'giorno', categoria: 'voce', stato: '_stato', fisso: 'fisso' } });
  const cfg = insights.getConfig();
  assertEq(cfg.spese.modules, ['spese_personali']); assertEq(cfg.spese.amount, 'totale'); assertEq(cfg.spese.date, 'giorno'); assertEq(cfg.spese.category, 'voce');
  assertEq(cfg.entrate.modules, ['entrate']);
});
test('salvare un\'impostazione non congela i ruoli: se cambiano, la funzione li segue', () => {
  insights.saveConfig({ anomaly: { pct: 40 } });
  roles.set('spese_personali', { kind: 'spesa', uses: ['riepiloghi'], roles: { importo: 'cifra', data: 'giorno', categoria: 'voce' } });
  assertEq(insights.getConfig().spese.amount, 'cifra');
  assertEq(insights.getConfig().anomaly.pct, 40);
});

console.log(`\n${'='.repeat(60)}`);
console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
try { fs.unlinkSync(dbPath); } catch (e) {}
process.exit(failed > 0 ? 1 : 0);
