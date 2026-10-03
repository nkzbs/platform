'use strict';
const express = require('express');
const { requireAuth, requireAdmin } = require('./auth');
const roles = require('../module-roles');
const { logAudit } = require('../audit-log');
const db = require('../db');

const router = express.Router();

router.get('/', requireAuth, requireAdmin, (req, res) => {
  res.json(roles.list());
});

router.get('/:slug', requireAuth, requireAdmin, (req, res) => {
  res.json(roles.get(req.params.slug) || { module_slug: req.params.slug, kind: null, uses: [], roles: {} });
});

router.put('/:slug', requireAuth, requireAdmin, (req, res) => {
  if (!db.prepare('SELECT 1 FROM modules WHERE slug = ?').get(req.params.slug)) return res.status(404).json({ error: 'Modulo non trovato' });
  const out = roles.set(req.params.slug, req.body || {});
  logAudit(req.user.username, 'module.roles', req.params.slug, { kind: out.kind, uses: out.uses });
  res.json(out);
});

module.exports = router;
