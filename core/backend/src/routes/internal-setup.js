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
  require('./setup-wizard').chiudi(); // un tenant nato dall'analisi arriva già con i suoi moduli: niente primi passi
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
  // L'AI: l'interruttore generale nasce SPENTO (manda dati a un servizio esterno). Si accende solo se l'analisi lo dice esplicitamente.
  if (b.ai_master === true && !moduleAi.masterOn()) { moduleAi.setMaster(true); out.ai_master = true; }
  // La Dashboard: i widget dell'analisi, solo se la Dashboard è ancora vuota e il modulo del widget è installato.
  out.dashboard = 0;
  if (Array.isArray(b.dashboard) && !db.prepare("SELECT 1 FROM dashboard_widgets WHERE page = 'dashboard'").get()) {
    const ins = db.prepare("INSERT INTO dashboard_widgets (type, module_slug, field, aggregation, label, color, sort_order, config, roles, user_ids, page) VALUES (?, ?, ?, ?, ?, '#2563EB', ?, ?, '[]', '[]', 'dashboard')");
    const campo = (v) => (typeof v === 'string' && /^[A-Za-z0-9_]{1,60}$/.test(v) ? v : null);
    b.dashboard.slice(0, 30).forEach((w, i) => {
      if (!w || !['kpi', 'table', 'periodo'].includes(w.type) || !installed(w.modulo)) { out.saltati.push('dashboard: widget ' + (i + 1) + ' non valido o modulo non installato'); return; }
      // un widget «periodo» conta o somma le righe la cui data (`config.date_field`) cade nel periodo scelto
      const cfg = w.type === 'periodo' ? { date_field: campo(w.config && w.config.date_field) || '', periodo: ['oggi', 'settimana', 'mese', 'anno', 'tutti'].includes(w.config && w.config.periodo) ? w.config.periodo : 'mese' } : {};
      if (w.type === 'periodo' && !cfg.date_field) { out.saltati.push('dashboard: widget ' + (i + 1) + ' (periodo) senza il campo data'); return; }
      ins.run(w.type, w.modulo, campo(w.campo), ['sum', 'count', 'avg', 'min', 'max'].includes(w.aggregazione) ? w.aggregazione : 'sum', String(w.etichetta || w.modulo).slice(0, 80), i, JSON.stringify(cfg));
      out.dashboard++;
    });
  }
  logAudit('analisi', 'tenant.setup_da_analisi', null, { ruoli: out.module_roles.length, ai: out.ai.length, report: out.reports.length });
  res.json(out);
});

// Applica i blocchi dei seed del verticale (campi, documenti, abbinamenti) ora che i moduli sono installati. Senza questa chiamata un tenant
// appena nato li riceverebbe solo ai riavvii successivi (all'avvio i moduli non c'erano ancora). Idempotente: ripetere non fa danni.
router.post('/seed', async (req, res) => {
  try { await require('../seed-blocchi-verticale').run(); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: 'Seed del verticale non applicati: ' + e.message }); }
});

// Il marchio dell'azienda alla nascita del tenant (da Analisi): ragione sociale, indirizzo, P.IVA, logo, colore. Regola di questo file: si COMPLETA,
// non si sovrascrive: un campo già compilato resta com'è. Logo non valido o colore non valido: quel campo si salta e si dice quale.
router.post('/azienda', (req, res) => {
  const b = req.body || {}, out = { impostati: [], saltati: [] };
  const attuale = db.prepare('SELECT ragione_sociale, indirizzo, piva, logo_url, accent_color FROM tenant_settings WHERE id = 1').get() || {};
  const { logoValido } = require('../lib/azienda');
  const nuovi = {};
  for (const k of ['ragione_sociale', 'indirizzo', 'piva', 'logo_url', 'accent_color']) {
    const v = typeof b[k] === 'string' ? b[k].trim() : '';
    if (!v) continue;
    if (attuale[k]) { out.saltati.push(k + ': già compilato'); continue; }
    if (k === 'logo_url' && !logoValido(v)) { out.saltati.push('logo_url: non valido'); continue; }
    if (k === 'accent_color' && !/^#[0-9a-fA-F]{6}$/.test(v)) { out.saltati.push('accent_color: non valido'); continue; }
    nuovi[k] = v; out.impostati.push(k);
  }
  const chiavi = Object.keys(nuovi);
  if (chiavi.length) {
    db.prepare('UPDATE tenant_settings SET ' + chiavi.map((k) => k + ' = ?').join(', ') + ' WHERE id = 1').run(...chiavi.map((k) => nuovi[k]));
    if (nuovi.accent_color) require('../pwa-icon').apply(); // l'icona dell'app si ricolora subito, come dalle impostazioni
    logAudit('analisi', 'tenant.marchio_da_analisi', null, { campi: chiavi });
  }
  res.json(out);
});

module.exports = router;
