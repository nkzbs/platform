const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin, requireModuleAccess } = require('./auth');
const { evaluateFormula, evaluateSteps, getModuleRows, aggregateValues, loadModuleMap, toDayCount, compareValues } = require('../formula');
const { parseSchemaNormalized } = require('../schema-v3');
const { fireTrigger } = require('../automation-engine');
const { logAudit } = require('../audit-log');
const { encryptFields, decryptFields } = require('../crypto-fields');
const { controllaValidazioni } = require('../validazioni-campo');
const { applicaEredita } = require('../lib/eredita-relazione');
const competenza = require('../competenza');
const pianoRata = require('../piano-rata');
const valoriSuggeriti = require('../valori-suggeriti');
const { attachComputedFields: attachComputedFieldsShared } = require('../computed-fields');
const { runSourceScript } = require('../source-engine');
const { ruleFor, ownedOrAllowed, filterViewable, isOwnRecord } = require('../permissions');
const { deleteUploadById } = require('../lib/upload-storage');
const { computePeriodView, shiftPeriod, dateToIsoYearWeek } = require('../period-view');
const { computeParentChildren } = require('../parent-children-view');
const { computeYearlyBreakdown } = require('../yearly-breakdown');
const { computeCategoryPivot } = require('../category-pivot');
const { computeWeeklyBreakdown } = require('../weekly-breakdown');

const router = express.Router();

const { getModuleSchema, attachComputedFields, attachComputedToFlatRows, applyDefaults, checkUnique, checkCreationValidation, logHistory } = require('./records-helpers');

// Valuta SOLO i campi computed marcati `live: true` (attributo generico sulla card
// Formula/Aggregato, non specifico di nessun caso d'uso) contro un record ANCORA IN
// BOZZA — dati in memoria nel form, mai salvato, quindi senza id reale. Aperto a
// qualunque utente autenticato (non requireAdmin come /builder/formula/check, che
// è per chi progetta lo schema, non per chi compila un record): usa sempre lo schema
// pubblicato (getModuleSchema), mai il draft del Builder, coerente con create/update
// sotto in questo stesso file. `childRows` è l'equivalente in bozza di *_children —
// righe embedded già in memoria lato form (vedi ModulePage), usate dal fallback
// generico di evaluateSteps quando get_related non trova un currentRecordId reale.
router.post('/:slug/evaluate-live', requireAuth, requireModuleAccess, (req, res) => {
  const schema = getModuleSchema(req.params.slug);
  if (!schema) return res.status(404).json({ error: 'Modulo non trovato' });
  const liveFields = (schema.fields || []).filter((f) => f.type === 'computed' && f.live && ((f.steps && f.steps.length) || f.expr));
  if (liveFields.length === 0) return res.json({ results: {} });

  const context = {
    currentModule: req.params.slug,
    currentRecordData: (req.body && req.body.data) || {},
    currentChildRows: (req.body && req.body.childRows) || {},
  };
  const results = {};
  liveFields.forEach((f) => {
    const result = (f.steps && f.steps.length) ? evaluateSteps(f.steps, db, context) : evaluateFormula(f.expr, db, context);
    results[f.key] = { label: f.label, valid: result.valid, value: result.valid ? result.value : null, errors: result.errors || [] };
  });
  res.json({ results });
});

router.get('/:slug', requireAuth, requireModuleAccess, (req, res) => {
  const schema = getModuleSchema(req.params.slug) || {};
  const { rel, value, date_field, from, to, updated_since } = req.query;

  // G11 (PLATFORM-0.6-GAP-ANALYSIS.md) — "vittoria gratuita" identificata il 2026-08-22 ma
  // mai spedita: updated_at è una colonna SQL reale (non un campo dentro `data`, mai
  // cifrata), quindi a differenza di rel/date_field (JS-side, dentro il JSON) questo filtro
  // può scendere nella query stessa — mai processare/decrittare righe che il filtro
  // successivo avrebbe comunque scartato. Stesso identico risultato di prima (il confronto
  // era già `updated_at > sinceTime`, solo spostato prima invece che dopo il fetch
  // completo) — nessun cambio di comportamento per chi non passa `updated_since`.
  let sql = 'SELECT * FROM records WHERE module_slug = ?';
  const params = [req.params.slug];
  if (updated_since && !Number.isNaN(new Date(updated_since).getTime())) {
    // datetime() normalizza sia il formato SQLite di updated_at ("YYYY-MM-DD HH:MM:SS",
    // da CURRENT_TIMESTAMP) sia un ISO8601 con T/Z/millisecondi arrivato dal client —
    // stesso confronto cronologico di prima (new Date(x).getTime() > sinceTime),
    // verificato equivalente prima di spedirlo.
    sql += ' AND datetime(updated_at) > datetime(?)';
    params.push(updated_since);
  }
  sql += ' ORDER BY created_at DESC';
  let records = db.prepare(sql).all(...params)
    .map((r) => ({ ...r, data: JSON.parse(r.data) }));

  const rule = ruleFor(schema, req.user.role);
  records = filterViewable(records, rule, req.user);

  // Filtro opzionale per relazione, usato per mostrare solo i "figli" di un record
  // padre (es. le righe di UN ordine specifico), senza introdurre una route dedicata
  if (rel && value !== undefined) {
    records = records.filter((r) => String(r.data[rel]) === String(value));
  }

  // Filtro opzionale per intervallo di date, su un campo a scelta (non un nome fisso
  // tipo "data" o "created_at" — ogni modulo chiama il proprio campo data come vuole).
  // Usato dal widget Dashboard "Checklist multi-modulo" per mostrare solo i record di
  // un periodo, ma generico: qualunque chiamante può passare questi tre parametri.
  // Un record senza valore in date_field, o con una data non interpretabile, viene
  // escluso quando il filtro è attivo — meglio ometterlo che sbagliare un totale.
  if (date_field && (from || to)) {
    const fromTime = from ? new Date(from).getTime() : null;
    const toTime = to ? new Date(to).getTime() : null;
    records = records.filter((r) => {
      const raw = r.data[date_field];
      if (!raw) return false;
      const t = new Date(raw).getTime();
      if (Number.isNaN(t)) return false;
      if (fromTime !== null && t < fromTime) return false;
      if (toTime !== null && t > toTime) return false;
      return true;
    });
  }

  records = records.map((r) => ({ ...r, data: decryptFields(r.data, schema.fields) }));
  records = records.map((r) => attachComputedFields(r, schema, req.params.slug));

  // G11 (PLATFORM-0.6-GAP-ANALYSIS.md, 2026-08-22) — paginazione OPZIONALE, non
  // il default: i filtri sopra (permessi riga per riga, relazione, intervallo
  // date, sync incrementale) sono valutati in JS sui dati decrittati, non
  // esprimibili come WHERE SQL — un LIMIT/OFFSET applicato PRIMA di questi
  // filtri pagherebbe la pagina sbagliata di record (es. i primi N per
  // created_at potrebbero essere tutti esclusi da view_own_only, restituendo
  // una pagina vuota mentre esistono record visibili più indietro). Applicato
  // quindi qui, DOPO tutta la pipeline di filtro — nessun cambio di
  // comportamento per chi non passa `limit` (risposta identica a prima,
  // nessuna chiamata esistente da aggiornare). Il totale filtrato va in
  // `X-Total-Count` invece che nel body, per non cambiare la forma della
  // risposta (un array, non un oggetto) e non rompere alcun consumatore
  // esistente che si aspetta `res.data` come array.
  const total = records.length;
  if (req.query.limit !== undefined) {
    const limit = Math.max(0, parseInt(req.query.limit, 10) || 0);
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    records = records.slice(offset, offset + limit);
    res.setHeader('X-Total-Count', String(total));
  }
  res.json(records);
});

router.use(require('./records-viste'));


router.use(require('./records-csv'));


// Quali azioni esterne del modulo possono partire ORA: { <chiave>: { ok, motivo } }. Lo chiede la scheda per mettere tra «Altre funzioni» (da attivare) quelle il cui servizio non è ancora abilitato.
// Nessuna richiesta a pagamento: l'adattatore controlla solo se la chiave collegata può ottenere il token del servizio (risposta in memoria 10 minuti).
router.get('/:slug/azioni-stato', requireAuth, requireModuleAccess, async (req, res) => {
  const schema = getModuleSchema(req.params.slug);
  if (!schema) return res.status(404).json({ error: 'Modulo non trovato' });
  const out = {};
  for (const config of schema.external_actions || []) {
    const adattatore = require('../lib/azioni-esterne').adattatore(config.adapter);
    if (!adattatore) continue;
    if (typeof adattatore.disponibile === 'function') {
      try { const d = await adattatore.disponibile({ config, dati: {} }); out[config.key] = { ok: !!d.ok, motivo: d.ok ? null : d.motivo || null }; }
      catch (e) { out[config.key] = { ok: false, motivo: e.message }; }
    } else out[config.key] = { ok: true, motivo: null };
    // A pagamento? Lo dice l'adattatore (`servizio`/`servizioPer`) e il costo è quello di listino: nessuna richiesta al servizio. Serve alla scheda «Azioni» per dirlo PRIMA di premere.
    try {
      const nome = typeof adattatore.servizioPer === 'function' ? adattatore.servizioPer({ config, dati: {} }) : adattatore.servizio;
      if (nome) { out[config.key].a_pagamento = true; const st = require('../lib/openapi-spese').stima(nome); out[config.key].costo = st && st.costo != null ? st.costo : null; }
    } catch (e) { /* senza stima: «a pagamento» resta, senza importo */ }
  }
  res.json(out);
});

// Quali moduli PDF originali si possono importare in questo modulo (per mostrare o nascondere la voce di menu).
router.get('/:slug/importa-modulo', requireAuth, requireModuleAccess, (req, res) => {
  const lista = require('../lib/importa-modulo-pdf').modelliDelModulo(getModuleSchema(req.params.slug) || {});
  res.json({ modelli: lista.map((m) => ({ chiave: m.chiave, titolo: m.titolo })) });
});

router.get('/:slug/:id', requireAuth, requireModuleAccess, (req, res) => {
  const schema = getModuleSchema(req.params.slug) || {};
  const record = db.prepare('SELECT * FROM records WHERE id = ? AND module_slug = ?').get(req.params.id, req.params.slug);
  if (!record) return res.status(404).json({ error: 'Record non trovato' });
  const rule = ruleFor(schema, req.user.role);
  if (rule && (!rule.view || !ownedOrAllowed(rule, record, req.user))) {
    return res.status(403).json({ error: 'Non hai i permessi per vedere questo record' });
  }
  const parsed = { ...record, data: decryptFields(JSON.parse(record.data), schema.fields) };
  res.json(attachComputedFields(parsed, schema, req.params.slug));
});

router.get('/:slug/:id/history', requireAuth, requireModuleAccess, (req, res) => {
  const schema = getModuleSchema(req.params.slug) || {};
  const rule = ruleFor(schema, req.user.role);
  if (rule && !rule.view) return res.status(403).json({ error: 'Non hai i permessi' });
  const rows = db.prepare('SELECT id, record_id, actor, action, before_data, after_data, created_at FROM record_history WHERE record_id = ? AND module_slug = ? ORDER BY created_at DESC LIMIT 50').all(req.params.id, req.params.slug);
  res.json(rows.map((r) => ({
    ...r,
    before_data: r.before_data ? JSON.parse(r.before_data) : null,
    after_data: r.after_data ? JSON.parse(r.after_data) : null,
  })));
});

router.post('/:slug', requireAuth, requireModuleAccess, (req, res) => {
  const schema = getModuleSchema(req.params.slug) || {};
  const rule = ruleFor(schema, req.user.role);
  if (rule && !rule.create) return res.status(403).json({ error: 'Non hai i permessi per creare record in questo modulo' });
  // Campi di sola lettura (`sola_lettura`: es. i consensi privacy, che si confermano solo firmando): non si scrivono a mano, nascono vuoti.
  const corpoCreazione = { ...(req.body || {}) }; for (const f of schema.fields || []) if (f.sola_lettura) delete corpoCreazione[f.key];
  const withDefaults = valoriSuggeriti.allinea(req.params.slug, schema, pianoRata.applica(req.params.slug, competenza.applica(req.params.slug, applicaEredita(db, schema, applyDefaults(corpoCreazione, schema.fields)), null)), req.user.id);
  const uniqueError = checkUnique(req.params.slug, schema.fields, withDefaults, null);
  if (uniqueError) return res.status(400).json(uniqueError);
  const campoError = controllaValidazioni(schema.fields, withDefaults);
  if (campoError) return res.status(400).json(campoError);
  const validationError = checkCreationValidation(schema, req.params.slug, withDefaults);
  if (validationError) return res.status(400).json(validationError);
  const safeBody = encryptFields(withDefaults, schema.fields);
  const result = db.prepare('INSERT INTO records (module_slug, user_id, data) VALUES (?, ?, ?)').run(req.params.slug, req.user.id, JSON.stringify(safeBody));
  const record = db.prepare('SELECT * FROM records WHERE id = ?').get(result.lastInsertRowid);
  const decrypted = decryptFields(JSON.parse(record.data), schema.fields);
  const attached = attachComputedFields({ ...record, data: decrypted }, schema, req.params.slug);
  fireTrigger(req.params.slug, 'nuovo_record', attached.data, attached.id, {});
  logHistory(req.params.slug, attached.id, req.user.username, 'create', null, attached.data);
  res.json(attached);
});

// «Importa da modulo PDF»: carichi il modulo originale compilato e il sistema propone i dati per una nuova scheda (non scrive niente:
// la creazione passa da POST /:slug, con le sue validazioni). Serve il permesso di creare, come per una scheda nuova.
router.post('/:slug/importa-modulo/proposta', requireAuth, requireModuleAccess, async (req, res) => {
  const schema = getModuleSchema(req.params.slug) || {};
  const rule = ruleFor(schema, req.user.role);
  if (rule && !rule.create) return res.status(403).json({ error: 'Non hai i permessi per creare record in questo modulo' });
  const { pdf_base64: b64, modello } = req.body || {};
  if (typeof b64 !== 'string' || !b64) return res.status(400).json({ error: 'Manca il PDF' });
  try {
    res.json(await require('../lib/importa-modulo-pdf').proponi({ schema, buffer: Buffer.from(b64, 'base64'), chiave: typeof modello === 'string' ? modello : undefined }));
  } catch (e) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Lettura del PDF non riuscita' }); }
});

// Creazione al volo da una relazione (es. "+ Nuovo cliente" nel dropdown dell'Ordine).
// Non riusa semplicemente POST /:slug perché deve verificare, server-side, che la
// relazione che ha originato la richiesta abbia davvero quick_create abilitato per
// il ruolo di chi chiama — l'opzione "+ Nuovo" nel form è solo UI, qui è enforcement
// reale, altrimenti un utente senza permesso potrebbe chiamare l'endpoint a mano.
router.post('/:slug/quick-create', requireAuth, requireModuleAccess, (req, res) => {
  const { via_module, via_relation, data } = req.body;
  if (!via_module || !via_relation) {
    return res.status(400).json({ error: 'via_module e via_relation sono obbligatori' });
  }
  const viaSchema = getModuleSchema(via_module);
  if (!viaSchema) return res.status(404).json({ error: 'Modulo di origine non trovato' });
  const relation = (viaSchema.relations || []).find((r) => r.key === via_relation && r.target_module === req.params.slug);
  if (!relation) return res.status(400).json({ error: 'Relazione non trovata su questo modulo' });
  const qc = relation.quick_create;
  if (!qc || !qc.enabled) return res.status(403).json({ error: 'Creazione al volo non abilitata per questa relazione' });
  if (Array.isArray(qc.roles) && qc.roles.length > 0 && !qc.roles.includes(req.user.role)) {
    return res.status(403).json({ error: 'Ruolo non autorizzato alla creazione al volo' });
  }
  const targetSchema = getModuleSchema(req.params.slug) || {};
  const createRule = ruleFor(targetSchema, req.user.role);
  if (createRule && !createRule.create) {
    return res.status(403).json({ error: 'Non hai i permessi per creare record in questo modulo' });
  }

  // Se è definito un fields_subset, scarta silenziosamente qualsiasi altro campo
  // arrivato nel body — evita che il client aggiri il sotto-insieme concordato.
  const rawPayload = Array.isArray(qc.fields_subset) && qc.fields_subset.length > 0
    ? Object.fromEntries(Object.entries(data || {}).filter(([k]) => qc.fields_subset.includes(k)))
    : (data || {});

  // Stesso trattamento di POST /:slug (defaults, unicità, cifratura, automazioni,
  // storico) — un record creato al volo da un dropdown relazione non è un
  // cittadino di seconda classe rispetto a uno creato dal form normale del modulo.
  const withDefaults = applyDefaults(rawPayload, targetSchema.fields);
  const uniqueError = checkUnique(req.params.slug, targetSchema.fields, withDefaults, null);
  if (uniqueError) return res.status(400).json(uniqueError);
  const validationError = checkCreationValidation(targetSchema, req.params.slug, withDefaults);
  if (validationError) return res.status(400).json(validationError);
  const safeBody = encryptFields(withDefaults, targetSchema.fields);
  const result = db.prepare('INSERT INTO records (module_slug, user_id, data) VALUES (?, ?, ?)').run(req.params.slug, req.user.id, JSON.stringify(safeBody));
  const record = db.prepare('SELECT * FROM records WHERE id = ?').get(result.lastInsertRowid);
  const decrypted = decryptFields(JSON.parse(record.data), targetSchema.fields);
  const attached = attachComputedFields({ ...record, data: decrypted }, targetSchema, req.params.slug);
  fireTrigger(req.params.slug, 'nuovo_record', attached.data, attached.id, {});
  logHistory(req.params.slug, attached.id, req.user.username, 'create', null, attached.data);
  res.json(attached);
});

// Sources scriptabili (Builder, Fase 4 — vedi source-engine.js per il motore/
// l'isolamento). Una Source cerca su un'API esterna (search_script) e propone un
// record (document_script); l'import finale riusa lo STESSO trattamento di
// POST /:slug e /quick-create (defaults, unicità, cifratura, automazioni, storico) —
// un record arrivato da una Source non è un cittadino di seconda classe.
function findApiSource(slug, key) {
  const schema = getModuleSchema(slug) || {};
  const src = (schema.api_sources || []).find((s) => s.key === key);
  return { schema, src };
}

router.post('/:slug/sources/:key/search', requireAuth, requireModuleAccess, async (req, res) => {
  const { schema, src } = findApiSource(req.params.slug, req.params.key);
  if (!src) return res.status(404).json({ error: 'Fonte non trovata' });
  if (src.enabled === false) return res.status(400).json({ error: 'Questa fonte è disattivata' });
  const rule = ruleFor(schema, req.user.role);
  if (rule && !rule.create) return res.status(403).json({ error: 'Non hai i permessi per creare record in questo modulo' });
  const type = req.body && req.body.type === 'barcode' ? 'barcode' : 'text';
  if (type === 'barcode' && !src.input_barcode_enabled) return res.status(400).json({ error: 'Questa fonte non accetta la ricerca per codice a barre' });
  if (type === 'text' && !src.input_text_enabled) return res.status(400).json({ error: 'Questa fonte non accetta la ricerca testuale' });
  const value = String((req.body && req.body.query) || '').trim();
  if (!value) return res.status(400).json({ error: 'Scrivi cosa cercare' });
  if (!src.search_script || !src.search_script.trim()) return res.status(400).json({ error: 'Questa fonte non ha uno script di ricerca' });

  const run = await runSourceScript(src.search_script, { query: { type, value } });
  if (!run.ok) return res.status(422).json({ error: run.error, logs: run.logs });
  const results = Array.isArray(run.result) ? run.result : [];
  res.json({ results: results.slice(0, 25), logs: run.logs });
});

router.post('/:slug/sources/:key/import', requireAuth, requireModuleAccess, async (req, res) => {
  const { schema, src } = findApiSource(req.params.slug, req.params.key);
  if (!src) return res.status(404).json({ error: 'Fonte non trovata' });
  if (src.enabled === false) return res.status(400).json({ error: 'Questa fonte è disattivata' });
  const rule = ruleFor(schema, req.user.role);
  if (rule && !rule.create) return res.status(403).json({ error: 'Non hai i permessi per creare record in questo modulo' });
  if (!src.document_script || !src.document_script.trim()) return res.status(400).json({ error: 'Questa fonte non ha uno script di importazione' });

  const run = await runSourceScript(src.document_script, { params: (req.body && req.body.params) || {} });
  if (!run.ok) return res.status(422).json({ error: run.error, logs: run.logs });
  const proposed = (run.result && typeof run.result === 'object' && !Array.isArray(run.result)) ? run.result : null;
  if (!proposed) return res.status(422).json({ error: 'Lo script di importazione deve chiamare app.result con un oggetto {campo: valore}', logs: run.logs });

  // Solo i campi che il modulo conosce davvero — uno script di una Source di terzi
  // non può scrivere un campo arbitrario che il Builder non ha dichiarato.
  const fieldKeys = new Set((schema.fields || []).map((f) => f.key));
  const filtered = Object.fromEntries(Object.entries(proposed).filter(([k]) => fieldKeys.has(k)));

  const withDefaults = applyDefaults(filtered, schema.fields);
  const uniqueError = checkUnique(req.params.slug, schema.fields, withDefaults, null);
  if (uniqueError) return res.status(400).json(uniqueError);
  const validationError = checkCreationValidation(schema, req.params.slug, withDefaults);
  if (validationError) return res.status(400).json(validationError);
  const safeBody = encryptFields(withDefaults, schema.fields);
  const result = db.prepare('INSERT INTO records (module_slug, user_id, data) VALUES (?, ?, ?)').run(req.params.slug, req.user.id, JSON.stringify(safeBody));
  const record = db.prepare('SELECT * FROM records WHERE id = ?').get(result.lastInsertRowid);
  const decrypted = decryptFields(JSON.parse(record.data), schema.fields);
  const attached = attachComputedFields({ ...record, data: decrypted }, schema, req.params.slug);
  fireTrigger(req.params.slug, 'nuovo_record', attached.data, attached.id, {});
  logHistory(req.params.slug, attached.id, req.user.username, 'create', null, attached.data);
  logAudit(req.user.username, 'record.import_source', req.params.slug + '#' + attached.id, { source: req.params.key });
  res.json(attached);
});

router.put('/:slug/:id', requireAuth, requireModuleAccess, (req, res) => {
  const schema = getModuleSchema(req.params.slug) || {};
  const existing = db.prepare('SELECT * FROM records WHERE id = ? AND module_slug = ?').get(req.params.id, req.params.slug);
  if (!existing) return res.status(404).json({ error: 'Record non trovato' });

  // Permesso verificato SUL RECORD ESISTENTE, prima di scrivere qualunque cosa — se
  // il ruolo ha view_own_only, un utente non può modificare un record che non è suo
  // nemmeno se 'edit' è true per il ruolo: non può vederlo, quindi non può nemmeno
  // agire su un id indovinato/copiato da qualcun altro.
  const rule = ruleFor(schema, req.user.role);
  if (rule && (!rule.edit || !ownedOrAllowed(rule, existing, req.user))) {
    return res.status(403).json({ error: 'Non hai i permessi per modificare questo record' });
  }

  // Stato PRIMA dell'update, per capire cosa è davvero cambiato (trigger cambio_stato /
  // modifica_campo) — senza questo confronto, ogni salvataggio (anche di un campo
  // invariato) farebbe scattare tutte le automazioni "modifica_campo" del modulo.
  const beforeData = JSON.parse(existing.data);

  const corpo = valoriSuggeriti.allinea(req.params.slug, schema, competenza.applica(req.params.slug, applicaEredita(db, schema, req.body), beforeData), req.user.id);
  for (const f of schema.fields || []) if (f.sola_lettura) { if (beforeData[f.key] === undefined) delete corpo[f.key]; else corpo[f.key] = beforeData[f.key]; } // sola lettura: resta com'è (lo cambia solo la firma)
  const uniqueError = checkUnique(req.params.slug, schema.fields, corpo, req.params.id);
  if (uniqueError) return res.status(400).json(uniqueError);
  const campoError = controllaValidazioni(schema.fields, corpo, beforeData);
  if (campoError) return res.status(400).json(campoError);
  const safeBody = encryptFields(corpo, schema.fields);
  db.prepare('UPDATE records SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND module_slug = ?').run(JSON.stringify(safeBody), req.params.id, req.params.slug);
  const record = db.prepare('SELECT * FROM records WHERE id = ?').get(req.params.id);
  const decryptedData = decryptFields(JSON.parse(record.data), schema.fields);
  const attached = attachComputedFields({ ...record, data: decryptedData }, schema, req.params.slug);

  if (beforeData._stato !== undefined && attached.data._stato !== undefined && beforeData._stato !== attached.data._stato) {
    fireTrigger(req.params.slug, 'cambio_stato', attached.data, attached.id, { stato: attached.data._stato });
  }
  Object.keys(attached.data || {}).forEach((key) => {
    if (key === '_stato') return; // già gestito sopra come evento dedicato, non anche come modifica_campo generica
    if (JSON.stringify(beforeData[key]) !== JSON.stringify(attached.data[key])) {
      fireTrigger(req.params.slug, 'modifica_campo', attached.data, attached.id, { campo: key });
    }
  });
  logHistory(req.params.slug, attached.id, req.user.username, 'update', beforeData, attached.data);

  res.json(attached);
});

router.use(require('./records-transizioni'));

const documenti = require('./records-documenti');
router.use(documenti);


// Cancellare un piano a rate (debiti_casa/debiti_personali, dichiarato con una scheda "Piani rateali" — Builder →
// Vista genitore-figli) lasciava le rate già generate come righe di spesa orfane, collegate a un piano che non
// esiste più: bisognava poi cercarle e cancellarle una per una a mano (segnalato dall'utente il 28/10). Qui si
// cancellano IN CASCATA, ma solo quelle NON ancora pagate (children_status_field diverso da children_status_done_value):
// le rate già pagate restano, sono storico di un pagamento reale già avvenuto. Generico: legge solo la dichiarazione
// del modulo (parent_children_views / vista "children"), nessun nome di modulo o di campo scritto qui.
async function cascadeDeleteUnpaidChildren(schema, parentId, actor) {
  const views = [...(schema.parent_children_views || []), ...((schema.views || []).filter((v) => v.mode === 'children'))];
  let n = 0;
  for (const cfg of views) {
    if (!cfg.children_module || !cfg.children_relation || !cfg.children_status_field) continue;
    const children = db.prepare('SELECT id, data FROM records WHERE module_slug = ?').all(cfg.children_module);
    for (const row of children) {
      let data; try { data = JSON.parse(row.data || '{}'); } catch (e) { continue; }
      if (data[cfg.children_relation] !== parentId) continue;
      if (data[cfg.children_status_field] === cfg.children_status_done_value) continue; // già pagata: non si tocca
      const attachments = db.prepare('SELECT upload_id FROM record_attachments WHERE module_slug = ? AND record_id = ?').all(cfg.children_module, row.id);
      db.prepare('DELETE FROM record_attachments WHERE module_slug = ? AND record_id = ?').run(cfg.children_module, row.id);
      for (const att of attachments) { try { await deleteUploadById(att.upload_id); } catch (e) {} }
      logHistory(cfg.children_module, row.id, actor, 'delete', data, null);
      db.prepare('DELETE FROM records WHERE id = ? AND module_slug = ?').run(row.id, cfg.children_module);
      n++;
    }
  }
  return n;
}

router.delete('/:slug/:id', requireAuth, requireModuleAccess, async (req, res) => {
  const schema = getModuleSchema(req.params.slug) || {};
  const existing = db.prepare('SELECT * FROM records WHERE id = ? AND module_slug = ?').get(req.params.id, req.params.slug);
  if (!existing) return res.status(404).json({ error: 'Record non trovato' });
  const rule = ruleFor(schema, req.user.role);
  if (rule && (!rule.delete || !ownedOrAllowed(rule, existing, req.user))) {
    return res.status(403).json({ error: 'Non hai i permessi per eliminare questo record' });
  }
  // Gli allegati del record (se ce ne sono) non restano orfani — prima
  // restavano per sempre su disco/Drive e come righe morte in
  // record_attachments (nessun vincolo di chiave esterna su record_id le
  // avrebbe comunque bloccate, ma restavano lì a puntare a un record
  // inesistente), mai puliti alla cancellazione del record che li conteneva.
  const attachments = db.prepare('SELECT upload_id FROM record_attachments WHERE module_slug = ? AND record_id = ?').all(req.params.slug, req.params.id);
  db.prepare('DELETE FROM record_attachments WHERE module_slug = ? AND record_id = ?').run(req.params.slug, req.params.id);
  for (const att of attachments) {
    try { await deleteUploadById(att.upload_id); } catch (e) {}
  }
  logHistory(req.params.slug, req.params.id, req.user.username, 'delete', JSON.parse(existing.data), null);
  db.prepare('DELETE FROM records WHERE id = ? AND module_slug = ?').run(req.params.id, req.params.slug);
  const righeCollegate = await cascadeDeleteUnpaidChildren(schema, parseInt(req.params.id, 10), req.user.username);
  logAudit(req.user.username, 'record.delete', req.params.slug + '#' + req.params.id, righeCollegate ? { righe_collegate_eliminate: righeCollegate } : null);
  res.json({ ok: true, righe_collegate_eliminate: righeCollegate });
});

router.use(require('./records-allegati'));


module.exports = router;
module.exports.runTransition = require('./records-transizioni').runTransition;
module.exports.contestoDocumentoDa = documenti.contestoDocumentoDa;
module.exports.getModuleSchema = getModuleSchema;
module.exports.registraFirmato = documenti.registraFirmato;
