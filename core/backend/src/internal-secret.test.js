'use strict';
// shared/internal-secret.js: nessun segreto di riserva, confronto esatto.
const assert = require('assert');

process.env.INTERNAL_API_SECRET = 'segreto-di-prova-123';
const { isInternalSecret, requireInternalSecret } = require('../../../shared/internal-secret.js');

let passed = 0;
function test(name, fn) { fn(); console.log('  ✓ ' + name); passed++; }

test('il segreto giusto passa', () => assert.strictEqual(isInternalSecret('segreto-di-prova-123'), true));
test('sbagliato, troncato, vuoto o mancante -> rifiutato', () => {
  for (const v of ['segreto-di-prova-12', 'segreto-di-prova-1234', '', undefined, null, ['segreto-di-prova-123']]) {
    assert.strictEqual(isInternalSecret(v), false, String(v));
  }
});
test('senza INTERNAL_API_SECRET nessun valore passa, neanche il vecchio default', () => {
  delete process.env.INTERNAL_API_SECRET;
  assert.strictEqual(isInternalSecret('changeme_internal'), false);
  assert.strictEqual(isInternalSecret(''), false);
  process.env.INTERNAL_API_SECRET = 'segreto-di-prova-123';
});
test('il middleware risponde 401 o lascia passare', () => {
  let status = null, nexted = false;
  const res = { status(s) { status = s; return { json() {} }; } };
  requireInternalSecret({ headers: { 'x-internal-secret': 'no' } }, res, () => { nexted = true; });
  assert.strictEqual(status, 401); assert.strictEqual(nexted, false);
  requireInternalSecret({ headers: { 'x-internal-secret': 'segreto-di-prova-123' } }, res, () => { nexted = true; });
  assert.strictEqual(nexted, true);
});

console.log(passed + ' passati, 0 falliti su ' + passed + ' test.');
