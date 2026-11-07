'use strict';
// GET /api/geocode?q=<indirizzo>[&paese=it] → { trovato, lat, lon, nome }. Per la mappa nella scheda (blocco `map_view`). Solo utenti collegati; la ricerca vera sta in lib/geocodifica.js.
const express = require('express');
const { requireAuth } = require('./auth');
const geo = require('../lib/geocodifica');
const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  if (q.trim().length < 3 || q.length > 200) return res.status(400).json({ error: 'Indirizzo mancante o troppo lungo' });
  const paese = /^[a-z]{2}$/i.test(String(req.query.paese || '')) ? String(req.query.paese).toLowerCase() : '';
  const r = await geo.cerca(q, { paese });
  res.json(r ? { trovato: true, ...r } : { trovato: false });
});

module.exports = router;
