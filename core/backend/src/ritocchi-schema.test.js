'use strict';
// Ritocchi di schema (ritocchi-schema.js) e token «numerata:» delle automazioni. Eseguire con: node src/ritocchi-schema.test.js
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const dbPath = path.join(os.tmpdir(), 'ritocchi-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.DB_PATH = dbPath;
process.env.JWT_SECRET = 'rit_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'rit_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rit-uploads-'));

let passed = 0, failed = 0;
function test(name, fn) { try { fn(); console.log('  ✓ ' + name); passed++; } catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; } }
function assertEq(a, e, msg) { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${msg || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); }

const db = require('./db');
const rit = require('./ritocchi-schema');
const { resolveDati } = require('./automation-engine');
const AUT = (v) => ({ id: 'aut_rate', block_type: 'automation', label: 'x', trigger: { evento: 'nuovo_record' }, azioni: [{ target: '__interno__', azione: 'crea_record_n_volte', config: { modulo: 'm', dati: { descrizione: v, importo: 1 } } }] });
const add = (slug, steps, draft = null) => db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json, schema_json_draft) VALUES (?, ?, 'box', '#000', 1, 1, 70, ?, ?)").run(slug, slug, JSON.stringify({ version: 3, steps }), draft ? JSON.stringify({ version: 3, steps: draft }) : null);
const valore = (slug, draft = false) => { const r = db.prepare('SELECT schema_json, schema_json_draft FROM modules WHERE slug = ?').get(slug); const s = JSON.parse(draft ? r.schema_json_draft : r.schema_json); return s.steps.find((x) => x.id === 'aut_rate').azioni[0].config.dati.descrizione; };
const DEF = (slug) => ({ [slug]: [{ id: 'r1', blocco: 'aut_rate', percorso: 'azioni.0.config.dati.descrizione', da: 'campo:nome', a: 'numerata:nome' }] });

console.log('\n--- il token numerata ---');
test('«Nome — rata x su y»; con una sola rata resta il nome; senza totale resta il nome', () => {
  assertEq(resolveDati({ d: 'numerata:nome' }, { nome: ' Antonio ' }, 3, { totale: 11 }).d, 'Antonio — rata 3 su 11');
  assertEq(resolveDati({ d: 'numerata:nome' }, { nome: 'Bollo' }, 1, { totale: 1 }).d, 'Bollo');
  assertEq(resolveDati({ d: 'numerata:nome' }, { nome: 'Bollo' }, 1, {}).d, 'Bollo');
});

console.log('\n--- il ritocco dello schema ---');
test('cambia il valore atteso, una volta sola, con versione e storico; il secondo avvio non fa niente', () => {
  add('p1', [AUT('campo:nome')]);
  const v0 = db.prepare('SELECT schema_version v FROM modules WHERE slug = ?').get('p1').v;
  assertEq(rit.apply(DEF('p1')), 1); assertEq(valore('p1'), 'numerata:nome');
  assertEq(db.prepare('SELECT schema_version v FROM modules WHERE slug = ?').get('p1').v, v0 + 1);
  assertEq(db.prepare('SELECT COUNT(*) c FROM modules_schema_history WHERE module_id = (SELECT id FROM modules WHERE slug = ?)').get('p1').c, 1);
  assertEq(rit.apply(DEF('p1')), 0);
});
test('un valore già scelto dal Builder (diverso da quello atteso) non si tocca', () => {
  add('p2', [AUT('campo:creditore')]);
  assertEq(rit.apply(DEF('p2')), 0); assertEq(valore('p2'), 'campo:creditore');
});
test('se l\'amministratore lo rimette com\'era, non viene ritoccato di nuovo', () => {
  const r = db.prepare('SELECT schema_json FROM modules WHERE slug = ?').get('p1'); const s = JSON.parse(r.schema_json);
  s.steps[0].azioni[0].config.dati.descrizione = 'campo:nome'; db.prepare('UPDATE modules SET schema_json = ? WHERE slug = ?').run(JSON.stringify(s), 'p1');
  assertEq(rit.apply(DEF('p1')), 0); assertEq(valore('p1'), 'campo:nome');
});
test('la bozza si ritocca insieme e non si butta', () => {
  add('p3', [AUT('campo:nome')], [AUT('campo:nome'), { id: 'altro', block_type: 'field', key: 'k', label: 'K', type: 'text' }]);
  assertEq(rit.apply(DEF('p3')), 1); assertEq(valore('p3', true), 'numerata:nome');
  assertEq(JSON.parse(db.prepare('SELECT schema_json_draft d FROM modules WHERE slug = ?').get('p3').d).steps.length, 2);
});
test('modulo assente, blocco assente, percorso sbagliato, schema illeggibile: niente, e non ferma l\'avvio', () => {
  assertEq(rit.apply(DEF('non_esiste')), 0);
  add('p4', [{ id: 'f', block_type: 'field', key: 'k', label: 'K', type: 'text' }]); assertEq(rit.apply(DEF('p4')), 0);
  add('p5', [AUT('campo:nome')]); assertEq(rit.apply({ p5: [{ id: 'x', blocco: 'aut_rate', percorso: 'azioni.9.config.dati.descrizione', da: 'campo:nome', a: 'y' }] }), 0);
  db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES ('x', 'p6', 'box', '#000', 1, 1, 70, '{rotto')").run();
  assertEq(rit.apply(DEF('p6')), 0); assertEq(db.prepare('SELECT schema_json s FROM modules WHERE slug = ?').get('p6').s, '{rotto');
});
test('le dichiarazioni reali (seeds/ritocchi-schema.json) sono ben formate', () => {
  for (const [slug, lista] of Object.entries(rit.RITOCCHI)) for (const r of lista) if (!(r.id && r.blocco && r.percorso && r.da && r.a)) throw new Error(slug + ': ritocco incompleto');
});

console.log(`\n${'='.repeat(60)}`);
console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
try { fs.unlinkSync(dbPath); } catch (e) {}
process.exit(failed > 0 ? 1 : 0);
