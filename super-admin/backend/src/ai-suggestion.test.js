'use strict';
// «Spiega e proponi» per i suggerimenti dei tenant (lib/ai-suggestion.js): al modello arriva la struttura e i numeri, mai valori o dati personali; la risposta si valida.
// Eseguire con: node src/ai-suggestion.test.js
const s = require('./lib/ai-suggestion');
let passed = 0, failed = 0;
function test(name, fn) { try { fn(); console.log('  ✓ ' + name); passed++; } catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; } }
const eq = (a, e, m) => { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${m || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m || 'atteso true'); };

test('al modello arrivano solo struttura e numeri: i dati personali nei nomi sono tolti, i valori strani scartati', () => {
  const r = s.sanitizeSuggestion({ regola: 'campo_poco_usato', modulo: 'Clienti di mario.rossi@example.com', titolo: '«Telefono 333 1234567» mai compilato', numeri: { compilate: 0, totale: 40, mai: true, sporco: 'DATO', 'chiave strana': 1 }, target: 'tel',
    campi: [{ key: 'tel', label: 'Telefono', type: 'phone', valore: 'RISERVATO' }, { label: 'senza chiave' }], stati: [{ key: 'a', label: 'Aperto' }] });
  ok(!r.error, r.error); const j = JSON.stringify(r.payload);
  ok(!/mario\.rossi@|333 1234567|RISERVATO|DATO/.test(j), j); eq(r.payload.numeri, { compilate: 0, totale: 40, mai: true }); eq(r.payload.campi, [{ key: 'tel', label: 'Telefono', type: 'phone' }]);
});
test('una regola non valida o un corpo vuoto si rifiutano', () => { ok(s.sanitizeSuggestion(null).error); ok(s.sanitizeSuggestion({ regola: 'DROP TABLE' }).error); ok(s.sanitizeSuggestion({}).error); });
test('la risposta si valida: spiegazione e passi obbligatori, al massimo 4 passi, azione da un elenco chiuso', () => {
  const v = s.validateSuggestion({ spiegazione: 'Potrebbe non servire.', cosa_fare: ['Verifica', 'Togli', '', 'Tre', 'Quattro', 'Cinque'], azione: 'cancella_tutto' });
  eq(v.proposta.cosa_fare.length, 4); eq(v.proposta.azione, 'altro');
  eq(s.validateSuggestion({ spiegazione: 'x', cosa_fare: ['a'], azione: 'rendi_scelta' }).proposta.azione, 'rendi_scelta');
  ok(s.validateSuggestion({ spiegazione: '', cosa_fare: ['a'] }).error); ok(s.validateSuggestion({ spiegazione: 'x', cosa_fare: [] }).error); ok(s.validateSuggestion('boh').error);
});
console.log(`\n${passed} passati, ${failed} falliti`); process.exit(failed ? 1 : 0);
