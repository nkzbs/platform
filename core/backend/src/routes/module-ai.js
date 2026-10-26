'use strict';
const express = require('express');
const { requireAuth, requireAdmin, requireModuleAccess } = require('./auth');
const moduleAi = require('../module-ai');
const { logAudit } = require('../audit-log');
const db = require('../db');

const router = express.Router();

// Quali potenziamenti sono accesi su un modulo, per chiunque sia collegato (serve alle pagine per mostrare i pulsanti giusti).
router.get('/:slug/enabled', requireAuth, requireModuleAccess, (req, res) => {
  res.json({ features: moduleAi.KEYS.filter((k) => moduleAi.can(req.params.slug, k)) });
});

// Elenco dei potenziamenti, con quelli accesi sul modulo e i ruoli che mancano a ciascuno.
router.get('/:slug', requireAuth, requireAdmin, (req, res) => {
  const on = moduleAi.get(req.params.slug);
  res.json(moduleAi.KEYS.map((k) => ({ key: k, label: moduleAi.FEATURES[k].label, description: moduleAi.FEATURES[k].description, enabled: on.includes(k), missing_roles: moduleAi.missing(req.params.slug, k) })));
});

router.put('/:slug', requireAuth, requireAdmin, (req, res) => {
  if (!db.prepare('SELECT 1 FROM modules WHERE slug = ?').get(req.params.slug)) return res.status(404).json({ error: 'Modulo non trovato' });
  const on = moduleAi.set(req.params.slug, req.body && req.body.features);
  logAudit(req.user.username, 'module.ai', req.params.slug, { features: on });
  res.json({ module_slug: req.params.slug, features: on });
});

module.exports = router;
