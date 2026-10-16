'use strict';
const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('./auth');
const { logAudit } = require('../audit-log');

const router = express.Router();

const BUILT_IN = ['admin', 'user'];

router.get('/', requireAuth, requireAdmin, (req, res) => {
  const custom = db.prepare('SELECT id, name, label, color FROM roles ORDER BY label').all();
  const all = [
    { name: 'admin', label: 'Admin', color: '#3B82F6', builtin: true },
    { name: 'user', label: 'Utente', color: '#6B7280', builtin: true },
    ...custom.map((r) => ({ ...r, builtin: false })),
  ];
  res.json(all);
});

router.post('/', requireAuth, requireAdmin, (req, res) => {
  const { name, label, color } = req.body;
  if (!name || !label) return res.status(400).json({ error: 'name e label obbligatori' });
  if (BUILT_IN.includes(name)) return res.status(400).json({ error: 'Nome riservato' });
  if (!/^[a-z0-9_]+$/.test(name)) return res.status(400).json({ error: 'name deve contenere solo lettere minuscole, numeri e underscore' });
  try {
    const result = db.prepare('INSERT INTO roles (name, label, color) VALUES (?, ?, ?)').run(name, label, color || '#6B7280');
    const role = db.prepare('SELECT id, name, label, color FROM roles WHERE id = ?').get(result.lastInsertRowid);
    logAudit(req.user.username, 'role.create', name, null);
    res.json(role);
  } catch (e) {
    res.status(400).json({ error: 'Nome ruolo già esistente' });
  }
});

router.delete('/:name', requireAuth, requireAdmin, (req, res) => {
  if (BUILT_IN.includes(req.params.name)) return res.status(400).json({ error: 'I ruoli built-in non possono essere eliminati' });
  const inUse = db.prepare('SELECT COUNT(*) as c FROM users WHERE role = ?').get(req.params.name);
  if (inUse.c > 0) return res.status(400).json({ error: `Ruolo in uso da ${inUse.c} utenti — riassegna prima` });
  db.prepare('DELETE FROM roles WHERE name = ?').run(req.params.name);
  logAudit(req.user.username, 'role.delete', req.params.name, null);
  res.json({ ok: true });
});

module.exports = router;
