'use strict';
// Test — distance-buckets.js. Eseguire con: node distance-buckets.test.js
const assert = require('assert');
const { assignBucket, computeDistanceBuckets } = require('./distance-buckets');

const buckets = [
  { key: 'scadute', label: 'Scadute', max_days: -1 },
  { key: 'entro7', label: 'Entro 7 giorni', max_days: 7 },
  { key: 'entro30', label: 'Entro 30 giorni', max_days: 30 },
  { key: 'oltre30', label: 'Oltre 30 giorni', max_days: null },
];

assert.strictEqual(assignBucket(-5, buckets), 'scadute');
assert.strictEqual(assignBucket(-1, buckets), 'scadute');
assert.strictEqual(assignBucket(0, buckets), 'entro7');
assert.strictEqual(assignBucket(7, buckets), 'entro7');
assert.strictEqual(assignBucket(8, buckets), 'entro30');
assert.strictEqual(assignBucket(30, buckets), 'entro30');
assert.strictEqual(assignBucket(31, buckets), 'oltre30');
assert.strictEqual(assignBucket(9999, buckets), 'oltre30');
assert.strictEqual(assignBucket(null, buckets), null);

const rows = [
  { __id: 1, giorni: -10, metricValue: 500 },   // scadute
  { __id: 2, giorni: 3, metricValue: 200 },      // entro7
  { __id: 3, giorni: 3, metricValue: 100 },      // entro7
  { __id: 4, giorni: 15, metricValue: 300 },     // entro30
  { __id: 5, giorni: 90, metricValue: 50 },      // oltre30
  { __id: 6, giorni: null, metricValue: 999 },   // senza data, escluso dai bucket
];
const result = computeDistanceBuckets(rows, buckets, 'currency');
console.log(JSON.stringify(result, null, 2));

const byKey = Object.fromEntries(result.buckets.map((b) => [b.key, b]));
assert.strictEqual(byKey.scadute.count, 1);
assert.strictEqual(byKey.scadute.total, 500);
assert.strictEqual(byKey.entro7.count, 2);
assert.strictEqual(byKey.entro7.total, 300);
assert.strictEqual(byKey.entro30.count, 1);
assert.strictEqual(byKey.entro30.total, 300);
assert.strictEqual(byKey.oltre30.count, 1);
assert.strictEqual(byKey.oltre30.total, 50);
assert.strictEqual(result.rows.length, 6);
assert.strictEqual(result.rows[0].__id, 1, 'ordinato per giorni crescente, scaduta prima');
assert.strictEqual(result.rows[result.rows.length - 1].giorni, null, 'righe senza data in fondo');

console.log('TUTTO OK');
