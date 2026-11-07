'use strict';
// Adattatore «segnaposto»: la funzione è prevista (il pulsante c'è, spiega cosa serve) ma il servizio esterno non è ancora attivato o collegato.
// Non chiama nulla e non costa nulla. Quando il servizio sarà attivo si cambia `adapter` del blocco con quello vero (nessun altro cambiamento al modulo).
async function esegui({ config }) {
  const e = new Error('«' + (config.label || 'Questa funzione') + '» è da attivare' + (config.servizio_richiesto ? ': serve ' + config.servizio_richiesto : '') + '.');
  e.status = 501; e.code = 'da_attivare';
  throw e;
}
module.exports = { esegui };
