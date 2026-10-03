const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('./auth');
const { parseSchemaNormalized, getRequiredConnectors, isV3, toV3 } = require('../schema-v3');
const { logAudit } = require('../audit-log');
const { ruleFor } = require('../permissions');

const router = express.Router();
const SUPER_ADMIN_URL = process.env.SUPER_ADMIN_URL || 'http://super-admin-backend:3000';
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || 'changeme_internal';
const TENANT_SLUG = process.env.TENANT_SLUG || 'default';

// ─── REGISTRO MODULI (Super Admin) ─────────────────────────────────────────────
// Il tenant non ha una copia locale del registro — lo interroga live, ogni volta,
// via rete Docker interna. Nessuna sincronizzazione da tenere aggiornata, nessun
// rischio di mostrare un elenco vecchio: se il Super Admin non risponde, lo Store
// mostra solo i moduli locali e lo dice esplicitamente, non finge un elenco vuoto.
router.get('/registry', requireAuth, requireAdmin, async (req, res) => {
  try {
    const r = await fetch(SUPER_ADMIN_URL + '/api/registry/public/modules?tenant_slug=' + encodeURIComponent(TENANT_SLUG), {
      headers: { 'x-internal-secret': INTERNAL_SECRET },
    });
    if (!r.ok) return res.status(502).json({ error: 'Registro non raggiungibile', unavailable: true });
    const modules = await r.json();
    checkForUpdates(modules);
    res.json(modules.filter((m) => !isSystem(m.slug)));
  } catch (e) {
    res.status(502).json({ error: 'Registro non raggiungibile', unavailable: true });
  }
});

// Nessun job in background: il controllo scatta solo quando il tenant riapre lo
// Store (qui). Limite esplicito — se non lo riapre mai dopo aver installato un
// modulo, non viene avvisato — ma è comunque un miglioramento reale rispetto a
// prima, dove non esisteva NESSUN modo di saperlo. Riusa la tabella notifications
// già esistente (stesso INSERT di automation-engine.js) — nessuna UI nuova, la
// campanella in Sidebar.jsx la mostra già.
function checkForUpdates(liveRegistry) {
  const tracked = db.prepare("SELECT slug, name, registry_slug, registry_source_tenant_slug, registry_version FROM modules WHERE installed = 1 AND registry_slug IS NOT NULL").all();
  if (tracked.length === 0) return;
  tracked.forEach((m) => {
    const latest = liveRegistry
      .filter((r) => r.slug === m.registry_slug && r.source_tenant_slug === m.registry_source_tenant_slug)
      .reduce((max, r) => Math.max(max, r.version || 0), 0);
    if (latest > (m.registry_version || 0)) {
      const already = db.prepare("SELECT 1 FROM notifications WHERE module_slug = ? AND message LIKE 'Nuova versione%' AND read = 0").get(m.slug);
      if (!already) {
        db.prepare('INSERT INTO notifications (message, module_slug, record_id) VALUES (?, ?, ?)')
          .run('Nuova versione disponibile per "' + m.name + '" (v' + latest + ', hai la v' + (m.registry_version || '?') + ')', m.slug, null);
      }
    }
  });
}

// Installa un modulo dal registro: il Super Admin restituisce lo schema_json e
// qui viene copiato come un modulo NUOVO e locale a questo tenant — da questo momento è un modulo come un
// altro, modificabile liberamente nel Builder. Non più totalmente scollegato
// dall'originale come prima: registry_module_id/registry_slug/registry_version
// restano salvati (vedi core/backend/src/db.js) solo per poter avvisare in futuro
// se il Super Admin pubblica una versione più recente (GET /registry sotto) — non
// per sincronizzare nulla in automatico, lo schema locale resta comunque del tenant.
// Fetch + inserimento locale di UN modulo dal registro — estratto dalla route
// sotto per essere riusabile anche per installare in automatico una dipendenza
// mancante (stesso identico percorso, solo chiamato una volta in più prima del
// modulo richiesto esplicitamente dall'utente).
async function installRegistryModuleById(id, actor) {
  const r = await fetch(SUPER_ADMIN_URL + '/api/registry/public/modules/' + id + '/install', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET },
    body: JSON.stringify({ tenant_slug: TENANT_SLUG }),
  });
  const payload = await r.json();
  if (!r.ok) throw Object.assign(new Error(payload.error || 'Installazione non riuscita'), { status: r.status });

  // Bug reale trovato 2026-08-30: questa funzione slugificava dal NOME
  // ("Clienti" -> "clienti") invece che dallo slug canonico del Registro
  // ("clienti_generico") — esattamente il bug già corretto sotto in
  // POST /registry/:id/install (vedi il commento lì), ma il fix non era mai
  // arrivato qui. Chiamata solo per installare in automatico una dipendenza
  // mancante: ogni volta che succedeva, il modulo finiva con uno slug LOCALE
  // diverso da quello che le relazioni di altri moduli si aspettano — quelle
  // relazioni restavano silenziosamente vuote (records.js risolve solo per
  // slug esatto, mai per registry_slug), e la dipendenza risultava "ancora
  // mancante" al prossimo controllo, causando installazioni duplicate a
  // catena (visto dal vivo: 5 copie vuote di clienti_generico su un tenant).
  let slug = (payload.slug || payload.name).toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '');
  let n = 2;
  while (db.prepare('SELECT id FROM modules WHERE slug = ?').get(slug)) { slug = slug + '-' + n; n++; }

  db.prepare('INSERT INTO modules (name, slug, icon, color, installed, sort_order, schema_json, registry_module_id, registry_source_tenant_slug, registry_slug, registry_version, support_module) VALUES (?, ?, ?, ?, 1, 99, ?, ?, ?, ?, ?, ?)')
    .run(payload.name, slug, payload.icon || 'box', payload.color || '#2563EB', payload.schema_json || '{}', payload.id || null, payload.source_tenant_slug || null, payload.slug || null, payload.version || null, payload.support_module ? 1 : 0);

  logAudit(actor, 'module.install_from_registry', slug, { registry_module_id: id });
  return db.prepare('SELECT * FROM modules WHERE slug = ?').get(slug);
}

// Import manuale (2026-08-16) — caricamento diretto di un modulo esportato a
// mano da Super Admin (vedi routes/registry.js POST /tenants/:slug/install-module),
// bypassa di proposito lo Store: strumento interno per supporto/migrazione, non
// un flusso ordinario. Autenticato con un token admin vero per QUESTO
// tenant (lo stesso meccanismo già usato da "Apri →"/Builder, mai un secret
// condiviso) — requireAuth+requireAdmin normali, nessuna via speciale. Stessa
// logica di slugify+dedup di installRegistryModuleById sopra, ma senza nessun
// collegamento a registry_module_id/registry_slug/registry_version: non è mai
// passato dal registro, niente notifiche di "nuova versione disponibile" per
// un modulo che il registro non ha mai visto.
router.post('/import', requireAuth, requireAdmin, (req, res) => {
  const { name, icon, color, schema_json } = req.body || {};
  if (!name || !schema_json) return res.status(400).json({ error: 'name e schema_json obbligatori' });

  let slug = name.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  let n = 2;
  while (db.prepare('SELECT id FROM modules WHERE slug = ?').get(slug)) { slug = slug + '-' + n; n++; }

  db.prepare('INSERT INTO modules (name, slug, icon, color, installed, sort_order, schema_json) VALUES (?, ?, ?, ?, 1, 99, ?)')
    .run(name, slug, icon || 'box', color || '#2563EB', schema_json);

  logAudit(req.user.username, 'module.import_manual', slug, null);
  res.json(db.prepare('SELECT * FROM modules WHERE slug = ?').get(slug));
});

// Dipendenze mancanti di un modulo (relazioni verso moduli non ancora installati
// su questo tenant) — usato sia per auto-installare quelle risolvibili, sia per
// segnalare quelle che restano bloccanti.
function findMissingDependencies(schemaJson) {
  let schema;
  try { schema = parseSchemaNormalized(schemaJson); } catch (e) { schema = { relations: [] }; }
  // target_module in una relazione è sempre lo slug CANONICO del Registro (vedi
  // commento più sotto su installRegistryModuleById) — ma un modulo già installato
  // può avere uno slug LOCALE diverso (import manuale pre-registro, o una
  // collisione di slug che lo ha rinominato in "-2"/"-3"...). Controllare solo
  // modules.slug qui sotto stimava "mancante" un modulo in realtà già presente,
  // e lo reinstallava da capo — bug reale trovato 2026-08-30: su 10 tenant demo
  // ogni installazione successiva di un modulo dipendente da clienti_generico/
  // dipendenti_generico/fatture_generico aggiungeva un'ALTRA copia vuota,
  // arrivando fino a 5 duplicati dello stesso modulo (demo-paghe, demo-hr).
  // Registrare anche registry_slug chiude il buco.
  const installed = db.prepare('SELECT slug, registry_slug FROM modules WHERE installed = 1').all();
  const installedSlugs = new Set(installed.flatMap((m) => [m.slug, m.registry_slug]).filter(Boolean));
  return (schema.relations || [])
    .map((r) => r.target_module)
    .filter((slug, i, arr) => slug && !installedSlugs.has(slug) && arr.indexOf(slug) === i);
}

router.post('/registry/:id/install', requireAuth, requireAdmin, async (req, res) => {
  let payload;
  try {
    const r = await fetch(SUPER_ADMIN_URL + '/api/registry/public/modules/' + req.params.id + '/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET },
      body: JSON.stringify({ tenant_slug: TENANT_SLUG }),
    });
    payload = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: payload.error || 'Installazione non riuscita' });
  } catch (e) {
    return res.status(502).json({ error: 'Registro non raggiungibile' });
  }

  // Verifica dipendenze PRIMA di installare — senza questo, un modulo con una
  // relazione verso un modulo non installato entrava comunque: il selettore della
  // relazione restava vuoto per sempre, il quick-create si interrompeva in
  // silenzio, le formule collegate calcolavano 0 — nessun errore da nessuna parte,
  // sembrava "nessun dato" invece di "manca un pezzo". target_module su ogni step
  // di tipo relazione è già un dato strutturato, basta leggerlo — nessun formato
  // "dipendenze" nuovo da inventare.
  const missing = findMissingDependencies(payload.schema_json);
  const autoInstalled = [];
  if (missing.length > 0) {
    // Se una dipendenza mancante è a sua volta un modulo pubblicato nel registro, la
    // installiamo qui automaticamente — l'utente non ha mai scelto di gestire da solo
    // un modulo di supporto/giunzione, non ha senso fargli fare un giro nello Store
    // per un pezzo di infrastruttura.
    let registryList = [];
    try {
      const rr = await fetch(SUPER_ADMIN_URL + '/api/registry/public/modules?tenant_slug=' + encodeURIComponent(TENANT_SLUG), { headers: { 'x-internal-secret': INTERNAL_SECRET } });
      if (rr.ok) registryList = await rr.json();
    } catch (e) { /* registryList resta vuoto, tutte le dipendenze finiscono in stillMissing sotto */ }

    const stillMissing = [];
    for (const slug of missing) {
      const dep = registryList.find((m) => m.slug === slug);
      if (!dep) { stillMissing.push(slug); continue; }
      try {
        const installedDep = await installRegistryModuleById(dep.id, req.user.username);
        autoInstalled.push(installedDep.slug);
      } catch (e) {
        stillMissing.push(slug);
      }
    }

    if (stillMissing.length > 0) {
      const missingNames = stillMissing.map((slug) => {
        const m = db.prepare('SELECT name FROM modules WHERE slug = ?').get(slug);
        return m ? m.name : slug;
      });
      return res.status(409).json({ error: 'Questo modulo richiede: ' + missingNames.join(', ') + ' — installa prima quei moduli.', missing_modules: stillMissing });
    }
  }

  // Slug locale univoco — DEVE partire dallo slug CANONICO del Registro
  // (payload.slug), non dal nome visualizzato: gli schema di altri moduli
  // referenziano questo modulo per slug esatto (relation.target_module,
  // computed sum_children(slug.campo)) — se il nome slugificato differisce
  // anche di poco dallo slug reale (es. "Righe Ordine" -> "righe-ordine" invece
  // di "ordini_righe_generico"), quei riferimenti puntano a un modulo che qui
  // non esiste più: la relazione resta vuota e sum_children calcola sempre 0,
  // senza nessun errore visibile. Bug reale trovato installando un modulo con
  // relazioni verso un altro modulo dal nome diverso dal proprio slug (il caso
  // comune per qualunque modulo "Generico"/vertical pubblicato nel Registro,
  // non solo per moduli di supporto). Fallback al nome solo se lo slug del
  // Registro manca per qualche motivo (installazioni precedenti a questo campo).
  let slug = (payload.slug || payload.name).toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '');
  let n = 2;
  while (db.prepare('SELECT id FROM modules WHERE slug = ?').get(slug)) { slug = slug + '-' + n; n++; }

  db.prepare('INSERT INTO modules (name, slug, icon, color, installed, sort_order, schema_json, registry_module_id, registry_source_tenant_slug, registry_slug, registry_version, support_module) VALUES (?, ?, ?, ?, 1, 99, ?, ?, ?, ?, ?, ?)')
    .run(payload.name, slug, payload.icon || 'box', payload.color || '#2563EB', payload.schema_json || '{}', payload.id || null, payload.source_tenant_slug || null, payload.slug || null, payload.version || null, payload.support_module ? 1 : 0);

  logAudit(req.user.username, 'module.install_from_registry', slug, { registry_module_id: req.params.id });
  const installedModule = db.prepare('SELECT * FROM modules WHERE slug = ?').get(slug);
  res.json(autoInstalled.length > 0 ? { ...installedModule, auto_installed: autoInstalled } : installedModule);
});

// Applica l'aggiornamento di un modulo già installato (2026-08-29) — il pezzo
// che mancava del tutto: prima checkForUpdates() sopra sapeva SOLO avvisare
// ("Nuova versione disponibile"), nessun endpoint la applicava davvero. Chi
// decide QUANDO (questo tenant, non uno scheduler automatico — "Core
// distribuisce, il partner/tenant decide", stesso principio già in uso per
// l'immagine platform-core nell'Update Manager). Sovrascrive lo schema_json
// locale con quello del registro: onestamente distruttivo, non un merge —
// un vero merge a 3 vie è l'Overlay Engine (roadmap 0.1.8, non ancora
// costruito), fingerlo qui sarebbe un check finto. Il chiamante (frontend)
// deve avvisare chiaramente prima di questa chiamata.
router.post('/:slug/update-from-registry', requireAuth, requireAdmin, async (req, res) => {
  const mod = db.prepare('SELECT * FROM modules WHERE slug = ?').get(req.params.slug);
  if (!mod) return res.status(404).json({ error: 'Modulo non trovato' });
  if (!mod.installed || !mod.registry_module_id) return res.status(400).json({ error: 'Questo modulo non è stato installato dal registro, niente da aggiornare da lì' });

  let payload;
  try {
    const r = await fetch(SUPER_ADMIN_URL + '/api/registry/public/modules/' + mod.registry_module_id + '/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET },
      body: JSON.stringify({ tenant_slug: TENANT_SLUG }),
    });
    payload = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: payload.error || 'Aggiornamento non riuscito' });
  } catch (e) {
    return res.status(502).json({ error: 'Registro non raggiungibile' });
  }

  if ((payload.version || 0) <= (mod.registry_version || 0)) {
    return res.status(400).json({ error: 'Nessun aggiornamento disponibile — hai già la versione più recente' });
  }

  db.prepare('UPDATE modules SET name = ?, icon = ?, color = ?, schema_json = ?, registry_version = ? WHERE slug = ?')
    .run(payload.name, payload.icon || mod.icon, payload.color || mod.color, payload.schema_json, payload.version, mod.slug);
  db.prepare("UPDATE notifications SET read = 1 WHERE module_slug = ? AND message LIKE 'Nuova versione%'").run(mod.slug);
  logAudit(req.user.username, 'module.update_from_registry', mod.slug, { from_version: mod.registry_version, to_version: payload.version });
  res.json(db.prepare('SELECT * FROM modules WHERE slug = ?').get(mod.slug));
});

// Moduli installati (sidebar)
// Per utenti non-admin: se hanno righe in user_modules, vede solo quei moduli (+ dashboard sempre).
// Se non hanno righe (nessuna restrizione configurata), vede tutto — backwards compatible.
// In AGGIUNTA (indipendente da user_modules): se il blocco permissions del modulo nega
// esplicitamente la vista al ruolo di chi chiama (rule.view === false), il modulo sparisce
// comunque dalla sidebar — senza questo, un ruolo come "Agente" con permissions.rules che
// nega la vista su "fatturazione" la vedrebbe ancora in menu (l'API sotto darebbe 403 al
// click, ma il menu stesso mentirebbe su cosa può davvero fare).
// Oltre a filtrare, applica l'eventuale etichetta per ruolo (permissions.rules[].
// label_override, es. "I miei ordini" per l'Agente invece di "Ordini") — stesso
// principio del filtro sopra: il menu deve riflettere davvero il ruolo di chi
// guarda, non solo l'accesso ma anche il modo in cui i moduli vengono chiamati.
function filterByRolePermissions(modules, role) {
  if (role === 'admin') return modules; // comportamento invariato: admin vede sempre tutto
  return modules
    .filter((m) => {
      if (m.slug === 'dashboard') return true;
      let schema;
      try { schema = parseSchemaNormalized(m.schema_json); } catch (e) { schema = {}; }
      const rule = ruleFor(schema, role);
      return !rule || rule.view !== false;
    })
    .map((m) => {
      let schema;
      try { schema = parseSchemaNormalized(m.schema_json); } catch (e) { schema = {}; }
      const rule = ruleFor(schema, role);
      return (rule && rule.label_override) ? { ...m, name: rule.label_override } : m;
    });
}

// Moduli installati/attivi visibili a QUESTO utente — admin vede tutto, un ruolo
// con user_modules configurato vede solo la propria lista (+ dashboard, sempre
// inclusa).
const { SQL_NOT_SYSTEM, isSystem } = require('../system-modules');

function getVisibleInstalledModules(user) {
  if (user.role === 'admin') {
    return db.prepare('SELECT * FROM modules WHERE installed = 1 AND active = 1 AND slug NOT IN (' + SQL_NOT_SYSTEM + ') ORDER BY sort_order').all();
  }
  const allowed = db.prepare('SELECT module_slug FROM user_modules WHERE user_id = ?').all(user.id);
  if (allowed.length === 0) {
    return db.prepare('SELECT * FROM modules WHERE installed = 1 AND active = 1 AND slug NOT IN (' + SQL_NOT_SYSTEM + ') ORDER BY sort_order').all();
  }
  const slugSet = new Set(allowed.map((r) => r.module_slug));
  slugSet.add('dashboard');
  const placeholders = [...slugSet].map(() => '?').join(',');
  return db.prepare(`SELECT * FROM modules WHERE installed = 1 AND active = 1 AND slug IN (${placeholders}) AND slug NOT IN (${SQL_NOT_SYSTEM}) ORDER BY sort_order`).all([...slugSet]);
}

router.get('/installed', requireAuth, (req, res) => {
  const modules = getVisibleInstalledModules(req.user);
  res.json(filterByRolePermissions(modules, req.user.role));
});

// Fase 12.5 (PLATFORM-MASTER-ROADMAP.md, audit 2026-09-02) — B2a: prime due tappe del
// Tenant API Contract. Prima Super Admin apriva il .db di QUESTO tenant direttamente
// (cloneModulesFromTemplate/installModulesByIds/installDefaultModules in
// super-admin/backend/src/routes/tenants.js) — funzionava solo perché tutto vive sullo
// stesso volume Docker, non perché esisteva un contratto stabile. Queste due rotte
// sostituiscono quell'accesso diretto: EXPORT (legge SE STESSO, usato quando questo
// tenant è la sorgente di un clone-da-template) e INSTALL-BATCH (scrive SE STESSO,
// usato per template clone / moduli di default / moduli scelti da un'analisi accettata
// — stesso payload per tutti e tre i casi, la differenza è solo in COSA gli manda
// super-admin/backend). Stesso principio di autenticazione già in uso su
// /internal/stats sotto (secret interno, rete Docker, mai esposto fuori) — a differenza
// di quella però questa scrive, quindi la validazione dello schema (parseSchemaNormalized)
// non è opzionale: mai bypassare schema-v3, è esattamente il motivo per cui questa fase
// esiste (vedi PLATFORM-CAPABILITY-TENANT-API-PLAN.md).
router.get('/internal/export', (req, res) => {
  const secret = req.headers['x-internal-secret'];
  if (!secret || secret !== INTERNAL_SECRET) return res.status(401).json({ error: 'Secret interno non valido' });
  // registry_slug/registry_source_tenant_slug aggiunti (2026-09-03) — servono a
  // derivare i processi di una nuova Analisi da un Verticale (super-admin/backend/
  // src/routes/client-analyses.js), che deve risolvere il registry_module_id
  // CORRENTE (released) di ogni modulo del template, mai quello con cui fu
  // installato all'epoca (potrebbe essere una versione preview/superata).
  const modules = db.prepare(
    "SELECT name, slug, icon, color, active, installed, sort_order, schema_json, schema_json_draft, schema_version, published_at, support_module, group_name, group_order, registry_slug, registry_source_tenant_slug FROM modules WHERE slug != 'dashboard'"
  ).all();
  const widgets = db.prepare('SELECT type, module_slug, field, aggregation, label, color, sort_order, config, roles FROM dashboard_widgets').all();
  res.json({ modules, widgets });
});

router.post('/internal/install-batch', (req, res) => {
  const secret = req.headers['x-internal-secret'];
  if (!secret || secret !== INTERNAL_SECRET) return res.status(401).json({ error: 'Secret interno non valido' });
  const { modules, widgets, set_baseline } = req.body || {};
  if (!Array.isArray(modules) || modules.length === 0) return res.status(400).json({ error: 'modules deve essere un array non vuoto' });

  // Validazione reale dello schema PRIMA di scrivere qualunque cosa — mai un
  // bypass silenzioso. Se anche un solo modulo ha uno schema non valido, l'intera
  // chiamata fallisce (nessuna scrittura parziale), stesso principio delle
  // transazioni già in uso in questo file.
  for (const m of modules) {
    if (!m || !m.slug || !m.name) return res.status(400).json({ error: 'Ogni modulo richiede almeno slug e name' });
    try { parseSchemaNormalized(m.schema_json); } catch (e) { return res.status(400).json({ error: `Schema non valido per il modulo "${m.slug}": ${e.message}` }); }
  }

  // Bug reale trovato testando B2b end-to-end 2026-09-02: la pulizia dei soli
  // placeholder non installati (installed=0) non bastava — un modulo del Registro
  // può avere lo STESSO slug di un modulo seminato di default già installed=1 al
  // boot del tenant (es. "clienti"), e l'INSERT falliva con UNIQUE constraint
  // failed. Questo batch è autoritativo su "cosa deve esserci ora" per gli slug che
  // porta: rimuove qualunque modulo esistente (placeholder O già installato, mai
  // 'dashboard') il cui slug ricompare nel batch, non solo i placeholder.
  const incomingSlugs = modules.map((m) => m.slug);
  const placeholders = incomingSlugs.map(() => '?').join(',');
  db.prepare(`DELETE FROM modules WHERE slug != 'dashboard' AND (installed = 0 OR slug IN (${placeholders}))`).run(...incomingSlugs);

  const insertModule = db.prepare(`
    INSERT INTO modules (name, slug, icon, color, active, installed, sort_order, schema_json, schema_json_draft, schema_version, published_at, support_module, group_name, group_order, registry_module_id, registry_source_tenant_slug, registry_slug, registry_version)
    VALUES (@name, @slug, @icon, @color, @active, @installed, @sort_order, @schema_json, @schema_json_draft, @schema_version, @published_at, @support_module, @group_name, @group_order, @registry_module_id, @registry_source_tenant_slug, @registry_slug, @registry_version)
  `);
  const insertWidget = db.prepare(`
    INSERT INTO dashboard_widgets (type, module_slug, field, aggregation, label, color, sort_order, config, roles)
    VALUES (@type, @module_slug, @field, @aggregation, @label, @color, @sort_order, @config, @roles)
  `);
  const insertBaseline = db.prepare(`INSERT OR REPLACE INTO module_overlay_baseline (module_slug, baseline_schema_json) VALUES (@slug, @schema_json)`);

  const tx = db.transaction(() => {
    modules.forEach((m, i) => insertModule.run({
      name: m.name, slug: m.slug, icon: m.icon || 'box', color: m.color || '#2563EB',
      active: m.active != null ? (m.active ? 1 : 0) : 1, installed: m.installed != null ? (m.installed ? 1 : 0) : 1,
      sort_order: m.sort_order != null ? m.sort_order : 90 + i, schema_json: m.schema_json,
      schema_json_draft: m.schema_json_draft || null, schema_version: m.schema_version || 1,
      published_at: m.published_at || null, support_module: m.support_module ? 1 : 0,
      group_name: m.group_name || null, group_order: m.group_order || 0,
      registry_module_id: m.registry_module_id || null, registry_source_tenant_slug: m.registry_source_tenant_slug || null,
      registry_slug: m.registry_slug || null, registry_version: m.registry_version || null,
    }));
    (widgets || []).forEach((w) => insertWidget.run({
      type: w.type, module_slug: w.module_slug, field: w.field || null, aggregation: w.aggregation || null,
      label: w.label || null, color: w.color || null, sort_order: w.sort_order || 0,
      config: w.config || null, roles: w.roles || null,
    }));
    if (set_baseline) modules.forEach((m) => insertBaseline.run({ slug: m.slug, schema_json: m.schema_json }));
  });
  tx();

  logAudit('platform:provisioning', 'modules.install_batch', modules.length + ' moduli', { widgets: (widgets || []).length, set_baseline: !!set_baseline });
  res.json({ ok: true, installed: modules.length, widgets: (widgets || []).length });
});

// Fase 12.5 — B2b: gemella di install-batch sopra, ma per il caso "modulo già
// installato, aggiungi workflow/permessi generati da un'analisi cliente accettata"
// (prima: lettura+scrittura diretta di modules.schema_json da
// super-admin/backend/src/lib/tenant-config-from-analysis.js). Il controllo
// "non sovrascrivere un workflow/permessi già presenti" resta qui, non nel
// chiamante — è il tenant a possedere il proprio schema, non chi lo chiama da fuori.
// workflow_steps/permissions_step arrivano già costruiti (buildWorkflowSteps/
// buildPermissionsStep sono funzioni pure, senza bisogno di leggere questo DB —
// restano lato super-admin/backend, che possiede i dati grezzi dell'analisi).
router.post('/internal/apply-workflow-config', (req, res) => {
  const secret = req.headers['x-internal-secret'];
  if (!secret || secret !== INTERNAL_SECRET) return res.status(401).json({ error: 'Secret interno non valido' });
  const { registry_module_id, workflow_steps, permissions_step } = req.body || {};
  if (!registry_module_id) return res.status(400).json({ error: 'registry_module_id obbligatorio' });

  const moduleRow = db.prepare('SELECT id, schema_json FROM modules WHERE registry_module_id = ?').get(registry_module_id);
  if (!moduleRow) return res.json({ configured: false, reason: 'modulo_non_trovato_sul_tenant' });

  let schema;
  try { schema = JSON.parse(moduleRow.schema_json || '{}'); } catch (e) { schema = {}; }
  const v3 = isV3(schema) ? schema : toV3(schema);
  const hasWorkflow = v3.steps.some((s) => s.block_type === 'workflow_state');
  const hasPermissions = v3.steps.some((s) => s.block_type === 'permissions');

  const newSteps = [];
  if (!hasWorkflow && Array.isArray(workflow_steps) && workflow_steps.length > 0) newSteps.push(...workflow_steps);
  if (!hasPermissions && permissions_step) newSteps.push(permissions_step);

  if (newSteps.length === 0) {
    return res.json({ configured: false, reason: (hasWorkflow || hasPermissions) ? 'workflow_o_permessi_gia_presenti' : 'nessun_dato_da_generare' });
  }

  const finalSchema = { version: 3, steps: [...v3.steps, ...newSteps] };
  // Stessa validazione reale già in uso in install-batch — mai scrivere uno schema
  // che il tenant stesso non saprebbe più interpretare.
  try { parseSchemaNormalized(JSON.stringify(finalSchema)); } catch (e) { return res.status(400).json({ error: `Schema risultante non valido: ${e.message}` }); }

  db.prepare('UPDATE modules SET schema_json = ? WHERE id = ?').run(JSON.stringify(finalSchema), moduleRow.id);
  logAudit('platform:provisioning', 'module.workflow_config_applied', String(registry_module_id), {
    workflow_states: newSteps.filter((s) => s.block_type === 'workflow_state').length,
    has_permissions: newSteps.some((s) => s.block_type === 'permissions'),
  });
  res.json({
    configured: true,
    workflow_states: newSteps.filter((s) => s.block_type === 'workflow_state').length,
    has_permissions: newSteps.some((s) => s.block_type === 'permissions'),
  });
});

// Gemella "batch" di apply-workflow-config sopra (2026-09-11, bug reale di
// performance trovato dal vivo: un'analisi con 7-8 processi/moduli mandava
// altrettante chiamate HTTP SEQUENZIALI al tenant appena creato — su un NAS
// lento questo da solo spiegava gran parte di una creazione tenant durata
// 273s). Stessa identica logica per-modulo di sopra, applicata in loop QUI
// dentro il processo del tenant invece che una richiesta alla volta dal
// chiamante — un solo round-trip di rete invece di N. Il chiamante
// (applyAnalysisConfigToTenant, super-admin/backend) costruisce comunque i
// workflow_steps/permissions_step per ogni modulo come prima, cambia solo
// come li spedisce.
router.post('/internal/apply-workflow-config-batch', (req, res) => {
  const secret = req.headers['x-internal-secret'];
  if (!secret || secret !== INTERNAL_SECRET) return res.status(401).json({ error: 'Secret interno non valido' });
  const { configs } = req.body || {};
  if (!Array.isArray(configs) || configs.length === 0) return res.status(400).json({ error: 'configs obbligatorio (array non vuoto)' });

  const results = configs.map(({ registry_module_id, workflow_steps, permissions_step }) => {
    if (!registry_module_id) return { registry_module_id: null, configured: false, reason: 'registry_module_id_mancante' };

    const moduleRow = db.prepare('SELECT id, schema_json FROM modules WHERE registry_module_id = ?').get(registry_module_id);
    if (!moduleRow) return { registry_module_id, configured: false, reason: 'modulo_non_trovato_sul_tenant' };

    let schema;
    try { schema = JSON.parse(moduleRow.schema_json || '{}'); } catch (e) { schema = {}; }
    const v3 = isV3(schema) ? schema : toV3(schema);
    const hasWorkflow = v3.steps.some((s) => s.block_type === 'workflow_state');
    const hasPermissions = v3.steps.some((s) => s.block_type === 'permissions');

    const newSteps = [];
    if (!hasWorkflow && Array.isArray(workflow_steps) && workflow_steps.length > 0) newSteps.push(...workflow_steps);
    if (!hasPermissions && permissions_step) newSteps.push(permissions_step);

    if (newSteps.length === 0) {
      return { registry_module_id, configured: false, reason: (hasWorkflow || hasPermissions) ? 'workflow_o_permessi_gia_presenti' : 'nessun_dato_da_generare' };
    }

    const finalSchema = { version: 3, steps: [...v3.steps, ...newSteps] };
    try { parseSchemaNormalized(JSON.stringify(finalSchema)); } catch (e) {
      return { registry_module_id, configured: false, reason: 'schema_non_valido: ' + e.message };
    }

    db.prepare('UPDATE modules SET schema_json = ? WHERE id = ?').run(JSON.stringify(finalSchema), moduleRow.id);
    return {
      registry_module_id, configured: true,
      workflow_states: newSteps.filter((s) => s.block_type === 'workflow_state').length,
      has_permissions: newSteps.some((s) => s.block_type === 'permissions'),
    };
  });

  const configured = results.filter((r) => r.configured);
  if (configured.length > 0) {
    logAudit('platform:provisioning', 'modules.workflow_config_applied_batch', configured.length + ' moduli', {
      registry_module_ids: configured.map((r) => r.registry_module_id),
    });
  }
  res.json({ results });
});

// Fase 12.5 — B2c: gemella di install-batch, ma per il caso "un solo modulo, crea O
// aggiorna per slug" — usato sia da Super Builder AI (/deploy, bozza generata
// dall'AI verso il proprio sandbox) sia dall'anteprima di una pubblicazione ancora
// 'preview' (registry.js preview-install). Prima: due copie quasi identiche di
// scrittura diretta sul .db del sandbox, NESSUNA delle due validava lo schema con
// schema-v3 prima di scrivere (unico caso in tutta la Fase 12.5 dove mancava anche
// nell'originale, non solo nel refactor) — qui la validazione è obbligatoria, come
// ovunque altro in questa fase.
router.post('/internal/upsert', (req, res) => {
  const secret = req.headers['x-internal-secret'];
  if (!secret || secret !== INTERNAL_SECRET) return res.status(401).json({ error: 'Secret interno non valido' });
  const { slug, name, icon, color, schema_json, registry_module_id, registry_source_tenant_slug, registry_slug, registry_version } = req.body || {};
  if (!slug || !name || !schema_json) return res.status(400).json({ error: 'slug, name e schema_json obbligatori' });
  try { parseSchemaNormalized(schema_json); } catch (e) { return res.status(400).json({ error: `Schema non valido: ${e.message}` }); }

  const schemaStr = typeof schema_json === 'string' ? schema_json : JSON.stringify(schema_json);
  const existing = db.prepare('SELECT id FROM modules WHERE slug = ?').get(slug);
  if (existing) {
    db.prepare('UPDATE modules SET name = ?, icon = ?, color = ?, schema_json = ?, installed = 1, registry_module_id = ?, registry_source_tenant_slug = ?, registry_slug = ?, registry_version = ? WHERE slug = ?')
      .run(name, icon || 'box', color || '#2563EB', schemaStr, registry_module_id || null, registry_source_tenant_slug || null, registry_slug || null, registry_version || null, slug);
  } else {
    db.prepare('INSERT INTO modules (name, slug, icon, color, installed, sort_order, schema_json, registry_module_id, registry_source_tenant_slug, registry_slug, registry_version) VALUES (?, ?, ?, ?, 1, 100, ?, ?, ?, ?, ?)')
      .run(name, slug, icon || 'box', color || '#2563EB', schemaStr, registry_module_id || null, registry_source_tenant_slug || null, registry_slug || null, registry_version || null);
  }
  logAudit('platform:provisioning', 'module.upsert', slug, { created: !existing });
  res.json({ ok: true, created: !existing });
});

// G2b/G15 (PLATFORM-0.6-GAP-ANALYSIS.md) — endpoint interno (rete Docker, mai esposto
// fuori), stesso principio di /auth/internal-token e /audit-log/internal/monitoring-feed:
// Super Admin autentica con INTERNAL_API_SECRET, non un login utente. Stessa identica
// query di lib/module-stats.js su Super Admin (moduli installati non-di-supporto, per
// categoria) ma calcolata DENTRO il processo del tenant — sostituisce l'apertura diretta
// del .db per questo caso d'uso.
router.get('/internal/stats', (req, res) => {
  const secret = req.headers['x-internal-secret'];
  if (!secret || secret !== (process.env.INTERNAL_API_SECRET || 'changeme_internal')) {
    return res.status(401).json({ error: 'Secret interno non valido' });
  }
  const rows = db.prepare(
    "SELECT group_name, COUNT(*) as c FROM modules WHERE installed = 1 AND (support_module IS NULL OR support_module = 0) GROUP BY group_name"
  ).all();
  const total = rows.reduce((s, r) => s + r.c, 0);
  const by_category = rows.map((r) => ({ category: r.group_name || null, count: r.c })).sort((a, b) => b.count - a.count);
  res.json({ total, by_category });
});

// Tutti i moduli (store)
router.get('/', requireAuth, requireAdmin, (req, res) => {
  const modules = db.prepare('SELECT * FROM modules WHERE slug NOT IN (' + SQL_NOT_SYSTEM + ') ORDER BY sort_order').all();
  res.json(modules);
});

// Riordino sidebar — riceve l'array di slug nell'ordine desiderato, riscrive
// sort_order per ciascuno (stesso pattern di PUT /dashboard/widgets/reorder).
// L'ordine dei gruppi in Sidebar.jsx deriva dal primo modulo incontrato scorrendo
// per sort_order, quindi riordinare qui basta a riordinare sia i gruppi sia i
// moduli al loro interno, senza bisogno di un campo group_order separato.
router.put('/reorder', requireAuth, requireAdmin, (req, res) => {
  const { order } = req.body;
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order deve essere un array di slug' });
  const update = db.prepare('UPDATE modules SET sort_order = ? WHERE slug = ?');
  order.forEach((slug, i) => update.run(i, slug));
  res.json({ ok: true });
});

// Customer Overlay — quali moduli di QUESTO tenant sono ancora identici a
// come sono nati da un verticale, e quali sono stati toccati dopo. Un modulo
// senza riga in module_overlay_baseline (creato a mano, o tenant senza
// modello) è 'untracked', mai un falso 'personalizzato'.
router.get('/overlay-status', requireAuth, requireAdmin, (req, res) => {
  const modules = db.prepare("SELECT slug, name, schema_json FROM modules WHERE slug != 'dashboard' AND installed = 1").all();
  const baselines = db.prepare('SELECT module_slug, baseline_schema_json FROM module_overlay_baseline').all();
  const baselineBySlug = {};
  baselines.forEach((b) => { baselineBySlug[b.module_slug] = b.baseline_schema_json; });
  const status = modules.map((m) => {
    const baseline = baselineBySlug[m.slug];
    if (baseline === undefined) return { slug: m.slug, name: m.name, status: 'untracked' };
    return { slug: m.slug, name: m.name, status: baseline === m.schema_json ? 'core' : 'customized' };
  });
  res.json(status);
});

// Singolo modulo
router.get('/:slug', requireAuth, (req, res) => {
  const module = db.prepare('SELECT * FROM modules WHERE slug = ?').get(req.params.slug);
  if (!module) return res.status(404).json({ error: 'Modulo non trovato' });
  res.json(module);
});

// Moduli "figli": qualsiasi modulo installato che ha una relazione many_to_one verso
// questo modulo. Derivato a runtime dallo schema — nessuna configurazione duplicata,
// funziona identico per ogni fork/verticale senza codice specifico.
router.get('/:slug/children-modules', requireAuth, (req, res) => {
  const installed = db.prepare('SELECT slug, name, icon, color, schema_json FROM modules WHERE installed = 1').all();
  const children = [];
  installed.forEach((m) => {
    if (m.slug === req.params.slug) return;
    let schema = {};
    try { schema = parseSchemaNormalized(m.schema_json); } catch (e) { return; }
    (schema.relations || []).forEach((r) => {
      if (r.type === 'many_to_one' && r.target_module === req.params.slug) {
        children.push({ module_slug: m.slug, module_name: m.name, module_icon: m.icon, module_color: m.color, relation_key: r.key, relation_label: r.label, display_mode: r.display_mode || 'tab' });
      }
    });
  });
  res.json(children);
});

// Aggiorna icona/colore di un modulo esistente (scelti dal set predefinito nel Builder)
router.patch('/:slug', requireAuth, requireAdmin, (req, res) => {
  const { icon, color, support_module, quick_toggle, name, group_name, group_order, active, list_view, batch_upload_field, batch_upload_category_field } = req.body;
  const mod = db.prepare('SELECT id FROM modules WHERE slug = ?').get(req.params.slug);
  if (!mod) return res.status(404).json({ error: 'Modulo non trovato' });
  if (icon) db.prepare('UPDATE modules SET icon = ? WHERE slug = ?').run(icon, req.params.slug);
  if (color) db.prepare('UPDATE modules SET color = ? WHERE slug = ?').run(color, req.params.slug);
  if (support_module !== undefined) db.prepare('UPDATE modules SET support_module = ? WHERE slug = ?').run(support_module ? 1 : 0, req.params.slug);
  // Visibilità in sidebar/navigazione — la colonna esisteva già ed era già rispettata
  // da GET /modules/installed (filtrato installed=1 AND active=1), mancava solo un
  // modo per scriverla. Non è un confine di sicurezza: solo convenienza di
  // navigazione, i permessi veri restano i ruoli/regole per-modulo già esistenti.
  if (active !== undefined) db.prepare('UPDATE modules SET active = ? WHERE slug = ?').run(active ? 1 : 0, req.params.slug);
  if (quick_toggle !== undefined) db.prepare('UPDATE modules SET quick_toggle = ? WHERE slug = ?').run(quick_toggle ? 1 : 0, req.params.slug);
  // Rinomina SOLO il nome visualizzato — mai lo slug. Lo slug è la chiave stabile usata
  // da relazioni (target_module), formule (sum_children(slug.campo)) e dai record già
  // salvati (module_slug): cambiarlo romperebbe silenziosamente tutto ciò che lo referenzia.
  if (name && name.trim()) db.prepare('UPDATE modules SET name = ? WHERE slug = ?').run(name.trim(), req.params.slug);
  // Sezione della sidebar in cui compare questo modulo (es. "CRM & Vendite") — nullo o
  // stringa vuota vuol dire "nessuna sezione", mostrato in cima senza intestazione.
  if (group_name !== undefined) db.prepare('UPDATE modules SET group_name = ? WHERE slug = ?').run(group_name && group_name.trim() ? group_name.trim() : null, req.params.slug);
  if (group_order !== undefined) db.prepare('UPDATE modules SET group_order = ? WHERE slug = ?').run(parseInt(group_order) || 0, req.params.slug);
  if (list_view !== undefined) db.prepare('UPDATE modules SET list_view = ? WHERE slug = ?').run(list_view === 'card_grid' ? 'card_grid' : 'table', req.params.slug);
  if (batch_upload_field !== undefined) db.prepare('UPDATE modules SET batch_upload_field = ? WHERE slug = ?').run(batch_upload_field || null, req.params.slug);
  if (batch_upload_category_field !== undefined) db.prepare('UPDATE modules SET batch_upload_category_field = ? WHERE slug = ?').run(batch_upload_category_field || null, req.params.slug);
  const updated = db.prepare('SELECT * FROM modules WHERE slug = ?').get(req.params.slug);
  res.json(updated);
});

// Crea nuovo modulo
router.post('/create', requireAuth, requireAdmin, (req, res) => {
  const { name, slug, icon, color, support_module } = req.body
  if (!name || !slug) return res.status(400).json({ error: 'Nome e slug obbligatori' })
  try {
    db.prepare('INSERT INTO modules (name, slug, icon, color, installed, sort_order, schema_json, support_module) VALUES (?, ?, ?, ?, 1, 99, ?, ?)').run(name, slug, icon || 'box', color || '#2563EB', '{}', support_module ? 1 : 0)
    const module = db.prepare('SELECT * FROM modules WHERE slug = ?').get(slug)
    logAudit(req.user.username, 'module.create', slug, { support_module: !!support_module })
    res.json(module)
  } catch (e) {
    res.status(400).json({ error: 'Slug gia esistente' })
  }
})

// I connettori di un modulo (requires_connection espliciti + quelli dedotti dalle
// sue automazioni, vedi getRequiredConnectors) non hanno più una pagina/sezione a
// sé — vivono solo dentro le card dei moduli che li usano (vedi StorePage). Se
// disinstallo/elimino l'ULTIMO modulo installato che usa un certo connettore, le
// sue credenziali non hanno più nessun punto della UI da cui essere viste o
// scollegate: per non lasciarle orfane nel DB, vengono cancellate qui. Se un altro
// modulo installato lo usa ancora, resta intatta.
function cleanupOrphanConnections(excludeSlug, integrationIds) {
  if (!integrationIds || !integrationIds.length) return;
  const others = db.prepare('SELECT schema_json FROM modules WHERE installed = 1 AND slug != ?').all(excludeSlug);
  const stillUsedIds = new Set();
  others.forEach((m) => getRequiredConnectors(m.schema_json).forEach((id) => stillUsedIds.add(id)));
  integrationIds.forEach((integrationId) => {
    if (stillUsedIds.has(integrationId)) return;
    if (integrationId === 'google') {
      // Il client OAuth (client_id/secret) è una configurazione a livello di istanza
      // fatta una volta su Google Cloud Console — non va persa solo perché l'unico
      // modulo che usava Google è stato rimosso: si azzera solo il token utente,
      // stessa logica di POST /integrazioni/google/disconnect.
      const row = db.prepare("SELECT credentials FROM connections WHERE integration_id = 'google'").get();
      if (row && row.credentials) {
        let creds = {};
        try { creds = JSON.parse(row.credentials) || {}; } catch {}
        db.prepare("UPDATE connections SET credentials = ?, connected = 0 WHERE integration_id = 'google'")
          .run(JSON.stringify({ client_id: creds.client_id, client_secret: creds.client_secret }));
      }
    } else {
      db.prepare('DELETE FROM connections WHERE integration_id = ?').run(integrationId);
    }
  });
}

function requiredConnectorsOf(slug) {
  const mod = db.prepare('SELECT schema_json FROM modules WHERE slug = ?').get(slug);
  if (!mod) return [];
  return getRequiredConnectors(mod.schema_json);
}

// Installa modulo
router.post('/:slug/install', requireAuth, requireAdmin, (req, res) => {
  db.prepare('UPDATE modules SET installed = 1 WHERE slug = ?').run(req.params.slug);
  logAudit(req.user.username, 'module.install', req.params.slug, null);
  res.json({ ok: true });
});

// Disinstalla modulo
router.post('/:slug/uninstall', requireAuth, requireAdmin, (req, res) => {
  // Protezione data-driven (flag is_system sul modulo, vedi db.js) invece di una
  // lista di slug scritta a mano nel codice — un modulo "di sistema" lo dichiara
  // se stesso nel DB, non serve ricordarsi di aggiornare questo file.
  const target = db.prepare('SELECT is_system FROM modules WHERE slug = ?').get(req.params.slug);
  if (target && target.is_system) {
    return res.status(400).json({ error: 'Questo modulo non può essere disinstallato' });
  }
  const integrationIds = requiredConnectorsOf(req.params.slug);
  db.prepare('UPDATE modules SET installed = 0 WHERE slug = ?').run(req.params.slug);
  cleanupOrphanConnections(req.params.slug, integrationIds);
  logAudit(req.user.username, 'module.uninstall', req.params.slug, null);
  res.json({ ok: true });
});

// Estratta a parte (2026-09-08) — riusata anche dal rollback di
// "Suggerimenti di miglioramento" (routes/assessment.js), stessa identica
// logica di eliminazione, non duplicata a mano.
function deleteModuleCompletely(slug, actor) {
  const mod = db.prepare('SELECT id, is_system FROM modules WHERE slug = ?').get(slug);
  if (!mod) throw Object.assign(new Error('Modulo non trovato'), { status: 404 });
  if (mod.is_system) throw Object.assign(new Error('Questo modulo non può essere eliminato'), { status: 400 });
  const integrationIds = requiredConnectorsOf(slug);

  const deleteAll = db.transaction(() => {
    db.prepare('DELETE FROM modules_schema_history WHERE module_id = ?').run(mod.id);
    db.prepare('DELETE FROM records WHERE module_slug = ?').run(slug);
    db.prepare('DELETE FROM user_modules WHERE module_slug = ?').run(slug);
    db.prepare('DELETE FROM modules WHERE id = ?').run(mod.id);
  });
  deleteAll();
  cleanupOrphanConnections(slug, integrationIds);

  logAudit(actor, 'module.delete', slug, null);
}

// Elimina modulo definitivamente (creato dal wizard nel Builder)
router.delete('/:slug', requireAuth, requireAdmin, (req, res) => {
  try {
    deleteModuleCompletely(req.params.slug, req.user.username);
    res.json({ ok: true });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'Eliminazione non riuscita' });
  }
});

module.exports = router;
// Riusata da routes/assessment.js (2026-09-08, "Suggerimenti di miglioramento"
// — installare direttamente il modulo che il pannello consiglia) — stesso
// identico percorso già usato da questo file per un'installazione dallo
// Store, mai una seconda implementazione.
module.exports.installRegistryModuleById = installRegistryModuleById;
module.exports.deleteModuleCompletely = deleteModuleCompletely;
module.exports.SUPER_ADMIN_URL = SUPER_ADMIN_URL;
module.exports.INTERNAL_SECRET = INTERNAL_SECRET;
module.exports.TENANT_SLUG = TENANT_SLUG;
