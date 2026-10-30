// ─── CONFIGURAZIONE TENANT DA ANALISI ───────────────────────────────────────
// Un'analisi cliente ricca (reparto, ruoli coinvolti, passaggi ordinati per
// processo — vedi ProcessoEditor.jsx) prima restava solo documentazione: il
// modulo scelto veniva installato "vuoto" (installModulesByIds copia
// schema_json verbatim dal Registro), nessun ruolo/workflow/permesso reale
// nasceva da quei dati. Richiesto esplicitamente dall'utente: i "ruoli
// coinvolti" devono diventare ruoli/permessi reali, i "passaggi" devono
// diventare stati di workflow.
//
// Scrive SEMPRE schema v3 puro ({version:3, steps:[...]}), mai v2-lenient a
// mano — verificato che parseSchemaNormalized()/toV2Lenient() (shared/schema-v3-core.js)
// sono il punto unico di lettura per qualunque consumer (permissions.js,
// records.js), quindi v3 puro è sicuro. La scrittura v2-lenient diretta con
// _v3_unsupported (pattern di super-builder.js /deploy) è la stessa forma che
// ha causato un bug reale già corretto (getAutomationSteps, 2026-08-10) — qui
// si evita deliberatamente.
//
// Non distruttivo per design: mai sovrascrive un workflow/permessi già
// presenti su un modulo (es. un modulo del Registro pubblicato con la sua
// configurazione reale) — genera solo per colmare un vuoto, mai per
// sostituire una scelta già fatta nel Builder.
const { logAudit } = require('../audit-log');
const { genId } = require('../../../../shared/schema-v3-core.js');
const { callTenantAPI } = require('./tenant-api-client');

const BUILT_IN_ROLES = ['admin', 'user'];
const PALETTE = ['#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EF4444', '#06B6D4', '#EC4899', '#84CC16'];

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

// Costruisce workflow_state (uno per passaggio, il primo initial:true) +
// workflow_transition tra stati consecutivi. Un ruolo con tipo diverso da
// 'utente' (es. "Sistema", "Commercialista" — presenti solo come
// documentazione, mai come riga reale in roles) genera una transizione con
// roles:[] (nessuna restrizione) invece di puntare a un nome ruolo
// inesistente, che bloccherebbe la transizione per chiunque.
function buildWorkflowSteps(passaggi, roleLookup) {
  if (!Array.isArray(passaggi) || passaggi.length === 0) return [];
  const stateKeys = [];
  const steps = [];
  const usedKeys = new Set();

  passaggi.forEach((step, i) => {
    const titolo = (step && (step.titolo || step.ruolo) || `Stato ${i + 1}`).toString().trim() || `Stato ${i + 1}`;
    const base = slugify(titolo) || `stato_${i + 1}`;
    let key = base;
    let n = 2;
    while (usedKeys.has(key)) { key = base + '_' + n; n++; }
    usedKeys.add(key);
    stateKeys.push(key);
    steps.push({
      id: genId('wst'), block_type: 'workflow_state',
      key, label: titolo, color: PALETTE[i % PALETTE.length], initial: i === 0,
    });
  });

  for (let i = 1; i < stateKeys.length; i++) {
    const passaggio = passaggi[i] || {};
    const label = (passaggio.titolo || `Passaggio ${i + 1}`).toString().trim();
    const roleLabel = (passaggio.ruolo || '').toString().trim().toLowerCase();
    const info = roleLabel ? roleLookup.get(roleLabel) : null;
    const roles = info && info.tipo === 'utente' ? [info.slug] : [];
    steps.push({
      id: genId('wtr'), block_type: 'workflow_transition',
      from: stateKeys[i - 1], to: stateKeys[i], label, roles,
    });
  }
  return steps;
}

// Una regola per ogni ruolo tipo:'utente' — default conservativo (view/create/edit
// sì, delete no): l'analisi non ha abbastanza informazione per sapere quale
// relazione rappresenta "il mio record" (view_own_only/owner_field), quella
// rifinitura resta un passo manuale nel Builder dopo la generazione.
function buildPermissionsStep(ruoliCoinvolti, roleLookup) {
  const utenteRoles = (ruoliCoinvolti || []).filter((r) => r && r.nome && (!r.tipo || r.tipo === 'utente'));
  if (utenteRoles.length === 0) return null;
  const seen = new Set();
  const rules = [];
  utenteRoles.forEach((r) => {
    const label = String(r.nome).trim();
    const info = roleLookup.get(label.toLowerCase());
    const slug = (info && info.slug) || slugify(label);
    if (!slug || seen.has(slug)) return;
    seen.add(slug);
    rules.push({ role: slug, view: true, view_own_only: false, create: true, edit: true, delete: false });
  });
  if (rules.length === 0) return null;
  return { id: genId('prm'), block_type: 'permissions', rules };
}

// processi: process_analyses.processi[] (già arricchiti da ProcessoEditor.jsx).
// installedRegistryModuleIds: gli id Registro effettivamente installati sul
// tenant (stessi passati a installModulesByIds), per non generare config su
// un modulo scartato (es. ancora 'preview', vedi routes/analyses.js).
//
// Fase 12.5 (audit 2026-09-02) — B2b: prima apriva il .db del tenant direttamente
// (lettura+scrittura di roles/modules.schema_json). Ora chiama l'API del tenant
// (core/backend, POST /roles/internal/sync + POST /modules/internal/apply-workflow-config)
// — le funzioni pure sotto (buildWorkflowSteps/buildPermissionsStep/slugify) restano
// invariate, costruiscono solo i blocchi CANDIDATI: è il tenant stesso a decidere se
// applicarli (mai sovrascrivere un workflow/permessi già presenti — controllo ora
// dentro core/backend/src/routes/modules.js, non più qui) e a validarli con schema-v3
// prima di scrivere.
async function applyAnalysisConfigToTenant({ tenantSlug, processi, installedRegistryModuleIds, actor }) {
  const result = { roles_created: [], modules_configured: [], skipped: [] };
  if (!Array.isArray(processi) || processi.length === 0) return result;

  // 1) Sincronizza ruoli — su TUTTI i processi (i ruoli sono per-tenant, non
  // per-modulo), solo tipo:'utente', mai duplicati/built-in. Dedup qui (per slug)
  // prima di mandarli: /roles/internal/sync è comunque idempotente lato tenant,
  // ma evita di mandare due volte lo stesso ruolo scritto in due processi diversi.
  const roleCandidates = new Map();
  let colorIdx = 0;
  processi.forEach((p) => {
    (p.ruoli_coinvolti || []).forEach((r) => {
      if (!r || !r.nome || (r.tipo && r.tipo !== 'utente')) return;
      const label = String(r.nome).trim();
      if (!label) return;
      const slug = slugify(label);
      if (!slug || BUILT_IN_ROLES.includes(slug) || roleCandidates.has(slug)) return;
      roleCandidates.set(slug, { slug, label, color: PALETTE[colorIdx % PALETTE.length] });
      colorIdx++;
    });
  });
  if (roleCandidates.size > 0) {
    const syncResult = await callTenantAPI(tenantSlug, 'POST', '/api/roles/internal/sync', { roles: [...roleCandidates.values()] });
    result.roles_created = syncResult.created || [];
  }

  // 2) Un solo processo per modulo installato — vince il primo (deterministico).
  // Una SOLA chiamata batch invece di una per modulo (2026-09-11, bug reale di
  // performance: un'analisi con 7-8 moduli mandava altrettanti round-trip
  // sequenziali al tenant appena creato, su un NAS lento causa diretta di
  // creazioni tenant da 270+ secondi) — vedi apply-workflow-config-batch in
  // core/backend/routes/modules.js, stessa identica logica per-modulo, solo
  // eseguita in loop lato tenant invece che dal chiamante.
  const installedSet = new Set(installedRegistryModuleIds || []);
  const seenModules = new Set();
  const configs = [];
  for (const p of processi) {
    if (!p.registry_module_id || !installedSet.has(p.registry_module_id)) continue;
    if (seenModules.has(p.registry_module_id)) {
      result.skipped.push({ registry_module_id: p.registry_module_id, reason: 'processo_duplicato_stesso_modulo' });
      continue;
    }
    seenModules.add(p.registry_module_id);

    const roleLookup = new Map();
    (p.ruoli_coinvolti || []).forEach((r) => {
      if (!r || !r.nome) return;
      const label = String(r.nome).trim();
      if (!label) return;
      roleLookup.set(label.toLowerCase(), { tipo: r.tipo || 'utente', slug: slugify(label) });
    });

    const workflow_steps = Array.isArray(p.passaggi) && p.passaggi.length > 0 ? buildWorkflowSteps(p.passaggi, roleLookup) : [];
    const permissions_step = buildPermissionsStep(p.ruoli_coinvolti, roleLookup);
    configs.push({ registry_module_id: p.registry_module_id, workflow_steps, permissions_step });
  }

  if (configs.length > 0) {
    try {
      const batchResult = await callTenantAPI(tenantSlug, 'POST', '/api/modules/internal/apply-workflow-config-batch', { configs });
      (batchResult.results || []).forEach((applyResult) => {
        if (applyResult.configured) {
          result.modules_configured.push({
            registry_module_id: applyResult.registry_module_id,
            workflow_states: applyResult.workflow_states,
            has_permissions: applyResult.has_permissions,
          });
        } else {
          result.skipped.push({ registry_module_id: applyResult.registry_module_id, reason: applyResult.reason });
        }
      });
    } catch (e) {
      configs.forEach((c) => result.skipped.push({ registry_module_id: c.registry_module_id, reason: 'errore_chiamata_tenant: ' + e.message }));
    }
  }

  // 3) Relazioni nuove tra moduli di verticali diverse (30/10/2026, richiesto
  // dall'utente: un'analisi ricca installava moduli "muti", senza relazioni tra
  // loro, perché vengono dalla Libreria da tenant diversi — withDependencies
  // sopra porta dentro solo le relazioni che un modulo scelto GIÀ aveva, mai ne
  // crea di nuove). L'AI propone leggendo i processi, apply-relations-batch (su
  // core/backend) valida e scrive — mai sovrascrive una relazione già presente.
  result.relations_created = [];
  try {
    const relazioni = await require('./analysis').proponiRelazioni(processi, installedRegistryModuleIds);
    if (relazioni.length > 0) {
      const relResult = await callTenantAPI(tenantSlug, 'POST', '/api/modules/internal/apply-relations-batch', {
        relations: relazioni.map((r) => ({ registry_module_id: r.da, target_registry_module_id: r.verso })),
      });
      result.relations_created = (relResult.results || []).filter((r) => r.configured);
    }
  } catch (e) {
    result.relations_error = e.message;
  }

  if (result.roles_created.length > 0 || result.modules_configured.length > 0 || result.relations_created.length > 0) {
    logAudit(actor || 'sistema', 'analysis.tenant_config_applied', tenantSlug, {
      roles_created: result.roles_created,
      modules_configured: result.modules_configured.map((m) => m.registry_module_id),
      relations_created: result.relations_created.map((r) => r.registry_module_id + '->' + r.target_registry_module_id),
    });
  }
  return result;
}

module.exports = { applyAnalysisConfigToTenant };
