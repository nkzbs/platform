'use strict';
// Analisi dei processi (Super Admin → Analisi): racconti un'attività, l'AI propone i processi, li rifinisci, vedi cosa copre la Libreria,
// salvi il manuale e — se vuoi — crei il tenant con i moduli e i ruoli che ne derivano.
//   GET    /api/analyses                  elenco
//   POST   /api/analyses                  { name, descrizione }
//   GET    /api/analyses/:id              l'analisi con i processi e il blueprint
//   PATCH  /api/analyses/:id              { name?, descrizione?, profilo?, processi? }
//   DELETE /api/analyses/:id
//   POST   /api/analyses/suggest-processi { descrizione }       proposte (mai salvate da sole)
//   POST   /api/analyses/suggest-processo { nome, reparto? }    un processo completo proposto
//   GET    /api/analyses/library          i moduli della Libreria (per scegliere a mano il modulo di un processo)
//   POST   /api/analyses/:id/create-tenant { name, slug, domain? }   crea il tenant, installa i moduli, genera ruoli e stati
const express = require('express');
const db = require('../db');
const { requireAuth } = require('./auth');
const { logAudit } = require('../audit-log');
const analysis = require('../lib/analysis');
const { applyAnalysisConfigToTenant } = require('../lib/tenant-config-from-analysis');

const router = express.Router();
const row = (id) => db.prepare('SELECT * FROM process_analyses WHERE id = ?').get(id);
const json = (s, d) => { try { return JSON.parse(s); } catch (e) { return d; } };
function full(r) {
  const processi = json(r.processi, []);
  return { id: r.id, name: r.name, descrizione: r.descrizione, profilo: json(r.profilo, {}), processi, tenant_slug: r.tenant_slug, created_at: r.created_at, updated_at: r.updated_at, blueprint: analysis.blueprint(processi) };
}
const aiError = (res, e) => res.status(e.status || 500).json({ error: e.message, code: e.code });

router.get('/', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM process_analyses ORDER BY updated_at DESC').all().map((r) => {
    const processi = json(r.processi, []);
    return { id: r.id, name: r.name, tenant_slug: r.tenant_slug, n_processi: processi.length, n_da_costruire: processi.filter((p) => p.copertura === 'da_costruire').length, updated_at: r.updated_at };
  }));
});

router.get('/library', requireAuth, (req, res) => res.json(analysis.libraryModules()));

router.post('/suggest-processi', requireAuth, async (req, res) => {
  const descrizione = String((req.body && req.body.descrizione) || '').trim();
  if (descrizione.length < 10) return res.status(400).json({ error: 'Racconta l\'attività in qualche riga.' });
  try {
    const processi = await analysis.suggestProcessi({ descrizione });
    logAudit(req.user.username, 'analysis.suggest_processi', null, { n: processi.length });
    res.json({ processi });
  } catch (e) { aiError(res, e); }
});

router.post('/suggest-processo', requireAuth, async (req, res) => {
  const nome = String((req.body && req.body.nome) || '').trim();
  if (!nome) return res.status(400).json({ error: 'Scrivi il nome del processo.' });
  try {
    const suggestion = await analysis.suggestProcesso({ nome, reparto: req.body.reparto });
    logAudit(req.user.username, 'analysis.suggest_processo', nome.slice(0, 60), { registry_module_id: suggestion.registry_module_id });
    res.json(suggestion);
  } catch (e) { aiError(res, e); }
});

router.post('/', requireAuth, (req, res) => {
  const name = String((req.body && req.body.name) || '').trim().slice(0, 80);
  if (!name) return res.status(400).json({ error: 'Dai un nome all\'analisi.' });
  const descrizione = String((req.body && req.body.descrizione) || '').slice(0, 4000);
  const id = db.prepare('INSERT INTO process_analyses (name, descrizione, created_by) VALUES (?, ?, ?)').run(name, descrizione, req.user.username).lastInsertRowid;
  logAudit(req.user.username, 'analysis.create', String(id), { name });
  res.json(full(row(id)));
});

router.get('/:id', requireAuth, (req, res) => {
  const r = row(req.params.id); if (!r) return res.status(404).json({ error: 'Analisi non trovata' });
  res.json(full(r));
});

router.patch('/:id', requireAuth, (req, res) => {
  const r = row(req.params.id); if (!r) return res.status(404).json({ error: 'Analisi non trovata' });
  const b = req.body || {}, sets = [], args = [];
  if (b.name != null) { const n = String(b.name).trim().slice(0, 80); if (!n) return res.status(400).json({ error: 'Il nome non può essere vuoto.' }); sets.push('name = ?'); args.push(n); }
  if (b.descrizione != null) { sets.push('descrizione = ?'); args.push(String(b.descrizione).slice(0, 4000)); }
  if (b.profilo != null) { sets.push('profilo = ?'); args.push(JSON.stringify(analysis.sanitizeProfilo(b.profilo))); }
  if (b.processi != null) {
    const valid = new Set(analysis.libraryModules().map((m) => m.id));
    sets.push('processi = ?'); args.push(JSON.stringify(analysis.sanitizeProcessi(b.processi, valid)));
  }
  if (sets.length) db.prepare('UPDATE process_analyses SET ' + sets.join(', ') + ', updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(...args, r.id);
  res.json(full(row(r.id)));
});

router.delete('/:id', requireAuth, (req, res) => {
  const r = row(req.params.id); if (!r) return res.status(404).json({ error: 'Analisi non trovata' });
  db.prepare('DELETE FROM process_analyses WHERE id = ?').run(r.id);
  logAudit(req.user.username, 'analysis.delete', String(r.id), { name: r.name });
  res.json({ ok: true });
});

// Crea il tenant dall'analisi: moduli scelti dai processi, poi ruoli e stati del flusso (mai sovrascrivendo un modulo che ha già i suoi).
router.post('/:id/create-tenant', requireAuth, async (req, res) => {
  const r = row(req.params.id); if (!r) return res.status(404).json({ error: 'Analisi non trovata' });
  if (r.tenant_slug) return res.status(400).json({ error: 'Da questa analisi è già nato il tenant «' + r.tenant_slug + '».' });
  const { name, slug, domain } = req.body || {};
  if (!name || !slug) return res.status(400).json({ error: 'Nome e slug obbligatori' });
  const valid = new Set(analysis.libraryModules().map((m) => m.id));
  const processi = analysis.sanitizeProcessi(json(r.processi, []), valid);
  const moduleIds = [...new Set(processi.map((p) => p.registry_module_id).filter(Boolean))];
  const { createTenant, enqueueHostedCreation, installModulesByIds } = require('./tenants');
  try {
    const { tenant, initialPassword } = await enqueueHostedCreation(() => createTenant({ name, slug, domain, actor: req.user.username }));
    let installed = await installModulesByIds(tenant.slug, moduleIds);
    if (moduleIds.length && (!installed || installed.modules !== moduleIds.length)) installed = await installModulesByIds(tenant.slug, moduleIds); // il tenant a volte non è ancora in ascolto: un secondo giro
    let config = null;
    try { config = await applyAnalysisConfigToTenant({ tenantSlug: tenant.slug, processi, installedRegistryModuleIds: moduleIds, actor: req.user.username }); }
    catch (e) { console.error('[analyses] ruoli e stati non applicati (non bloccante):', e.message); }
    db.prepare('UPDATE process_analyses SET tenant_slug = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(tenant.slug, r.id);
    logAudit(req.user.username, 'analysis.create_tenant', tenant.slug, { analysis_id: r.id, modules: installed ? installed.modules : 0, roles: config ? config.roles_created.length : 0 });
    const { encryption_key, jwt_secret, backup_offsite_credentials, ...pub } = db.prepare('SELECT * FROM tenants WHERE slug = ?').get(tenant.slug);
    res.json({ ...pub, initial_credentials: { username: 'admin', password: initialPassword }, modules_installed: installed ? installed.modules : 0, config_summary: config });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

module.exports = router;
