const express = require('express');
const db = require('../db');
const { requireAuth } = require('./auth');

const router = express.Router();

// Log letto in Connessioni (era un gap segnalato negli addendum: "Log automazioni
// nella pagina Integrazioni — non ancora affrontato"). Ora che le automazioni sono
// per-modulo, il log resta l'unico posto GLOBALE utile: vedere di colpo cosa è
// scattato ovunque, senza dover aprire ogni modulo uno per uno.
// Paginazione reale (2026-09-03) — stesso motivo/pattern di audit.js: {rows, total}
// invece di un array nudo, unico chiamante è AuditPage.jsx, aggiornato nello stesso commit.
router.get('/log', requireAuth, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const rows = db.prepare('SELECT * FROM automation_logs ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset);
  const total = db.prepare('SELECT COUNT(*) as n FROM automation_logs').get().n;
  res.json({ rows, total });
});

module.exports = router;
