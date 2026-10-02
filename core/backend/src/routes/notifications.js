const express = require('express');
const db = require('../db');
const { requireAuth } = require('./auth');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM notifications ORDER BY created_at DESC LIMIT 50').all();
  // Stesso filtro già in uso per dashboard_widgets.roles: [] o assente = visibile
  // a tutti (comportamento invariato per ogni notifica esistente, mai valorizzato
  // finora), un ruolo elencato = visibile solo a chi ce l'ha. Admin vede sempre
  // tutto, come lì.
  const visible = rows
    .map((r) => { let roles = []; try { roles = JSON.parse(r.roles || '[]'); } catch (e) { roles = []; } return { ...r, roles }; })
    .filter((r) => req.user.role === 'admin' || r.roles.length === 0 || r.roles.includes(req.user.role));
  res.json(visible);
});

router.post('/:id/read', requireAuth, (req, res) => {
  db.prepare('UPDATE notifications SET read = 1 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.post('/read-all', requireAuth, (req, res) => {
  db.prepare('UPDATE notifications SET read = 1 WHERE read = 0').run();
  res.json({ ok: true });
});

router.delete('/', requireAuth, (req, res) => {
  db.prepare('DELETE FROM notifications WHERE read = 1').run();
  res.json({ ok: true });
});

module.exports = router;
