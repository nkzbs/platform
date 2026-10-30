'use strict';
// «Ti manca un modulo?» — una volta alla settimana (più raro delle osservazioni giornaliere di
// suggestions.js: questa costa una vera chiamata AI), guarda l'insieme dei moduli installati e chiede
// all'AI (super-admin/backend/src/routes/tenant-ai.js → module-gap, stessa autenticazione già usata da
// routes/suggestions.js per /suggestion) se manca qualcosa: installare un modulo già pronto in Libreria,
// o costruirne uno nuovo. Mai i valori delle righe, solo struttura e qualche indizio già calcolato in
// locale (testo_da_strutturare, vedi suggestions.js). Un solo suggerimento aperto alla volta: non si
// installa né si costruisce da sola, propone e basta.
const db = require('./db');
const { parseSchemaNormalized } = require('./schema-v3');
const { signTenantRequest } = require('./lib/tenant-request-token');

const SUPER_ADMIN_URL = process.env.SUPER_ADMIN_URL || 'http://super-admin-backend:3000';
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || 'changeme_internal';
const RULE_KEY = 'modulo_mancante';
const SENTINEL = '_piattaforma'; // non un modulo vero: la riga non riguarda un modulo installato in particolare

function moduliInstallati() {
  return db.prepare("SELECT slug, name, schema_json, registry_module_id FROM modules WHERE installed = 1 AND COALESCE(is_system, 0) = 0").all()
    .map((m) => {
      let schema; try { schema = parseSchemaNormalized(m.schema_json); } catch (e) { return null; }
      return {
        nome: m.name, registry_module_id: m.registry_module_id || null,
        campi: (schema.fields || []).map((f) => ({ key: f.key, type: f.type })),
        stati: ((schema.workflow && schema.workflow.states) || []).map((s) => s.label || s.key),
      };
    }).filter(Boolean);
}

// Riusa un segnale già calcolato gratis ogni giorno (testo_da_strutturare): un campo di testo che ripete
// sempre gli stessi pochi valori è un indizio che manchi un collegamento a un'entità vera.
function indizi() {
  return db.prepare("SELECT title FROM suggestions WHERE rule_key = 'testo_da_strutturare' AND status = 'open' ORDER BY last_seen DESC LIMIT 5").all().map((r) => r.title);
}

async function chiediAllAI() {
  const installati = moduliInstallati();
  if (!installati.length) return null;
  const installed_registry_ids = installati.map((m) => m.registry_module_id).filter(Boolean);
  const payload = { installati: installati.map(({ nome, campi, stati }) => ({ nome, campi, stati })), indizi: indizi(), installed_registry_ids };
  const r = await fetch(SUPER_ADMIN_URL + '/api/tenant-ai/module-gap', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET, 'Authorization': 'Bearer ' + signTenantRequest('tenant-ai') },
    signal: AbortSignal.timeout(45000), body: JSON.stringify({ tenant_slug: process.env.TENANT_SLUG, data: payload }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(body.error || 'module-gap: errore ' + r.status); e.code = body.code; throw e; }
  return body.proposta;
}

// Scrive (o aggiorna) l'unico suggerimento 'modulo_mancante' aperto; una proposta diversa dalla volta
// prima chiude quella vecchia (mai due proposte di questo tipo aperte insieme: sarebbe solo rumore).
function salva(proposta) {
  const target = proposta.tipo === 'installa' ? 'installa:' + proposta.registry_module_id : 'crea:' + proposta.nome.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
  const title = proposta.tipo === 'installa'
    ? 'La Libreria ha un modulo pronto, «' + proposta.nome + '», che potrebbe servirti'
    : 'Potrebbe servirti un modulo nuovo: «' + proposta.nome + '»';
  db.transaction(() => {
    const vecchie = db.prepare("SELECT id, target FROM suggestions WHERE rule_key = ? AND status = 'open'").all(RULE_KEY);
    for (const v of vecchie) if (v.target !== target) db.prepare("UPDATE suggestions SET status = 'resolved', resolved_at = CURRENT_TIMESTAMP WHERE id = ?").run(v.id);
    const e = db.prepare('SELECT id, status FROM suggestions WHERE rule_key = ? AND module_slug = ? AND target = ?').get(RULE_KEY, SENTINEL, target);
    if (!e) db.prepare('INSERT INTO suggestions (rule_key, module_slug, target, title, data) VALUES (?, ?, ?, ?, ?)').run(RULE_KEY, SENTINEL, target, title, JSON.stringify(proposta));
    else if (e.status === 'resolved') db.prepare("UPDATE suggestions SET status = 'open', resolved_at = NULL, title = ?, data = ?, last_seen = CURRENT_TIMESTAMP WHERE id = ?").run(title, JSON.stringify(proposta), e.id);
    else db.prepare('UPDATE suggestions SET title = ?, data = ?, last_seen = CURRENT_TIMESTAMP WHERE id = ?').run(title, JSON.stringify(proposta), e.id);
  })();
}

async function controlla() {
  if (!require('./features').isEnabled('suggerimenti')) return { skipped: 'feature_off' };
  let proposta;
  try { proposta = await chiediAllAI(); }
  catch (e) { if (e.code === 'ai_not_configured') return { skipped: 'ai_not_configured' }; throw e; }
  if (!proposta || proposta.tipo === 'nessuna') return { nessuna: true };
  salva(proposta);
  return { proposta };
}

let running = false;
async function tick() {
  if (running) return null;
  running = true;
  try { return await controlla(); } finally { running = false; }
}

function startModuleGap() {
  const { withLock } = require('./scheduler-lock');
  const guarded = withLock('module-gap', 30 * 60 * 1000, async () => tick());
  let ultimo = 0;
  const SETTIMANA = 7 * 24 * 3600 * 1000;
  // un controllo ogni 6 ore decide se è passata una settimana dall'ultimo giro (la chiamata vera costa: niente di più frequente)
  setInterval(() => { if (Date.now() - ultimo < SETTIMANA) return; ultimo = Date.now(); Promise.resolve().then(() => guarded()).catch((e) => console.error('[modulo-mancante]', e.message)); }, 6 * 3600 * 1000).unref();
  setTimeout(() => { ultimo = Date.now(); Promise.resolve().then(() => guarded()).catch(() => {}); }, 5 * 60 * 1000).unref();
}

module.exports = { moduliInstallati, indizi, chiediAllAI, salva, controlla, tick, startModuleGap, RULE_KEY, SENTINEL };
