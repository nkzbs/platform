'use strict';
const express = require('express');
const { requireAuth, requireAdmin } = require('./auth');
const ai = require('../ai-suggestions');
const { logAudit } = require('../audit-log');

const router = express.Router();

// Stato e interruttore dell'assistente + quanto si è speso nel mese (letto da Super Admin).
router.get('/settings', requireAuth, requireAdmin, async (req, res) => {
  res.json({ bollette_enabled: ai.isEnabled(), budget: await ai.budget() });
});

router.put('/settings', requireAuth, requireAdmin, (req, res) => {
  const on = !!(req.body && req.body.bollette_enabled);
  ai.setEnabled(on);
  logAudit(req.user.username, on ? 'ai.bollette.on' : 'ai.bollette.off', null, null);
  res.json({ bollette_enabled: on });
});

// Suggerimenti in attesa per un modulo (per il pannello sopra l'elenco).
router.get('/suggestions', requireAuth, (req, res) => {
  const slug = String(req.query.module || '');
  if (!ai.BILL_MODULES.includes(slug)) return res.json([]);
  res.json(ai.listPending(slug));
});

// "Chiedi un suggerimento" su un record già esistente (usa solo ciò che il record contiene,
// non il testo della mail originale). Funziona anche con l'assistente spento: è una richiesta
// esplicita di chi la fa.
router.post('/suggest/:module/:id', requireAuth, requireAdmin, async (req, res) => {
  const out = await ai.suggestForRecord({ moduleSlug: req.params.module, recordId: parseInt(req.params.id, 10), force: true });
  if (out.error) return res.status(out.status === 429 ? 429 : 502).json({ error: out.error, code: out.code });
  res.json(out);
});

router.post('/suggestions/:id/accept', requireAuth, requireAdmin, (req, res) => {
  const out = ai.accept(parseInt(req.params.id, 10), req.user.username);
  res.status(out.error ? out.status : 200).json(out);
});

router.post('/suggestions/:id/dismiss', requireAuth, requireAdmin, (req, res) => {
  const out = ai.dismiss(parseInt(req.params.id, 10), req.user.username);
  res.status(out.error ? out.status : 200).json(out);
});

module.exports = router;
