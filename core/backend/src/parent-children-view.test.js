'use strict';
// Test — parent-children-view.js. Eseguire con: node parent-children-view.test.js
const assert = require('assert');
const { computeParentChildren } = require('./parent-children-view');

const config = { children_status_field: '_stato', children_status_done_value: 'pagato', amount_field: 'importo_totale', child_amount_field: 'importo' };

const parents = [
  { __id: 1, importo_totale: 300 },
  { __id: 2, importo_totale: 500 }, // nessun figlio -> escluso
];
const childrenByParent = new Map([
  [1, [
    { __id: 10, importo: 100, _stato: 'pagato' },
    { __id: 11, importo: 100, _stato: 'pagato' },
    { __id: 12, importo: 100, _stato: 'da_pagare' },
  ]],
]);

const result = computeParentChildren(parents, childrenByParent, config);
console.log(JSON.stringify(result, null, 2));

assert.strictEqual(result.length, 1, 'il genitore senza figli è escluso');
const r = result[0];
assert.strictEqual(r.n_children, 3);
assert.strictEqual(r.n_done, 2);
assert.strictEqual(r.residuo, 100, 'residuo = 300 - 200 pagati');
assert.strictEqual(r.pct, 67, 'round(2/3*100)');
assert.deepStrictEqual(r.children.map((c) => c.done), [true, true, false]);

console.log('TUTTO OK');
