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

const router = express.Router();
const row = (id) => db.prepare('SELECT * FROM process_analyses WHERE id = ?').get(id);
const json = (s, d) => { try { return JSON.parse(s); } catch (e) { return d; } };
function full(r) {
  const processi = json(r.processi, []);
  return { id: r.id, name: r.name, descrizione: r.descrizione, profilo: json(r.profilo, {}), processi, tenant_slug: r.tenant_slug, creazione: (json(r.creazione, null) || null), created_at: r.created_at, updated_at: r.updated_at, blueprint: analysis.blueprint(processi) };
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
  if (inCorso(creazioneDi(r))) return res.status(409).json({ error: 'Il tenant è in creazione: aspetta che finisca.' });
  db.prepare('DELETE FROM process_analyses WHERE id = ?').run(r.id);
  logAudit(req.user.username, 'analysis.delete', String(r.id), { name: r.name });
  res.json({ ok: true });
});

// ── Crea il tenant dall'analisi, IN BACKGROUND ────────────────────────────────────────────────────────────────────
// La creazione di un tenant richiede da qualche decina di secondi a più di un minuto (container, avvio del database, dominio, moduli). Non si resta appesi a una chiamata:
// la rotta parte e risponde subito (202); l'avanzamento sta in `creazione` (fase, inizio, tempi per fase) e la pagina lo legge con GET /:id/creazione. L'accesso admin iniziale
// si tiene SOLO in memoria e si consegna una volta sola (come alla creazione di un tenant normale: non è salvato da nessuna parte).
const FASI = ['container', 'database', 'moduli_default', 'dominio', 'moduli', 'ruoli'];
const credenziali = new Map(); // analysis id -> { username, password }
const creazioneDi = (r) => json(r.creazione, null);
const inCorso = (c) => !!c && c.fase !== 'finita' && c.fase !== 'errore' && Date.now() - c.inizio < 20 * 60 * 1000;
function setCreazione(id, patch) {
  const r = row(id); const cur = (r && creazioneDi(r)) || {};
  db.prepare('UPDATE process_analyses SET creazione = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(JSON.stringify({ ...cur, ...patch }), id);
}

async function creaTenantInBackground({ id, name, slug, domain, actor, processi }) {
  const t0 = Date.now(), segni = []; // [{ fase, t }]
  const segna = (fase) => { segni.push({ fase, t: Date.now() }); setCreazione(id, { fase }); };
  const tempi = () => { const out = {}; segni.forEach((s, i) => { const fine = (segni[i + 1] ? segni[i + 1].t : Date.now()); out[s.fase] = Math.round((fine - s.t) / 100) / 10; }); return out; };
  const { createTenant, enqueueHostedCreation, installModulesByIds } = require('./tenants');
  const moduleIds = analysis.withDependencies([...new Set(processi.map((p) => p.registry_module_id).filter(Boolean))]); // con i moduli richiesti dalle loro relazioni
  const avvisi = [];
  try {
    segna('container');
    const { tenant, initialPassword } = await enqueueHostedCreation(() => createTenant({ name, slug, domain, actor, skipDefaults: true, onStep: (f) => { if (FASI.includes(f) && (!segni.length || segni[segni.length - 1].fase !== f)) segna(f); } }));
    db.prepare('UPDATE process_analyses SET tenant_slug = ? WHERE id = ?').run(tenant.slug, id); // da qui il tenant esiste
    credenziali.set(id, { username: 'admin', password: initialPassword });
    segna('moduli');
    let installed = await installModulesByIds(tenant.slug, moduleIds);
    if (moduleIds.length && (!installed || installed.modules !== moduleIds.length)) installed = await installModulesByIds(tenant.slug, moduleIds); // il tenant a volte non è ancora in ascolto: un secondo giro
    if (moduleIds.length && (!installed || installed.modules !== moduleIds.length)) avvisi.push('Installati ' + (installed ? installed.modules : 0) + ' moduli su ' + moduleIds.length + ': i mancanti si aggiungono dalla Libreria.');
    segna('ruoli');
    let config = null;
    try { config = await analysis.deps.applyConfig({ tenantSlug: tenant.slug, processi, installedRegistryModuleIds: moduleIds, actor }); }
    catch (e) { console.error('[analyses] ruoli e stati non applicati (non bloccante):', e.message); avvisi.push('Ruoli e stati del flusso non applicati: si impostano dal Builder.'); }
    segni.push({ fase: 'fine', t: Date.now() });
    const t = tempi(); delete t.fine;
    setCreazione(id, { fase: 'finita', fine: Date.now(), secondi: Math.round((Date.now() - t0) / 100) / 10, tempi: t, moduli_installati: installed ? installed.modules : 0, ruoli_creati: config ? config.roles_created.length : 0, moduli_configurati: config ? config.modules_configured.length : 0, avvisi });
    logAudit(actor, 'analysis.create_tenant', tenant.slug, { analysis_id: id, modules: installed ? installed.modules : 0, roles: config ? config.roles_created.length : 0, secondi: Math.round((Date.now() - t0) / 1000) });
  } catch (e) {
    console.error('[analyses] creazione tenant fallita:', e.message);
    setCreazione(id, { fase: 'errore', errore: e.message, tempi: tempi() });
  }
}

router.post('/:id/create-tenant', requireAuth, (req, res) => {
  const r = row(req.params.id); if (!r) return res.status(404).json({ error: 'Analisi non trovata' });
  if (r.tenant_slug) return res.status(400).json({ error: 'Da questa analisi è già nato il tenant «' + r.tenant_slug + '».' });
  if (inCorso(creazioneDi(r))) return res.status(409).json({ error: 'La creazione è già in corso.' });
  const { name, slug, domain } = req.body || {};
  if (!name || !slug) return res.status(400).json({ error: 'Nome e slug obbligatori' });
  if (!/^[a-z0-9][a-z0-9-]*$/.test(String(slug))) return res.status(400).json({ error: 'Indirizzo non valido: solo lettere minuscole, numeri e trattini.' });
  if (db.prepare('SELECT 1 FROM tenants WHERE slug = ?').get(slug)) return res.status(400).json({ error: 'L\'indirizzo «' + slug + '» è già usato da un altro tenant.' });
  const valid = new Set(analysis.libraryModules().map((m) => m.id));
  const processi = analysis.sanitizeProcessi(json(r.processi, []), valid);
  setCreazione(r.id, { fase: 'container', inizio: Date.now(), nome: name, slug, tempi: {}, errore: null, avvisi: [] });
  creaTenantInBackground({ id: r.id, name, slug, domain, actor: req.user.username, processi }); // senza await: la pagina segue l'avanzamento
  res.status(202).json({ avviata: true });
});

// L'avanzamento. Chi legge a creazione finita riceve UNA volta l'accesso admin iniziale (poi non c'è più: serve «Reset credenziali»).
router.get('/:id/creazione', requireAuth, (req, res) => {
  const r = row(req.params.id); if (!r) return res.status(404).json({ error: 'Analisi non trovata' });
  const c = creazioneDi(r); if (!c) return res.json({ fase: null });
  const out = { ...c, in_corso: inCorso(c), tenant_slug: r.tenant_slug };
  if (c.fase === 'finita' && credenziali.has(r.id)) { out.credenziali = credenziali.get(r.id); credenziali.delete(r.id); }
  res.json(out);
});

module.exports = router;
