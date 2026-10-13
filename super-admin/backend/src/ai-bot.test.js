'use strict';
// Bot Telegram (lib/ai-bot.js): una frase diventa UNA azione di un elenco chiuso, validata rigidamente. Eseguire con: node src/ai-bot.test.js

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; }
}
const eq = (a, e, msg) => { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${msg || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); };
const ok = (c, msg) => { if (!c) throw new Error(msg || 'atteso true'); };

const bot = require('./lib/ai-bot');
const MODULI = [
  { slug: 'spese_casa', name: 'Spese Casa', etichetta: 'casa', categorie: ['Elettricità', 'Gas', 'Affitto'] },
  { slug: 'spese_personali', name: 'Spese Personali', etichetta: 'pers.', categorie: ['Benzina', 'Svago'] },
];
const mod = bot.sanitizeBot({ frase: 'ciao', moduli: MODULI }).payload.moduli;

console.log('\n--- cosa esce verso il modello ---');
test('la frase è ripulita dai dati personali; niente record, solo i moduli', () => {
  const s = bot.sanitizeBot({ frase: 'ho pagato mario.rossi@x.it con IBAN IT60X0542811101000000123456', moduli: MODULI, oggi: '2026-10-11' });
  ok(!s.payload.frase.includes('mario.rossi') && !s.payload.frase.includes('IT60X05'), s.payload.frase);
  eq(Object.keys(s.payload).sort(), ['frase', 'moduli', 'oggi', 'report', 'timbrature']);
});
test('frase vuota o senza moduli: errore; frase lunghissima: tagliata', () => {
  ok(!!bot.sanitizeBot({ frase: ' ', moduli: MODULI }).error); ok(!!bot.sanitizeBot({ frase: 'ciao', moduli: [] }).error);
  eq(bot.sanitizeBot({ frase: 'x'.repeat(2000), moduli: MODULI }).payload.frase.length, 300);
});

console.log('\n--- la risposta del modello è un\'azione dell\'elenco, o niente ---');
test('azioni sconosciute o pericolose diventano «altro», mai eseguite', () => {
  for (const a of ['elimina_tutto', 'cancella', 'modifica_utente', 'esegui', '', null, undefined, 42]) eq(bot.validateIntent({ azione: a }, mod).intent, { azione: 'altro' }, String(a));
});
test('domanda e altro: nessun parametro extra passa', () => {
  eq(bot.validateIntent({ azione: 'domanda', sql: 'DROP TABLE', cerca: 'x' }, mod).intent, { azione: 'domanda' });
});
test('elenco: solo pagare, scadute, smistare', () => {
  eq(bot.validateIntent({ azione: 'elenco', cosa: 'scadute' }, mod).intent, { azione: 'elenco', cosa: 'scadute' });
  ok(!!bot.validateIntent({ azione: 'elenco', cosa: 'utenti' }, mod).error);
});
test('segna pagata / riapri: serve una descrizione della voce; il testo è tagliato e senza a capo', () => {
  eq(bot.validateIntent({ azione: 'segna_pagata', cerca: 'affitto ottobre' }, mod).intent, { azione: 'segna_pagata', cerca: 'affitto ottobre' });
  ok(!!bot.validateIntent({ azione: 'riapri', cerca: 'a' }, mod).error);
  eq(bot.validateIntent({ azione: 'segna_pagata', cerca: 'a2a\nluce ' + 'x'.repeat(200) }, mod).intent.cerca.length, 60);
});
test('smista: modo dell\'elenco, rate tra 2 e 60, importo e scadenza controllati', () => {
  eq(bot.validateIntent({ azione: 'smista', cerca: 'a2a', modo: 'rate', n_rate: 3 }, mod).intent, { azione: 'smista', cerca: 'a2a', modo: 'rate', n_rate: 3, importo: null, scadenza: null });
  eq(bot.validateIntent({ azione: 'smista', cerca: 'a2a', modo: 'rate', n_rate: 99 }, mod).intent.n_rate, null, 'rate fuori misura: si richiede dopo');
  eq(bot.validateIntent({ azione: 'smista', cerca: 'a2a', modo: 'boh' }, mod).intent.modo, 'uno');
  ok(!!bot.validateIntent({ azione: 'smista', cerca: 'a2a', importo: -5 }, mod).error); ok(!!bot.validateIntent({ azione: 'smista', cerca: 'a2a', importo: 1e9 }, mod).error);
  eq(bot.validateIntent({ azione: 'smista', cerca: 'a2a', scadenza: '2026-02-31' }, mod).intent.scadenza, null, 'data impossibile');
});
test('nuova spesa: importo > 0 e ragionevole, descrizione, modulo e categoria esistenti, data valida', () => {
  const r = bot.validateIntent({ azione: 'nuova_spesa', descrizione: 'Benzina', importo: '20,5'.replace(',', '.'), data: '2026-10-11', modulo: 'spese_personali', pagata: true, categoria: 'benzina' }, mod).intent;
  eq(r, { azione: 'nuova_spesa', descrizione: 'Benzina', importo: 20.5, data: '2026-10-11', modulo: 'spese_personali', pagata: true, categoria: 'Benzina' });
  for (const imp of [0, -3, 'abc', 100001, null]) ok(!!bot.validateIntent({ azione: 'nuova_spesa', descrizione: 'x1', importo: imp }, mod).error, 'importo ' + imp);
  ok(!!bot.validateIntent({ azione: 'nuova_spesa', descrizione: '', importo: 5 }, mod).error);
});
test('un modulo inventato o una categoria che non è del modulo non passano (diventano null)', () => {
  const r = bot.validateIntent({ azione: 'nuova_spesa', descrizione: 'Cena', importo: 30, modulo: 'utenti', categoria: 'Svago' }, mod).intent;
  eq([r.modulo, r.categoria], [null, null]);
  eq(bot.validateIntent({ azione: 'nuova_spesa', descrizione: 'Cena', importo: 30, modulo: 'spese_casa', categoria: 'Svago' }, mod).intent.categoria, null, 'Svago è di un altro modulo');
});
test('«pagata» è vero solo se è proprio true (non una stringa)', () => {
  eq(bot.validateIntent({ azione: 'nuova_spesa', descrizione: 'Cena', importo: 30, pagata: 'true' }, mod).intent.pagata, false);
});
test('timbra: solo entrata/uscita, ora HH:MM valida, data recente e non futura; ore: periodo dell\'elenco', () => {
  eq(bot.validateIntent({ azione: 'timbra', tipo: 'entrata', ora: '07:05', data: '2026-10-10' }, mod, '2026-10-12').intent, { azione: 'timbra', tipo: 'entrata', ora: '07:05', data: '2026-10-10' });
  eq(bot.validateIntent({ azione: 'timbra', tipo: 'uscita', ora: '25:99', data: '2026-10-20' }, mod, '2026-10-12').intent, { azione: 'timbra', tipo: 'uscita', ora: null, data: null }, 'ora e data non valide → null');
  eq(bot.validateIntent({ azione: 'timbra', tipo: 'uscita', data: '2025-01-01' }, mod, '2026-10-12').intent.data, null, 'troppo vecchia');
  ok(!!bot.validateIntent({ azione: 'timbra', tipo: 'cancella' }, mod).error);
  eq(bot.validateIntent({ azione: 'ore', periodo: 'mese', sql: 'x' }, mod).intent, { azione: 'ore', periodo: 'mese' });
  eq(bot.validateIntent({ azione: 'ore', periodo: 'sempre' }, mod).intent.periodo, 'settimana');
});
test('senza moduli di spesa ma con le timbrature la frase è accettata', () => {
  ok(!bot.sanitizeBot({ frase: 'sono entrata', oggi: '2026-10-12', timbrature: true, moduli: [] }).error);
  ok(!!bot.sanitizeBot({ frase: 'sono entrata', oggi: '2026-10-12', moduli: [] }).error);
});
test('elenco: «cosa» deve essere uno dei report del tenant (altrimenti, l\'elenco di partenza)', () => {
  eq(bot.validateIntent({ azione: 'elenco', cosa: 'ore_periodo_1' }, mod, '2026-10-12', ['pagare', 'ore_periodo_1']).intent, { azione: 'elenco', cosa: 'ore_periodo_1' });
  ok(!!bot.validateIntent({ azione: 'elenco', cosa: 'rm_rf' }, mod, '2026-10-12', ['pagare']).error);
  eq(bot.validateIntent({ azione: 'elenco', cosa: 'scadute' }, mod).intent, { azione: 'elenco', cosa: 'scadute' });
  eq(bot.sanitizeBot({ frase: 'cosa devo pagare', oggi: '2026-10-12', moduli: [{ slug: 'a', name: 'A' }], report: [{ id: 'pagare', nome: 'Quanto devo pagare' }, { id: 'NO!', nome: 'x' }] }).payload.report, [{ id: 'pagare', nome: 'Quanto devo pagare' }]);
});
test('risposta non oggetto: errore', () => { ok(!!bot.validateIntent('boh', mod).error); ok(!!bot.validateIntent(null, mod).error); });

console.log(`\n${'='.repeat(60)}\n${passed} passati, ${failed} falliti su ${passed + failed} test.`);
process.exit(failed > 0 ? 1 : 0);
