'use strict';
// Gli stili grafici dell'app scelti in Impostazioni → Aspetto (`tenant_settings.stile_app`). Vuoto = «Classico» (com'è sempre stata). Gli altri sono varianti «Bento»:
// riquadri morbidi con un colore fisso per tipo di componente, sempre in chiaro e in scuro. I colori stanno nel CSS del frontend (index.css, [data-stile]); qui solo l'elenco ammesso.
// Aggiungere uno stile è aggiungere una voce qui e un blocco in index.css.
const STILI = {
  bento_pastello: { etichetta: 'Bento pastello' },
  bento_vetro: { etichetta: 'Bento vetro' },
};
const valida = (chiave) => (chiave === null || chiave === undefined || chiave === '' ? null : (Object.prototype.hasOwnProperty.call(STILI, chiave) ? chiave : undefined));
module.exports = { STILI, valida };
