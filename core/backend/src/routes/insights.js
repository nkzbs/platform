'use strict';
const express = require('express');
const { requireAuth, requireAdmin } = require('./auth');
const insights = require('../insights');
const moduleAi = require('../module-ai');
const { logAudit } = require('../audit-log');

const { requireFeature } = require('../features');

const router = express.Router();
router.use(requireAuth, requireFeature('analisi')); // prima l'accesso (401), poi la funzione (403)
const db = require('../db');

// Il widget da cui arriva la richiesta (?widget=ID o "widget" nel corpo): decide la vista (moduli e gruppi) e se "Spiega" è acceso.
// Senza widget: la vista generale, e "Spiega" se c'è almeno un widget che lo ha acceso.
function context(id) {
  if (id === undefined || id === null || id === '') return { view: null, explainable: moduleAi.anyExplainableWidget('come_sta_andando') };
  const w = db.prepare("SELECT id, config FROM dashboard_widgets WHERE id = ? AND type = 'come_sta_andando'").get(parseInt(id, 10));
  if (!w) return null;
  return { view: insights.viewFromWidget(w), explainable: moduleAi.widgetExplainable(w) };
}
const validMonth = (m) => m === undefined || /^\d{4}-\d{2}$/.test(String(m));

// I numeri del mese (nessuna AI): sempre disponibili, e con l'eventuale spiegazione già salvata.
const validYear = (y) => y === undefined || /^\d{4}$/.test(String(y));

router.get('/', requireAuth, (req, res) => {
  const ctx = context(req.query.widget);
  if (!ctx) return res.status(404).json({ error: 'Widget non trovato' });
  const { view, explainable } = ctx; // il pulsante "Spiega" c'è solo se il widget lo ha acceso
  if (req.query.period === 'anno') {
    if (!validYear(req.query.year)) return res.status(400).json({ error: 'Anno non valido (atteso AAAA)' });
    const snap = insights.buildYearSnapshot(req.query.year, new Date(), view);
    if (!snap.available || snap.vuoto) return res.json(snap);
    return res.json({ ...snap, explainable, explanation: insights.cachedExplanation(snap.key, snap) });
  }
  if (!validMonth(req.query.month)) return res.status(400).json({ error: 'Mese non valido (atteso AAAA-MM)' });
  const snap = insights.buildSnapshot(req.query.month, new Date(), view);
  if (!snap.available) return res.json(snap);
  res.json({ ...snap, explainable, explanation: insights.cachedExplanation(snap.key, snap) });
});

// "Spiega con l'assistente": usa la spiegazione salvata se i numeri non sono cambiati.
router.post('/explain', requireAuth, async (req, res) => {
  const b = req.body || {};
  const ctx = context(b.widget);
  if (!ctx) return res.status(404).json({ error: 'Widget non trovato' });
  if (!ctx.explainable) return res.status(403).json({ error: 'La spiegazione con l\'AI non è accesa su questo widget', code: 'ai_off' });
  const view = ctx.view;
  if (b.period === 'anno') {
    if (!validYear(b.year)) return res.status(400).json({ error: 'Anno non valido (atteso AAAA)' });
    const ysnap = insights.buildYearSnapshot(b.year, new Date(), view);
    if (!ysnap.available || ysnap.vuoto) return res.status(400).json({ error: ysnap.reason || 'Nessun mese concluso in questo anno.' });
    const yout = await insights.explain(ysnap, { refresh: !!b.refresh });
    if (yout.error) return res.status(yout.status === 429 ? 429 : yout.status === 503 ? 503 : 502).json({ error: yout.error, code: yout.code });
    return res.json({ text: yout.text, cached: yout.cached });
  }
  if (!validMonth(b.month)) return res.status(400).json({ error: 'Mese non valido (atteso AAAA-MM)' });
  const snap = insights.buildSnapshot(b.month, new Date(), view);
  if (!snap.available) return res.status(400).json({ error: snap.reason });
  const out = await insights.explain(snap, { refresh: !!b.refresh });
  if (out.error) return res.status(out.status === 429 ? 429 : out.status === 503 ? 503 : 502).json({ error: out.error, code: out.code });
  res.json({ text: out.text, cached: out.cached });
});

// Anteprima del messaggio mensile di un widget (solo numeri, senza commento dell'AI e senza inviare niente).
router.get('/monitor-preview', requireAuth, requireAdmin, (req, res) => {
  const w = db.prepare("SELECT id, label, config FROM dashboard_widgets WHERE id = ? AND type = 'come_sta_andando'").get(parseInt(req.query.widget, 10));
  if (!w) return res.status(404).json({ error: 'Widget non trovato' });
  const month = validMonth(req.query.month) && req.query.month ? req.query.month : insights.lastClosedMonth();
  const built = require('../monitor').buildText(w, month);
  res.json({ month, text: built ? built.text : null });
});

router.get('/config', requireAuth, requireAdmin, (req, res) => res.json(insights.getConfig()));
router.put('/config', requireAuth, requireAdmin, (req, res) => {
  const cfg = insights.saveConfig(req.body || {});
  logAudit(req.user.username, 'insights.config', null, null);
  res.json(cfg);
});

module.exports = router;
