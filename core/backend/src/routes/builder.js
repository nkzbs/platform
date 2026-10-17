const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('./auth');
const { validateFormula, evaluateFormula, validateSteps, evaluateSteps, loadModuleMap } = require('../formula');
const { parseSchemaNormalized, isV3, toV2Lenient, getAutomationSteps } = require('../schema-v3');
const { logAudit } = require('../audit-log');
const { attachComputedFields } = require('../computed-fields');
const { decryptFields } = require('../crypto-fields');
const { extractRefs } = require('../formula');
const { runAzioni } = require('../automation-engine');
const { runSourceScript } = require('../source-engine');
const vm = require('vm');

const router = express.Router();

// Mappa moduli installati con i relativi campi — cache che il Builder carica una volta sola
// per alimentare autocomplete e validazione client-side (evita un round-trip per ogni tasto)
router.get('/schema-cache', requireAuth, requireAdmin, (req, res) => {
  const modules = db.prepare('SELECT slug, name, icon, color FROM modules WHERE installed = 1').all();
  const full = modules.map((m) => {
    const row = db.prepare('SELECT schema_json, schema_json_draft FROM modules WHERE slug = ?').get(m.slug);
    let schema = {};
    try { schema = parseSchemaNormalized(row.schema_json_draft || row.schema_json); } catch (e) {}
    // 'relations' serve al frontend (StepChainEditor) per popolare sia "Ottieni record
    // collegati" (moduli con una relazione N:1 verso il modulo corrente) sia "Campo da
    // relazione" (le relazioni N:1 proprie del modulo corrente) — mancava, quindi quei
    // selettori risultavano sempre vuoti indipendentemente da quanti moduli/relazioni
    // esistessero davvero.
    // period_views/parent_children_views servono all'editor di view_tabs, per popolare
    // "quale blocco di questo modulo" dopo aver scelto il tipo — stesso bisogno di
    // fields/relations sopra, non ricaricare lo schema intero a ogni scelta.
    return {
      ...m, fields: schema.fields || [], relations: schema.relations || [],
      period_views: schema.period_views || [],
      parent_children_views: schema.parent_children_views || [],
      views: schema.views || [],
    };
  });
  res.json(full);
});

// Segue i rami se/altrimenti di una catena di azioni (stessa ricorsione di runAzioni
// in automation-engine.js e flattenAzioni in schema-v3-core.js, non esportata da lì).
function flattenAzioniLocal(azioni) {
  const out = [];
  (azioni || []).forEach((az) => {
    if (az && az.kind === 'condition') {
      out.push(...flattenAzioniLocal(az.then), ...flattenAzioniLocal(az.otherwise));
    } else if (az) {
      out.push(az);
    }
  });
  return out;
}

// Impatto di un rinomino chiave (campo/relazione/stato) SU TUTTI GLI ALTRI moduli
// installati — il Builder segnala già gli usi nello STESSO modulo (client-side, in
// memoria); questo copre l'altro caso reale: un modulo figlio che referenzia il
// modulo corrente via sum_children/related_field/get_related, o un'automazione di
// un altro modulo che punta a un record di questo modulo. Richiede una scansione
// server-side perché il frontend non ha lo schema di TUTTI i moduli installati
// (schema-cache espone solo fields/relations, non expr/steps/automazioni per intero).
router.post('/:slug/key-usage', requireAuth, requireAdmin, (req, res) => {
  const targetSlug = req.params.slug;
  const { key } = req.body || {};
  if (!key) return res.json([]);
  const modules = db.prepare('SELECT slug, name, schema_json, schema_json_draft FROM modules WHERE installed = 1 AND slug != ?').all(targetSlug);
  const usages = [];
  modules.forEach((m) => {
    const raw = m.schema_json_draft || m.schema_json;
    let schema = {};
    try { schema = parseSchemaNormalized(raw); } catch (e) { return; }
    const relations = schema.relations || [];

    (schema.fields || []).filter((f) => f.type === 'computed').forEach((f) => {
      if (f.expr) {
        const refs = extractRefs(f.expr, null, null);
        if (refs.some((r) => r.kind === 'children' && r.childModule === targetSlug && (r.field === key || r.field === null))) {
          usages.push({ module: m.slug, module_name: m.name, kind: 'formula', detail: `campo calcolato "${f.label || f.key}" (${f.expr})` });
        }
      }
      (f.steps || []).forEach((s) => {
        if (s.type === 'get_related' && s.child_module === targetSlug) {
          if ((s.filtro || []).some((flt) => flt.campo === key)) {
            usages.push({ module: m.slug, module_name: m.name, kind: 'formula', detail: `campo calcolato "${f.label || f.key}" — filtro su record collegati` });
          }
        }
        if (s.type === 'aggregate' && s.field === key) {
          const source = (f.steps || []).find((s2) => s2.id === s.input);
          if (source && source.type === 'get_related' && source.child_module === targetSlug) {
            usages.push({ module: m.slug, module_name: m.name, kind: 'formula', detail: `campo calcolato "${f.label || f.key}" — aggrega record collegati` });
          }
        }
        if (s.type === 'related_field' && s.field === key) {
          const rel = relations.find((r) => r.key === s.relation && r.type === 'many_to_one');
          if (rel && rel.target_module === targetSlug) {
            usages.push({ module: m.slug, module_name: m.name, kind: 'formula', detail: `campo calcolato "${f.label || f.key}" — campo da relazione` });
          }
        }
      });
    });

    getAutomationSteps(raw).forEach((step) => {
      flattenAzioniLocal(step.azioni).forEach((az) => {
        const cfg = az.config && typeof az.config === 'object' ? az.config : {};
        const json = JSON.stringify(cfg);
        const hasSlug = new RegExp('"' + targetSlug + '"').test(json);
        const hasKey = new RegExp('"' + key + '"').test(json);
        if (hasSlug && hasKey) {
          usages.push({ module: m.slug, module_name: m.name, kind: 'automation', detail: `automazione "${step.label || 'senza nome'}"` });
        }
      });
    });
  });
  res.json(usages);
});

// Valida + esegue in anteprima una formula sui dati reali del tenant.
// Un'unica chiamata (debounced dal frontend) copre sia sintassi/riferimenti sia il calcolo:
// il backend resta l'unica fonte di verità, il frontend ottimizza solo l'autocomplete.
// Il context {currentModule, currentRecordId} serve solo per i campi calcolati (tipo
// 'computed' su un modulo), che usano le funzioni *_children — gli aggregati di Report
// non lo passano e continuano a funzionare come prima.
router.post('/formula/check', requireAuth, requireAdmin, (req, res) => {
  const { expr, steps, context } = req.body;
  if (Array.isArray(steps) && steps.length > 0) {
    return res.json(evaluateSteps(steps, db, context || null));
  }
  res.json(evaluateFormula(expr || '', db, context || null));
});

// Prova dal vivo di uno script di una Source — sulla bozza non ancora pubblicata
// nell'editor, stesso principio di /formula/check. mode: 'search' esegue search_script
// con app.query = {type, value: query}; mode: 'document' esegue document_script con
// app.params = params (es. incollati a mano, o presi da un risultato di ricerca vero
// appena ottenuto). Nessuna scrittura: mai la creazione vera di un record qui.
router.post('/sources/test', requireAuth, requireAdmin, async (req, res) => {
  const { mode, code, query, query_type, params } = req.body || {};
  if (!code || !code.trim()) return res.status(400).json({ ok: false, error: 'Lo script è vuoto' });
  if (mode === 'document') {
    const run = await runSourceScript(code, { params: params || {} });
    return res.json(run);
  }
  const run = await runSourceScript(code, { query: { type: query_type === 'barcode' ? 'barcode' : 'text', value: String(query || '') } });
  res.json(run);
});

// Anteprima "a vuoto" di un'automazione — stesso principio di /formula/check, ma per il
// blocco 'automation': l'automazione arriva così com'è scritta ORA nell'editor (anche non
// salvata), si sceglie un record reale su cui provarla, e runAzioni gira con {dryRun:true}
// (vedi automation-engine.js — ogni punto che scrive record/notifiche/log/WhatsApp reale è
// gated dietro quel flag, verificato con una suite di test dedicata che conferma zero
// mutazioni per ciascuno dei tipi di azione). Nessuna logica di descrizione duplicata qui:
// runAzioni riusa le stesse stringhe che scriverebbe comunque in automation_logs.
router.post('/:slug/automation/dry-run', requireAuth, requireAdmin, (req, res) => {
  const { automation, record_id } = req.body || {};
  if (!automation || !Array.isArray(automation.azioni)) return res.status(400).json({ error: 'Automazione mancante' });

  const module = db.prepare('SELECT schema_json, schema_json_draft FROM modules WHERE slug = ?').get(req.params.slug);
  if (!module) return res.status(404).json({ error: 'Modulo non trovato' });
  const schema = parseSchemaNormalized(module.schema_json_draft || module.schema_json);

  // Le automazioni schedulate SENZA modalità 'per_record' girano sull'intero modulo, non
  // su un record specifico (es. report periodico, ammortamenti) — nessun record richiesto.
  const richiedeRecord = !(automation.trigger && automation.trigger.evento === 'schedulato' && automation.trigger.modalita !== 'per_record');

  let recordRow = null, recordData = {};
  if (richiedeRecord) {
    recordRow = record_id
      ? db.prepare('SELECT id, data FROM records WHERE id = ? AND module_slug = ?').get(record_id, req.params.slug)
      : db.prepare('SELECT id, data FROM records WHERE module_slug = ? ORDER BY id DESC LIMIT 1').get(req.params.slug);
    if (!recordRow) return res.json({ no_records: true });
    const parsed = { id: recordRow.id, data: decryptFields(JSON.parse(recordRow.data), schema.fields) };
    recordData = attachComputedFields(db, parsed, schema, req.params.slug).data;
  }

  const dryLog = [];
  runAzioni(automation.azioni, recordData, req.params.slug, automation.label || 'Anteprima', recordRow ? recordRow.id : null,
    { triggerDesc: 'anteprima' }, { dryRun: true, dryLog });
  res.json({ steps: dryLog, record_id: recordRow ? recordRow.id : null });
});

// Leggi draft — normalizzato a v2 perché l'editor attuale (BuilderPage) ragiona ancora
// in v2 (fields[]/relations[]/workflow/scope/aggregati separati). Un modulo salvato in
// v3 resta modificabile qui senza errori: viene mostrato "appiattito" a v2. Se lo si
// ripubblica da questo editor, torna a essere salvato come v2 (downgrade silenzioso ma
// senza perdita dati, dato che non esiste ancora nessun blocco 'condition' da nessuna
// parte) — accettabile per questo incremento, finché non esiste un editor v3 nativo.
router.get('/:slug/draft', requireAuth, requireAdmin, (req, res) => {
  const module = db.prepare('SELECT * FROM modules WHERE slug = ?').get(req.params.slug);
  if (!module) return res.status(404).json({ error: 'Modulo non trovato' });
  const draftRaw = module.schema_json_draft || module.schema_json;
  res.json({
    slug: module.slug,
    name: module.name,
    draft: parseSchemaNormalized(draftRaw),
    published: parseSchemaNormalized(module.schema_json),
    version: module.schema_version,
  });
});

// Salva draft
router.put('/:slug/draft', requireAuth, requireAdmin, (req, res) => {
  const { schema } = req.body;
  db.prepare('UPDATE modules SET schema_json_draft = ? WHERE slug = ?').run(JSON.stringify(schema), req.params.slug);
  res.json({ ok: true });
});

// Pubblica draft
router.post('/:slug/publish', requireAuth, requireAdmin, (req, res) => {
  const module = db.prepare('SELECT * FROM modules WHERE slug = ?').get(req.params.slug);
  if (!module) return res.status(404).json({ error: 'Modulo non trovato' });
  const draft = module.schema_json_draft || module.schema_json;

  // Validazione bloccante delle formule prima di pubblicare (livello 1+2 del validation engine)
  let draftParsed;
  try { draftParsed = JSON.parse(draft); } catch (e) { draftParsed = {}; }

  // Il Builder salva sempre v3 (steps[] unico) da quando esiste il canvas unificato —
  // ma questo blocco validava ancora draftParsed.fields/.aggregati direttamente, chiavi
  // che su un draft v3 non esistono mai (vivono dentro .steps). Risultato: la
  // validazione formule era di fatto SEMPRE no-op per qualunque modulo aperto nel
  // Builder nuovo — bug silenzioso, mai notato perché "non blocca mai" sembra un
  // successo finché non si pubblica per sbaglio una formula rotta. Normalizza sempre
  // a v2 (tollerante) prima di validare, indipendentemente dalla versione del draft.
  const normalized = isV3(draftParsed) ? toV2Lenient(draftParsed) : draftParsed;
  const formulaErrors = [];

  // Le chiavi campo devono essere identificatori puri — stesso pattern usato dal motore
  // formule ovunque (modulo.campo, campo proprio, ecc.). Bloccato qui anche se la UI del
  // Builder già ripulisce la chiave in digitazione, perché il draft potrebbe arrivare da
  // una chiamata diretta all'API, non solo dalla UI.
  const IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
  (normalized.fields || []).forEach((f) => {
    if (f.key && !IDENT_RE.test(f.key)) {
      formulaErrors.push({ label: f.label || f.key, errors: [`Chiave campo "${f.key}" non valida — solo lettere ASCII, numeri e underscore, senza iniziare con una cifra`] });
    }
  });

  const context = { currentModule: req.params.slug };
  const VALID_AGG_FUNCS = ['sum', 'avg', 'min', 'max', 'count'];
  (normalized.aggregati || []).forEach((a) => {
    // Forma "raggruppata" (group_by/metric/func/source_module, eseguita da
    // GET /:slug/report con la nuova notazione "relazione.campo") — validata a
    // parte da steps/expr (forma a valore singolo): un blocco report_aggregate usa
    // O l'una O l'altra, mai insieme, distinte dalla presenza di group_by.
    if (a.group_by) {
      const sourceModule = a.source_module || req.params.slug;
      const modMap = loadModuleMap(db);
      const sourceSchema = modMap[sourceModule];
      const label = a.label || 'Report';
      if (!sourceSchema) {
        formulaErrors.push({ label, errors: [`Modulo sorgente "${sourceModule}" non trovato o non installato`] });
        return;
      }
      if (!a.metric) {
        formulaErrors.push({ label, errors: ['Manca il campo da aggregare (metric)'] });
        return;
      }
      if (a.func && !VALID_AGG_FUNCS.includes(a.func)) {
        formulaErrors.push({ label, errors: [`Funzione di aggregazione non valida: "${a.func}"`] });
        return;
      }
      const fieldExists = (slug, key) => ((modMap[slug] || {}).fields || []).some((f) => f.key === key);
      if (a.group_by.includes('.')) {
        const [relKey, targetField] = a.group_by.split('.');
        const relation = (sourceSchema.relations || []).find((rel) => rel.key === relKey && rel.type === 'many_to_one');
        if (!relation) {
          formulaErrors.push({ label, errors: [`Nessuna relazione "${relKey}" su "${sourceModule}"`] });
        } else if (!fieldExists(relation.target_module, targetField)) {
          formulaErrors.push({ label, errors: [`Campo "${targetField}" non trovato su "${relation.target_module}"`] });
        }
      } else if (!fieldExists(sourceModule, a.group_by)) {
        formulaErrors.push({ label, errors: [`Campo "${a.group_by}" non trovato su "${sourceModule}"`] });
      }
      if (a.metric !== 'count' && !fieldExists(sourceModule, a.metric)) {
        formulaErrors.push({ label, errors: [`Campo "${a.metric}" non trovato su "${sourceModule}"`] });
      }
      if (a.metric_subtract && !fieldExists(sourceModule, a.metric_subtract)) {
        formulaErrors.push({ label, errors: [`Campo "${a.metric_subtract}" non trovato su "${sourceModule}"`] });
      }
      return;
    }
    if (a.steps && a.steps.length) {
      const check = validateSteps(a.steps, db); // aggregati di Report: nessun context, restano globali
      if (!check.valid) formulaErrors.push({ label: a.label || a.key, errors: check.errors });
      return;
    }
    if (!a.expr || !a.expr.trim()) return;
    // Passa il context del modulo corrente — senza, un riferimento ad un ALTRO aggregato
    // dello stesso modulo (agg_ref, es. "0.4*(1-dti) + 0.4*pct_pagato") non potrebbe mai
    // risolversi qui: extractOwnAggregateRefs richiede context.currentModule per sapere
    // in quale modulo cercare le altre key. Bug reale trovato verificando dal vivo.
    const check = validateFormula(a.expr, db, context);
    if (!check.valid) formulaErrors.push({ label: a.label || a.key, errors: check.errors });
  });
  (normalized.fields || []).forEach((f) => {
    if (f.type !== 'computed') return;
    if (f.steps && f.steps.length) {
      const check = validateSteps(f.steps, db, context);
      if (!check.valid) formulaErrors.push({ label: f.label || f.key, errors: check.errors });
      return;
    }
    if (!f.expr || !f.expr.trim()) return;
    const check = validateFormula(f.expr, db, context);
    if (!check.valid) formulaErrors.push({ label: f.label || f.key, errors: check.errors });
  });

  // Validazione strutturale dei blocchi automation (solo su draft v3 — è l'unico posto
  // dove possono esistere). Non valuta formule, solo forma: trigger riconosciuto,
  // azioni con target+azione presenti, eventuali rami condizionali con operatore valido.
  const VALID_EVENTI = ['nuovo_record', 'cambio_stato', 'modifica_campo', 'schedulato'];
  const VALID_OPS = ['>', '<', '>=', '<=', '==', '!='];
  const validateAzioni = (azioni, label) => {
    (azioni || []).forEach((az) => {
      if (az.kind === 'condition') {
        if (!az.op || !VALID_OPS.includes(az.op)) {
          formulaErrors.push({ label, errors: [`Condizione con operatore non valido: "${az.op || ''}"`] });
        }
        validateAzioni(az.then, label);
        validateAzioni(az.otherwise, label);
      } else {
        if (!az.target || !az.azione) {
          formulaErrors.push({ label, errors: ['Azione automazione incompleta — manca connessione o azione'] });
        }
      }
    });
  };
  // Bug reale trovato applicando branch_create a Spese/Debiti: TUTTE le validazioni qui
  // sotto (automation, branch_create,
  // period_view, parent_children_view, yearly_breakdown,
  // category_pivot, weekly_breakdown) erano racchiuse in un "if (isV3(draftParsed))" —
  // corretto SOLO per automation (concetto che non esiste in v2, .steps è comunque
  // undefined->[] su un draft v2, non serve nemmeno la guardia), ma sbagliato per tutte
  // le altre: leggono `normalized.*`, già valido per v2 O v3 (vedi commento sopra su
  // "normalized"), eppure non scattavano mai per un draft salvato in v2 — cioè ogni
  // volta che uno schema è stato scritto via chiamata diretta all'API invece che dal
  // vero editor Builder (il caso di quasi tutte le applicazioni reali di questa
  // iniziativa). Rimossa la guardia: ogni blocco valida ora indipendentemente dal
  // formato del draft, come da intento originale del commento su "normalized" sopra.
  (draftParsed.steps || []).filter((s) => s.block_type === 'automation').forEach((auto) => {
      const label = auto.label || 'Automazione';
      if (!auto.trigger || !VALID_EVENTI.includes(auto.trigger.evento)) {
        formulaErrors.push({ label, errors: [`Trigger non valido: "${auto.trigger && auto.trigger.evento}"`] });
      }
      validateAzioni(auto.azioni, label);
    });
    // branch_create: ogni ramo deve avere un'etichetta, almeno un campo, e se indica un
    // modulo di destinazione diverso da questo, quel modulo deve esistere davvero — un
    // target_module sbagliato fallirebbe solo al momento del salvataggio da parte
    // dell'utente finale, troppo tardi per essere utile.
    const allModuleSlugs = new Set(db.prepare('SELECT slug FROM modules').all().map((m) => m.slug));
    const branchModMap = loadModuleMap(db);
    // normalized.branch_creates, non draftParsed.steps — draftParsed è il JSON grezzo
    // così com'è stato salvato (v2 O v3 a seconda di chi ha scritto il draft), mentre
    // normalized è SEMPRE nella forma con branch_creates come array di primo livello
    // (v2 nativo, o v3 già appiattito sopra). La versione precedente guardava solo
    // draftParsed.steps: per un draft salvato in v2 (com'è ogni chiamata diretta
    // all'API usata per applicare i primitivi ai moduli reali finora) quell'array è
    // sempre vuoto — la validazione dei branch_create non scattava mai, silenziosamente.
    (normalized.branch_creates || []).forEach((bc) => {
      const label = bc.label || 'Creazione con scelta';
      const branches = bc.branches || [];
      if (branches.length < 2) {
        formulaErrors.push({ label, errors: ['Servono almeno 2 opzioni perché sia una vera scelta'] });
        return;
      }
      branches.forEach((b, i) => {
        if (!b.label || !b.label.trim()) formulaErrors.push({ label, errors: [`Opzione ${i + 1}: manca l'etichetta`] });
        if (!b.fields || b.fields.length === 0) formulaErrors.push({ label, errors: [`Opzione "${b.label || i + 1}": nessun campo configurato`] });
        if (b.target_module && !allModuleSlugs.has(b.target_module)) {
          formulaErrors.push({ label, errors: [`Opzione "${b.label || i + 1}": modulo di destinazione "${b.target_module}" non esiste`] });
        }
        // Ogni campo del ramo va risolto a runtime sui campi REALI del modulo di
        // destinazione (BranchCreateModal.jsx) — una chiave che non corrisponde a
        // nessun campo vero fallirebbe silenziosamente a un input di testo generico,
        // invece qui blocca la pubblicazione con un errore chiaro.
        const targetSlug = b.target_module || req.params.slug;
        const targetFieldKeys = new Set(((branchModMap[targetSlug] || {}).fields || []).map((f) => f.key));
        (b.fields || []).forEach((f, fi) => {
          if (!f.key || !f.key.trim()) { formulaErrors.push({ label, errors: [`Opzione "${b.label || i + 1}", campo ${fi + 1}: manca la chiave`] }); return; }
          if (!targetFieldKeys.has(f.key)) {
            formulaErrors.push({ label, errors: [`Opzione "${b.label || i + 1}": campo "${f.key}" non trovato su "${targetSlug}"`] });
          }
        });
      });
    });
    // period_view: granularità valida, campo data esistente, ogni metrica ha un campo
    // valido (tranne count, che non ne ha bisogno) — stessa disciplina degli altri
    // blocchi "vista", un riferimento sbagliato qui tornerebbe metriche sempre a zero
    // invece di un errore a pubblicazione.
    (normalized.period_views || []).forEach((pv) => {
      const label = pv.label || 'Vista per periodo';
      const modMap = loadModuleMap(db);
      const own = modMap[req.params.slug] || {};
      const validateFilter = (f) => {
        if (!f.field) { formulaErrors.push({ label, errors: ['Filtro senza campo'] }); return; }
        if (f.field === '_stato' || (f.field.includes('.') && f.field.endsWith('._stato'))) return;
        if (!f.field.includes('.')) {
          if (!(own.fields || []).some((x) => x.key === f.field)) formulaErrors.push({ label, errors: [`Campo filtro "${f.field}" non trovato`] });
          return;
        }
        const [relKey, targetField] = f.field.split('.');
        const rel = (own.relations || []).find((r) => r.key === relKey && r.type === 'many_to_one');
        if (!rel) { formulaErrors.push({ label, errors: [`Relazione "${relKey}" non trovata (o non many_to_one)`] }); return; }
        const targetFields = (modMap[rel.target_module] || {}).fields || [];
        if (!targetFields.some((x) => x.key === targetField)) formulaErrors.push({ label, errors: [`Campo "${targetField}" non trovato nel modulo "${rel.target_module}"`] });
      };
      if (!['mese', 'anno', 'settimana'].includes(pv.granularity)) { formulaErrors.push({ label, errors: ['Granularità non valida — solo "mese", "settimana" o "anno"'] }); return; }
      if (!pv.date_field || !(own.fields || []).some((f) => f.key === pv.date_field)) {
        formulaErrors.push({ label, errors: [`Campo data "${pv.date_field || ''}" non trovato`] });
      }
      const metrics = pv.metrics || [];
      if (metrics.length === 0) formulaErrors.push({ label, errors: ['Serve almeno una metrica'] });
      metrics.forEach((m, i) => {
        if (!m.key || !m.label) { formulaErrors.push({ label, errors: [`Metrica ${i + 1}: manca chiave o etichetta`] }); return; }
        if (m.func !== 'count' && (!m.field || !(own.fields || []).some((f) => f.key === m.field))) {
          formulaErrors.push({ label, errors: [`Metrica "${m.label}": campo "${m.field || ''}" non trovato`] });
        }
        if (m.filter) validateFilter(m.filter);
      });
      (pv.filters || []).forEach(validateFilter);
    });
    // parent_children_view: il modulo figli deve esistere, con la relazione dichiarata
    // (many_to_one verso QUESTO modulo) e i campi di stato/importo dichiarati.
    (normalized.parent_children_views || []).forEach((pc) => {
      const label = pc.label || 'Genitori con figli';
      const modMap = loadModuleMap(db);
      const own = modMap[req.params.slug] || {};
      if (!pc.children_module) { formulaErrors.push({ label, errors: ['Manca il modulo figli'] }); return; }
      const childMod = modMap[pc.children_module];
      if (!childMod) { formulaErrors.push({ label, errors: [`Modulo figli "${pc.children_module}" non trovato o non installato`] }); return; }
      if (!pc.children_relation) { formulaErrors.push({ label, errors: ['Manca la relazione dei figli verso questo modulo'] }); return; }
      const rel = (childMod.relations || []).find((r) => r.key === pc.children_relation && r.type === 'many_to_one' && r.target_module === req.params.slug);
      if (!rel) { formulaErrors.push({ label, errors: [`Relazione "${pc.children_relation}" non trovata (o non punta a questo modulo) su "${pc.children_module}"`] }); return; }
      if (!pc.children_status_field || !(childMod.fields || []).some((f) => f.key === pc.children_status_field) && pc.children_status_field !== '_stato') {
        formulaErrors.push({ label, errors: [`Campo stato figli "${pc.children_status_field || ''}" non trovato`] });
      }
      if (!pc.children_status_done_value) formulaErrors.push({ label, errors: ['Manca il valore "fatto" dello stato figli'] });
      if (pc.child_amount_field && !(childMod.fields || []).some((f) => f.key === pc.child_amount_field)) {
        formulaErrors.push({ label, errors: [`Campo importo figli "${pc.child_amount_field}" non trovato`] });
      }
      if (pc.amount_field && !(own.fields || []).some((f) => f.key === pc.amount_field)) {
        formulaErrors.push({ label, errors: [`Campo importo "${pc.amount_field}" non trovato`] });
      }
    });
    // yearly_breakdown / category_pivot: entrambi possono leggere un modulo diverso da
    // quello dichiarante (source_module, come report_aggregate) — validati sul modulo
    // sorgente effettivo, non su quello dichiarante.
    (normalized.yearly_breakdowns || []).forEach((yb) => {
      const label = yb.label || 'Riepilogo mensile';
      const modMap = loadModuleMap(db);
      const sourceSlug = yb.source_module || req.params.slug;
      const source = modMap[sourceSlug];
      if (!source) { formulaErrors.push({ label, errors: [`Modulo sorgente "${sourceSlug}" non trovato o non installato`] }); return; }
      if (!yb.date_field || !(source.fields || []).some((f) => f.key === yb.date_field)) {
        formulaErrors.push({ label, errors: [`Campo data "${yb.date_field || ''}" non trovato su "${sourceSlug}"`] });
      }
      const metrics = yb.metrics || [];
      if (metrics.length === 0) formulaErrors.push({ label, errors: ['Serve almeno una metrica'] });
      metrics.forEach((m, i) => {
        if (!m.key || !m.label) { formulaErrors.push({ label, errors: [`Metrica ${i + 1}: manca chiave o etichetta`] }); return; }
        if (m.func !== 'count' && (!m.field || !(source.fields || []).some((f) => f.key === m.field))) {
          formulaErrors.push({ label, errors: [`Metrica "${m.label}": campo "${m.field || ''}" non trovato su "${sourceSlug}"`] });
        }
      });
    });
    (normalized.category_pivots || []).forEach((cp) => {
      const label = cp.label || 'Pivot per categoria';
      const modMap = loadModuleMap(db);
      const sourceSlug = cp.source_module || req.params.slug;
      const source = modMap[sourceSlug];
      if (!source) { formulaErrors.push({ label, errors: [`Modulo sorgente "${sourceSlug}" non trovato o non installato`] }); return; }
      if (!cp.date_field || !(source.fields || []).some((f) => f.key === cp.date_field)) {
        formulaErrors.push({ label, errors: [`Campo data "${cp.date_field || ''}" non trovato su "${sourceSlug}"`] });
      }
      if (!cp.group_by || !(source.fields || []).some((f) => f.key === cp.group_by)) {
        formulaErrors.push({ label, errors: [`Campo raggruppamento "${cp.group_by || ''}" non trovato su "${sourceSlug}"`] });
      }
      if (!cp.metric_field || !(source.fields || []).some((f) => f.key === cp.metric_field)) {
        formulaErrors.push({ label, errors: [`Campo metrica "${cp.metric_field || ''}" non trovato su "${sourceSlug}"`] });
      }
    });
    (normalized.weekly_breakdowns || []).forEach((wb) => {
      const label = wb.label || 'Ore per settimana';
      const modMap = loadModuleMap(db);
      const sourceSlug = wb.source_module || req.params.slug;
      const source = modMap[sourceSlug];
      if (!source) { formulaErrors.push({ label, errors: [`Modulo sorgente "${sourceSlug}" non trovato o non installato`] }); return; }
      if (!wb.date_field || !(source.fields || []).some((f) => f.key === wb.date_field)) {
        formulaErrors.push({ label, errors: [`Campo data "${wb.date_field || ''}" non trovato su "${sourceSlug}"`] });
      }
      if (!wb.metric_field || !(source.fields || []).some((f) => f.key === wb.metric_field)) {
        formulaErrors.push({ label, errors: [`Campo metrica "${wb.metric_field || ''}" non trovato su "${sourceSlug}"`] });
      }
      if (wb.threshold != null && isNaN(Number(wb.threshold))) {
        formulaErrors.push({ label, errors: ['La soglia deve essere un numero'] });
      }
    });
    // view: block_type unificato (Fase 1 della semplificazione del Builder, ispirato a
    // Collections) — un solo blocco con 4 modalità (period/pivot/simple/children) per i
    // NUOVI blocchi creati dal Builder; period_view/yearly_breakdown/category_pivot/
    // weekly_breakdown/parent_children_view restano sopra, invariati, per i blocchi già
    // esistenti. Stessi identici controlli, solo dispatchati per v.mode invece che per
    // block_type separati.
    (normalized.views || []).forEach((v) => {
      const label = v.label || 'Vista';
      const modMap = loadModuleMap(db);
      const own = modMap[req.params.slug] || {};
      const sourceSlug = v.source_module || req.params.slug;
      const source = modMap[sourceSlug];
      const validateFilter = (f) => {
        if (!f.field) { formulaErrors.push({ label, errors: ['Filtro senza campo'] }); return; }
        if (f.field === '_stato' || (f.field.includes('.') && f.field.endsWith('._stato'))) return;
        if (!f.field.includes('.')) {
          if (!((source && source.fields) || []).some((x) => x.key === f.field)) formulaErrors.push({ label, errors: [`Campo filtro "${f.field}" non trovato`] });
          return;
        }
        const [relKey, targetField] = f.field.split('.');
        const rel = ((source && source.relations) || []).find((r) => r.key === relKey && r.type === 'many_to_one');
        if (!rel) { formulaErrors.push({ label, errors: [`Relazione "${relKey}" non trovata (o non many_to_one)`] }); return; }
        const targetFields = (modMap[rel.target_module] || {}).fields || [];
        if (!targetFields.some((x) => x.key === targetField)) formulaErrors.push({ label, errors: [`Campo "${targetField}" non trovato nel modulo "${rel.target_module}"`] });
      };

      if (v.mode === 'children') {
        if (!v.children_module) { formulaErrors.push({ label, errors: ['Manca il modulo figli'] }); return; }
        const childMod = modMap[v.children_module];
        if (!childMod) { formulaErrors.push({ label, errors: [`Modulo figli "${v.children_module}" non trovato o non installato`] }); return; }
        if (!v.children_relation) { formulaErrors.push({ label, errors: ['Manca la relazione dei figli verso questo modulo'] }); return; }
        const rel = (childMod.relations || []).find((r) => r.key === v.children_relation && r.type === 'many_to_one' && r.target_module === req.params.slug);
        if (!rel) { formulaErrors.push({ label, errors: [`Relazione "${v.children_relation}" non trovata (o non punta a questo modulo) su "${v.children_module}"`] }); return; }
        if (!v.children_status_field || !(childMod.fields || []).some((f) => f.key === v.children_status_field) && v.children_status_field !== '_stato') {
          formulaErrors.push({ label, errors: [`Campo stato figli "${v.children_status_field || ''}" non trovato`] });
        }
        if (!v.children_status_done_value) formulaErrors.push({ label, errors: ['Manca il valore "fatto" dello stato figli'] });
        if (v.child_amount_field && !(childMod.fields || []).some((f) => f.key === v.child_amount_field)) {
          formulaErrors.push({ label, errors: [`Campo importo figli "${v.child_amount_field}" non trovato`] });
        }
        if (v.amount_field && !(own.fields || []).some((f) => f.key === v.amount_field)) {
          formulaErrors.push({ label, errors: [`Campo importo "${v.amount_field}" non trovato`] });
        }
        return;
      }

      if (!source) { formulaErrors.push({ label, errors: [`Modulo sorgente "${sourceSlug}" non trovato o non installato`] }); return; }

      if (v.mode === 'period') {
        if (!['mese', 'anno', 'settimana'].includes(v.granularity)) { formulaErrors.push({ label, errors: ['Granularità non valida — solo "mese", "settimana" o "anno"'] }); return; }
        if (!v.date_field || !(source.fields || []).some((f) => f.key === v.date_field)) {
          formulaErrors.push({ label, errors: [`Campo data "${v.date_field || ''}" non trovato su "${sourceSlug}"`] });
        }
        const metrics = v.metrics || [];
        if (metrics.length === 0) formulaErrors.push({ label, errors: ['Serve almeno una metrica'] });
        metrics.forEach((m, i) => {
          if (!m.key || !m.label) { formulaErrors.push({ label, errors: [`Metrica ${i + 1}: manca chiave o etichetta`] }); return; }
          if (m.func !== 'count' && (!m.field || !(source.fields || []).some((f) => f.key === m.field))) {
            formulaErrors.push({ label, errors: [`Metrica "${m.label}": campo "${m.field || ''}" non trovato su "${sourceSlug}"`] });
          }
          if (m.filter) validateFilter(m.filter);
        });
        (v.filters || []).forEach(validateFilter);
      } else if (v.mode === 'pivot') {
        if (!v.date_field || !(source.fields || []).some((f) => f.key === v.date_field)) {
          formulaErrors.push({ label, errors: [`Campo data "${v.date_field || ''}" non trovato su "${sourceSlug}"`] });
        }
        if (!v.group_by || !(source.fields || []).some((f) => f.key === v.group_by)) {
          formulaErrors.push({ label, errors: [`Campo raggruppamento "${v.group_by || ''}" non trovato su "${sourceSlug}"`] });
        }
        if (!v.metric_field || !(source.fields || []).some((f) => f.key === v.metric_field)) {
          formulaErrors.push({ label, errors: [`Campo metrica "${v.metric_field || ''}" non trovato su "${sourceSlug}"`] });
        }
        (v.filters || []).forEach(validateFilter);
      } else if (v.mode === 'simple') {
        if (!v.date_field || !(source.fields || []).some((f) => f.key === v.date_field)) {
          formulaErrors.push({ label, errors: [`Campo data "${v.date_field || ''}" non trovato su "${sourceSlug}"`] });
        }
        if (!v.metric_field || !(source.fields || []).some((f) => f.key === v.metric_field)) {
          formulaErrors.push({ label, errors: [`Campo metrica "${v.metric_field || ''}" non trovato su "${sourceSlug}"`] });
        }
        if (v.threshold != null && isNaN(Number(v.threshold))) {
          formulaErrors.push({ label, errors: ['La soglia deve essere un numero'] });
        }
        (v.filters || []).forEach(validateFilter);
      } else {
        formulaErrors.push({ label, errors: [`Modalità "${v.mode || ''}" non valida`] });
      }
    });
    // api_source: solo un controllo di SINTASSI qui (gli script non si eseguono alla
    // pubblicazione — nessuna chiamata di rete non richiesta) — lo stesso vm.Script usato
    // da source-engine.js per intercettare un errore di scrittura prima che arrivi a un
    // utente che prova a cercare. Comportamento reale (risultati, errori a runtime) si
    // prova con "Prova" nel Builder (/builder/sources/test), mai qui.
    (normalized.api_sources || []).forEach((src) => {
      const label = src.label || 'Fonte esterna';
      if (!src.key) { formulaErrors.push({ label, errors: ['Manca la chiave della fonte'] }); }
      if (!src.input_text_enabled && !src.input_barcode_enabled) {
        formulaErrors.push({ label, errors: ['Deve accettare almeno un tipo di ricerca (testo o codice a barre)'] });
      }
      if (!src.search_script || !src.search_script.trim()) {
        formulaErrors.push({ label, errors: ['Manca lo script di ricerca'] });
      } else {
        try { new vm.Script('(async () => {\n' + src.search_script + '\n})()'); }
        catch (e) { formulaErrors.push({ label, errors: ['Script di ricerca, errore di sintassi: ' + e.message] }); }
      }
      if (!src.document_script || !src.document_script.trim()) {
        formulaErrors.push({ label, errors: ['Manca lo script di importazione'] });
      } else {
        try { new vm.Script('(async () => {\n' + src.document_script + '\n})()'); }
        catch (e) { formulaErrors.push({ label, errors: ['Script di importazione, errore di sintassi: ' + e.message] }); }
      }
    });
    // view_tabs: più viste "sostituisce tutta la tabella" alternabili a tab sullo
    // stesso modulo (es. Spese: tab "Spese" col period_view proprio, tab "Debiti" col
    // parent_children_view di un ALTRO modulo via source_module) — ogni tab referenzia
    // un blocco già dichiarato altrove per key, non lo ridefinisce.
    const TAB_BLOCK_ARRAY = {
      period_view: 'period_views', parent_children_view: 'parent_children_views', view: 'views',
    };
    if (normalized.view_tabs && normalized.view_tabs.tabs) {
      const label = 'Tab della vista';
      const tabs = normalized.view_tabs.tabs || [];
      if (tabs.length < 2) formulaErrors.push({ label, errors: ['Servono almeno 2 tab perché sia una vera scelta'] });
      const vtModMap = loadModuleMap(db);
      tabs.forEach((t, i) => {
        if (!t.label || !t.label.trim()) formulaErrors.push({ label, errors: [`Tab ${i + 1}: manca l'etichetta`] });
        const arrayKey = TAB_BLOCK_ARRAY[t.block_type];
        if (!arrayKey) { formulaErrors.push({ label, errors: [`Tab "${t.label || i + 1}": tipo "${t.block_type || ''}" non valido per una tab`] }); return; }
        const sourceSlug = t.source_module || req.params.slug;
        const source = vtModMap[sourceSlug];
        if (!source) { formulaErrors.push({ label, errors: [`Tab "${t.label || i + 1}": modulo sorgente "${sourceSlug}" non trovato o non installato`] }); return; }
        const resolvedBlock = (source[arrayKey] || []).find((b) => b.key === t.block_key);
        if (!resolvedBlock) {
          formulaErrors.push({ label, errors: [`Tab "${t.label || i + 1}": blocco "${t.block_key || ''}" non trovato su "${sourceSlug}"`] });
        } else if (t.block_type === 'view' && resolvedBlock.placement !== 'replace') {
          formulaErrors.push({ label, errors: [`Tab "${t.label || i + 1}": la vista "${t.block_key}" non sostituisce la tabella (placement "add"), non può essere una tab`] });
        }
      });
    }

  if (formulaErrors.length > 0) {
    return res.status(400).json({ error: 'Formule non valide — pubblicazione bloccata', details: formulaErrors });
  }

  // Salva in history
  db.prepare('INSERT INTO modules_schema_history (module_id, schema_json, version, published_by) VALUES (?, ?, ?, ?)').run(module.id, module.schema_json, module.schema_version, req.user.id);

  // Pubblica
  db.prepare('UPDATE modules SET schema_json = ?, schema_json_draft = NULL, schema_version = schema_version + 1, published_at = CURRENT_TIMESTAMP WHERE slug = ?').run(draft, req.params.slug);

  logAudit(req.user.username, 'module.publish', req.params.slug, { version: module.schema_version + 1 });
  res.json({ ok: true, version: module.schema_version + 1 });
});

// History versioni
router.get('/:slug/history', requireAuth, requireAdmin, (req, res) => {
  const module = db.prepare('SELECT id FROM modules WHERE slug = ?').get(req.params.slug);
  if (!module) return res.status(404).json({ error: 'Modulo non trovato' });
  const history = db.prepare('SELECT * FROM modules_schema_history WHERE module_id = ? ORDER BY published_at DESC').all(module.id);
  res.json(history);
});

// Ripristina una versione storica — la carica come bozza (non sovrascrive direttamente il
// pubblicato) così l'utente la rivede e la ripubblica esplicitamente, stessa logica draft→publish
router.post('/:slug/restore/:historyId', requireAuth, requireAdmin, (req, res) => {
  const module = db.prepare('SELECT * FROM modules WHERE slug = ?').get(req.params.slug);
  if (!module) return res.status(404).json({ error: 'Modulo non trovato' });
  const entry = db.prepare('SELECT * FROM modules_schema_history WHERE id = ? AND module_id = ?').get(req.params.historyId, module.id);
  if (!entry) return res.status(404).json({ error: 'Versione non trovata' });
  db.prepare('UPDATE modules SET schema_json_draft = ? WHERE slug = ?').run(entry.schema_json, req.params.slug);
  res.json({ ok: true });
});

module.exports = router;
