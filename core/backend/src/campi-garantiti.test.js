'use strict';
// Campi garantiti (campi-garantiti.js): un modulo già in uso riceve il campo dichiarato una volta sola, senza toccare altro.
// Eseguire con: node src/campi-garantiti.test.js

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const dbPath = path.join(os.tmpdir(), 'campi-garantiti-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.DB_PATH = dbPath;
process.env.JWT_SECRET = 'cg_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'cg_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-uploads-'));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; }
}
function assertEq(a, e, msg) { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${msg || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); }
function assertTrue(c, msg) { if (!c) throw new Error(msg || 'atteso true'); }

const db = require('./db');
const cg = require('./campi-garantiti');
const F = (key, type = 'text') => ({ id: 'f_' + key, block_type: 'field', key, label: key, type });
const add = (slug, schema, draft = null) => db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json, schema_json_draft) VALUES (?, ?, 'box', '#000', 1, 1, 70, ?, ?)").run(slug, slug, JSON.stringify(schema), draft ? JSON.stringify(draft) : null);
const schema = (slug) => JSON.parse(db.prepare('SELECT schema_json FROM modules WHERE slug = ?').get(slug).schema_json);
const keys = (s) => (s.steps || []).filter((x) => x.block_type === 'field').map((x) => x.key);
const DEF = { m1: [{ key: 'ricevuta', label: 'Ricevuta', type: 'file', dopo: 'data_pagamento' }] };

console.log('\n--- campo garantito ---');
test('si aggiunge dopo il campo indicato, senza toccare il resto, e la versione dello schema sale', () => {
  add('m1', { version: 3, steps: [F('descrizione'), F('data_pagamento', 'date'), F('note'), { id: 'w', block_type: 'workflow_state', key: 'a', label: 'A', initial: true }] });
  const v0 = db.prepare('SELECT schema_version v FROM modules WHERE slug = ?').get('m1').v;
  assertEq(cg.apply(DEF), 1);
  const s = schema('m1');
  assertEq(keys(s), ['descrizione', 'data_pagamento', 'ricevuta', 'note']);
  assertEq(s.steps.find((x) => x.key === 'ricevuta').type, 'file');
  assertEq(s.steps.filter((x) => x.block_type === 'workflow_state').length, 1, 'lo stato resta');
  assertEq(db.prepare('SELECT schema_version v FROM modules WHERE slug = ?').get('m1').v, v0 + 1);
  assertEq(db.prepare('SELECT COUNT(*) c FROM modules_schema_history WHERE module_id = (SELECT id FROM modules WHERE slug = ?)').get('m1').c, 1, 'la versione precedente è nello storico');
});
test('al secondo avvio non succede niente (idempotente)', () => {
  assertEq(cg.apply(DEF), 0);
  assertEq(keys(schema('m1')).filter((k) => k === 'ricevuta').length, 1);
});
test('se l\'amministratore lo toglie dal Builder, non ricompare', () => {
  const s = schema('m1'); s.steps = s.steps.filter((x) => x.key !== 'ricevuta');
  db.prepare('UPDATE modules SET schema_json = ? WHERE slug = ?').run(JSON.stringify(s), 'm1');
  assertEq(cg.apply(DEF), 0);
  assertEq(keys(schema('m1')).includes('ricevuta'), false);
});
test('un modulo che ha già un campo con quella chiave non cambia', () => {
  add('m2', { version: 3, steps: [F('descrizione'), F('ricevuta', 'file')] });
  const v0 = db.prepare('SELECT schema_version v FROM modules WHERE slug = ?').get('m2').v;
  assertEq(cg.apply({ m2: DEF.m1 }), 0);
  assertEq(db.prepare('SELECT schema_version v FROM modules WHERE slug = ?').get('m2').v, v0);
});
test('un modulo che non c\'è, o non è installato, si salta', () => {
  assertEq(cg.apply({ non_esiste: DEF.m1 }), 0);
  db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES ('x', 'm3', 'box', '#000', 0, 1, 70, ?)").run(JSON.stringify({ version: 3, steps: [F('descrizione')] }));
  assertEq(cg.apply({ m3: DEF.m1 }), 0);
});
test('se c\'è una bozza dello schema, il campo entra anche lì e la bozza resta', () => {
  add('m4', { version: 3, steps: [F('descrizione'), F('data_pagamento', 'date')] }, { version: 3, steps: [F('descrizione'), F('data_pagamento', 'date'), F('extra')] });
  assertEq(cg.apply({ m4: DEF.m1 }), 1);
  const d = JSON.parse(db.prepare('SELECT schema_json_draft d FROM modules WHERE slug = ?').get('m4').d);
  assertEq(keys(d), ['descrizione', 'data_pagamento', 'ricevuta', 'extra']);
});
test('uno schema illeggibile non si tocca e non ferma l\'avvio', () => {
  db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES ('x', 'm5', 'box', '#000', 1, 1, 70, '{rotto')").run();
  assertEq(cg.apply({ m5: DEF.m1 }), 0);
  assertEq(db.prepare('SELECT schema_json s FROM modules WHERE slug = ?').get('m5').s, '{rotto');
});
test('schema a elenco piatto (non v3): il campo entra in fields', () => {
  db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES ('x', 'm6', 'box', '#000', 1, 1, 70, ?)").run(JSON.stringify({ fields: [{ key: 'descrizione', label: 'D', type: 'text' }] }));
  assertEq(cg.apply({ m6: DEF.m1 }), 1);
  assertEq(schema('m6').fields.map((f) => f.key), ['descrizione', 'ricevuta']);
});
test('le dichiarazioni reali (seeds/campi-garantiti.json) sono ben formate', () => {
  for (const [slug, defs] of Object.entries(cg.GARANTITI)) {
    assertTrue(Array.isArray(defs) && defs.length, slug);
    for (const d of defs) assertTrue(d.key && d.label && d.type, slug + ': chiave, etichetta e tipo');
  }
});

console.log(`\n${'='.repeat(60)}`);
console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
try { fs.unlinkSync(dbPath); } catch (e) {}
process.exit(failed > 0 ? 1 : 0);
