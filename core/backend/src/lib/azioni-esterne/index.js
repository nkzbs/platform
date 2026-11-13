'use strict';
// Le AZIONI ESTERNE: un blocco `external_action` nello schema di un modulo è un pulsante sul record che chiama un servizio esterno (un connettore con credenziali
// sigillate) e scrive l'esito sul record. Il blocco dice QUALE adattatore usare e come i campi del modulo si collegano all'adattatore; il codice dell'adattatore
// non conosce nomi di moduli. Gli adattatori sono un elenco chiuso (core + plugin) (un blocco non può caricare codice a piacere).
const ADATTATORI = {
  verifica_persona: () => require('./verifica_persona'),
  credit_score_societa: () => require('./credit_score_societa'),
  messaggio_cliente: () => require('./messaggio_cliente'),
  firma_elettronica: () => require('./firma_elettronica'),
  fattura_elettronica: () => require('./fattura_elettronica'),
  da_attivare: () => require('./da_attivare'), // segnaposto per funzioni previste ma non ancora collegate al servizio esterno
};
// Oltre a quelli del core, gli adattatori dei plugin attivi per questo tenant (plugins/index.js).
const tutti = () => ({ ...ADATTATORI, ...require('../../plugins').adattatori() });
const adattatore = (nome) => { const t = tutti(); return Object.prototype.hasOwnProperty.call(t, nome) ? t[nome]() : null; };
module.exports = { adattatore, nomiAdattatori: () => Object.keys(tutti()) };
