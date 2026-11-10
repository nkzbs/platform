'use strict';
// Le AZIONI ESTERNE: un blocco `external_action` nello schema di un modulo è un pulsante sul record che chiama un servizio esterno (un connettore con credenziali
// sigillate) e scrive l'esito sul record. Il blocco dice QUALE adattatore usare e come i campi del modulo si collegano all'adattatore; il codice dell'adattatore
// non conosce nomi di moduli. Gli adattatori sono un elenco chiuso (un blocco non può caricare codice a piacere).
const ADATTATORI = {
  valutazione_immobiliare: () => require('./valutazione_immobiliare'),
  verifica_persona: () => require('./verifica_persona'),
  credit_score_societa: () => require('./credit_score_societa'),
  controllo_catastale: () => require('./controllo_catastale'),
  messaggio_cliente: () => require('./messaggio_cliente'),
  firma_elettronica: () => require('./firma_elettronica'),
  fattura_elettronica: () => require('./fattura_elettronica'),
  da_attivare: () => require('./da_attivare'), // segnaposto per funzioni previste ma non ancora collegate al servizio esterno
};
const adattatore = (nome) => (Object.prototype.hasOwnProperty.call(ADATTATORI, nome) ? ADATTATORI[nome]() : null);
module.exports = { adattatore, nomiAdattatori: () => Object.keys(ADATTATORI) };
