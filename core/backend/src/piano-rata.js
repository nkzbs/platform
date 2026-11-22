'use strict';
// Piano a rate creato a mano: se hai indicato l'importo totale e il numero di rate ma non l'importo della rata, lo calcola (come fa «Dividi in rate»
// di Smista). Quali moduli sono piani e quali sono i loro campi lo dichiara chi li usa (Builder → Avvisi → Piano a rate): nessun nome scritto qui.
const moduleRoles = require('./module-roles');

const round2 = (n) => Math.round(n * 100) / 100;
const vuoto = (v) => v === undefined || v === null || v === '' || Number(v) === 0;

// Ritorna i dati con l'importo della rata calcolato, o gli stessi dati se non c'è niente da fare.
function applica(slug, dati) {
  const piano = moduleRoles.list({ use: 'avvisi' }).map((m) => m.avvisi && m.avvisi.piano).find((p) => p && p.modulo === slug);
  if (!piano || !piano.campi || !piano.campi.importo_rata || !piano.campi.importo_totale || !piano.campi.n_rate) return dati;
  const tot = Number(dati[piano.campi.importo_totale]), n = parseInt(dati[piano.campi.n_rate], 10);
  if (!vuoto(dati[piano.campi.importo_rata]) || !(tot > 0) || !(n >= 1)) return dati;
  return { ...dati, [piano.campi.importo_rata]: round2(tot / n) };
}

module.exports = { applica };
