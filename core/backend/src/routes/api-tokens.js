'use strict';
// Token API personali: per un client esterno (es. un server MCP) che agisce come
// un utente vero, senza login/2FA ogni volta. Ogni utente gestisce solo i PROPRI
// token (anche un admin non vede quelli di un altro) — un token vale quanto i
// permessi di chi l'ha creato, niente di più, niente di meno.
//   POST   /api/api-tokens        { label }  -> { id, label, token }  (il token in chiaro, UNA sola volta)
//   GET    /api/api-tokens                   -> elenco (mai il token, solo id/label/date)
//   DELETE /api/api-tokens/:id               -> revoca
const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { requireAuth } = require('./auth');
const { logAudit } = require('../audit-log');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT id, label, created_at, last_used_at, revoked_at FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
  res.json(rows);
});

router.post('/', requireAuth, (req, res) => {
  const label = String((req.body && req.body.label) || '').trim().slice(0, 60);
  if (!label) return res.status(400).json({ error: 'Scrivi un nome per riconoscerlo (es. "MCP sul Mac").' });
  const token = 'plat_' + crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const result = db.prepare('INSERT INTO api_tokens (user_id, label, token_hash) VALUES (?, ?, ?)').run(req.user.id, label, hash);
  logAudit(req.user.username, 'api_token.create', label, null);
  res.json({ id: result.lastInsertRowid, label, token });
});

router.delete('/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM api_tokens WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Token non trovato' });
  db.prepare('UPDATE api_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE id = ?').run(row.id);
  logAudit(req.user.username, 'api_token.revoke', row.label, null);
  res.json({ ok: true });
});

module.exports = router;
