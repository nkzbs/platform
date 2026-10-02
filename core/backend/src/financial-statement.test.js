'use strict';
// Test — financial-statement.js. Eseguire con: node financial-statement.test.js
const assert = require('assert');
const { computeStatement } = require('./financial-statement');

const conti = [
  { id: 1, codice: '4000', nome: 'Vendite', tipo: 'Ricavo' },
  { id: 2, codice: '6000', nome: 'Acquisti', tipo: 'Costo' },
  { id: 3, codice: '1000', nome: 'Cassa', tipo: 'Attivo' },
  { id: 4, codice: '2000', nome: 'Debiti fornitori', tipo: 'Passivo' },
  { id: 5, codice: '3000', nome: 'Capitale sociale', tipo: 'Capitale' },
];

// Scrittura 1: incasso vendita 1000 -> Cassa (dare 1000) / Vendite (avere 1000)
// Scrittura 2: acquisto 400 a debito -> Acquisti (dare 400) / Debiti fornitori (avere 400)
// Scrittura 3: apporto capitale 600 in cassa -> Cassa (dare 600) / Capitale sociale (avere 600)
const righe = [
  { conto_id: 3, dare: 1000, avere: 0 },
  { conto_id: 1, dare: 0, avere: 1000 },
  { conto_id: 2, dare: 400, avere: 0 },
  { conto_id: 4, dare: 0, avere: 400 },
  { conto_id: 3, dare: 600, avere: 0 },
  { conto_id: 5, dare: 0, avere: 600 },
];

const result = computeStatement(righe, conti);

assert.strictEqual(result.conto_economico.totRicavi, 1000, 'ricavi');
assert.strictEqual(result.conto_economico.totCosti, 400, 'costi');
assert.strictEqual(result.conto_economico.utile, 600, 'utile');
assert.strictEqual(result.stato_patrimoniale.totAttivo, 1600, 'attivo (cassa 1000+600)');
assert.strictEqual(result.stato_patrimoniale.totPassivo, 400, 'passivo');
assert.strictEqual(result.stato_patrimoniale.totPatrimonio, 600 + 600, 'patrimonio (capitale 600 + utile 600)');
assert.strictEqual(result.stato_patrimoniale.pareggio, true, 'pareggio: attivo 1600 = passivo 400 + patrimonio 1200');

const cassaBilancio = result.bilancio.find((c) => c.codice === '1000');
assert.strictEqual(cassaBilancio.dare, 1600);
assert.strictEqual(cassaBilancio.saldo, 1600);

console.log('TUTTO OK');
