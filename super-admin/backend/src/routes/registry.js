const express = require('express');
const Database = require('better-sqlite3');
const db = require('../db');
const { requireAuth, requireQueryToken } = require('./auth');
const { logAudit } = require('../audit-log');
const { mintTenantAdminToken, installModulesByIds } = require('./tenants');

// La Libreria: i moduli che costruisco, salvati con una versione, da installare in
// qualunque tenant. Installare = copiare: il tenant ne riceve una copia sua, che può
// modificare senza toccare gli altri, e vede "disponibile la v2" quando ne pubblico
// una nuova. (Il nome interno della tabella resta `registry_modules`.)
//
// Una riga = una versione di un modulo. Ripubblicare lo stesso modulo dello stesso
// tenant crea una riga nuova con versione +1: chi ha installato la precedente non
// la perde sotto i piedi.

const router = express.Router();

// Protegge gli endpoint /public/*: chiamati dai backend dei singoli tenant (rete
// Docker interna, mai esposti fuori), non da un utente Super Admin loggato.
function requireInternalSecret(req, res, next) {
  const secret = req.headers['x-internal-secret'];
  if (!secret || secret !== (process.env.INTERNAL_API_SECRET || 'changeme_internal')) {
    return res.status(401).json({ error: 'Secret interno non valido' });
  }
  next();
}

// Apre il .db di UN tenant in sola lettura: Super Admin monta lo stesso volume dati
// di tutti i tenant.
function openTenantDbReadOnly(slug) {
  const tenant = db.prepare('SELECT * FROM tenants WHERE slug = ?').get(slug);
  if (!tenant) return null;
  try {
    return new Database(tenant.db_path, { readonly: true, fileMustExist: true });
  } catch (e) {
    return null;
  }
}

// Solo l'ultima versione di ogni modulo (slug + tenant d'origine).
const LATEST_VERSIONS_SQL = `
  SELECT rm.* FROM registry_modules rm
  JOIN (SELECT slug, source_tenant_slug, MAX(version) AS v FROM registry_modules GROUP BY slug, source_tenant_slug) l
    ON l.slug = rm.slug AND l.source_tenant_slug IS rm.source_tenant_slug AND l.v = rm.version
`;

// Quante volte è stato installato un modulo (id di riga del registro).
function installCounts() {
  const counts = {};
  db.prepare("SELECT json_extract(details,'$.registry_module_id') AS rmid, COUNT(*) AS cnt FROM audit_log WHERE action = 'registry.install' GROUP BY rmid").all()
    .forEach((r) => { counts[r.rmid] = r.cnt; });
  return counts;
}

// ─── Uso da Super Admin (utente loggato) ───────────────────────────────────────

// Elenco della Libreria: l'ultima versione di ogni modulo, con quante versioni esistono.
router.get('/modules', requireAuth, (req, res) => {
  const counts = installCounts();
  const versions = {};
  db.prepare('SELECT slug, source_tenant_slug, COUNT(*) AS n FROM registry_modules GROUP BY slug, source_tenant_slug').all()
    .forEach((r) => { versions[r.slug + '@' + r.source_tenant_slug] = r.n; });
  const latest = db.prepare(LATEST_VERSIONS_SQL + ' ORDER BY rm.created_at DESC').all();
  res.json(latest.map((m) => ({
    ...m,
    versions_count: versions[m.slug + '@' + m.source_tenant_slug] || 1,
    install_count: counts[m.id] || 0,
  })));
});

// Moduli di UN tenant, per il selettore "salva nella Libreria".
router.get('/tenants/:slug/modules', requireAuth, (req, res) => {
  const tdb = openTenantDbReadOnly(req.params.slug);
  if (!tdb) return res.status(404).json({ error: 'Tenant non trovato o database non ancora creato' });
  try {
    res.json(tdb.prepare('SELECT id, name, slug, icon, color FROM modules ORDER BY name').all());
  } finally {
    tdb.close();
  }
});

// Esporta UN modulo direttamente da un tenant come file JSON. Auth via ?token=
// perché è un download da <a href>.
router.get('/tenants/:slug/modules/:moduleSlug/export', requireQueryToken, (req, res) => {
  const tdb = openTenantDbReadOnly(req.params.slug);
  if (!tdb) return res.status(404).json({ error: 'Tenant non trovato o database non ancora creato' });
  let mod;
  try {
    mod = tdb.prepare('SELECT name, slug, icon, color, schema_json FROM modules WHERE slug = ?').get(req.params.moduleSlug);
  } finally {
    tdb.close();
  }
  if (!mod) return res.status(404).json({ error: 'Modulo non trovato' });
  res.setHeader('Content-Disposition', 'attachment; filename="modulo-' + mod.slug + '.json"');
  res.setHeader('Content-Type', 'application/json');
  res.json(mod);
});

// Salva nella Libreria il modulo di un tenant. Se esiste già (stesso tenant e stesso
// modulo) nasce la versione successiva.
router.post('/publish', requireAuth, (req, res) => {
  const { tenant_slug, module_slug, description, release_notes } = req.body || {};
  if (!tenant_slug || !module_slug) return res.status(400).json({ error: 'tenant_slug e module_slug obbligatori' });

  const tdb = openTenantDbReadOnly(tenant_slug);
  if (!tdb) return res.status(404).json({ error: 'Tenant non trovato o database non ancora creato' });
  let mod;
  try {
    mod = tdb.prepare('SELECT * FROM modules WHERE slug = ?').get(module_slug);
  } finally {
    tdb.close();
  }
  if (!mod) return res.status(404).json({ error: 'Modulo non trovato in quel tenant' });

  const prev = db.prepare('SELECT MAX(version) AS v FROM registry_modules WHERE source_tenant_slug = ? AND slug = ?').get(tenant_slug, module_slug);
  const version = (prev.v || 0) + 1;

  const result = db.prepare(`
    INSERT INTO registry_modules (name, slug, description, icon, color, schema_json, version, source_tenant_slug, release_notes, group_name, support_module)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(mod.name, mod.slug, description || '', mod.icon, mod.color, mod.schema_json, version, tenant_slug,
    release_notes || '', mod.group_name || null, mod.support_module ? 1 : 0);

  logAudit(req.user.username, 'registry.publish', module_slug, { tenant_slug, version });
  res.json(db.prepare('SELECT * FROM registry_modules WHERE id = ?').get(result.lastInsertRowid));
});

// Corregge descrizione e note di una versione senza ripubblicare.
router.patch('/modules/:id', requireAuth, (req, res) => {
  const mod = db.prepare('SELECT * FROM registry_modules WHERE id = ?').get(req.params.id);
  if (!mod) return res.status(404).json({ error: 'Modulo non trovato nella Libreria' });
  const { description, release_notes } = req.body || {};
  db.prepare('UPDATE registry_modules SET description = ?, release_notes = ? WHERE id = ?').run(
    description ?? mod.description,
    release_notes ?? mod.release_notes,
    mod.id
  );
  logAudit(req.user.username, 'registry.update', mod.slug, { registry_module_id: mod.id });
  res.json(db.prepare('SELECT * FROM registry_modules WHERE id = ?').get(mod.id));
});

// Toglie dalla Libreria UNA versione. I tenant che l'hanno già installata non cambiano.
router.delete('/modules/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM default_modules WHERE registry_module_id = ?').run(req.params.id);
  db.prepare('DELETE FROM registry_modules WHERE id = ?').run(req.params.id);
  logAudit(req.user.username, 'registry.remove', req.params.id, null);
  res.json({ ok: true });
});

// Storico delle versioni dello stesso modulo.
router.get('/modules/:id/versions', requireAuth, (req, res) => {
  const mod = db.prepare('SELECT slug, source_tenant_slug FROM registry_modules WHERE id = ?').get(req.params.id);
  if (!mod) return res.status(404).json({ error: 'Modulo non trovato nella Libreria' });
  res.json(db.prepare(`
    SELECT id, version, created_at, release_notes
    FROM registry_modules WHERE slug = ? AND source_tenant_slug IS ? ORDER BY version DESC
  `).all(mod.slug, mod.source_tenant_slug));
});

// Struttura completa di una versione (campi, relazioni, workflow, ...): serve alla
// scheda "Struttura" della Libreria.
router.get('/modules/:id/schema', requireAuth, (req, res) => {
  const mod = db.prepare('SELECT id, name, slug, version, schema_json FROM registry_modules WHERE id = ?').get(req.params.id);
  if (!mod) return res.status(404).json({ error: 'Modulo non trovato nella Libreria' });
  res.json(mod);
});

// Esporta una versione come JSON scaricabile. Auth via ?token= (download da <a href>).
router.get('/modules/:id/export', requireQueryToken, (req, res) => {
  const mod = db.prepare('SELECT name, slug, description, icon, color, schema_json, version FROM registry_modules WHERE id = ?').get(req.params.id);
  if (!mod) return res.status(404).json({ error: 'Modulo non trovato' });
  res.setHeader('Content-Disposition', 'attachment; filename="modulo-' + mod.slug + '-v' + mod.version + '.json"');
  res.setHeader('Content-Type', 'application/json');
  res.json(mod);
});

// Installa una versione della Libreria in un tenant: il tenant ne riceve una COPIA e
// si ricorda da quale versione viene, così può proporre l'aggiornamento.
router.post('/modules/:id/install-to/:slug', requireAuth, async (req, res) => {
  const mod = db.prepare('SELECT id, name, slug, version FROM registry_modules WHERE id = ?').get(req.params.id);
  if (!mod) return res.status(404).json({ error: 'Modulo non trovato nella Libreria' });
  const tenant = db.prepare('SELECT slug FROM tenants WHERE slug = ?').get(req.params.slug);
  if (!tenant) return res.status(404).json({ error: 'Tenant non trovato' });
  try {
    const result = await installModulesByIds(tenant.slug, [mod.id]);
    logAudit(req.user.username, 'registry.install', mod.slug, { registry_module_id: mod.id, tenant_slug: tenant.slug, version: mod.version });
    res.json({ ok: true, installed: result ? result.modules : [] });
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message || 'Tenant non raggiungibile (container fermo?)' });
  }
});

// Carica un modulo esportato (file JSON) in un tenant, senza passare dalla Libreria.
router.post('/tenants/:slug/install-module', requireAuth, async (req, res) => {
  const { name, icon, color, schema_json, description } = req.body || {};
  if (!name || !schema_json) return res.status(400).json({ error: 'name e schema_json obbligatori' });
  const tenant = db.prepare('SELECT slug FROM tenants WHERE slug = ?').get(req.params.slug);
  if (!tenant) return res.status(404).json({ error: 'Tenant non trovato' });
  try {
    const token = await mintTenantAdminToken(tenant.slug);
    const r = await fetch('http://platform-' + tenant.slug + ':80/api/modules/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ name, icon, color, schema_json, description }),
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data.error || 'Installazione rifiutata dal tenant' });
    logAudit(req.user.username, 'registry.install_module_manual', tenant.slug, { module_name: name });
    res.json(data);
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message || 'Tenant non raggiungibile (container fermo?)' });
  }
});

// Moduli installati di default in ogni tenant nuovo.
router.get('/default-modules', requireAuth, (req, res) => {
  res.json(db.prepare(`
    SELECT rm.* FROM default_modules dm
    JOIN registry_modules rm ON rm.id = dm.registry_module_id
    ORDER BY rm.name
  `).all());
});

router.put('/default-modules', requireAuth, (req, res) => {
  const { module_ids } = req.body || {};
  if (!Array.isArray(module_ids)) return res.status(400).json({ error: 'Payload non valido: atteso { module_ids: [...] }' });
  db.transaction(() => {
    db.prepare('DELETE FROM default_modules').run();
    const insert = db.prepare('INSERT OR IGNORE INTO default_modules (registry_module_id) VALUES (?)');
    module_ids.forEach((id) => insert.run(id));
  })();
  logAudit(req.user.username, 'registry.default_modules.update', null, { module_ids });
  res.json({ ok: true, count: module_ids.length });
});

// ─── Uso da un backend tenant (secret interno) ─────────────────────────────────

// Elenco per la pagina Libreria del tenant. Mai schema_json: quello arriva solo
// installando.
router.get('/public/modules', requireInternalSecret, (req, res) => {
  const counts = installCounts();
  const modules = db.prepare(
    LATEST_VERSIONS_SQL.replace('SELECT rm.*', 'SELECT rm.id, rm.name, rm.slug, rm.description, rm.icon, rm.color, rm.version, rm.source_tenant_slug, rm.release_notes, rm.group_name, rm.support_module')
    + ' ORDER BY rm.name'
  ).all();
  res.json(modules.map((m) => ({ ...m, support_module: !!m.support_module, install_count: counts[m.id] || 0 })));
});

// Aggiornamento di un modulo già installato (il tenant lo sta solo aggiornando).
router.post('/public/modules/:id/refresh', requireInternalSecret, (req, res) => {
  const { tenant_slug } = req.body || {};
  if (!tenant_slug) return res.status(400).json({ error: 'tenant_slug obbligatorio' });
  const mod = db.prepare('SELECT * FROM registry_modules WHERE id = ?').get(req.params.id);
  if (!mod) return res.status(404).json({ error: 'Modulo non trovato nella Libreria' });
  logAudit(tenant_slug, 'registry.refresh', mod.slug, { registry_module_id: mod.id, version: mod.version });
  res.json(modulePayload(mod));
});

router.post('/public/modules/:id/install', requireInternalSecret, (req, res) => {
  const { tenant_slug } = req.body || {};
  if (!tenant_slug) return res.status(400).json({ error: 'tenant_slug obbligatorio' });
  const mod = db.prepare('SELECT * FROM registry_modules WHERE id = ?').get(req.params.id);
  if (!mod) return res.status(404).json({ error: 'Modulo non trovato nella Libreria' });
  logAudit(tenant_slug, 'registry.install', mod.slug, { registry_module_id: mod.id });
  res.json(modulePayload(mod));
});

// id/version/slug/origine in più rispetto al solo schema: il tenant deve sapere da
// dove viene un modulo installato per confrontarlo con le versioni successive.
function modulePayload(mod) {
  return {
    id: mod.id, version: mod.version, slug: mod.slug, source_tenant_slug: mod.source_tenant_slug,
    name: mod.name, icon: mod.icon, color: mod.color, schema_json: mod.schema_json,
    description: mod.description, group_name: mod.group_name, support_module: !!mod.support_module,
  };
}

module.exports = router;
