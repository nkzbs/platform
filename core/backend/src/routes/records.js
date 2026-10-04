const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('./auth');
const { evaluateFormula, evaluateSteps, getModuleRows, aggregateValues, loadModuleMap, toDayCount, compareValues } = require('../formula');
const { parseSchemaNormalized } = require('../schema-v3');
const { fireTrigger } = require('../automation-engine');
const { logAudit } = require('../audit-log');
const { encryptFields, decryptFields } = require('../crypto-fields');
const { attachComputedFields: attachComputedFieldsShared } = require('../computed-fields');
const { ruleFor, ownedOrAllowed, filterViewable, isOwnRecord } = require('../permissions');
const { deleteUploadById } = require('../lib/upload-storage');
const { computePeriodView, shiftPeriod, dateToIsoYearWeek } = require('../period-view');
const { computeParentChildren } = require('../parent-children-view');
const { computeYearlyBreakdown } = require('../yearly-breakdown');
const { computeCategoryPivot } = require('../category-pivot');
const { computeWeeklyBreakdown } = require('../weekly-breakdown');

const router = express.Router();

function getModuleSchema(slug) {
  const mod = db.prepare('SELECT schema_json FROM modules WHERE slug = ?').get(slug);
  if (!mod) return null;
  return parseSchemaNormalized(mod.schema_json);
}

// Calcola i campi di tipo 'computed' per un record, sempre a runtime — non sono mai
// salvati nel record stesso (coerente col principio "i moduli sono solo schema, mai
// codice/logica dedicata": un campo computed è un'annotazione nello schema_json, la
// stessa formula.js già usata per gli aggregati di Report, solo con uno scope diverso).
// Un campo computed usa `steps` (catena di blocchi) SE presente, altrimenti `expr`
// (testo) — le due rappresentazioni non convivono mai sullo stesso campo.
function attachComputedFields(record, schema, moduleSlug) {
  return attachComputedFieldsShared(db, record, schema, moduleSlug);
}

// Come sopra, ma per le righe "piatte" ({__id, ...campi}, nessun sotto-oggetto data) usate
// dai blocchi Builder che leggono i record grezzi da sé (period_view,
// parent_children_view, yearly_breakdown/category_pivot/weekly_breakdown via
// loadFilteredRows) — un campo computed non è MAI persistito nel record, quindi
// date_field/metric_field/group_by che puntano a un campo computed leggerebbero sempre
// undefined (trattato come 0) senza questo passaggio. Trovato reale: Scadenzario (Coffee,
// fatture.residuo) mostrava 0 in ogni bucket — il metric_field è un campo computed, mai
// calcolato prima d'ora su queste righe. Muta le righe in place (stesso pattern di
// attachComputedFields) ed è no-op se il modulo non ha campi computed/soglia/soglia_data.
function attachComputedToFlatRows(rawRows, schema, moduleSlug) {
  const hasComputed = (schema.fields || []).some((f) => ['computed', 'soglia', 'soglia_data'].includes(f.type));
  if (!hasComputed) return rawRows;
  rawRows.forEach((row) => attachComputedFields({ id: row.__id, data: row }, schema, moduleSlug));
  return rawRows;
}

// Applica i valori di default definiti nello schema ai campi mancanti/vuoti del body.
// Token speciali: '_today_' → data odierna ISO, '_now_' → datetime locale ISO.
function applyDefaults(data, fields) {
  const result = { ...data };
  for (const f of (fields || [])) {
    if (f.default_value === undefined || f.default_value === null || f.default_value === '') continue;
    if (result[f.key] !== undefined && result[f.key] !== null && result[f.key] !== '') continue;
    let val = f.default_value;
    if (val === '_today_') val = new Date().toISOString().slice(0, 10);
    else if (val === '_now_') val = new Date().toISOString().slice(0, 16);
    result[f.key] = val;
  }
  return result;
}

// Verifica vincolo univoco: nessun altro record nel modulo può avere lo stesso valore
// su campi marcati unique:true. excludeId esclude il record stesso in caso di PUT.
function checkUnique(slug, fields, data, excludeId) {
  const uniqueFields = (fields || []).filter(
    (f) => f.unique && data[f.key] !== undefined && data[f.key] !== null && data[f.key] !== ''
  );
  if (uniqueFields.length === 0) return null;
  const rows = db.prepare('SELECT id, data FROM records WHERE module_slug = ?').all(slug);
  for (const f of uniqueFields) {
    const conflict = rows.find((r) => {
      if (excludeId && r.id === parseInt(excludeId)) return false;
      try { return String(JSON.parse(r.data)[f.key]) === String(data[f.key]); } catch { return false; }
    });
    if (conflict) return { error: `Il campo "${f.label || f.key}" deve essere univoco — questo valore è già presente.` };
  }
  return null;
}

// Validazione bloccante opzionale sulla CREAZIONE di un record (blocco schema
// 'validazione_creazione': { expr, messaggio }) — stessa sandbox espressioni già
// usata per i campi computed e per la validazione delle transizioni di workflow,
// solo valutata prima dell'insert invece che prima di un cambio stato. Non c'è
// ancora un id reale (il record non esiste finché non passa questo controllo),
// quindi il contesto porta solo currentRecordData, mai currentRecordId.
function checkCreationValidation(schema, slug, data) {
  const v = schema && schema.validazione_creazione;
  if (!v || !v.expr) return null;
  const context = { currentModule: slug, currentRecordData: data };
  const result = evaluateFormula(v.expr, db, context);
  if (!result.valid) return { error: 'Validazione creazione non valutabile: ' + (result.errors || []).join('; ') };
  if (!result.value) return { error: v.messaggio || 'Creazione bloccata: condizione non soddisfatta' };
  return null;
}

function logHistory(moduleSlug, recordId, actor, action, beforeData, afterData) {
  try {
    db.prepare('INSERT INTO record_history (record_id, module_slug, actor, action, before_data, after_data) VALUES (?, ?, ?, ?, ?, ?)')
      .run(recordId, moduleSlug, actor || null, action, beforeData != null ? JSON.stringify(beforeData) : null, afterData != null ? JSON.stringify(afterData) : null);
  } catch (e) { /* mai blocca il salvataggio del record */ }
}

// Valuta SOLO i campi computed marcati `live: true` (attributo generico sulla card
// Formula/Aggregato, non specifico di nessun caso d'uso) contro un record ANCORA IN
// BOZZA — dati in memoria nel form, mai salvato, quindi senza id reale. Aperto a
// qualunque utente autenticato (non requireAdmin come /builder/formula/check, che
// è per chi progetta lo schema, non per chi compila un record): usa sempre lo schema
// pubblicato (getModuleSchema), mai il draft del Builder, coerente con create/update
// sotto in questo stesso file. `childRows` è l'equivalente in bozza di *_children —
// righe embedded già in memoria lato form (vedi ModulePage), usate dal fallback
// generico di evaluateSteps quando get_related non trova un currentRecordId reale.
router.post('/:slug/evaluate-live', requireAuth, (req, res) => {
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

router.get('/:slug', requireAuth, (req, res) => {
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

// ─── REPORT: aggregato raggruppato per categoria ───────────────────────────────
// Primo vero consumatore del blocco "Formula/Aggregato" (report_aggregate) del
// Builder — quel blocco esiste e si valida da tempo, ma finora nessuna schermata
// calcolava e mostrava davvero i suoi numeri. Qui il raggruppamento è generico:
// group_by può essere QUALUNQUE campo select/checkbox del modulo (non un nome fisso
// tipo "categoria"), metric QUALUNQUE campo numerico — chi chiama decide la forma,
// il motore non conosce il significato dei dati, solo come aggregarli. Riusa
// aggregateValues, la stessa matematica già usata per i campi computed, non una
// copia — se quella cambia, anche questo endpoint si allinea da solo.
router.get('/:slug/report', requireAuth, (req, res) => {
  const schema = getModuleSchema(req.params.slug) || {};
  const { group_by, metric, func, metric_subtract, date_field, date_from, date_to, compare_from, compare_to } = req.query;
  if (!group_by || !metric) return res.status(400).json({ error: 'group_by e metric sono obbligatori' });

  const rule = ruleFor(schema, req.user.role);
  if (rule && !rule.view) return res.status(403).json({ error: 'Non hai i permessi per vedere questo modulo' });

  let allRows = getModuleRows(db, req.params.slug);
  if (rule && rule.view_own_only) {
    const rawRows = db.prepare('SELECT data, user_id FROM records WHERE module_slug = ?').all(req.params.slug);
    allRows = rawRows.filter((r) => isOwnRecord(rule, r, req.user))
      .map((r) => { try { return JSON.parse(r.data); } catch (e) { return {}; } });
  }

  // group_by può riferirsi a un campo di un modulo COLLEGATO via relazione many_to_one
  // (notazione "relazione.campo", es. "conto.tipo" da movimenti_righe verso piano_conti)
  // invece che solo a un campo proprio — necessario per i report contabili reali (saldo
  // per tipo di conto, costi per centro di costo), dove il valore di raggruppamento non
  // vive mai sul modulo che si sta aggregando ma su quello collegato.
  let resolveGroupKey = (r) => {
    const rawKey = r[group_by];
    return (rawKey === undefined || rawKey === null || rawKey === '') ? '(vuoto)' : String(rawKey);
  };
  if (group_by.includes('.')) {
    const [relKey, targetField] = group_by.split('.');
    const modMap = loadModuleMap(db);
    const relation = ((modMap[req.params.slug] || {}).relations || []).find((rel) => rel.key === relKey && rel.type === 'many_to_one');
    if (!relation) return res.status(400).json({ error: `Nessuna relazione "${relKey}" su questo modulo` });
    const targetRows = db.prepare('SELECT id, data FROM records WHERE module_slug = ?').all(relation.target_module);
    const targetById = {};
    targetRows.forEach((tr) => { try { targetById[tr.id] = JSON.parse(tr.data); } catch (e) { targetById[tr.id] = {}; } });
    resolveGroupKey = (r) => {
      const targetId = r[relKey];
      const targetData = targetId != null ? targetById[targetId] : null;
      const rawKey = targetData ? targetData[targetField] : undefined;
      return (rawKey === undefined || rawKey === null || rawKey === '') ? '(vuoto)' : String(rawKey);
    };
  }

  const filterByDate = (rows, from, to) => {
    if (!date_field || (!from && !to)) return rows;
    return rows.filter((r) => {
      const v = r[date_field];
      if (!v) return false;
      const d = v.slice(0, 10);
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
  };

  const metricField = (schema.fields || []).find((f) => f.key === metric);

  const buildGroups = (rows) => {
    const groups = {};
    rows.forEach((r) => {
      const key = resolveGroupKey(r);
      if (!groups[key]) groups[key] = [];
      groups[key].push(r);
    });
    const result = Object.entries(groups).map(([label, groupRows]) => {
      const value = aggregateValues(groupRows, metric, func || 'sum', metricField && metricField.type);
      // metric_subtract: sottrae la stessa aggregazione (stesso func) calcolata su un
      // secondo campo delle STESSE righe del gruppo — copre "saldo = dare - avere",
      // ricorrente in ogni report di contabilità in partita doppia (Bilancio, Conto
      // Economico, Centri di Costo), senza due chiamate separate sottratte a mano lato
      // client come oggi fanno CentriCostoPage.jsx/ContabilitaGeneralePage.jsx.
      const netValue = metric_subtract
        ? value - aggregateValues(groupRows, metric_subtract, func || 'sum', metricField && metricField.type)
        : value;
      return { label, value: netValue, count: groupRows.length };
    }).sort((a, b) => b.value - a.value);
    return { groups: result, total: result.reduce((s, g) => s + g.value, 0) };
  };

  const current = buildGroups(filterByDate(allRows, date_from, date_to));
  const response = { ...current };

  if (compare_from || compare_to) {
    const prev = buildGroups(filterByDate(allRows, compare_from, compare_to));
    response.compare_groups = prev.groups;
    response.compare_total = prev.total;
  }

  res.json(response);
});

// Esegue un blocco report_aggregate "a valore singolo" (senza group_by — quelli passano
// da /report sopra) — vocabolario esistente dal Builder da tempo (editor + validazione
// publish-time) ma mai eseguito da nessuna route finora. La formula può referenziare
// altri aggregati dello stesso modulo per nome (vedi formula.js evaluateModuleAggregate/
// agg_ref), per comporre valori tipo un "indice" pesato da più aggregati già definiti
// a parte, invece di essere un'unica formula gigante.
router.get('/:slug/aggregate/:key', requireAuth, (req, res) => {
  const schema = getModuleSchema(req.params.slug) || {};
  const rule = ruleFor(schema, req.user.role);
  if (rule && !rule.view) return res.status(403).json({ error: 'Non hai i permessi per vedere questo modulo' });
  const agg = (schema.aggregati || []).find((a) => a.key === req.params.key);
  if (!agg) return res.status(404).json({ error: 'Aggregato non trovato' });
  if (agg.group_by) return res.status(400).json({ error: 'Questo aggregato è raggruppato — usa GET /:slug/report' });
  if (!agg.expr || !agg.expr.trim()) return res.status(400).json({ error: 'Aggregato senza formula' });
  const result = evaluateFormula(agg.expr, db, { currentModule: req.params.slug });
  if (!result.valid) return res.status(400).json({ error: result.errors.join('; ') });
  res.json({ key: agg.key, label: agg.label, format: agg.format || 'number', value: result.value });
});

// Legge un campo, con supporto alla notazione "relazione.campo" (stesso pattern già
// usato da group_by di report_aggregate) per i casi in cui il dato (es. la data) vive
// sul record COLLEGATO via many_to_one, non sulla riga stessa — es. le righe di un
// movimento contabile non hanno una propria data, la ereditano dal movimento padre.
function resolveFieldPath(row, path, relationCache) {
  if (!path.includes('.')) return row[path];
  const [relKey, targetField] = path.split('.');
  const targetId = row[relKey];
  const cache = relationCache[relKey];
  if (!cache || targetId == null) return undefined;
  const targetData = cache[targetId];
  return targetData ? targetData[targetField] : undefined;
}

// Costruisce una cache id->data per ogni relazione many_to_one usata dai path con
// notazione "relazione.campo" in una vista — una query per relazione
// coinvolta, non una per riga (altrimenti N righe = N query).
function buildRelationCache(db, sourceModule, modMap, paths) {
  const cache = {};
  const relKeys = new Set(paths.filter((p) => p && p.includes('.')).map((p) => p.split('.')[0]));
  relKeys.forEach((relKey) => {
    const relation = ((modMap[sourceModule] || {}).relations || []).find((r) => r.key === relKey && r.type === 'many_to_one');
    if (!relation) return;
    const rows = db.prepare('SELECT id, data FROM records WHERE module_slug = ?').all(relation.target_module);
    const byId = {};
    rows.forEach((r) => { try { byId[r.id] = JSON.parse(r.data); } catch (e) { byId[r.id] = {}; } });
    cache[relKey] = byId;
  });
  return cache;
}

// Vista navigabile per periodo (mese o anno) — es. Spese Casa (mese corrente, avanti/
// indietro), Report (anno corrente vs precedente). y/m in query indicano il periodo
// richiesto (m assente per granularità 'anno'); senza query param, il periodo odierno.
router.get('/:slug/period-view/:key', requireAuth, (req, res) => {
  const schema = getModuleSchema(req.params.slug) || {};
  const rule = ruleFor(schema, req.user.role);
  if (rule && !rule.view) return res.status(403).json({ error: 'Non hai i permessi per vedere questo modulo' });
  const config = (schema.period_views || []).find((p) => p.key === req.params.key);
  if (!config) return res.status(404).json({ error: 'Vista non trovata' });

  const modMap = loadModuleMap(db);
  const rawRows = attachComputedToFlatRows(db.prepare('SELECT id, data FROM records WHERE module_slug = ?').all(req.params.slug)
    .map((r) => { try { return { __id: r.id, ...JSON.parse(r.data || '{}') }; } catch (e) { return { __id: r.id }; } }), schema, req.params.slug);

  const filterPaths = (config.filters || []).map((f) => f.field).filter((p) => p && p.includes('.'));
  const relCache = buildRelationCache(db, req.params.slug, modMap, filterPaths);
  const rows = rawRows.filter((row) => (config.filters || []).every((f) => compareValues(resolveFieldPath(row, f.field, relCache), f.op || '==', f.value)));

  const now = new Date();
  const defaultPeriod = config.granularity === 'anno' ? { y: now.getFullYear() }
    : config.granularity === 'settimana' ? dateToIsoYearWeek(now)
    : { y: now.getFullYear(), m: now.getMonth() + 1 };
  const period = req.query.y
    ? (config.granularity === 'anno' ? { y: parseInt(req.query.y) }
      : config.granularity === 'settimana' ? { y: parseInt(req.query.y), w: parseInt(req.query.w) || 1 }
      : { y: parseInt(req.query.y), m: parseInt(req.query.m) || 1 })
    : defaultPeriod;

  const result = computePeriodView(rows, config.date_field, config.granularity, period, config.metrics || [], !!config.compare_previous, compareValues);
  const prev = shiftPeriod(config.granularity, period, -1);
  const next = shiftPeriod(config.granularity, period, 1);
  res.json({ key: config.key, label: config.label, period, prev, next, ...result });
});

// Lista di genitori con riepilogo dei figli (es. Debiti con le rispettive Rate) — i figli
// vivono in un altro modulo (children_module), collegati via una relazione many_to_one
// SU quel modulo verso questo (children_relation, come sum_children).
router.get('/:slug/parent-children/:key', requireAuth, (req, res) => {
  const schema = getModuleSchema(req.params.slug) || {};
  const rule = ruleFor(schema, req.user.role);
  if (rule && !rule.view) return res.status(403).json({ error: 'Non hai i permessi per vedere questo modulo' });
  const config = (schema.parent_children_views || []).find((p) => p.key === req.params.key);
  if (!config) return res.status(404).json({ error: 'Vista non trovata' });

  const modMap = loadModuleMap(db);
  const childSchema = modMap[config.children_module];
  if (!childSchema) return res.status(400).json({ error: `Modulo figli "${config.children_module}" non trovato` });
  const rel = (childSchema.relations || []).find((r) => r.key === config.children_relation && r.type === 'many_to_one');
  if (!rel) return res.status(400).json({ error: `Relazione "${config.children_relation}" non trovata su "${config.children_module}"` });

  const parents = attachComputedToFlatRows(db.prepare('SELECT id, data FROM records WHERE module_slug = ?').all(req.params.slug)
    .map((r) => { try { return { __id: r.id, ...JSON.parse(r.data || '{}') }; } catch (e) { return { __id: r.id }; } }), schema, req.params.slug);
  const childrenRaw = attachComputedToFlatRows(db.prepare('SELECT id, data FROM records WHERE module_slug = ?').all(config.children_module)
    .map((r) => { try { return { __id: r.id, ...JSON.parse(r.data || '{}') }; } catch (e) { return { __id: r.id }; } }), childSchema, config.children_module);

  const childrenByParent = new Map();
  childrenRaw.forEach((c) => {
    const pid = c[config.children_relation];
    if (pid == null) return;
    if (!childrenByParent.has(pid)) childrenByParent.set(pid, []);
    childrenByParent.get(pid).push(c);
  });
  if (config.children_order_field) {
    childrenByParent.forEach((list) => list.sort((a, b) => String(a[config.children_order_field] || '').localeCompare(String(b[config.children_order_field] || ''))));
  }

  const rows = computeParentChildren(parents, childrenByParent, config);
  res.json({ key: config.key, label: config.label, rows });
});

// Carica e filtra le righe di un modulo per un blocco "report" — condiviso da
// yearly-breakdown e category-pivot sotto, entrambi con lo stesso bisogno (righe di un
// modulo, opzionalmente un ALTRO modulo via source_module — come report_aggregate — con
// gli stessi filtri {field,op,value} già usati altrove).
function loadFilteredRows(sourceModule, filters, modMap) {
  const rawRows = attachComputedToFlatRows(db.prepare('SELECT id, data FROM records WHERE module_slug = ?').all(sourceModule)
    .map((r) => { try { return { __id: r.id, ...JSON.parse(r.data || '{}') }; } catch (e) { return { __id: r.id }; } }), modMap[sourceModule] || {}, sourceModule);
  const filterPaths = (filters || []).map((f) => f.field).filter((p) => p && p.includes('.'));
  const relCache = buildRelationCache(db, sourceModule, modMap, filterPaths);
  return rawRows.filter((row) => (filters || []).every((f) => compareValues(resolveFieldPath(row, f.field, relCache), f.op || '==', f.value)));
}

// Riepilogo mensile di un anno (12 mesi), opzionalmente confrontato con lo stesso mese
// dell'anno precedente — es. ReportFinancePage "Riepilogo mensile". Diverso da
// period_view: qui i 12 mesi convivono nella stessa risposta (una tabella/grafico), non
// un solo periodo navigabile.
router.get('/:slug/yearly-breakdown/:key', requireAuth, (req, res) => {
  const schema = getModuleSchema(req.params.slug) || {};
  const rule = ruleFor(schema, req.user.role);
  if (rule && !rule.view) return res.status(403).json({ error: 'Non hai i permessi per vedere questo modulo' });
  const config = (schema.yearly_breakdowns || []).find((y) => y.key === req.params.key);
  if (!config) return res.status(404).json({ error: 'Vista non trovata' });

  const modMap = loadModuleMap(db);
  const sourceModule = config.source_module || req.params.slug;
  const rows = loadFilteredRows(sourceModule, config.filters, modMap);
  const year = parseInt(req.query.y) || new Date().getFullYear();

  const result = computeYearlyBreakdown(rows, config.date_field, year, config.metrics || [], !!config.compare_previous_year, compareValues);
  res.json({ key: config.key, label: config.label, ...result });
});

// Pivot per categoria su N anni, con delta% tra i due più recenti — es.
// ReportFinancePage "Anno su anno" (2 anni) e "Storico utenze" (N anni).
router.get('/:slug/category-pivot/:key', requireAuth, (req, res) => {
  const schema = getModuleSchema(req.params.slug) || {};
  const rule = ruleFor(schema, req.user.role);
  if (rule && !rule.view) return res.status(403).json({ error: 'Non hai i permessi per vedere questo modulo' });
  const config = (schema.category_pivots || []).find((c) => c.key === req.params.key);
  if (!config) return res.status(404).json({ error: 'Vista non trovata' });

  const modMap = loadModuleMap(db);
  const sourceModule = config.source_module || req.params.slug;
  const rows = loadFilteredRows(sourceModule, config.filters, modMap);
  const baseYear = parseInt(req.query.y) || new Date().getFullYear();
  const nYears = Math.max(1, Math.min(10, parseInt(req.query.n) || config.n_years || 2));
  const years = Array.from({ length: nYears }, (_, i) => baseYear - i);

  const metric = { field: config.metric_field, func: config.metric_func || 'sum' };
  const result = computeCategoryPivot(rows, config.date_field, config.group_by, metric, years, compareValues);
  res.json({ key: config.key, label: config.label, format: config.metric_format || 'number', ...result });
});

// Settimane ISO di un mese, ciascuna con la sua metrica + un totale opzionale "oltre
// soglia" (es. Timbrature: ore per settimana + straordinari oltre 40h/settimana).
router.get('/:slug/weekly-breakdown/:key', requireAuth, (req, res) => {
  const schema = getModuleSchema(req.params.slug) || {};
  const rule = ruleFor(schema, req.user.role);
  if (rule && !rule.view) return res.status(403).json({ error: 'Non hai i permessi per vedere questo modulo' });
  const config = (schema.weekly_breakdowns || []).find((w) => w.key === req.params.key);
  if (!config) return res.status(404).json({ error: 'Vista non trovata' });

  const modMap = loadModuleMap(db);
  const sourceModule = config.source_module || req.params.slug;
  const rows = loadFilteredRows(sourceModule, config.filters, modMap);
  const now = new Date();
  const year = parseInt(req.query.y) || now.getFullYear();
  const month = parseInt(req.query.m) || (now.getMonth() + 1);

  const metric = { field: config.metric_field, func: config.metric_func || 'sum' };
  const threshold = config.threshold != null ? Number(config.threshold) : null;
  const result = computeWeeklyBreakdown(rows, config.date_field, year, month, metric, threshold, compareValues);
  res.json({ key: config.key, label: config.label, format: config.metric_format || 'number', ...result });
});

router.get('/:slug/export', requireAuth, (req, res) => {
  const schema = getModuleSchema(req.params.slug) || {};
  const rule = ruleFor(schema, req.user.role);
  if (rule && !rule.view) return res.status(403).json({ error: 'Non hai i permessi per esportare questo modulo' });

  let records = db.prepare('SELECT * FROM records WHERE module_slug = ? ORDER BY created_at DESC').all(req.params.slug)
    .map((r) => ({ ...r, data: JSON.parse(r.data) }));
  records = filterViewable(records, rule, req.user);
  records = records.map((r) => ({ ...r, data: decryptFields(r.data, schema.fields) }));

  const exportFields = (schema.fields || []).filter((f) => f.type !== 'computed' && f.type !== 'soglia' && f.type !== 'soglia_data');
  const headers = ['ID', 'Creato il', 'Aggiornato il', ...exportFields.map((f) => f.label || f.key)];
  const esc = (s) => '"' + String(s ?? '').replace(/"/g, '""') + '"';
  const csvRows = records.map((r) => [
    r.id,
    r.created_at,
    r.updated_at,
    ...exportFields.map((f) => {
      const v = r.data[f.key];
      if (v === null || v === undefined) return '';
      if (f.type === 'encrypted') return '[cifrato]';
      if (typeof v === 'object') return JSON.stringify(v);
      return String(v);
    }),
  ]);
  const csv = [headers, ...csvRows].map((row) => row.map(esc).join(',')).join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="' + req.params.slug + '-export.csv"');
  res.send('﻿' + csv);
});

// F15 (PLATFORM-MASTER-ROADMAP.md) — Migration Engine: "Extract" (CSV, sempre esistito) +
// "Discover"/"Profile"/"Map" resi reali sotto (prima erano un match automatico "alla cieca"
// per nome esatto — se l'header di chi importa non coincideva byte-per-byte con label/key del
// campo, quella colonna spariva senza che l'utente lo sapesse). Nessun connettore per sistemi
// specifici (gestionali di terze parti, citati dalla roadmap): nessuna conoscenza verificabile
// del loro formato reale — costruirli ora sarebbe stato inventare un formato, lo stesso errore
// già rifiutato altrove in questa sessione ("mai un check finto"). Il CSV resta il formato
// universale realmente supportabile senza fabbricare nulla.
function parseCsvRow(line) {
  const cols = []; let cur = ''; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"' && !inQ) { inQ = true; continue; }
    if (c === '"' && inQ) { if (line[i + 1] === '"') { cur += '"'; i++; } else { inQ = false; } continue; }
    if (c === ',' && !inQ) { cols.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  cols.push(cur.trim());
  return cols;
}
function parseCsvLines(csvText) {
  return csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(Boolean);
}
function normalizeHeader(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');
}
function importableFields(schema) {
  return (schema.fields || []).filter((f) => f.type !== 'computed' && f.type !== 'soglia' && f.type !== 'soglia_data');
}
// Match automatico ESATTO (nome header = label o key del campo) — comportamento storico di
// POST /import, invariato per chi non passa field_map esplicito (mai una regressione per un
// import già in uso in produzione). Il match NORMALIZZATO (maiuscole/accenti/spazi ignorati)
// è usato SOLO come suggerimento in /import/preview, mai applicato in automatico.
function exactHeaderMatch(headers, exportFields) {
  const fieldMap = {};
  headers.forEach((h, i) => {
    const f = exportFields.find((f) => f.label === h || f.key === h);
    if (f) fieldMap[i] = f.key;
  });
  return fieldMap;
}

// "Discover" + "Profile": mostra cosa contiene il file PRIMA di scrivere qualunque record —
// intestazioni trovate, un suggerimento di mappatura (match esatto, poi normalizzato come
// fallback), le prime righe come anteprima, quanti campi del modulo restano senza colonna.
router.post('/:slug/import/preview', requireAuth, (req, res) => {
  const schema = getModuleSchema(req.params.slug) || {};
  const rule = ruleFor(schema, req.user.role);
  if (rule && !rule.create) return res.status(403).json({ error: 'Non hai i permessi per creare record' });
  const csvText = req.body && req.body.csv;
  if (!csvText) return res.status(400).json({ error: 'Campo csv mancante nel body' });

  const lines = parseCsvLines(csvText);
  if (lines.length < 1) return res.json({ headers: [], suggestedMap: {}, sampleRows: [], totalRows: 0, unmatchedFields: [] });

  const headers = parseCsvRow(lines[0]);
  const exportFields = importableFields(schema);
  const exactMap = exactHeaderMatch(headers, exportFields);
  const suggestedMap = { ...exactMap };
  headers.forEach((h, i) => {
    if (suggestedMap[i]) return; // già trovato per match esatto
    const normH = normalizeHeader(h);
    const f = exportFields.find((f) => normalizeHeader(f.label) === normH || normalizeHeader(f.key) === normH);
    if (f) suggestedMap[i] = f.key;
  });

  const matchedKeys = new Set(Object.values(suggestedMap));
  const unmatchedFields = exportFields.filter((f) => !matchedKeys.has(f.key)).map((f) => ({ key: f.key, label: f.label, required: !!f.required }));

  res.json({
    headers,
    suggestedMap,
    sampleRows: lines.slice(1, 6).map(parseCsvRow),
    totalRows: Math.max(0, lines.length - 1),
    unmatchedFields,
  });
});

router.post('/:slug/import', requireAuth, (req, res) => {
  const schema = getModuleSchema(req.params.slug) || {};
  const rule = ruleFor(schema, req.user.role);
  if (rule && !rule.create) return res.status(403).json({ error: 'Non hai i permessi per creare record' });
  const csvText = req.body && req.body.csv;
  if (!csvText) return res.status(400).json({ error: 'Campo csv mancante nel body' });
  // field_map opzionale (indice colonna -> field key), da /import/preview confermata/corretta
  // a mano dall'utente — se assente, comportamento storico invariato (match esatto automatico).
  const explicitMap = req.body && req.body.field_map;

  const lines = parseCsvLines(csvText);
  if (lines.length < 2) return res.json({ created: 0, skipped: 0, errors: [] });

  const headers = parseCsvRow(lines[0]);
  const exportFields = importableFields(schema);
  const fieldMap = explicitMap && typeof explicitMap === 'object' ? explicitMap : exactHeaderMatch(headers, exportFields);

  let created = 0; let skipped = 0; const errors = [];
  for (let li = 1; li < lines.length; li++) {
    const cols = parseCsvRow(lines[li]);
    if (cols.every((c) => !c)) { skipped++; continue; }
    const data = {};
    cols.forEach((v, i) => { if (fieldMap[i] && v !== '') data[fieldMap[i]] = v; });
    try {
      const withDefaults = applyDefaults(data, schema.fields);
      const uniqueErr = checkUnique(req.params.slug, schema.fields, withDefaults, null);
      if (uniqueErr) { errors.push({ row: li + 1, error: uniqueErr.error }); continue; }
      const safeBody = encryptFields(withDefaults, schema.fields);
      db.prepare('INSERT INTO records (module_slug, user_id, data) VALUES (?, ?, ?)').run(req.params.slug, req.user.id, JSON.stringify(safeBody));
      created++;
    } catch (e) {
      errors.push({ row: li + 1, error: e.message });
    }
  }
  res.json({ created, skipped, errors });
});

// Imposta un campo allo stesso valore per TUTTI i record di un modulo in un colpo
// solo — azione di manutenzione generica (es. "azzera tutte le giacenze furgone",
// richiesta esplicita per coffee), non hardcoded su un modulo specifico. Solo
// admin: agisce su OGNI record del modulo, irreversibile a parte un backup del
// tenant — non esposta come azione generale in UI, va collegata a un bottone
// dedicato dove serve davvero (vedi ModulePage per giacenza_furgone).
router.post('/:slug/bulk-set-field', requireAuth, requireAdmin, (req, res) => {
  const { campo, valore } = req.body || {};
  if (!campo) return res.status(400).json({ error: 'Campo obbligatorio' });
  const rows = db.prepare('SELECT id, data FROM records WHERE module_slug = ?').all(req.params.slug);
  const update = db.prepare('UPDATE records SET data = ? WHERE id = ?');
  const tx = db.transaction(() => {
    rows.forEach((r) => {
      let d;
      try { d = JSON.parse(r.data || '{}'); } catch { return; }
      d[campo] = valore;
      update.run(JSON.stringify(d), r.id);
    });
  });
  tx();
  logAudit(req.user.username, 'records.bulk_set_field', req.params.slug, { campo, valore, count: rows.length });
  res.json({ ok: true, count: rows.length });
});

router.get('/:slug/:id', requireAuth, (req, res) => {
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

router.get('/:slug/:id/history', requireAuth, (req, res) => {
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

router.post('/:slug', requireAuth, (req, res) => {
  const schema = getModuleSchema(req.params.slug) || {};
  const rule = ruleFor(schema, req.user.role);
  if (rule && !rule.create) return res.status(403).json({ error: 'Non hai i permessi per creare record in questo modulo' });
  const withDefaults = applyDefaults(req.body, schema.fields);
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
  res.json(attached);
});

// Creazione al volo da una relazione (es. "+ Nuovo cliente" nel dropdown dell'Ordine).
// Non riusa semplicemente POST /:slug perché deve verificare, server-side, che la
// relazione che ha originato la richiesta abbia davvero quick_create abilitato per
// il ruolo di chi chiama — l'opzione "+ Nuovo" nel form è solo UI, qui è enforcement
// reale, altrimenti un utente senza permesso potrebbe chiamare l'endpoint a mano.
router.post('/:slug/quick-create', requireAuth, (req, res) => {
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

router.put('/:slug/:id', requireAuth, (req, res) => {
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

  const uniqueError = checkUnique(req.params.slug, schema.fields, req.body, req.params.id);
  if (uniqueError) return res.status(400).json(uniqueError);
  const safeBody = encryptFields(req.body, schema.fields);
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

router.post('/:slug/:id/transition', requireAuth, (req, res) => {
  const schema = getModuleSchema(req.params.slug) || {};
  const existing = db.prepare('SELECT * FROM records WHERE id = ? AND module_slug = ?').get(req.params.id, req.params.slug);
  if (!existing) return res.status(404).json({ error: 'Record non trovato' });

  const rule = ruleFor(schema, req.user.role);
  if (rule && (!rule.edit || !ownedOrAllowed(rule, existing, req.user))) {
    return res.status(403).json({ error: 'Non hai i permessi per modificare questo record' });
  }

  const { to } = req.body;
  if (!to) return res.status(400).json({ error: 'Campo "to" obbligatorio' });

  const workflow = schema.workflow;
  if (!workflow) return res.status(400).json({ error: 'Questo modulo non ha un workflow' });

  const beforeData = JSON.parse(existing.data);
  const from = beforeData._stato;

  const transition = (workflow.transitions || []).find((t) => t.from === from && t.to === to);
  if (!transition) {
    return res.status(422).json({ error: `Transizione non ammessa: ${from} → ${to}` });
  }

  if (Array.isArray(transition.roles) && transition.roles.length > 0 && !transition.roles.includes(req.user.role)) {
    return res.status(403).json({ error: 'Il tuo ruolo non può eseguire questa transizione' });
  }

  // Validazione bloccante opzionale sulla transizione (es. "dare == avere" prima di
  // confermare un movimento contabile) — riusa la stessa sandbox di espressioni dei
  // campi computed, ma qui il risultato blocca il salvataggio invece di limitarsi a
  // annotare un valore: è l'unico punto della piattaforma dove un'automazione può
  // impedire un cambiamento di stato invece di reagirci dopo il commit.
  if (transition.validazione && transition.validazione.expr) {
    const context = { currentModule: req.params.slug, currentRecordId: existing.id, currentRecordData: beforeData };
    const result = evaluateFormula(transition.validazione.expr, db, context);
    if (!result.valid) {
      return res.status(400).json({ error: 'Validazione transizione non valutabile: ' + (result.errors || []).join('; ') });
    }
    if (!result.value) {
      return res.status(400).json({ error: transition.validazione.messaggio || `Transizione ${from} → ${to} bloccata: condizione non soddisfatta` });
    }
  }

  // Variante di validazione per un confronto con un record DIRETTAMENTE collegato
  // (many_to_one) — es. "kg richiesti dal lotto ≤ kg disponibili nella materia prima
  // collegata". La sandbox formula.js non ha un primitivo "leggi un campo del record a
  // cui punto" (solo aggregazioni sui FIGLI, mai sul padre di una relazione), quindi
  // per questo caso specifico si confrontano due valori letti direttamente qui invece
  // di provare a forzarlo nel DSL delle formule.
  if (transition.validazione && transition.validazione.relazione_check) {
    const rc = transition.validazione.relazione_check;
    const relatedId = beforeData[rc.relazione];
    let relatedValue = null;
    if (relatedId && rc.modulo_relazionato && rc.campo_relazionato) {
      try {
        const row = db.prepare('SELECT data FROM records WHERE module_slug = ? AND id = ?').get(rc.modulo_relazionato, relatedId);
        if (row) relatedValue = parseFloat(JSON.parse(row.data || '{}')[rc.campo_relazionato]) || 0;
      } catch (e) { relatedValue = null; }
    }
    const currentValue = parseFloat(beforeData[rc.campo_corrente]) || 0;
    const ops = { '<=': (a, b) => a <= b, '>=': (a, b) => a >= b, '<': (a, b) => a < b, '>': (a, b) => a > b, '==': (a, b) => a === b, '!=': (a, b) => a !== b };
    const cmp = ops[rc.op] || ops['<='];
    if (relatedValue === null || !cmp(currentValue, relatedValue)) {
      return res.status(400).json({ error: transition.validazione.messaggio || `Transizione ${from} → ${to} bloccata: vincolo con il record collegato non soddisfatto` });
    }
  }

  const newData = { ...beforeData, _stato: to };
  db.prepare('UPDATE records SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND module_slug = ?').run(JSON.stringify(newData), req.params.id, req.params.slug);
  const record = db.prepare('SELECT * FROM records WHERE id = ?').get(req.params.id);
  const decryptedData = decryptFields(JSON.parse(record.data), schema.fields);
  const attached = attachComputedFields({ ...record, data: decryptedData }, schema, req.params.slug);

  fireTrigger(req.params.slug, 'cambio_stato', attached.data, attached.id, { stato: to });
  logHistory(req.params.slug, attached.id, req.user.username, 'transition', beforeData, attached.data);
  res.json(attached);
});

router.delete('/:slug/:id', requireAuth, async (req, res) => {
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
  logAudit(req.user.username, 'record.delete', req.params.slug + '#' + req.params.id, null);
  res.json({ ok: true });
});

// ─── ALLEGATI TIPIZZATI ──────────────────────────────────────────────────────
router.get('/:slug/:id/attachments', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT ra.id, ra.tipo, ra.created_at, u.original_name, u.size, u.mime_type, u.id as upload_id
    FROM record_attachments ra JOIN uploads u ON u.id = ra.upload_id
    WHERE ra.module_slug = ? AND ra.record_id = ?
    ORDER BY ra.created_at ASC
  `).all(req.params.slug, req.params.id);
  res.json(rows);
});

router.post('/:slug/:id/attachments', requireAuth, (req, res) => {
  const { upload_id, tipo } = req.body;
  if (!upload_id) return res.status(400).json({ error: 'upload_id obbligatorio' });
  const up = db.prepare('SELECT id FROM uploads WHERE id = ?').get(upload_id);
  if (!up) return res.status(404).json({ error: 'Upload non trovato' });
  const result = db.prepare(
    'INSERT INTO record_attachments (module_slug, record_id, upload_id, tipo) VALUES (?, ?, ?, ?)'
  ).run(req.params.slug, req.params.id, upload_id, tipo || null);
  res.json({ id: result.lastInsertRowid, upload_id, tipo });
});

router.delete('/:slug/:id/attachments/:attId', requireAuth, async (req, res) => {
  // Ogni riga qui ha un upload dedicato, mai condiviso con un altro record
  // (creato apposta al momento dell'allega, verificato su tutti e 3 i punti
  // del frontend che chiamano questa API) — cancellare il collegamento
  // cancella quindi anche il file vero sottostante, altrimenti resta orfano
  // per sempre su disco/Drive (come succedeva prima di questo fix).
  const att = db.prepare('SELECT upload_id FROM record_attachments WHERE id = ? AND module_slug = ? AND record_id = ?')
    .get(req.params.attId, req.params.slug, req.params.id);
  db.prepare('DELETE FROM record_attachments WHERE id = ? AND module_slug = ? AND record_id = ?')
    .run(req.params.attId, req.params.slug, req.params.id);
  if (att) { try { await deleteUploadById(att.upload_id); } catch (e) {} }
  res.json({ ok: true });
});

module.exports = router;
