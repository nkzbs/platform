'use strict';
// Competenza di una voce con scadenza: la scadenza dal giorno `giorno` del mese in poi conta nel mese dopo (chi paga il 27: una voce che scade
// il 27 o dopo è del mese successivo). Riepiloghi, checklist e report assegnano il mese leggendo il campo `data` (ruolo `data`): qui si tiene
// quel campo allineato alla scadenza. Lo dichiara il modulo (module_roles.competenza.giorno, 0 = spenta); nessun nome di campo scritto qui.
const moduleRoles = require('./module-roles');

const ISO = /^\d{4}-\d{2}-\d{2}$/;

// La data di competenza per una scadenza: la scadenza stessa, oppure il primo del mese dopo.
function dataDiCompetenza(scadenza, giorno) {
  if (!ISO.test(String(scadenza || '')) || !(giorno >= 2 && giorno <= 28)) return null;
  const y = parseInt(scadenza.slice(0, 4), 10), m = parseInt(scadenza.slice(5, 7), 10), d = parseInt(scadenza.slice(8, 10), 10);
  if (d < giorno) return scadenza;
  const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
  return ny + '-' + String(nm).padStart(2, '0') + '-01';
}

// Ritorna i dati con il campo `data` allineato alla scadenza, o gli stessi dati se non c'è niente da fare.
// `prima` = i dati prima della modifica (null alla creazione). Si ricalcola quando la scadenza è nuova o cambiata; se chi modifica cambia a mano
// anche la data, vince la data scritta a mano.
function applica(slug, dati, prima) {
  const decl = moduleRoles.get(slug);
  if (!decl || !decl.competenza || !decl.competenza.giorno) return dati;
  const R = decl.roles || {};
  if (!R.data || !R.scadenza) return dati;
  const sc = dati[R.scadenza];
  if (!ISO.test(String(sc || ''))) return dati;
  if (prima && prima[R.scadenza] === sc) return dati; // scadenza invariata: la data resta com'è
  if (prima && dati[R.data] !== prima[R.data]) return dati; // data cambiata a mano
  const nuova = dataDiCompetenza(sc, decl.competenza.giorno);
  return nuova ? { ...dati, [R.data]: nuova } : dati;
}

module.exports = { applica, dataDiCompetenza };
