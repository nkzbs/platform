'use strict';
// "Chiedi ai tuoi dati" (lib/ai-ask.js): la domanda diventa una query strutturata e validata, mai SQL. Eseguire con: node src/ai-ask.test.js

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; }
}
function assertEq(a, e, msg) { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${msg || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); }
function assertTrue(c, msg) { if (!c) throw new Error(msg || 'atteso true'); }

const ask = require('./lib/ai-ask');
const CAT = [
  { slug: 'spese_casa', name: 'Spese casa', kind: 'spesa', ruoli: ['importo', 'data', 'categoria', 'descrizione', 'stato'], categorie: ['Elettricità', 'Gas', 'Affitto/Mutuo'] },
  { slug: 'ore', name: 'Ore', kind: null, ruoli: ['data', 'descrizione'], categorie: [] },
];

console.log('\n--- cosa esce verso il modello ---');
test('la domanda è ripulita dai dati personali e il catalogo tiene solo moduli con un importo', () => {
  const s = ask.sanitizeAsk({ domanda: 'Quanto ho pagato a mario.rossi@x.it con IBAN IT60X0542811101000000123456 nel 2025?', oggi: '2026-10-04', catalogo: CAT });
  assertTrue(!s.payload.domanda.includes('mario.rossi') && !s.payload.domanda.includes('IT60X05'), s.payload.domanda);
  assertEq(s.payload.catalogo.map((m) => m.slug), ['spese_casa'], 'il modulo senza importo non è interrogabile');
});
test('storico: assente senza dati, ripulito dai dati personali e tagliato quando c\'è', () => {
  const senza = ask.sanitizeAsk({ domanda: 'quanto ho speso?', catalogo: CAT });
  assertEq(senza.payload.storico, null);
  const con = ask.sanitizeAsk({ domanda: 'e il mese scorso?', catalogo: CAT, storico: { testo: 'quanto ha speso mario.rossi@x.it', capito: 'x'.repeat(2000) } });
  assertTrue(!con.payload.storico.testo.includes('mario.rossi'), con.payload.storico.testo);
  assertEq(con.payload.storico.capito.length, 300);
  assertEq(ask.sanitizeAsk({ domanda: 'quanto ho speso?', catalogo: CAT, storico: {} }).payload.storico, null, 'storico senza testo: ignorato');
});
test('domanda troppo corta o catalogo vuoto: errore', () => {
  assertTrue(!!ask.sanitizeAsk({ domanda: 'a', catalogo: CAT }).error); assertTrue(!!ask.sanitizeAsk({ domanda: 'quanto ho speso?', catalogo: [] }).error);
});

console.log('\n--- la risposta del modello si valida contro il catalogo ---');
const cat = ask.sanitizeAsk({ domanda: 'quanto ho speso?', catalogo: CAT }).payload.catalogo;
test('una query giusta passa, con la categoria normalizzata e il periodo', () => {
  const v = ask.validateQuery({ modulo: 'spese_casa', calcolo: 'somma', periodo: { da: '2025-01-01', a: '2025-12-31' }, filtri: [{ ruolo: 'categoria', op: 'uguale', valore: 'elettricità' }], raggruppa: 'mese', titolo: 'Luce nel 2025' }, cat);
  assertEq(v.query.filtri, [{ ruolo: 'categoria', op: 'uguale', valore: 'Elettricità' }]); assertEq(v.query.raggruppa, 'mese'); assertEq(v.query.periodo, { da: '2025-01-01', a: '2025-12-31' });
});
test('un modulo che non esiste o un ruolo che il modulo non ha: rifiutato', () => {
  assertTrue(!!ask.validateQuery({ modulo: 'utenti' }, cat).error);
  assertTrue(!!ask.validateQuery({ modulo: 'spese_casa', filtri: [{ ruolo: 'gruppo', op: 'uguale', valore: 'x' }] }, cat).error);
});
test('una categoria non ammessa si rifiuta (il modello non può inventarla)', () => {
  assertTrue(/non ammessa/.test(ask.validateQuery({ modulo: 'spese_casa', filtri: [{ ruolo: 'categoria', op: 'uguale', valore: 'Viaggi' }] }, cat).error));
});
test('operazioni, calcoli e raggruppamenti fuori dall\'elenco: scartati o ricondotti al default', () => {
  assertTrue(!!ask.validateQuery({ modulo: 'spese_casa', filtri: [{ ruolo: 'importo', op: 'DROP TABLE', valore: 1 }] }, cat).error);
  const v = ask.validateQuery({ modulo: 'spese_casa', calcolo: 'sqrt', raggruppa: 'boh' }, cat); assertEq(v.query.calcolo, 'somma'); assertEq(v.query.raggruppa, 'nessuno');
});
test('periodo con date non valide o al contrario: rifiutato; la data non è un filtro', () => {
  assertTrue(!!ask.validateQuery({ modulo: 'spese_casa', periodo: { da: '2025-12-31', a: '2025-01-01' } }, cat).error);
  assertTrue(!!ask.validateQuery({ modulo: 'spese_casa', periodo: { da: 'ieri', a: 'oggi' } }, cat).error);
  assertTrue(!!ask.validateQuery({ modulo: 'spese_casa', filtri: [{ ruolo: 'data', op: 'uguale', valore: '2025-01-01' }] }, cat).error);
});
test('l\'importo di un filtro deve essere un numero; massimo 4 filtri', () => {
  assertTrue(!!ask.validateQuery({ modulo: 'spese_casa', filtri: [{ ruolo: 'importo', op: 'maggiore', valore: 'tanto' }] }, cat).error);
  const f = { ruolo: 'descrizione', op: 'contiene', valore: 'a2a' };
  assertEq(ask.validateQuery({ modulo: 'spese_casa', filtri: [f, f, f, f, f, f] }, cat).query.filtri.length, 4);
});
test('"non posso rispondere" del modello diventa un errore leggibile', () => {
  assertEq(ask.validateQuery({ errore: 'non posso rispondere a questa domanda' }, cat).error, 'non posso rispondere a questa domanda');
});

console.log(`\n${'='.repeat(60)}`);
console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
process.exit(failed > 0 ? 1 : 0);
