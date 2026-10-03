'use strict';
const express = require('express');
const { requireAuth, requireAdmin } = require('./auth');
const insights = require('../insights');
const { logAudit } = require('../audit-log');

const { requireFeature } = require('../features');

const router = express.Router();
router.use(requireAuth, requireFeature('analisi')); // prima l'accesso (401), poi la funzione (403)
const validMonth = (m) => m === undefined || /^\d{4}-\d{2}$/.test(String(m));

// I numeri del mese (nessuna AI): sempre disponibili, e con l'eventuale spiegazione già salvata.
router.get('/', requireAuth, (req, res) => {
  if (!validMonth(req.query.month)) return res.status(400).json({ error: 'Mese non valido (atteso AAAA-MM)' });
  const snap = insights.buildSnapshot(req.query.month);
  if (!snap.available) return res.json(snap);
  res.json({ ...snap, explanation: insights.cachedExplanation(snap.month, snap) });
});

// "Spiega con l'assistente": usa la spiegazione salvata se i numeri non sono cambiati.
router.post('/explain', requireAuth, async (req, res) => {
  const b = req.body || {};
  if (!validMonth(b.month)) return res.status(400).json({ error: 'Mese non valido (atteso AAAA-MM)' });
  const snap = insights.buildSnapshot(b.month);
  if (!snap.available) return res.status(400).json({ error: snap.reason });
  const out = await insights.explain(snap, { refresh: !!b.refresh });
  if (out.error) return res.status(out.status === 429 ? 429 : out.status === 503 ? 503 : 502).json({ error: out.error, code: out.code });
  res.json({ text: out.text, cached: out.cached });
});

router.get('/config', requireAuth, requireAdmin, (req, res) => res.json(insights.getConfig()));
router.put('/config', requireAuth, requireAdmin, (req, res) => {
  const cfg = insights.saveConfig(req.body || {});
  logAudit(req.user.username, 'insights.config', null, null);
  res.json(cfg);
});

module.exports = router;
