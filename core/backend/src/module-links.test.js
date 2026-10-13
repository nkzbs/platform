'use strict';
// «Collega i moduli» (module-links.js): proposte dalle regole sui nomi, applicazione validata dal codice, niente duplicati.
// Eseguire con: node src/module-links.test.js
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
process.env.DB_PATH = path.join(os.tmpdir(), 'links-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.JWT_SECRET = 'links_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'links_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'links-uploads-'));
let passed = 0, failed = 0;
function test(name, fn) { try { fn(); console.log('  ✓ ' + name); passed++; } catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; } }
const eq = (a, e, m) => { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${m || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); };

const db = require('./db');
const links = require('./module-links');
const f = (key, label, type = 'text') => ({ key, label, type });
const add = (name, slug, fields, extra = {}) => db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES (?, ?, 'box', '#000', 1, 1, 50, ?)")
  .run(name, slug, JSON.stringify({ fields, relations: [], ...extra }));
add('Clienti', 'clienti', [f('ragione_sociale', 'Ragione sociale')]);
add('Ordini', 'ordini', [f('numero', 'Numero'), f('cliente', 'Cliente')]);
add('Righe ordine', 'righe_ordine', [f('descrizione', 'Descrizione'), f('qta', 'Quantità', 'number')]);
add('Magazzino', 'magazzino', [f('nome', 'Nome')]);
db.prepare("UPDATE modules SET is_system = 1 WHERE slug = 'magazzino'").run();
const schemaDi = (slug) => JSON.parse(db.prepare('SELECT schema_json FROM modules WHERE slug = ?').get(slug).schema_json);
const coppie = () => links.proposte().filter((p) => ['clienti', 'ordini', 'righe_ordine'].includes(p.da)).map((p) => p.da + '>' + p.a).sort();

test('stems: singolare e plurale coincidono, le parole vuote spariscono', () => {
  eq(links.stems('Clienti'), links.stems('Cliente')); eq(links.stems('Righe del ordine'), ['righ', 'ordin']);
});
test('propone per nome contenuto e per campo che si chiama come un altro modulo; mai verso moduli di sistema o al contrario', () => {
  eq(coppie(), ['ordini>clienti', 'righe_ordine>ordini']);
});
test('applica: crea la relazione col campo da mostrare giusto, chiave libera, versione e storia', () => {
  const r = links.applica([{ da: 'ordini', a: 'clienti' }], { id: null, username: 'admin' });
  eq(r.creati, [{ da: 'ordini', a: 'clienti', key: 'rel_clienti' }]);
  const rel = schemaDi('ordini').relations[0]; eq([rel.key, rel.type, rel.target_module, rel.display_field], ['rel_clienti', 'many_to_one', 'clienti', 'ragione_sociale']);
  eq(db.prepare("SELECT schema_version v FROM modules WHERE slug = 'ordini'").get().v, 2);
  eq(db.prepare("SELECT COUNT(*) c FROM modules_schema_history").get().c, 1);
});
test('dopo averla creata non si propone più e non si duplica', () => {
  eq(coppie(), ['righe_ordine>ordini']);
  const r = links.applica([{ da: 'ordini', a: 'clienti' }], { id: null, username: 'admin' });
  eq([r.creati.length, r.saltati[0].motivo], [0, 'già collegati']); eq(schemaDi('ordini').relations.length, 1);
});
test('non si fida di quello che arriva: moduli inesistenti, di sistema, se stesso', () => {
  const r = links.applica([{ da: 'x', a: 'clienti' }, { da: 'ordini', a: 'magazzino' }, { da: 'ordini', a: 'ordini' }, null, { da: 'clienti' }], { id: null, username: 'admin' });
  eq(r.creati, []); eq(r.saltati.length, 5);
});
test('schema v3 (steps): aggiunge un blocco relazione', () => {
  db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES ('Appuntamenti', 'appuntamenti', 'box', '#000', 1, 1, 50, ?)")
    .run(JSON.stringify({ version: 3, steps: [{ id: 'f1', block_type: 'field', key: 'data', label: 'Data', type: 'date' }, { id: 'f2', block_type: 'field', key: 'cliente', label: 'Cliente', type: 'text' }] }));
  const r = links.applica([{ da: 'appuntamenti', a: 'clienti' }], { id: null, username: 'admin' }); eq(r.creati.length, 1);
  const st = schemaDi('appuntamenti').steps; eq(st[st.length - 1].block_type, 'relation'); eq(st[st.length - 1].target_module, 'clienti');
});
console.log(`\n${passed} passati, ${failed} falliti`);
process.exit(failed ? 1 : 0);
