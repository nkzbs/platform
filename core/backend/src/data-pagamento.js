'use strict';
// Data di pagamento automatica: quando una voce passa a «fatto» (pagata) e il suo campo `data_pagamento` è vuoto, si scrive la data di oggi. Prima la data
// si scriveva solo da «Smista» (già pagata) e dal bot: cambiando lo stato a mano restava vuota, e il pagato dell'anno non si poteva calcolare.
// Vale SOLO da ora e SOLO nel passaggio di stato: una riga creata già pagata, o una già pagata che si modifica, non si tocca (la data non si inventa).
// Lo dichiara il modulo: ruolo `data_pagamento` e stato «fatto» negli avvisi (Builder → Ruoli del modulo); nessun nome scritto qui.
const moduleRoles = require('./module-roles');

const oggi = (now = new Date()) => { const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now); return p; };

// Ritorna i dati con la data di pagamento compilata, o gli stessi dati se non c'è niente da fare. `prima` = dati prima della modifica (null alla creazione).
function applica(slug, dati, prima, now = new Date()) {
  if (!prima) return dati;
  const decl = moduleRoles.get(slug);
  if (!decl || !decl.roles || !decl.roles.data_pagamento) return dati;
  const fatto = decl.avvisi && decl.avvisi.states && decl.avvisi.states.fatto;
  if (!fatto) return dati;
  const chiaveStato = decl.roles.stato || '_stato';
  if (dati[chiaveStato] !== fatto || prima[chiaveStato] === fatto) return dati; // non è un passaggio verso «fatto»
  const campo = decl.roles.data_pagamento;
  if (dati[campo]) return dati; // già scritta (a mano, o da Smista)
  return { ...dati, [campo]: oggi(now) };
}

module.exports = { applica, oggi };
