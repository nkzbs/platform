'use strict';

// Test — motore dell'abbinamento (lib/abbinamento.js), il blocco `match_view`.
// Eseguire con: node abbinamento.test.js

const { calcolaAbbinamenti, valutaRegola, confronta } = require('./lib/abbinamento');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.error('  ✗ ' + name); console.error('    ' + e.message); failed++; }
}
function assertEq(actual, expected, msg) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${msg || ''}: atteso ${b}, ottenuto ${a}`);
}

console.log('\n--- confronti ---');

test('testo: senza maiuscole né accenti, uno contiene l\'altro', () => {
  assertEq(confronta('testo', 'Appartamento', 'appartamento'), true);
  assertEq(confronta('testo', 'Desenzano', 'Desenzano del Garda'), true);
  assertEq(confronta('testo', 'Desenzano del Garda', 'desenzano'), true);
  assertEq(confronta('testo', 'Perù', 'PERU'), true);
  assertEq(confronta('testo', 'Villa', 'Appartamento'), false);
});
test('testo: elenchi separati da virgola, punto e virgola o barra valgono voce per voce', () => {
  assertEq(confronta('testo', 'Trilocale, Villa', 'Villa'), true);
  assertEq(confronta('testo', 'Bilocale; Attico', 'Villa'), false);
  assertEq(confronta('testo', 'Villa/Casa indipendente', 'Casa indipendente'), true);
  assertEq(confronta('testo', ['Villa', 'Attico'], 'Attico'), true);
});
test('uguale: numeri come numeri, testi senza maiuscole', () => {
  assertEq(confronta('uguale', 3, '3'), true);
  assertEq(confronta('uguale', 3, 4), false);
  assertEq(confronta('uguale', 'Si', 'si'), true);
});
test('theirs<=mine e theirs>=mine su numeri, anche scritti all\'italiana', () => {
  assertEq(confronta('theirs<=mine', 200000, 180000), true);
  assertEq(confronta('theirs<=mine', 200000, 200000), true);
  assertEq(confronta('theirs<=mine', 200000, 250000), false);
  assertEq(confronta('theirs>=mine', 150000, 180000), true);
  assertEq(confronta('theirs<=mine', '200.000,00', '180.500,50'), true);
  assertEq(confronta('theirs<=mine', 'boh', 100), false, 'non numerico = non confrontabile');
});
test('operatore sconosciuto → mai vero', () => {
  assertEq(confronta('inventato', 'a', 'a'), false);
});

console.log('\n--- una regola ---');

test('valutaRegola: mio campo vuoto → saltata; campo del candidato mancante → ko', () => {
  const r = { mine: 'budget', theirs: 'prezzo', op: 'theirs<=mine' };
  assertEq(valutaRegola(r, {}, { prezzo: 100 }), 'saltata');
  assertEq(valutaRegola(r, { budget: '' }, { prezzo: 100 }), 'saltata');
  assertEq(valutaRegola(r, { budget: 200 }, {}), 'ko');
  assertEq(valutaRegola(r, { budget: 200 }, { prezzo: 100 }), 'ok');
});
test('theirs come lista: basta un campo che vada bene', () => {
  const r = { mine: 'zona', theirs: ['comune', 'quartiere', 'localita'], op: 'testo' };
  assertEq(valutaRegola(r, { zona: 'Sirmione' }, { comune: 'Desenzano', localita: 'Sirmione centro' }), 'ok');
  assertEq(valutaRegola(r, { zona: 'Sirmione' }, { comune: 'Desenzano' }), 'ko');
  assertEq(valutaRegola(r, { zona: 'Sirmione' }, {}), 'ko');
});

console.log('\n--- abbinamenti ---');

const REGOLE = [
  { mine: 'cerca_tipo', theirs: 'tipo', op: 'testo', label: 'Tipologia' },
  { mine: 'budget', theirs: 'prezzo', op: 'theirs<=mine', label: 'Prezzo nel budget', required: true },
  { mine: 'zona', theirs: ['comune', 'quartiere'], op: 'testo', label: 'Zona' },
];
const immobili = [
  { id: 1, data: { tipo: 'Villa', prezzo: 300000, comune: 'Desenzano' }, updated_at: '2026-01-01 10:00:00' },
  { id: 2, data: { tipo: 'Appartamento', prezzo: 150000, comune: 'Desenzano' }, updated_at: '2026-01-02 10:00:00' },
  { id: 3, data: { tipo: 'Villa', prezzo: 180000, comune: 'Brescia' }, updated_at: '2026-01-03 10:00:00' },
  { id: 4, data: { tipo: 'Villa', prezzo: 190000, comune: 'Desenzano del Garda', _stato: 'venduto' }, updated_at: '2026-01-04 10:00:00' },
  { id: 5, data: { tipo: 'Terreno', prezzo: 50000, comune: 'Roma' }, updated_at: '2026-01-05 10:00:00' },
];
const cliente = { cerca_tipo: 'Villa', budget: 200000, zona: 'Desenzano' };

test('i vincoli (regole obbligatorie) escludono, le affinità fanno il punteggio', () => {
  const r = calcolaAbbinamenti({ rules: REGOLE }, cliente, immobili);
  assertEq(r.applicabile, true); assertEq(r.valutabili, 3);
  const per = Object.fromEntries(r.items.map((i) => [i.id, i.punteggio]));
  assertEq(per[4], 1, 'tipologia e zona');
  assertEq(per[3], 1 / 2, 'solo tipologia (Brescia ≠ Desenzano)');
  assertEq(per[2], 1 / 2, 'solo zona (Appartamento ≠ Villa)');
  assertEq(r.items.some((i) => i.id === 1), false, 'villa da 300.000 con budget 200.000: esclusa dal vincolo');
  assertEq(r.items.some((i) => i.id === 5), false, 'terreno a Roma: il budget basta ma nessuna affinità → non è un abbinamento');
  assertEq(r.items.map((i) => i.id), [4, 3, 2]);
});
test('se tutte le regole sono vincoli bastano i vincoli, punteggio pieno', () => {
  const r = calcolaAbbinamenti({ rules: [{ mine: 'budget', theirs: 'prezzo', op: 'theirs<=mine', required: true }] }, { budget: 200000 }, immobili);
  assertEq(r.items.map((i) => i.id).sort(), [2, 3, 4, 5]);
  assertEq(r.items.every((i) => i.punteggio === 1), true);
});
test('a parità di punteggio il più recente viene prima', () => {
  const r = calcolaAbbinamenti({ rules: REGOLE }, cliente, immobili);
  const ids = r.items.map((i) => i.id);
  assertEq(ids.indexOf(3) < ids.indexOf(2), true, 'id 3 (più recente) prima di id 2');
});
test('ogni risultato dice cosa soddisfa e cosa no', () => {
  const r = calcolaAbbinamenti({ rules: REGOLE }, cliente, immobili);
  const i3 = r.items.find((i) => i.id === 3);
  assertEq(i3.soddisfatte, ['Tipologia', 'Prezzo nel budget']); assertEq(i3.mancanti, ['Zona']);
});
test('un campo vuoto sul mio record non esclude nessuno e non conta', () => {
  const r = calcolaAbbinamenti({ rules: REGOLE }, { cerca_tipo: 'Villa', budget: '', zona: '' }, immobili);
  assertEq(r.valutabili, 1);
  assertEq(r.items.map((i) => i.id).sort(), [1, 3, 4]);
  assertEq(r.items.every((i) => i.punteggio === 1), true);
});
test('nessun criterio compilato → niente risultati e valutabili 0 (la sezione dirà «compila i criteri»)', () => {
  const r = calcolaAbbinamenti({ rules: REGOLE }, {}, immobili);
  assertEq(r, { applicabile: true, valutabili: 0, items: [] });
});
test('filtro sul candidato (es. solo immobili in vendita) e condizione sul mio record', () => {
  const r = calcolaAbbinamenti({ rules: REGOLE, target_filter: { field: '_stato', in: ['in_vendita'] } }, cliente, immobili);
  assertEq(r.items, [], 'nessun candidato ha quello stato');
  const r2 = calcolaAbbinamenti({ rules: REGOLE, target_filter: { field: '_stato', equals: 'venduto' } }, cliente, immobili);
  assertEq(r2.items.map((i) => i.id), [4]);
  const r3 = calcolaAbbinamenti({ rules: REGOLE, when: { field: 'tipo_cliente', equals: 'Acquirente' } }, { ...cliente, tipo_cliente: 'Venditore' }, immobili);
  assertEq(r3, { applicabile: false, valutabili: 0, items: [] });
  const r4 = calcolaAbbinamenti({ rules: REGOLE, when: { field: 'tipo_cliente', equals: 'Acquirente' } }, { ...cliente, tipo_cliente: 'Acquirente' }, immobili);
  assertEq(r4.applicabile, true);
});
test('regole incomplete o con operatore sconosciuto vengono ignorate, non rompono', () => {
  const r = calcolaAbbinamenti({ rules: [{ mine: 'a' }, { mine: 'a', theirs: 'b', op: 'boh' }, REGOLE[0]] }, cliente, immobili);
  assertEq(r.valutabili, 1);
  assertEq(r.items.map((i) => i.id).sort(), [1, 3, 4]);
});
test('definizione senza regole, o candidati assenti → risultato vuoto, mai un errore', () => {
  assertEq(calcolaAbbinamenti({}, cliente, immobili).items, []);
  assertEq(calcolaAbbinamenti({ rules: REGOLE }, cliente, null).items, []);
  assertEq(calcolaAbbinamenti({ rules: REGOLE }, null, immobili).valutabili, 0);
});
test('direzione inversa: da un immobile alle richieste dei clienti (budget cliente ≥ prezzo immobile)', () => {
  const inverse = [
    { mine: 'tipo', theirs: 'cerca_tipo', op: 'testo', label: 'Tipologia' },
    { mine: 'prezzo', theirs: 'budget', op: 'theirs>=mine', label: 'Nel budget', required: true },
    { mine: 'comune', theirs: 'zona', op: 'testo', label: 'Zona' },
  ];
  const clienti = [
    { id: 10, data: { cerca_tipo: 'Villa', budget: 250000, zona: 'Desenzano' } },
    { id: 11, data: { cerca_tipo: 'Villa', budget: 100000, zona: 'Desenzano' } },
    { id: 12, data: { cerca_tipo: 'Attico', budget: 400000, zona: 'Milano' } },
  ];
  const r = calcolaAbbinamenti({ rules: inverse }, immobili[3].data, clienti);
  assertEq(r.items.map((i) => i.id), [10]);
});
test('non modifica i dati ricevuti', () => {
  const copia = JSON.stringify(immobili);
  calcolaAbbinamenti({ rules: REGOLE }, cliente, immobili);
  assertEq(JSON.stringify(immobili), copia);
});

console.log(`\n${'─'.repeat(50)}`);
console.log(`Risultato: ${passed} passati, ${failed} falliti`);
if (failed > 0) process.exit(1);
