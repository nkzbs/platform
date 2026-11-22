'use strict';
// Cartelle di Drive che si traducono o si ignorano (cartelle-drive.js). Eseguire con: node src/cartelle-drive.test.js
let passed = 0, failed = 0;
function test(name, fn) { try { fn(); console.log('  ✓ ' + name); passed++; } catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; } }
function assertEq(a, e, msg) { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${msg || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); }

const { nomeCartella, nomiCartelle, REGOLE } = require('./cartelle-drive');
const R = { arch: { alias: { Ricevute: 'Ricevuta di pagamento' }, ignora: ['Prova'] } };

test('un alias dà la scelta vera, una cartella da ignorare dà null, le altre restano com\'erano', () => {
  assertEq(nomeCartella('arch', 'Ricevute', R), 'Ricevuta di pagamento');
  assertEq(nomeCartella('arch', 'Prova', R), null);
  assertEq(nomeCartella('arch', 'Bolletta', R), 'Bolletta');
});
test('un altro modulo, o un nome vuoto, non cambia niente', () => {
  assertEq(nomeCartella('altro', 'Ricevute', R), 'Ricevute'); assertEq(nomeCartella('altro', 'Prova', R), 'Prova');
  assertEq(nomeCartella('arch', undefined, R), undefined);
});
test('una proprietà ereditata (es. «constructor») non è un alias', () => {
  assertEq(nomeCartella('arch', 'constructor', R), 'constructor'); assertEq(nomeCartella('arch', 'toString', R), 'toString');
});
test('l\'elenco delle cartelle: tradotte, senza ignorate e senza doppioni (anche se due nomi puntano alla stessa scelta)', () => {
  assertEq(nomiCartelle('arch', ['Ricevute', 'Ricevuta di pagamento', 'Prova', 'Bolletta', 'Bolletta'], R), ['Ricevuta di pagamento', 'Bolletta']);
  assertEq(nomiCartelle('arch', null, R), []);
});
test('le regole dichiarate davvero (seeds/cartelle-drive.json) sono ben formate', () => {
  for (const [slug, r] of Object.entries(REGOLE)) {
    if (!slug) throw new Error('modulo');
    for (const [a, b] of Object.entries(r.alias || {})) if (!a || !b || a === b) throw new Error(slug + ': alias ' + a);
    if (!Array.isArray(r.ignora || [])) throw new Error(slug + ': ignora');
  }
  assertEq(nomeCartella('documenti', 'Ricevute'), 'Ricevuta di pagamento'); assertEq(nomeCartella('documenti', 'Prova'), null);
});

console.log(`\n${'='.repeat(60)}`);
console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
process.exit(failed > 0 ? 1 : 0);
