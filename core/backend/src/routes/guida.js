'use strict';
// La guida d'uso: i testi che i pacchetti di verticale attivi portano con sé (parte `guida`: introduzione, passi per ruolo, un capitolo per modulo, flussi, glossario).
// Qui solo i testi, uniti tra i pacchetti attivi; elenco di campi, passaggi e documenti di un modulo li ricava la scheda dagli schemi (sempre allineati). Nessun nome di settore.
const express = require('express');
const { requireAuth } = require('./auth');
const seeds = require('../seed-blocchi-verticale');

const router = express.Router();

function unisci(pacchetti) {
  const out = { introduzione: null, per_ruolo: {}, capitoli: {}, flussi: [], glossario: [] };
  for (const slug of pacchetti) {
    const g = seeds.leggiPacchetto(slug).guida || {};
    if (!out.introduzione && g.introduzione) out.introduzione = g.introduzione;
    for (const [k, v] of Object.entries(g.per_ruolo || {})) if (!k.startsWith('_') && !out.per_ruolo[k]) out.per_ruolo[k] = v;
    for (const [k, v] of Object.entries(g.capitoli || {})) if (!k.startsWith('_') && !out.capitoli[k]) out.capitoli[k] = v;
    if (Array.isArray(g.flussi)) out.flussi.push(...g.flussi);
    if (Array.isArray(g.glossario)) out.glossario.push(...g.glossario);
  }
  return out;
}

router.get('/', requireAuth, (req, res) => {
  const g = unisci(seeds.pacchettiAttivi());
  const vuota = !g.introduzione && !Object.keys(g.capitoli).length && !g.flussi.length && !g.glossario.length;
  res.json({ presente: !vuota, ...g });
});

module.exports = router;
module.exports.unisci = unisci;
