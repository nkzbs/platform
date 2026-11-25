'use strict';
// Gestione GDPR (gdpr.js): registri, «Precompila» (non duplica), checklist di conformità, 72 ore delle violazioni, ricerca e esportazione di una persona.
// Solo la logica, sul database: nessun server. Eseguire con: node src/gdpr.test.js
const path = require('path'), os = require('os'), crypto = require('crypto');
process.env.DB_PATH = path.join(os.tmpdir(), 'gdpr-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.JWT_SECRET = 'g_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'gi_' + crypto.randomBytes(8).toString('hex');
let passed = 0, failed = 0;
const test = (n, fn) => { try { fn(); console.log('  ✓ ' + n); passed++; } catch (e) { console.error('  ✗ ' + n + '\n    ' + e.message); failed++; } };
const eq = (a, e, m) => { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${m || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m || 'atteso true'); };

const db = require('./db');
const g = require('./gdpr');

test('stato iniziale: registro e fornitori mancano, nessuna violazione', () => {
  const s = Object.fromEntries(g.stato().map((v) => [v.chiave, v.stato]));
  eq([s.registro, s.fornitori, s.violazioni], ['manca', 'manca', 'ok']);
});
test('«Precompila» aggiunge le bozze, una sola volta', () => {
  const a = g.precompila(), b = g.precompila();
  ok(a.trattamenti >= 4 && a.fornitori >= 1, 'bozze: ' + JSON.stringify(a));
  eq(b, { trattamenti: 0, fornitori: 0 }, 'seconda volta');
  eq(g.stato().find((v) => v.chiave === 'registro').stato, 'attenzione', 'le bozze sono da verificare');
});
test('confermare tutte le bozze porta il registro a posto', () => {
  for (const t of g.elenco('trattamenti')) g.aggiorna('trattamenti', t.id, { da_verificare: 0 });
  eq(g.stato().find((v) => v.chiave === 'registro').stato, 'ok');
});
test('fornitori senza accordo firmato = attenzione; firmati o «non serve» = a posto', () => {
  eq(g.stato().find((v) => v.chiave === 'fornitori').stato, 'attenzione');
  for (const f of g.elenco('fornitori')) g.aggiorna('fornitori', f.id, { dpa_stato: f.chiave === 'cloudflare' ? 'firmato' : 'non_serve' });
  eq(g.stato().find((v) => v.chiave === 'fornitori').stato, 'ok');
});
test('valori non ammessi vengono ricondotti al predefinito (stato accordo, rischio)', () => {
  const id = g.crea('fornitori', { nome: 'Prova', dpa_stato: 'boh' });
  eq(g.elenco('fornitori').find((f) => f.id === id).dpa_stato, 'da_firmare');
  const v = g.crea('violazioni', { scoperta_il: '2026-11-01T10:00', descrizione: 'x', rischio: 'enorme' });
  eq(g.elenco('violazioni').find((x) => x.id === v).rischio, 'basso');
  g.togli('fornitori', id); g.togli('violazioni', v);
});
test('campi obbligatori: nome per trattamenti e fornitori, data e descrizione per le violazioni', () => {
  for (const [tipo, corpo] of [['trattamenti', {}], ['fornitori', { nome: '  ' }], ['violazioni', { descrizione: 'x' }]]) {
    let status; try { g.crea(tipo, corpo); } catch (e) { status = e.status; }
    eq(status, 400, tipo);
  }
});
test('72 ore: le ore residue contano dalla scoperta e vanno sotto zero a termine scaduto', () => {
  const scoperta = '2026-11-01T10:00:00Z', t0 = Date.parse(scoperta);
  eq(g.oreResidue(scoperta, t0), 72);
  eq(g.oreResidue(scoperta, t0 + 70 * 3600e3), 2);
  ok(g.oreResidue(scoperta, t0 + 80 * 3600e3) < 0, 'scaduto');
  eq(g.oreResidue('non una data'), null);
});
test('violazione a rischio non notificata: «in scadenza» entro le 72 ore, «manca» dopo; notificata o a rischio basso non conta', () => {
  const ora = Date.parse('2026-11-02T10:00:00Z');
  const stato = () => g.stato(ora).find((v) => v.chiave === 'violazioni').stato;
  const id = g.crea('violazioni', { scoperta_il: '2026-11-01T10:00:00Z', descrizione: 'Mail al destinatario sbagliato', rischio: 'medio', interessati_n: 3 });
  eq(stato(), 'attenzione');
  eq(g.stato(Date.parse('2026-11-05T10:00:00Z')).find((v) => v.chiave === 'violazioni').stato, 'manca', 'oltre le 72 ore');
  g.aggiorna('violazioni', id, { notificata_garante_il: '2026-11-01' });
  eq(stato(), 'ok', 'notificata');
  g.aggiorna('violazioni', id, { notificata_garante_il: '', rischio: 'basso' });
  eq(stato(), 'ok', 'rischio basso');
  g.togli('violazioni', id);
});
test('ricerca di una persona: minimo 4 caratteri, trova nel testo dei record, i caratteri speciali non fanno da jolly', () => {
  db.prepare("INSERT INTO records (module_slug, data) VALUES ('clienti', ?)").run(JSON.stringify({ nome: 'Mario Rossi', email: 'mario.rossi@example.com', codice_fiscale: 'RSSMRA80A01H501U' }));
  db.prepare("INSERT INTO records (module_slug, data) VALUES ('trattative', ?)").run(JSON.stringify({ titolo: 'Vendita a Mario Rossi' }));
  db.prepare("INSERT INTO records (module_slug, data) VALUES ('clienti', ?)").run(JSON.stringify({ nome: 'Anna Verdi' }));
  let st; try { g.cercaPersona('ab'); } catch (e) { st = e.status; }
  eq(st, 400, 'troppo corto');
  const t = g.cercaPersona('Mario Rossi');
  eq(t.map((x) => x.modulo).sort(), ['clienti', 'trattative']);
  eq(g.cercaPersona('RSSMRA80A01H501U').length, 1, 'per codice fiscale');
  eq(g.cercaPersona('%%%%').length, 0, 'il % non è un jolly');
  eq(g.cercaPersona('mario.rossi@example.com')[0].dati.nome, 'Mario Rossi', 'i dati servono all\'esportazione');
});
console.log(`\n${passed} passati, ${failed} falliti`);
process.exit(failed ? 1 : 0);
