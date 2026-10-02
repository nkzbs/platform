const express = require('express');
const fs = require('fs');
const db = require('../db');
const { requireAuth } = require('./auth');
const { logAudit } = require('../audit-log');
const { createTenant, waitForTenantDb, ensureTenantRunning } = require('./tenants');
const { parseJsonResponse } = require('../lib/ai');
const { callAI, isProviderConfigured } = require('../lib/ai-providers');

// AI_PROVIDER (2026-09-06) — un solo punto per scegliere il provider di
// QUESTA route, non un selettore per-richiesta/per-utente: l'utente ha
// chiesto di estendere Mistral al Builder dopo averlo verificato dal vivo
// con ai-providers.js. Env var, non un campo in più nella UI — coerente col
// principio "extension point, non un framework" già seguito per
// ai-providers.js stesso. Default 'anthropic' per non cambiare
// comportamento a chi non ha ancora toccato questa variabile.
const AI_PROVIDER = process.env.AI_PROVIDER || 'anthropic';
const { callTenantAPI } = require('../lib/tenant-api-client');

const router = express.Router();

// Un sandbox per generazione al volo, non uno per bozza: rifinire con l'editor
// Builder esistente serve solo un posto dove il modulo generato "vive" finché
// non viene pubblicato nel registro (registry.js). Semplificazione 2026-09-27
// (rimozione del concetto Partner): un solo operatore, un solo sandbox
// condiviso — prima esisteva anche un sandbox dedicato per partner.
const CORE_SANDBOX_SLUG = 'ai-sandbox';
function sandboxSlugFor() {
  return CORE_SANDBOX_SLUG;
}
function sandboxNameFor() {
  return 'AI Sandbox (Super Builder)';
}

// Spec condensata dello schema v3 (vedi core/backend/src/schema-v3.js) + due esempi
// reali presi da moduli davvero pubblicati — non inventati apposta per il prompt.
// Tenerli reali (non esempi giocattolo) è deliberato: il modello copia lo STILE
// di questi schemi (nomi chiave, convenzioni id, come si esprime una relazione),
// non solo la sintassi.
const SCHEMA_SPEC = `Genera SOLO un oggetto JSON schema "v3" per un modulo di Platform Core. Formato:
{"version": 3, "steps": [ ...blocchi in ordine... ]}

Ogni blocco ha "id" (stringa univoca, es. "fld_titolo", "rel_cliente", "wst_bozza") e "block_type", più le proprietà del tipo:

- block_type "field": key, label, type (text|number|currency|date|time|select|textarea|file|checkbox|computed), required (bool, opzionale), options (array, solo per type select), expr (solo per type computed — espressioni tipo "sum_children(modulo.campo)").
- block_type "relation": key, label, type ("many_to_one" o "many_to_many"), target_module (slug del modulo collegato), display_mode ("select_inline"), display_field (campo del modulo target da mostrare).
- block_type "workflow_state": key, label, color (hex), initial (bool, solo sul primo stato).
- block_type "workflow_transition": from, to, label (etichetta del bottone).
- block_type "scope": eventuali filtri di visibilità globale (raro, ometti se non richiesto).

Regole:
- Il primo workflow_state deve avere "initial": true.
- Ogni workflow_transition deve riferirsi a "from"/"to" che esistono tra i workflow_state definiti.
- Non inventare target_module che non esistono se l'utente non li ha menzionati — se serve una relazione a un modulo non specificato, usa un nome slug plausibile e segnalalo a parte (non nel JSON).
- Rispondi SOLO con il JSON, nessun testo prima o dopo, nessun blocco markdown \`\`\`.

Esempio reale 1 — modulo "Documenti" (solo campi + relazioni, nessun workflow):
{"version":3,"steps":[{"id":"fld_titolo","block_type":"field","key":"titolo","label":"Titolo","type":"text","required":true},{"id":"fld_tipo","block_type":"field","key":"tipo","label":"Tipo","type":"select","options":["Contratto","Fattura","Altro"]},{"id":"fld_data","block_type":"field","key":"data","label":"Data","type":"date"},{"id":"fld_file","block_type":"field","key":"file","label":"File","type":"file"},{"id":"rel_cliente","block_type":"relation","key":"cliente","label":"Cliente collegato","type":"many_to_one","target_module":"clienti","display_mode":"select_inline","display_field":"nome"}]}

Esempio reale 2 — modulo "Ordini" (campi + relazioni + workflow con più stati):
{"version":3,"steps":[{"id":"fld_numero","block_type":"field","key":"numero","label":"Numero Ordine","type":"text"},{"id":"fld_data","block_type":"field","key":"data","label":"Data","type":"date","required":true},{"id":"fld_totale","block_type":"field","key":"totale","label":"Totale Ordine (€)","type":"computed","expr":"sum_children(ordini_righe.totale_riga)"},{"id":"rel_cliente","block_type":"relation","key":"cliente","label":"Cliente","type":"many_to_one","target_module":"clienti","display_mode":"select_inline","display_field":"ragione_sociale"},{"id":"wst_bozza","block_type":"workflow_state","key":"bozza","label":"Bozza","color":"#F59E0B","initial":true},{"id":"wst_confermato","block_type":"workflow_state","key":"confermato","label":"Confermato","color":"#3B82F6"},{"id":"wst_consegnato","block_type":"workflow_state","key":"consegnato","label":"Consegnato","color":"#10B981"},{"id":"wtr_conferma","block_type":"workflow_transition","from":"bozza","to":"confermato","label":"Conferma"},{"id":"wtr_consegna","block_type":"workflow_transition","from":"confermato","to":"consegnato","label":"Segna Consegnato"}]}`;

router.get('/status', requireAuth, (req, res) => {
  const slug = sandboxSlugFor();
  const sandbox = db.prepare('SELECT slug, name, port, status FROM tenants WHERE slug = ?').get(slug);
  res.json({ configured: isProviderConfigured(AI_PROVIDER), provider: AI_PROVIDER, sandbox: sandbox || null });
});

router.post('/generate', requireAuth, async (req, res) => {
  if (!isProviderConfigured(AI_PROVIDER)) {
    const envVar = AI_PROVIDER === 'mistral' ? 'MISTRAL_API_KEY' : 'ANTHROPIC_API_KEY';
    return res.status(501).json({ error: 'ai_not_configured', message: 'Imposta ' + envVar + ' come variabile d\'ambiente sul backend di Super Admin per generare bozze via AI (provider attivo: ' + AI_PROVIDER + ').' });
  }
  const { prompt, module_name } = req.body;
  if (!prompt || !String(prompt).trim()) return res.status(400).json({ error: 'Descrivi il modulo da generare' });

  try {
    const userMsg = 'Nome modulo: ' + (module_name || '(da dedurre dalla descrizione)') + '\nDescrizione richiesta dall\'utente:\n' + prompt;
    const text = await callAI(AI_PROVIDER, { system: SCHEMA_SPEC, user: userMsg, maxTokens: 4096 });

    let schema;
    try {
      schema = parseJsonResponse(text);
    } catch (e) {
      return res.status(502).json({ error: 'Il modello non ha restituito un JSON valido', raw: text.slice(0, 2000) });
    }
    if (schema.version !== 3 || !Array.isArray(schema.steps) || schema.steps.length === 0) {
      return res.status(502).json({ error: 'Schema generato non valido (manca version:3 o steps)', raw: text.slice(0, 2000) });
    }

    logAudit(req.user.username, 'super_builder.generate', module_name || '(senza nome)', { prompt_length: prompt.length, steps: schema.steps.length });
    res.json({ schema_json: schema });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Crea (se manca) il tenant sandbox del chiamante — estratta a parte (prima
// viveva solo dentro /deploy) così anche /ensure-sandbox può riusarla per il
// percorso "Nuovo modulo da zero" senza AI: prima l'unico modo di ottenere il
// sandbox era generare prima una bozza AI, non c'era un ingresso diretto per
// chi vuole costruire a mano.
async function ensureSandbox(actor) {
  const slug = sandboxSlugFor();
  let sandbox = db.prepare('SELECT * FROM tenants WHERE slug = ?').get(slug);
  if (!sandbox) {
    const created = await createTenant({ name: sandboxNameFor(), slug, actor, isSandbox: true });
    sandbox = created.tenant;
    await waitForTenantDb(sandbox.db_path);
  } else if (!fs.existsSync(sandbox.db_path)) {
    await waitForTenantDb(sandbox.db_path);
  }
  // Un sandbox esistente ma inutilizzato per giorni può risultare FERMO (bug
  // reale 2026-09-12: "ho creato un modulo... ma non posso selezionarlo" — il
  // sandbox condiviso di Core era fermo da 5 giorni, ogni scrittura falliva
  // in silenzio). Riga+file che esistono non bastano, va garantito che il
  // container risponda davvero prima di scriverci dentro via HTTP sotto.
  await ensureTenantRunning(sandbox.slug);
  return sandbox;
}

// Garantisce che il sandbox esista e lo ritorna — chiamato dal bottone "Nuovo modulo
// da zero" in TenantBuilderPage PRIMA di aver scelto un tenant, esattamente come
// /deploy fa già in automatico quando l'AI genera una bozza senza un target_slug.
router.post('/ensure-sandbox', requireAuth, async (req, res) => {
  try {
    const sandbox = await ensureSandbox(req.user.username);
    res.json({ slug: sandbox.slug, port: sandbox.port, domain: sandbox.domain });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Crea (se manca) il tenant sandbox del chiamante e ci scrive dentro il modulo
// generato — stessa scrittura diretta sul .db già usata da cloneModulesFromTemplate,
// non l'endpoint di installazione dal registro (pensato per un tenant che chiama
// Super Admin, non il contrario). Da qui l'operatore apre il Builder ESISTENTE sul
// tenant sandbox per rifinire la bozza, invece di duplicare un editor dentro Super
// Admin. Sempre e solo il sandbox condiviso — il Super Builder serve solo a
// costruire un modulo da pubblicare allo Store, non a toccare un tenant reale
// (quello resta "Apri →" su Tenant, che apre il Builder vero e sempre aggiornato
// del tenant).
router.post('/deploy', requireAuth, async (req, res) => {
  const { module_slug, module_name, schema_json, icon, color } = req.body;
  if (!module_slug || !module_name || !schema_json) return res.status(400).json({ error: 'module_slug, module_name e schema_json obbligatori' });

  try {
    const sandbox = await ensureSandbox(req.user.username);

    // Fase 12.5 (audit 2026-09-02) — B2c: chiama l'API del sandbox invece di aprire
    // il suo .db direttamente. Bonus reale del refactor: prima questa scrittura non
    // passava MAI da schema-v3 prima di scrivere (unico punto in tutta questa fase
    // dove mancava anche nell'originale) — ora sì, dentro /modules/internal/upsert.
    await callTenantAPI(sandbox.slug, 'POST', '/api/modules/internal/upsert', {
      slug: module_slug, name: module_name, icon, color, schema_json,
    });

    logAudit(req.user.username, 'super_builder.deploy', module_slug, { sandbox_slug: sandbox.slug });
    res.json({ ok: true, sandbox_slug: sandbox.slug, sandbox_port: sandbox.port, module_slug });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
// Riusata da routes/registry.js per l'installazione in anteprima di una
// pubblicazione (stage 'preview') — stesso sandbox condiviso, nessuna
// seconda implementazione.
module.exports.ensureSandbox = ensureSandbox;
// Riusata da routes/registry.js per riconoscere se un tenant sorgente è
// PROPRIO il sandbox del chiamante (smaltimento automatico dopo /release).
module.exports.sandboxSlugFor = sandboxSlugFor;
