'use strict';
// "Chiedi ai tuoi dati" lato progetto (ask-data.js): catalogo senza record, rivalidazione ed esecuzione della query strutturata. Eseguire con: node src/ask-data.test.js

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const dbPath = path.join(os.tmpdir(), 'ask-data-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.DB_PATH = dbPath;
process.env.JWT_SECRET = 'ask_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'ask_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ask-uploads-'));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; }
}
function assertEq(a, e, msg) { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${msg || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); }
function assertTrue(c, msg) { if (!c) throw new Error(msg || 'atteso true'); }

const db = require('./db');
const roles = require('./module-roles');
const ask = require('./ask-data');
const schema = { version: 3, steps: [{ id: 'c', block_type: 'field', key: 'categoria', label: 'Categoria', type: 'select', options: ['Elettricità', 'Gas', 'Altro'] }] };
db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES ('Costi', 'costi', 'box', '#000', 1, 1, 70, ?)").run(JSON.stringify(schema));
db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES ('Ore', 'ore', 'box', '#000', 1, 1, 71, '{}')").run();
roles.set('costi', { kind: 'spesa', uses: [], roles: { importo: 'importo', data: 'data', categoria: 'categoria', descrizione: 'descrizione', stato: '_stato' }, avvisi: { states: { nuovo: 'da_smistare' } } });
roles.set('ore', { kind: null, uses: [], roles: { data: 'data' } });
const rec = (d) => db.prepare('INSERT INTO records (module_slug, user_id, data) VALUES (?, NULL, ?)').run('costi', JSON.stringify({ _stato: 'pagato', ...d }));
rec({ descrizione: 'A2A', data: '2025-01-10', importo: 60, categoria: 'Elettricità' });
rec({ descrizione: 'A2A', data: '2025-02-10', importo: 80, categoria: 'Elettricità' });
rec({ descrizione: 'Gas', data: '2025-02-12', importo: 40, categoria: 'Gas' });
rec({ descrizione: 'Gas 2026', data: '2026-01-12', importo: 50, categoria: 'Gas' });
rec({ descrizione: 'Nuova', data: '2025-03-01', importo: 999, categoria: 'Altro', _stato: 'da_smistare' });
rec({ descrizione: 'Incerta', data: '2025-03-02', importo: 500, categoria: 'Altro', data_incerta: true });
const admin = { role: 'admin', id: 1 };
const cat = ask.catalogo();
const Q = (extra) => ask.validate({ modulo: 'costi', calcolo: 'somma', periodo: null, filtri: [], raggruppa: 'nessuno', titolo: 't', ...extra }, cat).query;

test('il catalogo ha solo i moduli con un importo, con ruoli e categorie, e nessun record', () => {
  assertEq(cat.map((m) => m.slug), ['costi']); assertEq(cat[0].categorie, ['Elettricità', 'Gas', 'Altro']);
  assertTrue(!JSON.stringify(cat).includes('A2A'), 'nessun dato di righe');
});
test('somma di una categoria in un anno', () => {
  const r = ask.run(Q({ periodo: { da: '2025-01-01', a: '2025-12-31' }, filtri: [{ ruolo: 'categoria', op: 'uguale', valore: 'Elettricità' }] }), admin);
  assertEq(r.totale, 140); assertEq(r.n_righe, 2);
});
test('le righe da smistare e quelle a data incerta non contano; e si dice quante sono state escluse', () => {
  const r = ask.run(Q({ periodo: { da: '2025-01-01', a: '2025-12-31' } }), admin);
  assertEq(r.totale, 180); assertEq(r.esclusi_da_smistare, 1);
});
test('raggruppata per mese, in ordine di data', () => {
  const r = ask.run(Q({ periodo: { da: '2025-01-01', a: '2025-12-31' }, raggruppa: 'mese' }), admin);
  assertEq(r.righe.map((x) => [x.etichetta, x.valore]), [['2025-01', 60], ['2025-02', 120]]);
});
test('raggruppata per categoria, dal più alto', () => {
  const r = ask.run(Q({ raggruppa: 'categoria' }), admin);
  assertEq(r.righe.map((x) => x.etichetta), ['Elettricità', 'Gas']); assertEq(r.righe[0].valore, 140);
});
test('conteggio, media, massimo e minimo', () => {
  const f = [{ ruolo: 'categoria', op: 'uguale', valore: 'Gas' }];
  assertEq(ask.run(Q({ calcolo: 'conteggio', filtri: f }), admin).totale, 2);
  assertEq(ask.run(Q({ calcolo: 'media', filtri: f }), admin).totale, 45);
  assertEq(ask.run(Q({ calcolo: 'massimo', filtri: f }), admin).totale, 50);
  assertEq(ask.run(Q({ calcolo: 'minimo', filtri: f }), admin).totale, 40);
});
test('filtri su importo e testo', () => {
  assertEq(ask.run(Q({ filtri: [{ ruolo: 'importo', op: 'maggiore', valore: 55 }] }), admin).totale, 60 + 80);
  assertEq(ask.run(Q({ filtri: [{ ruolo: 'descrizione', op: 'contiene', valore: 'a2a' }] }), admin).totale, 140);
});
test('una query fuori catalogo o con valori non ammessi si rifiuta (anche se arriva "validata" da fuori)', () => {
  assertTrue(!!ask.validate({ modulo: 'ore', calcolo: 'somma', raggruppa: 'nessuno', filtri: [] }, cat).error, 'modulo senza importo');
  assertTrue(!!ask.validate({ modulo: 'costi', calcolo: 'DROP', raggruppa: 'nessuno', filtri: [] }, cat).error);
  assertTrue(!!ask.validate({ modulo: 'costi', calcolo: 'somma', raggruppa: 'nessuno', filtri: [{ ruolo: 'data', op: 'uguale', valore: 'x' }] }, cat).error);
  assertTrue(!!ask.validate({ modulo: 'costi', calcolo: 'somma', raggruppa: 'nessuno', filtri: new Array(5).fill({ ruolo: 'descrizione', op: 'uguale', valore: 'x' }) }, cat).error);
});
test('i permessi del modulo valgono: un ruolo senza vista non vede niente', () => {
  const s2 = { ...schema, steps: [...schema.steps, { id: 'p', block_type: 'permissions', rules: [{ role: 'user', view: false }] }] };
  db.prepare("UPDATE modules SET schema_json = ? WHERE slug = 'costi'").run(JSON.stringify(s2));
  assertEq(ask.run(Q({}), { role: 'user', id: 9 }).n_righe, 0); assertEq(ask.run(Q({}), admin).n_righe, 4);
});
test('il filtro in parole dice cosa è stato capito', () => {
  const t = ask.leggibile(Q({ periodo: { da: '2025-01-01', a: '2025-12-31' }, filtri: [{ ruolo: 'categoria', op: 'uguale', valore: 'Gas' }], raggruppa: 'mese' }), 'Costi');
  assertEq(t, ['Modulo: Costi', 'Somma dell\'importo', 'Categoria = Gas', 'Dal 01/01/2025 al 31/12/2025', 'Per mese']);
});

console.log(`\n${'='.repeat(60)}`);
console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
try { fs.unlinkSync(dbPath); } catch (e) {}
process.exit(failed > 0 ? 1 : 0);
