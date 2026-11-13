'use strict';
// GET /api/geocode?q=<indirizzo>[&paese=it] → { trovato, lat, lon, nome }. Per la mappa nella scheda (blocco `map_view`). Solo utenti collegati; la ricerca vera sta in lib/geocodifica.js. `/servizi`: servizi vicini a un punto (lib/servizi-vicini.js).
const express = require('express');
const { requireAuth } = require('./auth');
const geo = require('../lib/geocodifica');
const plugins = require('../plugins');
const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  if (q.trim().length < 3 || q.length > 200) return res.status(400).json({ error: 'Indirizzo mancante o troppo lungo' });
  const paese = /^[a-z]{2}$/i.test(String(req.query.paese || '')) ? String(req.query.paese).toLowerCase() : '';
  const r = await geo.cerca(q, { paese });
  res.json(r ? { trovato: true, ...r } : { trovato: false });
});

// GET /api/geocode/servizi?lat=..&lon=.. → { disponibile: true, raggio, categorie } se c'è; { in_corso: true } mentre il servizio sta rispondendo (la pagina richiede ogni pochi secondi);
// { disponibile: false } se non risponde. Per l'elenco «Servizi vicini» sotto la mappa.
router.get('/servizi', requireAuth, (req, res) => {
  const servizi = plugins.libreria('immobiliare', 'servizi-vicini');
  if (!servizi) return res.json({ disponibile: false, in_corso: false }); // senza il plugin non c'è l'elenco dei luoghi vicini
  const s = servizi.stato(req.query.lat, req.query.lon);
  if (!s.valido) return res.status(400).json({ error: 'Coordinate non valide' });
  if (s.pronto) return res.json({ disponibile: true, raggio: s.raggio, categorie: s.categorie });
  res.json(s.in_corso ? { disponibile: false, in_corso: true } : { disponibile: false, in_corso: false });
});

module.exports = router;
