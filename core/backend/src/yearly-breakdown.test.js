'use strict';
// Test — yearly-breakdown.js. Eseguire con: node yearly-breakdown.test.js
const assert = require('assert');
const { computeYearlyBreakdown, MESI } = require('./yearly-breakdown');

const compareValues = (a, op, b) => { switch (op) { case '==': return a == b; case '!=': return a != b; default: return false; } };

const rows = [
  { __id: 1, data: '2026-01-10', importo: 100 },
  { __id: 2, data: '2026-01-20', importo: 50 },
  { __id: 3, data: '2026-06-05', importo: 200 },
  { __id: 4, data: '2025-01-15', importo: 999 }, // stesso mese, anno precedente
  { __id: 5, data: '2025-06-01', importo: 10 },
];

const result = computeYearlyBreakdown(rows, 'data', 2026,
  [{ key: 'totale', label: 'Totale', field: 'importo', func: 'sum', format: 'currency' }], true, compareValues);

assert.strictEqual(result.months.length, 12);
assert.deepStrictEqual(result.months.map((m) => m.label), MESI);

const gennaio = result.months[0];
assert.strictEqual(gennaio.metrics[0].value, 150, 'gennaio 2026 = 100+50');
assert.strictEqual(gennaio.compareMetrics[0].value, 999, 'gennaio 2025 (confronto)');

const giugno = result.months[5];
assert.strictEqual(giugno.metrics[0].value, 200);
assert.strictEqual(giugno.compareMetrics[0].value, 10);

const febbraio = result.months[1];
assert.strictEqual(febbraio.metrics[0].value, 0, 'nessun dato febbraio 2026');

// Totali = somma di tutti i 12 mesi.
assert.strictEqual(result.totals[0].value, 350, 'totale anno 2026 = 150+200');
assert.strictEqual(result.compareTotals[0].value, 1009, 'totale anno 2025 = 999+10');

console.log(JSON.stringify({ gennaio, giugno, totals: result.totals, compareTotals: result.compareTotals }, null, 2));
console.log('TUTTO OK');
