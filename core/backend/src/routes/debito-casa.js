'use strict';
// Stessa risposta già data dal bot ("quanto devo a Federica?"), qui come API —
// per il server MCP (25/10/2026) e per qualunque altro client che non sia Telegram.
const express = require('express');
const { requireAuth } = require('./auth');
const debitoCasa = require('../debito-casa');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  if (!debitoCasa.attivo()) return res.json({ attivo: false });
  const { html } = debitoCasa.rispondi(req.user);
  res.json({ attivo: true, html });
});

module.exports = router;
