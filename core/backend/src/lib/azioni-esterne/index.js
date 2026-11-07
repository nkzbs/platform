'use strict';
// Le AZIONI ESTERNE: un blocco `external_action` nello schema di un modulo è un pulsante sul record che chiama un servizio esterno (un connettore con credenziali
// sigillate) e scrive l'esito sul record. Il blocco dice QUALE adattatore usare e come i campi del modulo si collegano all'adattatore; il codice dell'adattatore
// non conosce nomi di moduli. Gli adattatori sono un elenco chiuso (un blocco non può caricare codice a piacere).
const ADATTATORI = {
  valutazione_immobiliare: () => require('./valutazione_immobiliare'),
};
const adattatore = (nome) => (Object.prototype.hasOwnProperty.call(ADATTATORI, nome) ? ADATTATORI[nome]() : null);
module.exports = { adattatore, nomiAdattatori: () => Object.keys(ADATTATORI) };
