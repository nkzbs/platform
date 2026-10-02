'use strict';
const express = require('express');
const db = require('../db');
const { requireAuth } = require('./auth');

const router = express.Router();

// GET /api/m2m/:source_module/:source_id/:relation_key
router.get('/:source_module/:source_id/:relation_key', requireAuth, (req, res) => {
  const links = db.prepare(
    'SELECT * FROM m2m_links WHERE source_module = ? AND source_id = ? AND relation_key = ?'
  ).all(req.params.source_module, req.params.source_id, req.params.relation_key);
  res.json(links.map((l) => ({ ...l, data: JSON.parse(l.data) })));
});

// POST /api/m2m/:source_module/:source_id/:relation_key
router.post('/:source_module/:source_id/:relation_key', requireAuth, (req, res) => {
  const { target_module, target_id, data } = req.body;
  if (!target_module || !target_id) return res.status(400).json({ error: 'target_module e target_id obbligatori' });
  try {
    const result = db.prepare(
      'INSERT INTO m2m_links (source_module, source_id, relation_key, target_module, target_id, data) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(req.params.source_module, req.params.source_id, req.params.relation_key, target_module, target_id, JSON.stringify(data || {}));
    const link = db.prepare('SELECT * FROM m2m_links WHERE id = ?').get(result.lastInsertRowid);
    res.json({ ...link, data: JSON.parse(link.data) });
  } catch (e) {
    res.status(400).json({ error: 'Link già esistente o dati non validi' });
  }
});

// PUT /api/m2m/:source_module/:source_id/:relation_key/:target_id
router.put('/:source_module/:source_id/:relation_key/:target_id', requireAuth, (req, res) => {
  const link = db.prepare(
    'SELECT * FROM m2m_links WHERE source_module = ? AND source_id = ? AND relation_key = ? AND target_id = ?'
  ).get(req.params.source_module, req.params.source_id, req.params.relation_key, req.params.target_id);
  if (!link) return res.status(404).json({ error: 'Link non trovato' });
  db.prepare('UPDATE m2m_links SET data = ? WHERE id = ?').run(JSON.stringify(req.body.data || {}), link.id);
  const updated = db.prepare('SELECT * FROM m2m_links WHERE id = ?').get(link.id);
  res.json({ ...updated, data: JSON.parse(updated.data) });
});

// DELETE /api/m2m/:source_module/:source_id/:relation_key/:target_id
router.delete('/:source_module/:source_id/:relation_key/:target_id', requireAuth, (req, res) => {
  db.prepare(
    'DELETE FROM m2m_links WHERE source_module = ? AND source_id = ? AND relation_key = ? AND target_id = ?'
  ).run(req.params.source_module, req.params.source_id, req.params.relation_key, req.params.target_id);
  res.json({ ok: true });
});

module.exports = router;
