const express = require('express');
const db = require('../db');
const { requireAuth } = require('./auth');

const router = express.Router();

// PLATFORM-UI-REDESIGN-CATALOG.md #10 — feedback 👍👎 per argomento della
// Guida. topic_key è uno slug stabile calcolato lato frontend da
// sezione+titolo (gli argomenti vivono in un file JS statico, non in una
// tabella con un id proprio) — nessuno scoping per partner/Core: la Guida è
// la stessa per tutti, il feedback è aggregato indipendentemente da chi vota.
router.get('/feedback/:topicKey', requireAuth, (req, res) => {
  const row = db.prepare(`
    SELECT
      SUM(CASE WHEN useful = 1 THEN 1 ELSE 0 END) as useful,
      SUM(CASE WHEN useful = 0 THEN 1 ELSE 0 END) as not_useful
    FROM guide_feedback WHERE topic_key = ?
  `).get(req.params.topicKey);
  res.json({ useful: row.useful || 0, not_useful: row.not_useful || 0 });
});

router.post('/feedback', requireAuth, (req, res) => {
  const { topic_key, useful } = req.body;
  if (!topic_key || (useful !== true && useful !== false)) return res.status(400).json({ error: 'topic_key e useful (booleano) obbligatori' });
  db.prepare('INSERT INTO guide_feedback (topic_key, useful) VALUES (?, ?)').run(topic_key, useful ? 1 : 0);
  res.json({ ok: true });
});

module.exports = router;
