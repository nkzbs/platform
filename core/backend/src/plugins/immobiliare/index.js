'use strict';
// PLUGIN «immobiliare»: le funzioni che servono solo a chi fa mediazione immobiliare (valutazione di mercato con comparabili/OMI/rischi/servizi vicini e il suo report PDF,
// visura catastale). Stanno fuori dal core: un tenant le ha solo se ha ricevuto uno dei `pacchetti` qui sotto (vedi plugins/index.js). Il core non le conosce per nome:
// chiede al registro dei plugin.
module.exports = {
  id: 'immobiliare',
  nome: 'Mediazione immobiliare',
  pacchetti: ['mediazione-immobiliare'],
  // Adattatori delle azioni esterne (lib/azioni-esterne/): caricati solo quando serve.
  adattatori: {
    valutazione_immobiliare: () => require('./valutazione_immobiliare'),
    controllo_catastale: () => require('./controllo_catastale'),
  },
  // Librerie interne del plugin che altre parti possono chiedere al registro (plugins.libreria('immobiliare', 'servizi-vicini')).
  librerie: {
    'servizi-vicini': () => require('./servizi-vicini'),
    'report-valutazione-pdf': () => require('./report-valutazione-pdf'),
  },
};
