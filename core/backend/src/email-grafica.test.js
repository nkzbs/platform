'use strict';
// La grafica unica delle mail ai clienti: marchio dell'agenzia, un solo pulsante, nessun HTML iniettato, leggibile su colori chiari.
// Eseguire con: node src/email-grafica.test.js
const g = require('./lib/email-grafica');
let passed = 0, failed = 0;
function test(n, fn) { try { fn(); console.log('  ✓ ' + n); passed++; } catch (e) { console.error('  ✗ ' + n + '\n    ' + e.message); failed++; } }
const ok = (c, m) => { if (!c) throw new Error(m || 'atteso true'); };
const ID = { nome: 'Agenzia Prova', indirizzo: 'Via Roma 1, Milano', piva: '01234567890', logo: '', colore: '#9a4a2b' };

test('fascia con nome e colore dell\'agenzia, piè di pagina con indirizzo e P.IVA', () => {
  const h = g.htmlComunicazione('Ciao Mario', { identita: ID });
  ok(h.includes('#9a4a2b') && h.includes('Agenzia Prova') && h.includes('Via Roma 1, Milano') && h.includes('P.IVA 01234567890'));
  ok(h.includes('>A<'), 'senza logo si usa l\'iniziale');
});
test('il logo si usa solo se è un indirizzo https', () => {
  ok(g.htmlComunicazione('x', { identita: { ...ID, logo: 'https://x.it/l.png' } }).includes('<img src="https://x.it/l.png"'));
  ok(!g.htmlComunicazione('x', { identita: { ...ID, logo: 'javascript:alert(1)' } }).includes('<img'), 'mai un logo non https');
});
test('il testo è «sicuro»: tag e virgolette si neutralizzano, i paragrafi si separano', () => {
  const h = g.htmlComunicazione('<script>alert(1)</script>\n\nSecondo "paragrafo"', { identita: ID });
  ok(!h.includes('<script>') && h.includes('&lt;script&gt;'), 'tag neutralizzato');
  ok((h.match(/<p style="margin:0 0 14px">/g) || []).length === 2, 'due paragrafi');
});
test('un indirizzo https nel testo diventa un collegamento', () => {
  ok(g.htmlComunicazione('Apri https://esempio.it/f/abc ora', { identita: ID }).includes('<a href="https://esempio.it/f/abc"'));
});
test('pulsante: solo con indirizzo https, un solo pulsante; senza https non si disegna', () => {
  const h = g.htmlComunicazione('x', { identita: ID, pulsante: { testo: 'Rivedi e firma', url: 'https://esempio.it/f/abc' }, nota: 'Ci vogliono 3 minuti' });
  ok(h.includes('Rivedi e firma') && h.includes('Ci vogliono 3 minuti') && (h.match(/font:600 15px Arial/g) || []).length === 1);
  ok(!g.htmlComunicazione('x', { identita: ID, pulsante: { testo: 'Vai', url: 'http://non-sicuro.it' } }).includes('>Vai<'), 'http non ammesso');
});
test('elenco dei documenti e firma di chi scrive', () => {
  const h = g.htmlComunicazione('x', { identita: ID, elenco: [{ nome: 'Informativa privacy', dettaglio: '2 pagine' }, { nome: 'Antiriciclaggio', dettaglio: '3 pagine' }], firmaDa: { nome: 'Giulia Bianchi', ruolo: 'Agente' } });
  ok(h.includes('Informativa privacy') && h.includes('3 pagine') && h.includes('Giulia Bianchi') && h.includes('Agente'));
});
test('un colore chiaro dell\'agenzia ha il testo scuro; uno scuro ha il testo bianco; un colore non valido torna al predefinito', () => {
  ok(g.testoSu('#f2e6a0') === '#1c1917' && g.testoSu('#1f4e79') === '#ffffff');
  ok(g.coloreValido('rosso') === '#1f4e79' && g.coloreValido('#12ab9f') === '#12ab9f');
});
test('senza nessun dato dell\'agenzia la mail si disegna lo stesso', () => {
  const h = g.htmlComunicazione('Ciao', { identita: { nome: '', indirizzo: '', piva: '', logo: '', colore: g.coloreValido(null) } });
  ok(h.includes('La tua agenzia') && h.includes('Ciao'));
});
console.log(`\n${passed} passati, ${failed} falliti`); process.exit(failed ? 1 : 0);
