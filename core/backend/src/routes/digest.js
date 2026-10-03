'use strict';
const express = require('express');
const { requireAuth, requireAdmin } = require('./auth');
const digest = require('../daily-digest');
const { logAudit } = require('../audit-log');

const { requireFeature } = require('../features');

const router = express.Router();
router.use(requireAuth, requireFeature('riepilogo_mattino')); // prima l'accesso (401), poi la funzione (403)

router.get('/settings', requireAuth, requireAdmin, (req, res) => {
  const s = digest.settings();
  res.json({ enabled: s.enabled, hour: s.hour, last_sent: s.lastSent });
});

router.put('/settings', requireAuth, requireAdmin, (req, res) => {
  const { enabled, hour } = req.body || {};
  const s = digest.saveSettings({ enabled, hour });
  logAudit(req.user.username, s.enabled ? 'digest.on' : 'digest.off', null, { hour: s.hour });
  res.json({ enabled: s.enabled, hour: s.hour, last_sent: s.lastSent });
});

// Anteprima: il messaggio che partirebbe adesso, senza inviare nulla.
router.get('/preview', requireAuth, requireAdmin, (req, res) => {
  const d = digest.buildDigest(new Date());
  res.json(d ? { text: d.text, counts: d.counts } : { text: null, counts: null });
});

// Invia ora (anche con il riepilogo spento): richiesta esplicita di chi la fa.
router.post('/send-now', requireAuth, requireAdmin, async (req, res) => {
  const out = await digest.sendDigest({ actor: req.user.username });
  res.json(out);
});

module.exports = router;
