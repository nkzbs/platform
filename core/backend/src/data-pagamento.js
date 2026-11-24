'use strict';
// Data di pagamento automatica: quando una voce passa a «fatto» (pagata) e il suo campo `data_pagamento` è vuoto, si scrive il giorno di pagamento del mese della sua
// scadenza: il giorno dichiarato dal modulo (module_roles.competenza.giorno, es. il 27) di quel mese, ma mai nel futuro (se la segni pagata prima di quel giorno vale
// oggi). Senza scadenza vale la data della riga; senza giorno dichiarato vale oggi. Scelta dell'utente il 24/11/2026 («una bolletta che scade il 15 novembre: 27 novembre»),
// e coerente con lo storico di Collections (182 scadenze su 193 pagate il 27 del loro mese). Prima la data
// si scriveva solo da «Smista» (già pagata) e dal bot: cambiando lo stato a mano restava vuota, e il pagato dell'anno non si poteva calcolare.
// Vale SOLO da ora e SOLO nel passaggio di stato: una riga creata già pagata, o una già pagata che si modifica, non si tocca (la data non si inventa).
// Lo dichiara il modulo: ruolo `data_pagamento` e stato «fatto» negli avvisi (Builder → Ruoli del modulo); nessun nome scritto qui.
const moduleRoles = require('./module-roles');

// Il giorno `giorno` del mese di `iso` (AAAA-MM-GG): con giorno 27, 2026-11-15 → 2026-11-27; 2026-12-30 → 2026-12-27. Null se la data o il giorno non sono validi.
function giornoDiPagamento(iso, giorno) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || '')) || !(giorno >= 2 && giorno <= 28)) return null;
  return iso.slice(0, 8) + String(giorno).padStart(2, '0');
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
  const base = String(dati[decl.roles.scadenza] || dati[decl.roles.data] || '').slice(0, 10);
  const run = giorno ? giornoDiPagamento(base, giorno) : null;
  return { ...dati, [campo]: run && run < adesso ? run : adesso };
}

module.exports = { applica, oggi, giornoDiPagamento };
