'use strict';
// La guida d'uso: i testi che i pacchetti di verticale attivi portano con sé (parte `guida`: introduzione, passi per ruolo, un capitolo per modulo, flussi, glossario).
// Qui solo i testi, uniti tra i pacchetti attivi; elenco di campi, passaggi e documenti di un modulo li ricava la scheda dagli schemi (sempre allineati). Nessun nome di settore.
const express = require('express');
const { requireAuth } = require('./auth');
const db = require('../db');
const seeds = require('../seed-blocchi-verticale');

const router = express.Router();

// Un passo del giro guidato: `pagina` (una pagina dell'app o lo slug di un modulo), `titolo` e `testo` sono obbligatori; `target` (cosa evidenziare)
// se manca è la voce di menu della pagina; `ruoli` (facoltativo) limita il passo a quei ruoli.
const passoValido = (p) => p && typeof p.pagina === 'string' && p.pagina && typeof p.titolo === 'string' && p.titolo && typeof p.testo === 'string' && p.testo;

function unisci(pacchetti) {
  const out = { introduzione: null, per_ruolo: {}, capitoli: {}, flussi: [], glossario: [], giro: [] };
  for (const slug of pacchetti) {
    const g = seeds.leggiPacchetto(slug).guida || {};
    if (!out.introduzione && g.introduzione) out.introduzione = g.introduzione;
    for (const [k, v] of Object.entries(g.per_ruolo || {})) if (!k.startsWith('_') && !out.per_ruolo[k]) out.per_ruolo[k] = v;
    for (const [k, v] of Object.entries(g.capitoli || {})) if (!k.startsWith('_') && !out.capitoli[k]) out.capitoli[k] = v;
    if (Array.isArray(g.flussi)) out.flussi.push(...g.flussi);
    if (Array.isArray(g.glossario)) out.glossario.push(...g.glossario);
    if (Array.isArray(g.giro)) out.giro.push(...g.giro.filter(passoValido));
  }
  return out;
}

router.get('/', requireAuth, (req, res) => {
  const g = unisci(seeds.pacchettiAttivi());
  const vuota = !g.introduzione && !Object.keys(g.capitoli).length && !g.flussi.length && !g.glossario.length && !g.giro.length;
  res.json({ presente: !vuota, ...g });
});

// Il giro guidato di chi guarda: i passi per il suo ruolo e se partire da solo (mai visto, e niente Primi passi davanti). Parte anche a richiesta dalla Guida.
//   GET  /api/guida/giro        { passi: [{ pagina, target?, titolo, testo }], mostra }
//   POST /api/guida/giro/visto  segna il giro come visto (concluso o saltato): non riparte da solo
router.get('/giro', requireAuth, (req, res) => {
  const passi = unisci(seeds.pacchettiAttivi()).giro.filter((p) => !Array.isArray(p.ruoli) || !p.ruoli.length || p.ruoli.includes(req.user.role));
  const riga = db.prepare('SELECT giro_visto_at FROM users WHERE id = ?').get(req.user.id) || {};
  const primiPassi = req.user.role === 'admin' && require('./setup-wizard').daMostrare();
  res.json({ passi, mostra: passi.length > 0 && !riga.giro_visto_at && !primiPassi });
});
router.post('/giro/visto', requireAuth, (req, res) => {
  db.prepare("UPDATE users SET giro_visto_at = CURRENT_TIMESTAMP WHERE id = ?").run(req.user.id);
  res.json({ ok: true });
});

module.exports = router;
module.exports.unisci = unisci;
