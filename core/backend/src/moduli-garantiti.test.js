'use strict';
// Moduli garantiti (moduli-garantiti.js): un modulo che manca si crea con i suoi record, una volta sola. Eseguire con: node src/moduli-garantiti.test.js
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const dbPath = path.join(os.tmpdir(), 'moduli-garantiti-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.DB_PATH = dbPath;
process.env.JWT_SECRET = 'mg_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'mg_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-uploads-'));

let passed = 0, failed = 0;
function test(name, fn) { try { fn(); console.log('  ✓ ' + name); passed++; } catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; } }
function assertEq(a, e, msg) { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${msg || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); }
function assertTrue(c, msg) { if (!c) throw new Error(msg || 'atteso true'); }

const db = require('./db');
const mg = require('./moduli-garantiti');
const DEF = { m_uno: { name: 'Uno', icon: 'store', color: '#111111', schema: { version: 3, steps: [{ id: 'f1', block_type: 'field', key: 'nome', label: 'Nome', type: 'text' }] }, records: [{ nome: 'A' }, { nome: 'B' }] } };
const nRec = (slug) => db.prepare('SELECT COUNT(*) c FROM records WHERE module_slug = ?').get(slug).c;

test('un modulo che manca si crea con lo schema, attivo e installato, e i record di partenza (del primo amministratore)', () => {
  assertEq(mg.apply(DEF), 1);
  const m = db.prepare('SELECT name, icon, installed, active, schema_json FROM modules WHERE slug = ?').get('m_uno');
  assertEq([m.name, m.icon, m.installed, m.active], ['Uno', 'store', 1, 1]);
  assertEq(JSON.parse(m.schema_json).steps[0].key, 'nome');
  assertEq(nRec('m_uno'), 2);
  assertEq(db.prepare("SELECT user_id u FROM records WHERE module_slug = 'm_uno' LIMIT 1").get().u, db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get().id);
});
test('con `se_esiste` il modulo nasce solo dove c\'è almeno uno dei moduli indicati, e se manca si riprova dopo', () => {
  const D = { m_tre: { ...DEF.m_uno, name: 'Tre', se_esiste: ['m_base'] } };
  assertEq(mg.apply(D), 0); assertEq(db.prepare("SELECT COUNT(*) c FROM modules WHERE slug = 'm_tre'").get().c, 0, 'senza il modulo base non nasce');
  db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES ('Base', 'm_base', 'box', '#000', 1, 1, 70, '{}')").run();
  assertEq(mg.apply(D), 1); assertEq(nRec('m_tre'), 2, 'ora nasce, coi suoi record'); assertEq(mg.apply(D), 0);
});
test('il secondo avvio non fa niente; se i record vengono cancellati non tornano', () => {
  assertEq(mg.apply(DEF), 0);
  db.prepare("DELETE FROM records WHERE module_slug = 'm_uno'").run();
  assertEq(mg.apply(DEF), 0); assertEq(nRec('m_uno'), 0);
});
test('se il modulo viene eliminato non si ricrea', () => {
  db.prepare("DELETE FROM modules WHERE slug = 'm_uno'").run();
  assertEq(mg.apply(DEF), 0); assertEq(db.prepare("SELECT COUNT(*) c FROM modules WHERE slug = 'm_uno'").get().c, 0);
});
test('un modulo che c\'è già (anche con altro schema, anche vuoto) non si tocca: niente record, niente schema nuovo', () => {
  db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES ('Già', 'm_due', 'box', '#000', 1, 1, 70, '{}')").run();
  assertEq(mg.apply({ m_due: DEF.m_uno }), 0);
  assertEq(db.prepare("SELECT schema_json s FROM modules WHERE slug = 'm_due'").get().s, '{}'); assertEq(nRec('m_due'), 0);
});
test('i moduli dichiarati davvero (seeds/moduli-garantiti.json) sono ben formati, con nomi unici', () => {
  for (const [slug, d] of Object.entries(mg.MODULI)) {
    assertTrue(d.name && d.schema && Array.isArray(d.schema.steps), slug);
    assertTrue(Array.isArray(d.se_esiste) && d.se_esiste.length, slug + ': i moduli garantiti reali dipendono da un modulo che c\'è (mai su ogni tenant)');
    const nomi = (d.records || []).map((r) => r.nome); assertEq(new Set(nomi.map((x) => x.toLowerCase())).size, nomi.length, 'nomi doppi in ' + slug);
  }
});

console.log(`\n${'='.repeat(60)}`);
console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
try { fs.unlinkSync(dbPath); } catch (e) {}
process.exit(failed > 0 ? 1 : 0);
