'use strict';
// Suggerimenti (funzione facoltativa «suggerimenti», solo admin):
//   GET  /api/suggestions               le osservazioni aperte e quelle ignorate
//   POST /api/suggestions/scan          controlla adesso
//   PATCH /api/suggestions/:id          { status: 'dismissed' | 'open' }   ignora / riapri
//   POST /api/suggestions/:id/propose   chiede all'AI di spiegare e proporre (struttura e conteggi, mai i valori delle righe)
const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('./auth');
const { requireFeature } = require('../features');
const { logAudit } = require('../audit-log');
const moduleAi = require('../module-ai');
const sug = require('../suggestions');
const { parseSchemaNormalized } = require('../schema-v3');
const { signTenantRequest } = require('../lib/tenant-request-token');

const router = express.Router();
router.use(requireAuth, requireAdmin, requireFeature('suggerimenti'));
const SUPER_ADMIN_URL = process.env.SUPER_ADMIN_URL || 'http://super-admin-backend:3000';
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || 'changeme_internal';

router.get('/', (req, res) => res.json({ items: sug.elenco(), ai_accesa: moduleAi.masterOn() }));

router.post('/scan', (req, res) => { const r = sug.scansiona(); logAudit(req.user.username, 'suggerimenti.scan', null, r); res.json({ ...r, items: sug.elenco() }); });

// Controllo «ti manca un modulo?» su richiesta: a differenza di /scan (gratis, locale) questa chiama l'AI, quindi non è automatico ad ogni visita della pagina.
router.post('/gap-scan', async (req, res) => {
  if (!moduleAi.masterOn()) return res.status(400).json({ error: 'L\'AI non è accesa (Impostazioni → AI).', code: 'ai_off' });
  try {
    const r = await require('../module-gap').controlla();
    logAudit(req.user.username, 'suggerimenti.gap_scan', null, r);
    res.json({ ...r, items: sug.elenco() });
  } catch (e) { res.status(e.status || 502).json({ error: e.message || 'L\'AI non è raggiungibile.', code: e.code }); }
});

router.patch('/:id', (req, res) => {
  const st = req.body && req.body.status;
  if (st !== 'dismissed' && st !== 'open') return res.status(400).json({ error: 'Stato non valido' });
  const r = db.prepare("UPDATE suggestions SET status = ? WHERE id = ? AND status IN ('open', 'dismissed')").run(st, req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Suggerimento non trovato' });
  res.json({ ok: true });
});

router.post('/:id/propose', async (req, res) => {
  if (!moduleAi.masterOn()) return res.status(400).json({ error: 'L\'AI non è accesa (Impostazioni → AI).', code: 'ai_off' });
  const s = db.prepare('SELECT * FROM suggestions WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Suggerimento non trovato' });
  const m = db.prepare('SELECT name, schema_json FROM modules WHERE slug = ?').get(s.module_slug);
  if (!m) return res.status(404).json({ error: 'Il modulo non c\'è più.' });
  let schema; try { schema = parseSchemaNormalized(m.schema_json); } catch (e) { return res.status(400).json({ error: 'Lo schema del modulo non si legge.' }); }
  const payload = {
    regola: s.rule_key, modulo: m.name, titolo: s.title, numeri: JSON.parse(s.data || '{}'), target: s.target,
    campi: (schema.fields || []).slice(0, 40).map((f) => ({ key: f.key, label: f.label || f.key, type: f.type })),
    stati: ((schema.workflow && schema.workflow.states) || []).map((x) => ({ key: x.key, label: x.label || x.key })),
  };
  try {
    const r = await fetch(SUPER_ADMIN_URL + '/api/tenant-ai/suggestion', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET, 'Authorization': 'Bearer ' + signTenantRequest('tenant-ai') }, signal: AbortSignal.timeout(45000), body: JSON.stringify({ tenant_slug: process.env.TENANT_SLUG, data: payload }) });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(r.status === 429 ? 429 : r.status === 503 ? 503 : 502).json({ error: body.error || 'L\'AI non è disponibile in questo momento.', code: body.code });
    db.prepare('UPDATE suggestions SET ai = ? WHERE id = ?').run(JSON.stringify(body.proposta), s.id);
    logAudit(req.user.username, 'suggerimenti.proponi', s.module_slug, { regola: s.rule_key });
    res.json({ proposta: body.proposta });
  } catch (e) { res.status(502).json({ error: 'L\'AI non è raggiungibile.' }); }
});

module.exports = router;
