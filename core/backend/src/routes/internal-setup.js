'use strict';
// Impostazione iniziale di un tenant dall'analisi dei processi (Super Admin → Analisi → Crea il tenant). Solo con il secret interno (rete Docker), mai dal browser.
// POST /api/internal-setup/apply  { module_roles?: [{ slug, kind, uses, roles, avvisi, riepiloghi, estratto }], ai?: [{ slug, features }], reports?: [{ tipo, nome, params }], features?: { chiave: true } }
// Regola unica: si COMPLETA, non si sovrascrive. Un modulo che ha già la sua dichiarazione dei ruoli o i suoi potenziamenti AI non si tocca; i report nascono SPENTI; le funzioni si accendono, mai si spengono.
const express = require('express');
const db = require('../db');
const moduleRoles = require('../module-roles');
const moduleAi = require('../module-ai');
const reports = require('../reports');
const features = require('../features');
const { logAudit } = require('../audit-log');

const router = express.Router();
router.use((req, res, next) => {
  const secret = req.headers['x-internal-secret'];
  if (!secret || secret !== (process.env.INTERNAL_API_SECRET || 'changeme_internal')) return res.status(401).json({ error: 'Secret interno non valido' });
  next();
});

router.post('/apply', (req, res) => {
  const b = req.body || {}, out = { module_roles: [], ai: [], reports: [], features: [], saltati: [] };
  const installed = (slug) => !!db.prepare('SELECT 1 FROM modules WHERE slug = ? AND installed = 1').get(slug);

  for (const m of (Array.isArray(b.module_roles) ? b.module_roles : []).slice(0, 80)) {
    if (!m || !installed(m.slug)) { out.saltati.push('ruoli: ' + (m && m.slug) + ' non installato'); continue; }
    if (moduleRoles.get(m.slug)) { out.saltati.push('ruoli: ' + m.slug + ' ha già la sua dichiarazione'); continue; }
    moduleRoles.set(m.slug, m); out.module_roles.push(m.slug);
  }
  for (const a of (Array.isArray(b.ai) ? b.ai : []).slice(0, 80)) {
    if (!a || !installed(a.slug)) continue;
    if (moduleAi.get(a.slug).length) { out.saltati.push('ai: ' + a.slug + ' ha già i suoi potenziamenti'); continue; }
    out.ai.push({ slug: a.slug, features: moduleAi.set(a.slug, a.features) }); // restano inattivi finché l'interruttore generale dell'AI è spento
  }
  const accendi = { ...(b.features && typeof b.features === 'object' ? b.features : {}) };
  if (Array.isArray(b.reports) && b.reports.length) accendi.riepilogo_mattino = true;
  if (out.module_roles.some((s) => ['spesa', 'entrata'].includes((moduleRoles.get(s) || {}).kind))) accendi.analisi = true;
  for (const k of Object.keys(accendi)) if (accendi[k] === true && features.set(k, true)) out.features.push(k);
  for (const r of (Array.isArray(b.reports) ? b.reports : []).slice(0, 20)) {
    const created = reports.addDefinition(r && r.tipo, r && r.nome);
    if (created.error) { out.saltati.push('report: ' + created.error); continue; }
    const { enabled, ...params } = (r && r.params) || {}; // nascono spenti: si accendono dall'app
    const upd = Object.keys(params).length ? reports.saveSettings(created.id, params) : {};
    if (upd.error) out.saltati.push('report ' + created.id + ': ' + upd.error);
    out.reports.push(created.id);
  }
  logAudit('analisi', 'tenant.setup_da_analisi', null, { ruoli: out.module_roles.length, ai: out.ai.length, report: out.reports.length });
  res.json(out);
});

module.exports = router;
