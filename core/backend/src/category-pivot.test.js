'use strict';
// Test — category-pivot.js. Eseguire con: node category-pivot.test.js
const assert = require('assert');
const { computeCategoryPivot } = require('./category-pivot');

const compareValues = (a, op, b) => { switch (op) { case '==': return a == b; case '!=': return a != b; default: return false; } };
const metric = { field: 'importo', func: 'sum' };

const rows = [
  { __id: 1, data: '2026-03-01', categoria: 'Alimentari', importo: 100 },
  { __id: 2, data: '2026-05-01', categoria: 'Alimentari', importo: 50 },
  { __id: 3, data: '2025-03-01', categoria: 'Alimentari', importo: 120 },
  { __id: 4, data: '2026-01-01', categoria: 'Utenze', importo: 200 },
  { __id: 5, data: '2025-01-01', categoria: 'Utenze', importo: 0 }, // nel 2025 non speso
  { __id: 6, data: '2024-01-01', categoria: 'Vecchia', importo: 10 }, // solo nel 2024, fuori dai 2 anni richiesti
];

// Anno su anno: solo 2026 vs 2025.
const pivot2 = computeCategoryPivot(rows, 'data', 'categoria', metric, [2026, 2025], compareValues);
console.log(JSON.stringify(pivot2, null, 2));

const alimentari = pivot2.categories.find((c) => c.category === 'Alimentari');
assert.strictEqual(alimentari.values[0].value, 150, '2026: 100+50');
assert.strictEqual(alimentari.values[1].value, 120, '2025');
assert.strictEqual(alimentari.deltaPct, 25, '(150-120)/120*100 = 25%');

const utenze = pivot2.categories.find((c) => c.category === 'Utenze');
assert.strictEqual(utenze.values[0].value, 200);
assert.strictEqual(utenze.values[1].value, 0);
assert.strictEqual(utenze.deltaPct, 100, 'da 0 a 200 -> +100% per convenzione (non divisione per zero)');

assert.ok(!pivot2.categories.some((c) => c.category === 'Vecchia'), '"Vecchia" fuori dai 2 anni richiesti, esclusa dal risultato');

// Storico utenze: 3 anni.
const pivot3 = computeCategoryPivot(rows, 'data', 'categoria', metric, [2026, 2025, 2024], compareValues);
const vecchia = pivot3.categories.find((c) => c.category === 'Vecchia');
assert.strictEqual(vecchia.values[2].value, 10, 'con 3 anni richiesti, "Vecchia" (solo 2024) ora compare');
assert.strictEqual(vecchia.values[0].value, 0);

console.log('TUTTO OK');
