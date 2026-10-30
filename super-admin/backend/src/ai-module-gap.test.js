'use strict';
// «Ti manca un modulo?» (lib/ai-module-gap.js): al modello arrivano struttura e indizi, mai dati personali; la risposta si valida contro il catalogo VERO della Libreria, mai un id inventato.
// Eseguire con: node src/ai-module-gap.test.js
const g = require('./lib/ai-module-gap');
let passed = 0, failed = 0;
function test(name, fn) { try { fn(); console.log('  ✓ ' + name); passed++; } catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; } }
const eq = (a, e, m) => { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${m || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m || 'atteso true'); };

test('installati obbligatorio, e i dati personali nei nomi/stati sono tolti', () => {
  ok(g.sanitizeModuleGap(null).error); ok(g.sanitizeModuleGap({}).error); ok(g.sanitizeModuleGap({ installati: [] }).error);
  const r = g.sanitizeModuleGap({ installati: [{ nome: 'Clienti di mario.rossi@example.com', campi: [{ key: 'tel', type: 'phone' }, { key: '', type: 'text' }], stati: ['Aperto per mario.rossi@example.com'] }], indizi: ['«Fornitore» ripete sempre gli stessi 5 valori: mario.rossi@example.com'] });
  ok(!r.error, r.error); const j = JSON.stringify(r.payload);
  ok(!/mario\.rossi@example\.com/.test(j), j);
  eq(r.payload.installati[0].campi, [{ key: 'tel', type: 'phone' }]);
});
test('un modulo senza nome viene scartato dall\'elenco', () => {
  const r = g.sanitizeModuleGap({ installati: [{ nome: '', campi: [] }, { nome: 'Spese', campi: [] }] });
  eq(r.payload.installati.length, 1); eq(r.payload.installati[0].nome, 'Spese');
});

const LIBRERIA = [{ id: 1, name: 'Clienti', description: 'Anagrafica clienti' }, { id: 2, name: 'Manutenzioni', description: 'Interventi programmati' }];
test('tipo "nessuna" o mancante: nessun motivo richiesto, nessun id', () => {
  eq(g.validateModuleGap({ tipo: 'nessuna' }, LIBRERIA).proposta.tipo, 'nessuna');
  eq(g.validateModuleGap({}, LIBRERIA).proposta.tipo, 'nessuna');
  ok(g.validateModuleGap(null, LIBRERIA).error);
  ok(g.validateModuleGap('boh', LIBRERIA).error);
});
test('"installa" con un id che esiste davvero nella libreria: passano nome e descrizione del catalogo, non quelli (eventuali) del modello', () => {
  const v = g.validateModuleGap({ tipo: 'installa', registry_module_id: 1, nome: 'nome a caso del modello', motivo: 'Hai clienti ma nessun modulo li gestisce' }, LIBRERIA);
  eq(v.proposta, { tipo: 'installa', registry_module_id: 1, nome: 'Clienti', descrizione: 'Anagrafica clienti', motivo: 'Hai clienti ma nessun modulo li gestisce' });
});
test('"installa" con un id inventato o non nella libreria diventa "nessuna": mai un modulo a caso', () => {
  eq(g.validateModuleGap({ tipo: 'installa', registry_module_id: 999, motivo: 'x' }, LIBRERIA).proposta.tipo, 'nessuna');
  eq(g.validateModuleGap({ tipo: 'installa', motivo: 'x' }, LIBRERIA).proposta.tipo, 'nessuna');
});
test('"crea" senza un nome diventa "nessuna"; con un nome, nome e descrizione sono accorciati', () => {
  eq(g.validateModuleGap({ tipo: 'crea', motivo: 'x' }, LIBRERIA).proposta.tipo, 'nessuna');
  const v = g.validateModuleGap({ tipo: 'crea', nome: 'Manutenzioni auto', descrizione: 'x'.repeat(400), motivo: 'Molte righe fanno riferimento a un\'auto che non esiste come modulo' }, LIBRERIA);
  eq(v.proposta.tipo, 'crea'); eq(v.proposta.nome, 'Manutenzioni auto'); eq(v.proposta.descrizione.length, 300);
});

console.log(`\n${passed} passati, ${failed} falliti`); process.exit(failed ? 1 : 0);
