'use strict';
// Il «dizionario» del bot Telegram: i modi di dire, le regole di disambiguazione e gli esempi (frase → azione) che si aggiungono alle istruzioni date al modello che traduce le frasi libere
// (lib/ai-bot.js). Sono DATI (bot-dizionario.json), non codice: per far capire una frase in più si aggiunge una riga lì. Gli esempi usano segnaposto per le date ({oggi}, {ieri},
// {domani}, {anno}) calcolati a ogni richiesta dalla data di oggi, così un esempio non insegna mai una data sbagliata; e ogni esempio deve essere un'azione VALIDA per
// le stesse regole del bot (shared/ai-bot-intent.js): lo controlla il test. Il modello riceve solo la forma, mai valori da copiare.
const DIZIONARIO = require('./bot-dizionario.json');

const giorno = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// Sostituisce i segnaposto delle date in un valore (stringa) con le date vere, calcolate da `oggi`.
function risolvi(testo, oggi) {
  return String(testo)
    .replace(/\{oggi\}/g, oggi).replace(/\{ieri\}/g, giorno(oggi, -1)).replace(/\{altroieri\}/g, giorno(oggi, -2))
    .replace(/\{domani\}/g, giorno(oggi, 1)).replace(/\{anno\}/g, oggi.slice(0, 4));
}
const risolviIntento = (intento, oggi) => JSON.parse(risolvi(JSON.stringify(intento), oggi));

// Gli esempi con le date risolte: [{ frase, intento }].
const esempi = (oggi) => DIZIONARIO.esempi.map((e) => ({ frase: e.frase, intento: risolviIntento(e.intento, oggi) }));

// La parte di istruzioni da aggiungere dopo quelle di base.
function sezione(oggi) {
  const modi = Object.entries(DIZIONARIO.modi).map(([azione, frasi]) => '- ' + azione + ': ' + frasi.map((f) => '«' + f + '»').join(', ')).join('\n');
  const es = esempi(oggi).map((e) => '«' + e.frase + '» → ' + JSON.stringify(e.intento)).join('\n');
  return '\n\nRegole in più per capire meglio:\n' + DIZIONARIO.regole.map((r) => '- ' + r).join('\n')
    + '\n\nModi di dire per ogni azione (non sono tutti: capisci anche i simili):\n' + modi
    + '\n\nEsempi (oggi è ' + oggi + '). Mostrano solo la forma: usa sempre i valori della frase vera, mai quelli degli esempi. Modulo e categoria restano null se la frase non li dice con chiarezza:\n' + es;
}

module.exports = { DIZIONARIO, esempi, sezione, risolvi };
