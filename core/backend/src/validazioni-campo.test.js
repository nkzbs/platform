'use strict';
// Validazioni di campo (shared/validazioni-campo.js): codice fiscale, partita IVA, regole sui campi del modulo. Funzioni pure.
const { codiceFiscaleValido, partitaIvaValida, controllaValidazioni } = require('./validazioni-campo');
let passed = 0, failed = 0;
function test(name, fn) { try { fn(); console.log('  ✓ ' + name); passed++; } catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; } }
const eq = (a, e, m) => { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${m || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); };

test('codice fiscale: valido (anche minuscolo/spazi), carattere di controllo sbagliato, forma sbagliata', () => {
  eq(codiceFiscaleValido('RSSMRA85T10A562S'), true); eq(codiceFiscaleValido(' rssmra85t10a562s '), true);
  eq(codiceFiscaleValido('RSSMRA85T10A562T'), false, 'controllo'); eq(codiceFiscaleValido('RSSMRA85T10A562'), false, 'corto'); eq(codiceFiscaleValido(''), false);
});
test('partita IVA: valida (con IT davanti), cifra di controllo sbagliata, lunghezza sbagliata', () => {
  eq(partitaIvaValida('12345678903'), true); eq(partitaIvaValida('IT12345678903'), true);
  eq(partitaIvaValida('12345678904'), false); eq(partitaIvaValida('1234567890'), false);
});
test('controllaValidazioni: vuoto ok, valore errato → errore col nome del campo, "o_piva" accetta entrambi, invariato non blocca', () => {
  const campi = [{ key: 'cf', label: 'Codice fiscale / P.IVA', validazione: 'codice_fiscale_o_piva_it' }, { key: 'altro', label: 'Altro' }];
  eq(controllaValidazioni(campi, { cf: '' }), null); eq(controllaValidazioni(campi, { altro: 'x' }), null);
  eq(controllaValidazioni(campi, { cf: 'RSSMRA85T10A562S' }), null); eq(controllaValidazioni(campi, { cf: '12345678903' }), null);
  const e = controllaValidazioni(campi, { cf: 'sbagliato' }); eq(e.campo, 'cf'); if (!/Codice fiscale \/ P\.IVA/.test(e.error)) throw new Error(e.error);
  eq(controllaValidazioni(campi, { cf: 'sbagliato' }, { cf: 'sbagliato' }), null, 'dato vecchio invariato non blocca');
});

console.log(`\n${passed} passati, ${failed} falliti.`);
process.exit(failed ? 1 : 0);
