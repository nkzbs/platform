'use strict';
// Il dizionario del bot (lib/bot-dizionario.json + lib/bot-dizionario.js): ogni esempio è un'azione VALIDA per le regole del bot, ogni azione ha modi di dire ed esempi, nessuna frase
// vale due azioni, le date si calcolano da «oggi», e le istruzioni non si gonfiano. Eseguire con: node src/bot-dizionario.test.js

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; }
}
const eq = (a, e, msg) => { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${msg || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); };
const ok = (c, msg) => { if (!c) throw new Error(msg || 'atteso true'); };

const bot = require('./lib/ai-bot');
const diz = require('./lib/bot-dizionario');
const { AZIONI, validateIntent } = require('../../../shared/ai-bot-intent.js');

const OGGI = '2026-11-25';
const MODULI = [{ slug: 'spese', name: 'Spese', etichetta: 'spese', categorie: ['Auto', 'Casa'] }];
const ENTRATA = [{ slug: 'entrate', name: 'Entrate', categorie: ['Stipendio'], gruppi: ['Casa'] }];
const REPORT = ['pagare', 'scadute', 'smistare'];

console.log('\n--- gli esempi sono azioni valide ---');
test('ogni esempio, con le date calcolate da «oggi», passa la validazione del bot e dà la stessa azione scritta nell\'esempio', () => {
  for (const e of diz.esempi(OGGI)) {
    const v = validateIntent(e.intento, MODULI, OGGI, REPORT, ENTRATA);
    ok(v.intent, 'esempio non valido: «' + e.frase + '» → ' + (v.error || '?'));
    eq(v.intent.azione, e.intento.azione, 'l\'azione cambia nella validazione per «' + e.frase + '»');
  }
});
test('i valori degli esempi non cambiano nella validazione (importi, orari, date, rate): l\'esempio mostra proprio ciò che il bot accetta', () => {
  for (const e of diz.esempi(OGGI)) {
    const v = validateIntent(e.intento, MODULI, OGGI, REPORT, ENTRATA).intent;
    for (const k of ['importo', 'ora', 'ora_fine', 'data', 'n_rate', 'cerca', 'tipo', 'periodo', 'campo', 'pagata']) {
      if (k in e.intento) eq(v[k], e.intento[k], 'campo «' + k + '» di «' + e.frase + '»');
    }
  }
});

console.log('\n--- copertura e coerenza ---');
test('ogni azione ha i suoi modi di dire; ogni azione tranne «elenco» ha almeno un esempio (l\'elenco dipende dai report del tenant)', () => {
  const conEsempi = new Set(diz.DIZIONARIO.esempi.map((e) => e.intento.azione));
  for (const a of AZIONI) {
    ok((diz.DIZIONARIO.modi[a] || []).length >= 3, 'pochi modi di dire per «' + a + '»');
    if (a !== 'elenco') ok(conEsempi.has(a), 'nessun esempio per «' + a + '»');
  }
  for (const a of Object.keys(diz.DIZIONARIO.modi)) ok(AZIONI.includes(a), '«' + a + '» non è un\'azione del bot');
});
test('nessuna frase di esempio compare due volte, e nessun modo di dire vale due azioni', () => {
  const viste = new Set();
  for (const e of diz.DIZIONARIO.esempi) { const k = e.frase.toLowerCase(); ok(!viste.has(k), 'frase doppia: «' + e.frase + '»'); viste.add(k); }
  const modi = new Map();
  for (const [azione, frasi] of Object.entries(diz.DIZIONARIO.modi)) {
    for (const f of frasi) {
      const k = f.toLowerCase();
      // «ho pagato» compare sia in nuova_spesa sia in segna_pagata, ma con la specifica tra parentesi: la regola scritta decide
      if (modi.has(k) && modi.get(k) !== azione) throw new Error('«' + f + '» è in «' + modi.get(k) + '» e in «' + azione + '»');
      modi.set(k, azione);
    }
  }
});
test('niente dati personali nel dizionario: nessun indirizzo email, numero lungo o IBAN', () => {
  const testo = JSON.stringify(diz.DIZIONARIO);
  ok(!/[\w.]+@[\w.]+\.\w+/.test(testo), 'un indirizzo email');
  ok(!/\b[A-Z]{2}\d{2}[A-Z0-9]{10,}\b/.test(testo), 'un IBAN');
  ok(!/\d{9,}/.test(testo), 'un numero lungo');
});

console.log('\n--- le istruzioni complete ---');
test('le date degli esempi sono calcolate da «oggi»: ieri e domani sono quelli di OGGI, non di un altro giorno', () => {
  const p = bot.promptBot(OGGI);
  ok(p.includes('"data":"2026-11-24"'), 'ieri'); ok(p.includes('"data":"2026-11-26"'), 'domani'); ok(p.includes('"periodo":"2026-03"'), 'l\'anno di oggi');
  const altro = bot.promptBot('2027-01-01');
  ok(altro.includes('"data":"2026-12-31"') && altro.includes('"periodo":"2027-03"'), 'a cavallo d\'anno: ieri è il 31/12 e l\'anno è il nuovo');
});
test('nessun segnaposto resta nel testo mandato al modello', () => {
  const p = bot.promptBot(OGGI);
  ok(!/\{(oggi|ieri|altroieri|domani|anno)\}/.test(p), 'segnaposto non sostituito');
});
test('le istruzioni di base restano in testa, intere, e il dizionario si aggiunge dopo', () => {
  const p = bot.promptBot(OGGI);
  ok(p.startsWith(bot.BOT_PROMPT) && p.length > bot.BOT_PROMPT.length + 2000, 'il dizionario non è stato aggiunto in coda');
  for (const a of AZIONI) ok(p.includes('"azione":"' + a + '"'), 'manca l\'azione ' + a);
});
test('le istruzioni non si gonfiano: sotto i 20.000 caratteri (un modello piccolo si confonde con istruzioni troppo lunghe, e ogni richiesta le paga)', () => {
  const n = bot.promptBot(OGGI).length;
  ok(n < 20000, 'le istruzioni sono lunghe ' + n + ' caratteri');
  console.log('    (lunghezza attuale: ' + n + ' caratteri, di cui ' + (n - bot.BOT_PROMPT.length) + ' di dizionario)');
});
test('senza una data valida usa quella di oggi (non si rompe)', () => {
  ok(bot.promptBot(undefined).includes('Esempi (oggi è '), 'senza data');
  ok(bot.promptBot('non è una data').includes('Esempi (oggi è '), 'data sbagliata');
});

console.log(`\n${'='.repeat(60)}\n${passed} passati, ${failed} falliti su ${passed + failed} test.`);
process.exit(failed > 0 ? 1 : 0);
