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

// ─── REPORT: aggregato raggruppato per categoria ───────────────────────────────
// Primo vero consumatore del blocco "Formula/Aggregato" (report_aggregate) del
// Builder — quel blocco esiste e si valida da tempo, ma finora nessuna schermata
// calcolava e mostrava davvero i suoi numeri. Qui il raggruppamento è generico:
// group_by può essere QUALUNQUE campo select/checkbox del modulo (non un nome fisso
// tipo "categoria"), metric QUALUNQUE campo numerico — chi chiama decide la forma,
// il motore non conosce il significato dei dati, solo come aggregarli. Riusa
// aggregateValues, la stessa matematica già usata per i campi computed, non una
// copia — se quella cambia, anche questo endpoint si allinea da solo.
router.get('/:slug/report', requireAuth, requireModuleAccess, (req, res) => {
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
router.get('/:slug/aggregate/:key', requireAuth, requireModuleAccess, (req, res) => {
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
router.get('/:slug/period-view/:key', requireAuth, requireModuleAccess, (req, res) => {
  const schema = getModuleSchema(req.params.slug) || {};
  const rule = ruleFor(schema, req.user.role);
  if (rule && !rule.view) return res.status(403).json({ error: 'Non hai i permessi per vedere questo modulo' });
  // Blocco 'view' unificato (Builder semplificato, fase 1) con mode:'period' e
  // breakdown falso — stessa shape di un period_view legacy, GenericView.jsx lo
  // manda qui. Bug reale trovato dal vivo (18/10): questa route cercava SOLO in
  // period_views, mai in views — un modulo che usa solo il nuovo block_type
  // (nessun period_view legacy) dava sempre 404 "Vista non trovata".
  const config = (schema.period_views || []).find((p) => p.key === req.params.key)
    || (schema.views || []).find((v) => v.mode === 'period' && !v.breakdown && v.key === req.params.key);
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
router.get('/:slug/parent-children/:key', requireAuth, requireModuleAccess, (req, res) => {
  const schema = getModuleSchema(req.params.slug) || {};
  const rule = ruleFor(schema, req.user.role);
  if (rule && !rule.view) return res.status(403).json({ error: 'Non hai i permessi per vedere questo modulo' });
  // Stesso bug/fix del period-view sopra, qui per mode:'children'.
  const config = (schema.parent_children_views || []).find((p) => p.key === req.params.key)
    || (schema.views || []).find((v) => v.mode === 'children' && v.key === req.params.key);
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
router.get('/:slug/yearly-breakdown/:key', requireAuth, requireModuleAccess, (req, res) => {
  const schema = getModuleSchema(req.params.slug) || {};
  const rule = ruleFor(schema, req.user.role);
  if (rule && !rule.view) return res.status(403).json({ error: 'Non hai i permessi per vedere questo modulo' });
  // Stesso bug/fix del period-view sopra — qui per mode:'period' con breakdown
  // vero (yearly_breakdown è lo stesso mode:'period' del period_view, distinto
  // solo dal flag breakdown, vedi GenericView.jsx).
  const config = (schema.yearly_breakdowns || []).find((y) => y.key === req.params.key)
    || (schema.views || []).find((v) => v.mode === 'period' && v.breakdown && v.key === req.params.key);
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
router.get('/:slug/category-pivot/:key', requireAuth, requireModuleAccess, (req, res) => {
  const schema = getModuleSchema(req.params.slug) || {};
  const rule = ruleFor(schema, req.user.role);
  if (rule && !rule.view) return res.status(403).json({ error: 'Non hai i permessi per vedere questo modulo' });
  // Stesso bug/fix del period-view sopra, qui per mode:'pivot'.
  const config = (schema.category_pivots || []).find((c) => c.key === req.params.key)
    || (schema.views || []).find((v) => v.mode === 'pivot' && v.key === req.params.key);
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
router.get('/:slug/weekly-breakdown/:key', requireAuth, requireModuleAccess, (req, res) => {
  const schema = getModuleSchema(req.params.slug) || {};
  const rule = ruleFor(schema, req.user.role);
  if (rule && !rule.view) return res.status(403).json({ error: 'Non hai i permessi per vedere questo modulo' });
  // Stesso bug/fix del period-view sopra, qui per mode:'simple'.
  const config = (schema.weekly_breakdowns || []).find((w) => w.key === req.params.key)
    || (schema.views || []).find((v) => v.mode === 'simple' && v.key === req.params.key);
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

router.get('/:slug/export', requireAuth, requireModuleAccess, (req, res) => {
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
router.post('/:slug/import/preview', requireAuth, requireModuleAccess, (req, res) => {
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

router.post('/:slug/import', requireAuth, requireModuleAccess, (req, res) => {
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
  const withDefaults = applicaEredita(db, schema, applyDefaults(req.body, schema.fields));
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

  const corpo = applicaEredita(db, schema, req.body);
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

// Cambio di stato di una riga, con TUTTI i controlli dell'app (permessi del ruolo, regole del workflow, validazioni, automazioni).
// Usata dalla rotta qui sotto e dal bot Telegram (telegram.js): così una riga si chiude nello stesso modo da qualunque via.
// Ritorna { status, body } invece di scrivere su `res`.
function runTransition(user, slug, id, to) {
  const err = (status, error) => ({ status, body: { error } });
  const schema = getModuleSchema(slug) || {};
  const existing = db.prepare('SELECT * FROM records WHERE id = ? AND module_slug = ?').get(id, slug);
  if (!existing) return err(404, 'Record non trovato');

  const rule = ruleFor(schema, user.role);
  if (rule && (!rule.edit || !ownedOrAllowed(rule, existing, user))) return err(403, 'Non hai i permessi per modificare questo record');

  if (!to) return err(400, 'Campo "to" obbligatorio');

  const workflow = schema.workflow;
  if (!workflow) return err(400, 'Questo modulo non ha un workflow');

  const beforeData = JSON.parse(existing.data);
  const from = beforeData._stato;

  const transition = (workflow.transitions || []).find((t) => t.from === from && t.to === to);
  if (!transition) return err(422, `Transizione non ammessa: ${from} → ${to}`);

  // L'amministratore passa sempre (come nei permessi dei moduli, permissions.js): un passaggio riservato a un ruolo non deve bloccare chi gestisce il tenant.
  if (Array.isArray(transition.roles) && transition.roles.length > 0 && user.role !== 'admin' && !transition.roles.includes(user.role)) return err(403, 'Il tuo ruolo non può eseguire questa transizione');

  // Requisiti dello stato di arrivo (blocco `state_requirements`): se il blocco è «bloccante» e manca qualcosa, il passaggio non avviene e si dice cosa manca.
  // Se non è bloccante sono solo un promemoria nella scheda (shared/requisiti-stato.js, lo stesso calcolo).
  const requisiti = require('../requisiti-stato');
  const bloccoRequisiti = requisiti.bloccoPerStato(schema.state_requirements, to);
  if (bloccoRequisiti && bloccoRequisiti.bloccante) {
    const allegati = db.prepare('SELECT tipo FROM record_attachments WHERE module_slug = ? AND record_id = ?').all(slug, existing.id);
    const manca = requisiti.valutaRequisiti(bloccoRequisiti, beforeData, allegati).filter((v) => !v.ok).map((v) => v.label);
    if (manca.length) {
      const stato = (workflow.states || []).find((x) => x.key === to);
      return { status: 400, body: { error: 'Per passare a «' + ((stato && stato.label) || to) + '» manca: ' + manca.join(', ') + '.', mancano: manca } };
    }
  }

  // Validazione bloccante opzionale sulla transizione (es. "dare == avere" prima di
  // confermare un movimento contabile) — riusa la stessa sandbox di espressioni dei
  // campi computed, ma qui il risultato blocca il salvataggio invece di limitarsi a
  // annotare un valore: è l'unico punto della piattaforma dove un'automazione può
  // impedire un cambiamento di stato invece di reagirci dopo il commit.
  if (transition.validazione && transition.validazione.expr) {
    const context = { currentModule: slug, currentRecordId: existing.id, currentRecordData: beforeData };
    const result = evaluateFormula(transition.validazione.expr, db, context);
    if (!result.valid) return err(400, 'Validazione transizione non valutabile: ' + (result.errors || []).join('; '));
    if (!result.value) return err(400, transition.validazione.messaggio || `Transizione ${from} → ${to} bloccata: condizione non soddisfatta`);
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
      return err(400, transition.validazione.messaggio || `Transizione ${from} → ${to} bloccata: vincolo con il record collegato non soddisfatto`);
    }
  }

  const newData = { ...beforeData, _stato: to };
  db.prepare('UPDATE records SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND module_slug = ?').run(JSON.stringify(newData), id, slug);
  const record = db.prepare('SELECT * FROM records WHERE id = ?').get(id);
  const decryptedData = decryptFields(JSON.parse(record.data), schema.fields);
  const attached = attachComputedFields({ ...record, data: decryptedData }, schema, slug);

  fireTrigger(slug, 'cambio_stato', attached.data, attached.id, { stato: to });
  logHistory(slug, attached.id, user.username, 'transition', beforeData, attached.data);
  return { status: 200, body: attached };
}

router.post('/:slug/:id/transition', requireAuth, requireModuleAccess, (req, res) => {
  const out = runTransition(req.user, req.params.slug, req.params.id, (req.body || {}).to);
  res.status(out.status).json(out.body);
});

// ─── Azioni esterne (blocco di schema `external_action`) ──────────────────────────────────────────────────────────────
// Un pulsante sul record che chiama un servizio esterno tramite un adattatore (lib/azioni-esterne/) e scrive l'esito sul record. Il blocco dice quale adattatore
// e come i campi del modulo si collegano a lui: qui non ci sono nomi di moduli. Solo amministratori (usano il credito del servizio), con l'accesso al modulo.
function contestoAzione(req) {
  const schema = getModuleSchema(req.params.slug);
  if (!schema) return { errore: [404, 'Modulo non trovato'] };
  const config = (schema.external_actions || []).find((x) => x.key === req.params.key);
  if (!config) return { errore: [404, 'Azione non trovata in questo modulo'] };
  const adattatore = require('../lib/azioni-esterne').adattatore(config.adapter);
  if (!adattatore) return { errore: [400, 'Questa azione usa un adattatore che il core non conosce: «' + String(config.adapter).slice(0, 60) + '»'] };
  const record = db.prepare('SELECT * FROM records WHERE id = ? AND module_slug = ?').get(req.params.id, req.params.slug);
  if (!record) return { errore: [404, 'Record non trovato'] };
  let dati; try { dati = JSON.parse(record.data); } catch (e) { return { errore: [500, 'Record illeggibile'] }; }
  return { config, adattatore, record, dati };
}

router.post('/:slug/:id/azione/:key', requireAuth, requireAdmin, requireModuleAccess, async (req, res) => {
  const ctx = contestoAzione(req);
  if (ctx.errore) return res.status(ctx.errore[0]).json({ error: ctx.errore[1] });
  // Se l'azione consuma un servizio a pagamento (l'adattatore dichiara `servizio`): prima si conferma il costo (409 con importo, spesa del mese e tetto), poi si controlla il tetto
  // mensile, e a esecuzione riuscita la spesa si registra. La conferma è richiesta DAL SERVER: un client non può saltarla.
  // Un adattatore può dichiarare `disponibile`: se il servizio non è (ancora) abilitato la funzione resta «da attivare» PRIMA di chiedere conferma e senza costo; appena il servizio è attivo parte da sola.
  if (typeof ctx.adattatore.disponibile === 'function') {
    let d; try { d = await ctx.adattatore.disponibile({ config: ctx.config, dati: ctx.dati }); } catch (e) { d = { ok: false, motivo: e.message }; }
    if (!d.ok) return res.status(501).json({ error: '«' + (ctx.config.label || 'Questa funzione') + '» è da attivare: ' + (d.motivo || 'il servizio non è disponibile') + (ctx.config.come_attivare ? ' ' + ctx.config.come_attivare : ''), code: 'da_attivare' });
  }
  // `servizioPer` sceglie la voce di listino in base al blocco; `senzaCosto` dice che questa pressione non spende (per esempio il ricontrollo di una richiesta già pagata).
  const nomeServizio = typeof ctx.adattatore.servizioPer === 'function' ? ctx.adattatore.servizioPer({ config: ctx.config, dati: ctx.dati }) : ctx.adattatore.servizio;
  const gratis = typeof ctx.adattatore.senzaCosto === 'function' && ctx.adattatore.senzaCosto({ config: ctx.config, dati: ctx.dati });
  const spese = nomeServizio && !gratis ? require('../lib/openapi-spese') : null;
  const st = spese ? spese.stima(nomeServizio) : null;
  if (spese) {
    const mese = spese.riepilogo(), amb = spese.ambiente();
    if (!(req.body && req.body.conferma === true)) return res.status(409).json({ error: 'Conferma il costo prima di eseguire.', code: 'conferma_costo', gia_eseguita: !!(ctx.config.risultato_in && ctx.dati[ctx.config.risultato_in]), riepilogo: typeof ctx.adattatore.riepilogo === 'function' ? ctx.adattatore.riepilogo({ dati: ctx.dati, config: ctx.config, slug: req.params.slug, id: ctx.record.id }) : null, servizio: st.servizio, nome: st.nome, costo: st.costo, noto: st.noto, ambiente: amb, speso_mese: mese.produzione.speso, tetto: mese.tetto });
    if (amb === 'produzione' && mese.tetto !== null && st.costo !== null && mese.produzione.speso + st.costo > mese.tetto) return res.status(402).json({ error: 'Questa richiesta supera il tetto di spesa mensile (' + mese.tetto.toFixed(2) + ' €, già spesi ' + mese.produzione.speso.toFixed(2) + ' €). Si cambia in Impostazioni → Connessioni → OpenAPI.it.', code: 'tetto_superato', tetto: mese.tetto, speso_mese: mese.produzione.speso });
  }
  let out;
  try { out = await ctx.adattatore.esegui({ dati: ctx.dati, config: ctx.config, utente: req.user, id: ctx.record.id, slug: req.params.slug }); }
  catch (e) { return res.status(e.status || 500).json({ error: e.message, code: e.code }); }
  if (spese) spese.registra({ servizio: st.servizio, descrizione: ctx.config.label + ' · ' + req.params.slug + '#' + ctx.record.id, costo: st.costo || 0, utente: req.user.username, riferimento: req.params.slug + '#' + ctx.record.id });
  const next = { ...ctx.dati, ...out.patch };
  db.prepare('UPDATE records SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(JSON.stringify(next), ctx.record.id);
  const updated = db.prepare('SELECT * FROM records WHERE id = ?').get(ctx.record.id);
  logAudit(req.user.username, 'record.azione_esterna', req.params.slug + '#' + ctx.record.id, { azione: ctx.config.key, ...(out.audit || {}) });
  res.json({ ok: true, record: { ...updated, data: JSON.parse(updated.data) }, ...(out.risposta || {}) });
});

// PDF dell'esito di un'azione esterna (se l'adattatore lo prevede): parte da ciò che è già salvato sul record, senza richiamare il servizio.
router.post('/:slug/:id/azione/:key/pdf', requireAuth, requireAdmin, requireModuleAccess, async (req, res) => {
  const ctx = contestoAzione(req);
  if (ctx.errore) return res.status(ctx.errore[0]).json({ error: ctx.errore[1] });
  if (typeof ctx.adattatore.pdf !== 'function') return res.status(400).json({ error: 'Questa azione non produce un PDF' });
  try {
    const identita = await require('../lib/identita-pdf').caricaIdentita(db);
    const pdf = await ctx.adattatore.pdf({ id: ctx.record.id, dati: ctx.dati, config: ctx.config, identita });
    logAudit(req.user.username, 'record.scarica_azione_esterna', req.params.slug + '#' + ctx.record.id, { azione: ctx.config.key });
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="' + req.params.key + '-' + ctx.record.id + '.pdf"', 'Cache-Control': 'no-store' });
    res.send(pdf);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Creazione del PDF non riuscita' });
  }
});

// ─── Abbinamento (blocco di schema `match_view`) ──────────────────────────────────────────────
// «Immobili adatti» su un Cliente, «Richieste compatibili» su un Immobile: record di un altro
// modulo che corrispondono a questo secondo regole dichiarate dal Builder (lib/abbinamento.js).
// Solo lettura: non scrive nulla. Rispetta i permessi di vista del modulo bersaglio (compreso
// «solo propri»); un modulo che l'utente non può vedere dà un elenco vuoto, non un errore.
router.get('/:slug/:id/abbinamenti/:key', requireAuth, requireModuleAccess, (req, res) => {
  const { slug, id, key } = req.params;
  const schema = getModuleSchema(slug) || {};
  const def = (schema.match_views || []).find((m) => m.key === key);
  if (!def) return res.status(404).json({ error: 'Abbinamento non trovato in questo modulo' });
  const record = db.prepare('SELECT * FROM records WHERE id = ? AND module_slug = ?').get(id, slug);
  if (!record) return res.status(404).json({ error: 'Record non trovato' });
  const rule = ruleFor(schema, req.user.role);
  if (rule && (!rule.view || !ownedOrAllowed(rule, record, req.user))) return res.status(403).json({ error: 'Non hai i permessi per vedere questo record' });

  const vuoto = { applicabile: true, valutabili: 0, items: [], titolo: def.label };
  const targetSchema = getModuleSchema(def.target_module);
  if (!targetSchema) return res.json(vuoto);
  const targetRule = ruleFor(targetSchema, req.user.role);
  if (req.user.role !== 'admin') {
    const haRighe = db.prepare('SELECT 1 FROM user_modules WHERE user_id = ?').get(req.user.id);
    if (haRighe && !db.prepare('SELECT 1 FROM user_modules WHERE user_id = ? AND module_slug = ?').get(req.user.id, def.target_module)) return res.json(vuoto);
  }
  const candidati = filterViewable(
    db.prepare('SELECT id, user_id, data, updated_at FROM records WHERE module_slug = ? ORDER BY updated_at DESC LIMIT 2000').all(def.target_module)
      .map((r) => ({ ...r, data: JSON.parse(r.data) })),
    targetRule, req.user
  );
  const mioDato = decryptFields(JSON.parse(record.data), schema.fields);
  const esito = require('../lib/abbinamento').calcolaAbbinamenti(def, mioDato, candidati);
  const mostra = [def.display_field, ...(def.subtitle_fields || [])].filter(Boolean);
  res.json({
    applicabile: esito.applicabile, valutabili: esito.valutabili, titolo: def.label, target_module: def.target_module,
    items: esito.items.slice(0, 20).map((it) => ({
      id: it.id, punteggio: it.punteggio, soddisfatte: it.soddisfatte, mancanti: it.mancanti,
      titolo: def.display_field && it.data[def.display_field] != null && it.data[def.display_field] !== '' ? String(it.data[def.display_field]) : '#' + it.id,
      dettagli: mostra.filter((c) => c !== def.display_field).map((c) => ({ campo: c, valore: it.data[c] })).filter((d) => d.valore != null && d.valore !== ''),
    })),
    totale: esito.items.length,
  });
});

// ─── Documento da modello (blocco di schema `document_action`) ────────────────────────────────
// Un modulo dichiara dal Builder uno o più documenti (oggetto + testo con segnaposto + dove
// spedirli); qui non c'è nessun nome di modulo né di campo. Due rotte separate, apposta:
// `anteprima` NON spedisce nulla (solo testo di bozza da rivedere e modificare), `invia` manda
// esattamente il testo che l'admin ha approvato — mai il testo generato senza un giro per gli
// occhi di chi lo manda. Il DESTINATARIO lo ricava sempre il server dal modello e dal record:
// non arriva dalla richiesta, così nessuno può far spedire un documento a un indirizzo scelto da fuori.
// Sostituisce le rotte che stavano legate agli slug di un solo verticale (vedi docs/DECISIONI.md).
function contestoDocumentoDa(slug, id, key, user) {
  const schema = getModuleSchema(slug) || {};
  const azione = (schema.document_actions || []).find((a) => a.key === key);
  if (!azione) return { errore: [404, 'Documento non trovato in questo modulo'] };
  const record = db.prepare('SELECT * FROM records WHERE id = ? AND module_slug = ?').get(id, slug);
  if (!record) return { errore: [404, 'Record non trovato'] };
  const rule = user ? ruleFor(schema, user.role) : null;
  if (user && rule && (!rule.view || !ownedOrAllowed(rule, record, user))) return { errore: [403, 'Non hai i permessi per vedere questo record'] };
  const dati = attachComputedFields({ ...record, data: decryptFields(JSON.parse(record.data), schema.fields) }, schema, slug).data;
  const tenant = db.prepare('SELECT ragione_sociale, indirizzo, piva FROM tenant_settings WHERE id = 1').get();
  const leggiRecord = (modulo, rid) => {
    const r = db.prepare('SELECT data FROM records WHERE module_slug = ? AND id = ?').get(modulo, rid);
    return r ? JSON.parse(r.data) : null;
  };
  const get = require('../lib/modello-documento').costruisciGet({ record: dati, schema, tenant, leggiRecord });
  return { schema, azione, record, get };
}
const contestoDocumento = (req) => contestoDocumentoDa(req.params.slug, req.params.id, req.params.key, req.user);

router.post('/:slug/:id/documento/:key/anteprima', requireAuth, requireAdmin, requireModuleAccess, (req, res) => {
  const ctx = contestoDocumento(req);
  if (ctx.errore) return res.status(ctx.errore[0]).json({ error: ctx.errore[1] });
  const { renderModello, risolviDestinatario } = require('../lib/modello-documento');
  res.json({
    oggetto: renderModello(ctx.azione.subject, ctx.get),
    corpo: renderModello(ctx.azione.body, ctx.get),
    destinatario: risolviDestinatario(ctx.azione.recipient, ctx.get),
  });
});

router.post('/:slug/:id/documento/:key/invia', requireAuth, requireAdmin, requireModuleAccess, async (req, res) => {
  const ctx = contestoDocumento(req);
  if (ctx.errore) return res.status(ctx.errore[0]).json({ error: ctx.errore[1] });
  const { oggetto, corpo } = req.body || {};
  if (typeof corpo !== 'string' || !corpo.trim()) return res.status(400).json({ error: 'Testo del documento mancante' });
  const { risolviDestinatario } = require('../lib/modello-documento');
  const destinatario = risolviDestinatario(ctx.azione.recipient, ctx.get);
  if (!destinatario) return res.status(400).json({ error: 'Nessun indirizzo email a cui spedire: il campo del destinatario è vuoto' });

  const email = require('../lib/email');
  const invio = await email.invia({ to: destinatario, subject: (typeof oggetto === 'string' && oggetto.trim()) || ctx.azione.label || 'Documento', html: email.htmlDaTesto(corpo) });
  if (!invio.ok) return res.status(502).json({ error: 'Invio non riuscito: ' + invio.motivo });

  logAudit(req.user.username, 'record.invia_documento', req.params.slug + '#' + ctx.record.id, { documento: ctx.azione.key, email: destinatario });
  // Cambio di stato opzionale dopo l'invio, solo se il workflow lo ammette da dove il record si
  // trova: se non è ammesso (es. già "documenti inviati" per un secondo invio) l'email parte
  // comunque e lo stato non si tocca.
  let statoAggiornato = false;
  if (ctx.azione.on_send_state) statoAggiornato = runTransition(req.user, req.params.slug, req.params.id, ctx.azione.on_send_state).status === 200;
  res.json({ ok: true, stato_aggiornato: statoAggiornato });
});

// Documento da scaricare: lo stesso testo approvato in anteprima diventa un PDF da stampare e firmare.
// Vale per qualunque documento del modulo (anche quelli che si spediscono per email).
router.post('/:slug/:id/documento/:key/pdf', requireAuth, requireAdmin, requireModuleAccess, async (req, res) => {
  const ctx = contestoDocumento(req);
  if (ctx.errore) return res.status(ctx.errore[0]).json({ error: ctx.errore[1] });
  const { corpo } = req.body || {};
  if (typeof corpo !== 'string' || !corpo.trim()) return res.status(400).json({ error: 'Testo del documento mancante' });
  try {
    const identita = await require('../lib/identita-pdf').caricaIdentita(db);
    const pdf = await require('../lib/documento-pdf').creaPdf({ titolo: ctx.azione.label || 'Documento', corpo, ...identita, riquadroFirma: ctx.azione.delivery === 'firma', piePagina: ctx.azione.label || '' });
    logAudit(req.user.username, 'record.scarica_documento', req.params.slug + '#' + ctx.record.id, { documento: ctx.azione.key });
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="' + ctx.azione.key + '-' + ctx.record.id + '.pdf"', 'Cache-Control': 'no-store' });
    res.send(pdf);
  } catch (e) {
    res.status(500).json({ error: 'Creazione del PDF non riuscita' });
  }
});

// Registra un documento firmato sul record: allega il file con il tipo giusto, scrive i consensi dati, la data della firma, la versione e la scadenza di conservazione,
// e passa allo stato previsto (`on_signed_state`). Lo usano la rotta «firmato» (caricato dall'agente) e la richiesta di firma (caricato dal cliente dal suo link).
// `ctx` è quello di contestoDocumentoDa; `user` ({ username, role }) è chi risulta nella cronologia e per i permessi del cambio di stato.
function registraFirmato({ user, slug, id, ctx, uploadId, consensi, senzaStato = false }) {
  const schema = ctx.schema;
  const { calcolaAggiornamento, TIPO_FIRMATO } = require('../lib/documento-firmato');
  const oggi = new Date().toISOString().slice(0, 10);
  const patch = calcolaAggiornamento(ctx.azione, consensi, oggi);
  const tipo = TIPO_FIRMATO(ctx.azione);

  db.prepare('INSERT INTO record_attachments (module_slug, record_id, upload_id, tipo) VALUES (?, ?, ?, ?)').run(slug, ctx.record.id, uploadId, tipo);
  const beforeData = JSON.parse(ctx.record.data);
  if (Object.keys(patch).length) {
    db.prepare('UPDATE records SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND module_slug = ?').run(JSON.stringify({ ...beforeData, ...patch }), ctx.record.id, slug);
    const dopo = db.prepare('SELECT * FROM records WHERE id = ?').get(ctx.record.id);
    const attached = attachComputedFields({ ...dopo, data: decryptFields(JSON.parse(dopo.data), schema.fields) }, schema, slug);
    logHistory(slug, ctx.record.id, user.username, 'update', beforeData, attached.data);
    Object.keys(patch).forEach((k) => { if (JSON.stringify(beforeData[k]) !== JSON.stringify(patch[k])) fireTrigger(slug, 'modifica_campo', attached.data, attached.id, { campo: k }); });
  }
  logAudit(user.username, 'record.documento_firmato', slug + '#' + ctx.record.id, { documento: ctx.azione.key, consensi: patch });
  let statoAggiornato = false;
  if (ctx.azione.on_signed_state && !senzaStato) statoAggiornato = runTransition(user, slug, id, ctx.azione.on_signed_state).status === 200;
  return { tipo, patch, statoAggiornato };
}

// Documento firmato: il file caricato (scansione o foto del foglio firmato) si allega al record e,
// se il documento lo prevede, si registrano i consensi dati, la data della firma, la versione del
// testo e fino a quando si conservano i dati. Richiamare la rotta con un nuovo firmato (anche per
// revocare un consenso) aggiunge una nuova copia e aggiorna i campi: lo storico resta nella cronologia.
router.post('/:slug/:id/documento/:key/firmato', requireAuth, requireAdmin, requireModuleAccess, (req, res) => {
  const ctx = contestoDocumento(req);
  if (ctx.errore) return res.status(ctx.errore[0]).json({ error: ctx.errore[1] });
  if (ctx.azione.delivery !== 'firma') return res.status(400).json({ error: 'Questo documento non prevede la firma' });
  const schema = ctx.schema;
  const rule = ruleFor(schema, req.user.role);
  if (rule && (!rule.edit || !ownedOrAllowed(rule, ctx.record, req.user))) return res.status(403).json({ error: 'Non hai i permessi per modificare questo record' });

  const { upload_id, consensi } = req.body || {};
  const up = upload_id ? db.prepare('SELECT id, uploaded_by, mime_type FROM uploads WHERE id = ?').get(upload_id) : null;
  if (!up) return res.status(400).json({ error: 'Carica prima il documento firmato' });
  if (up.uploaded_by !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Puoi allegare solo file che hai caricato tu' });
  if (!(up.mime_type === 'application/pdf' || /^image\/(jpeg|png|webp)$/.test(up.mime_type))) return res.status(400).json({ error: 'Il documento firmato deve essere un PDF o una foto (JPEG, PNG, WebP)' });

  const esito = registraFirmato({ user: req.user, slug: req.params.slug, id: req.params.id, ctx, uploadId: up.id, consensi });
  const { tipo, patch, statoAggiornato } = esito;
  res.json({ ok: true, tipo, campi_aggiornati: Object.keys(patch), stato_aggiornato: statoAggiornato });
});

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

// ─── ALLEGATI TIPIZZATI ──────────────────────────────────────────────────────
// Falla reale trovata il 2026-10-14 (segnalata dall'utente, mai verificata
// prima): queste tre rotte avevano solo requireAuth, NESSUN controllo sul
// record a cui l'allegato appartiene — un utente con ruolo "solo propri"
// (view_own_only) poteva leggere/aggiungere/staccare allegati di un record
// altrui semplicemente conoscendone slug+id, bypassando del tutto la regola
// che per i record stessi (GET /:slug/:id) è già rispettata. Stesso identico
// controllo di quella rotta, replicato qui.
function loadRecordOr404(slug, id, res) {
  const record = db.prepare('SELECT * FROM records WHERE id = ? AND module_slug = ?').get(id, slug);
  if (!record) { res.status(404).json({ error: 'Record non trovato' }); return null; }
  return record;
}

router.get('/:slug/:id/attachments', requireAuth, requireModuleAccess, (req, res) => {
  const record = loadRecordOr404(req.params.slug, req.params.id, res);
  if (!record) return;
  const schema = getModuleSchema(req.params.slug) || {};
  const rule = ruleFor(schema, req.user.role);
  if (rule && (!rule.view || !ownedOrAllowed(rule, record, req.user))) {
    return res.status(403).json({ error: 'Non hai i permessi per vedere questo record' });
  }
  const rows = db.prepare(`
    SELECT ra.id, ra.tipo, ra.created_at, u.original_name, u.size, u.mime_type, u.id as upload_id
    FROM record_attachments ra JOIN uploads u ON u.id = ra.upload_id
    WHERE ra.module_slug = ? AND ra.record_id = ?
    ORDER BY ra.created_at ASC
  `).all(req.params.slug, req.params.id);
  res.json(rows);
});

router.post('/:slug/:id/attachments', requireAuth, requireModuleAccess, (req, res) => {
  const record = loadRecordOr404(req.params.slug, req.params.id, res);
  if (!record) return;
  const schema = getModuleSchema(req.params.slug) || {};
  const rule = ruleFor(schema, req.user.role);
  if (rule && (!rule.edit || !ownedOrAllowed(rule, record, req.user))) {
    return res.status(403).json({ error: 'Non hai i permessi per modificare questo record' });
  }
  const { upload_id, tipo } = req.body;
  if (!upload_id) return res.status(400).json({ error: 'upload_id obbligatorio' });
  const up = db.prepare('SELECT id, uploaded_by FROM uploads WHERE id = ?').get(upload_id);
  if (!up) return res.status(404).json({ error: 'Upload non trovato' });
  // Senza questo controllo, avere il permesso di modifica sul PROPRIO record
  // bastava a "rubare" un file caricato da qualcun altro: lo si collegava al
  // proprio record (questa rotta) e poi lo si leggeva da lì, aggirando
  // qualunque permesso sul record originale dell'upload. L'unico flusso reale
  // (RecordDetailModal.jsx, ModulePage/index.jsx) carica e allega nella
  // stessa azione, sempre con lo stesso utente — un admin resta libero per
  // import/correzioni.
  if (up.uploaded_by !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Puoi allegare solo file che hai caricato tu' });
  }
  const result = db.prepare(
    'INSERT INTO record_attachments (module_slug, record_id, upload_id, tipo) VALUES (?, ?, ?, ?)'
  ).run(req.params.slug, req.params.id, upload_id, tipo || null);
  res.json({ id: result.lastInsertRowid, upload_id, tipo });
});

router.delete('/:slug/:id/attachments/:attId', requireAuth, requireModuleAccess, async (req, res) => {
  const record = loadRecordOr404(req.params.slug, req.params.id, res);
  if (!record) return;
  const schema = getModuleSchema(req.params.slug) || {};
  const rule = ruleFor(schema, req.user.role);
  if (rule && (!rule.edit || !ownedOrAllowed(rule, record, req.user))) {
    return res.status(403).json({ error: 'Non hai i permessi per modificare questo record' });
  }
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
module.exports.runTransition = runTransition;
module.exports.contestoDocumentoDa = contestoDocumentoDa;
module.exports.getModuleSchema = getModuleSchema;
module.exports.registraFirmato = registraFirmato;
