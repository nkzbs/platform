'use strict';
const express = require('express');
const { requireAuth, requireAdmin } = require('./auth');
const features = require('../features');
const { logAudit } = require('../audit-log');

const router = express.Router();

// Elenco delle funzioni con stato, nome e descrizione (per la scheda "Funzioni" delle Impostazioni).
router.get('/', requireAuth, requireAdmin, (req, res) => {
  const st = features.all();
  res.json(features.KEYS.map((k) => ({ key: k, enabled: st[k], label: features.FEATURES[k].label, description: features.FEATURES[k].description })));
});

router.put('/:key', requireAuth, requireAdmin, (req, res) => {
  const on = !!(req.body && req.body.enabled);
  if (!features.set(req.params.key, on)) return res.status(404).json({ error: 'Funzione sconosciuta' });
  logAudit(req.user.username, on ? 'feature.on' : 'feature.off', req.params.key, null);
  res.json({ key: req.params.key, enabled: on });
});

module.exports = router;
