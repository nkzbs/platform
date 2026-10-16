'use strict';
const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('./auth');
const { logAudit } = require('../audit-log');
const { requireInternalSecret } = require('../../../../shared/internal-secret.js');

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

// Fase 12.5 (PLATFORM-MASTER-ROADMAP.md, audit 2026-09-02) — B2b: Super Admin generava
// ruoli reali da un'analisi cliente accettata (nomi/tipi da "ruoli coinvolti", vedi
// ProcessoEditor.jsx) scrivendo direttamente nella tabella roles del tenant. Questa
// rotta la sostituisce — stesso principio di autenticazione di /modules/internal/*.
// Idempotente: un nome già esistente (o built-in) viene saltato, mai un duplicato/errore.
router.post('/internal/sync', requireInternalSecret, (req, res) => {
  const { roles } = req.body || {};
  if (!Array.isArray(roles)) return res.status(400).json({ error: 'roles deve essere un array' });
  const existing = new Set(db.prepare('SELECT name FROM roles').all().map((r) => r.name));
  const insert = db.prepare('INSERT INTO roles (name, label, color) VALUES (?, ?, ?)');
  const created = [];
  roles.forEach((r) => {
    if (!r || !r.slug || !r.label) return;
    if (BUILT_IN.includes(r.slug) || existing.has(r.slug)) return;
    try {
      insert.run(r.slug, r.label, r.color || '#6B7280');
      existing.add(r.slug);
      created.push(r.slug);
    } catch (e) { /* nome duplicato dopo slugify (es. due varianti accentate): ignora, non fatale */ }
  });
  if (created.length > 0) logAudit('platform:provisioning', 'role.sync_from_analysis', created.join(','), null);
  res.json({ created });
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
