'use strict';
// Data di pagamento automatica: quando una voce passa a «fatto» (pagata) e il suo campo `data_pagamento` è vuoto, si scrive la data del giorno di pagamento della sua
// competenza: l'ultimo «giorno di pagamento» (module_roles.competenza.giorno, es. il 27) uguale o precedente alla data di competenza, ma mai nel futuro (se la segni pagata
// prima di quel giorno vale oggi). Senza giorno dichiarato, o senza data di competenza, vale oggi. Prima la data
// si scriveva solo da «Smista» (già pagata) e dal bot: cambiando lo stato a mano restava vuota, e il pagato dell'anno non si poteva calcolare.
// Vale SOLO da ora e SOLO nel passaggio di stato: una riga creata già pagata, o una già pagata che si modifica, non si tocca (la data non si inventa).
// Lo dichiara il modulo: ruolo `data_pagamento` e stato «fatto» negli avvisi (Builder → Ruoli del modulo); nessun nome scritto qui.
const moduleRoles = require('./module-roles');

// L'ultimo giorno `giorno` del mese uguale o precedente a `iso` (AAAA-MM-GG): con giorno 27, 2026-12-01 → 2026-11-27; 2026-11-27 → 2026-11-27; 2026-11-05 → 2026-10-27.
function ultimoGiornoDiPagamento(iso, giorno) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || '')) || !(giorno >= 2 && giorno <= 28)) return null;
  let y = parseInt(iso.slice(0, 4), 10), m = parseInt(iso.slice(5, 7), 10);
  if (parseInt(iso.slice(8, 10), 10) < giorno) { m -= 1; if (m === 0) { m = 12; y -= 1; } }
  return y + '-' + String(m).padStart(2, '0') + '-' + String(giorno).padStart(2, '0');
}

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
  const adesso = oggi(now);
  const giorno = decl.competenza && decl.competenza.giorno;
  const run = decl.roles.data && giorno ? ultimoGiornoDiPagamento(String(dati[decl.roles.data] || '').slice(0, 10), giorno) : null;
  return { ...dati, [campo]: run && run < adesso ? run : adesso };
}

module.exports = { applica, oggi, ultimoGiornoDiPagamento };
