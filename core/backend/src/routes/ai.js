'use strict';
const express = require('express');
const { requireAuth, requireAdmin } = require('./auth');
const ai = require('../ai-suggestions');
const reportAi = require('../report-ai');
const aiKey = require('../ai-key');
const moduleAi = require('../module-ai');
const { logAudit } = require('../audit-log');

const router = express.Router();

// Stato e interruttore dell'assistente + quanto si è speso nel mese (letto da Super Admin).
router.get('/settings', requireAuth, requireAdmin, async (req, res) => {
  const [budget, key] = await Promise.all([ai.budget(), aiKey.status()]);
  res.json({ report_enabled: reportAi.isEnabled(), budget, key });
});

// Cambia solo gli interruttori presenti nella richiesta.
router.put('/settings', requireAuth, requireAdmin, (req, res) => {
  const body = req.body || {};
  if ('report_enabled' in body) {
    reportAi.setEnabled(!!body.report_enabled);
    logAudit(req.user.username, body.report_enabled ? 'ai.report.on' : 'ai.report.off', null, null);
  }
  res.json({ report_enabled: reportAi.isEnabled() });
});

// "Spiega questo report": riceve i totali già calcolati e mostrati nella pagina (mai righe).
// Funziona solo sui moduli che hanno acceso "Spiegare" (Builder → Potenziamenti AI) e hanno i ruoli richiesti.
router.post('/explain-report', requireAuth, async (req, res) => {
  const b = req.body || {};
  if (!moduleAi.can(String(b.modulo || ''), 'explain')) return res.status(403).json({ error: 'La spiegazione con l\'AI non è accesa su questo modulo', code: 'ai_off' });
  const gruppi = Array.isArray(b.gruppi) ? b.gruppi.slice(0, 12).map((g) => ({
    nome: String((g && g.label) != null ? g.label : (g && g.nome) || '').slice(0, 40),
    valore: g && g.value != null ? g.value : g && g.valore,
    confronto: g && g.confronto != null ? g.confronto : undefined,
  })) : [];
  if (!gruppi.length) return res.status(400).json({ error: 'Nessun dato da spiegare' });
  const out = await reportAi.explain('spiegazione', {
    titolo: String(b.titolo || '').slice(0, 80), periodo: String(b.periodo || '').slice(0, 60),
    metrica: String(b.metrica || '').slice(0, 40), funzione: String(b.funzione || '').slice(0, 20),
    totale: b.totale, totale_confronto: b.totale_confronto, gruppi,
  });
  if (out.error) return res.status(out.status === 429 ? 429 : 502).json({ error: out.error, code: out.code });
  res.json({ text: out.text });
});

// Chiave Mistral di questo tenant. Va a Super Admin, che la controlla con Mistral e la conserva
// cifrata; qui non resta nulla e non viene mai restituita.
router.put('/key', requireAuth, requireAdmin, async (req, res) => {
  const key = String((req.body && req.body.key) || '').trim();
  if (!key) return res.status(400).json({ error: 'Incolla la chiave.' });
  const r = await aiKey.setKey(key);
  if (!r.ok) return res.status(r.status === 400 ? 400 : 502).json({ error: r.data.error || 'Non sono riuscito a salvare la chiave.' });
  logAudit(req.user.username, 'ai.key.set', null, null);
  res.json(r.data);
});

router.delete('/key', requireAuth, requireAdmin, async (req, res) => {
  const r = await aiKey.clearKey();
  if (!r.ok) return res.status(502).json({ error: r.data.error || 'Non sono riuscito a togliere la chiave.' });
  logAudit(req.user.username, 'ai.key.clear', null, null);
  res.json(r.data);
});

// Tutte le proposte in attesa (casa e personali) e le righe ancora da chiedere: per la dashboard.
router.get('/overview', requireAuth, requireAdmin, (req, res) => res.json(ai.overview()));

// Suggerimenti in attesa per un modulo (per il pannello sopra l'elenco).
router.get('/suggestions', requireAuth, (req, res) => {
  const slug = String(req.query.module || '');
  if (!ai.triageModules().includes(slug)) return res.json([]);
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
