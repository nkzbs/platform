// Rotte dei record che leggono e aggregano: report, aggregati, vista per periodo, genitore-figli, ripartizioni annuali/per categoria/settimanali. Solo lettura. Montato da routes/records.js nello stesso punto in cui stavano.
const express = require('express');
const db = require('../db');
const valoriSuggeriti = require('../valori-suggeriti');
const { requireAuth, requireModuleAccess } = require('./auth');
const { evaluateFormula, getModuleRows, aggregateValues, loadModuleMap, compareValues } = require('../formula');
const { ruleFor, isOwnRecord } = require('../permissions');
const { computePeriodView, shiftPeriod, dateToIsoYearWeek } = require('../period-view');
const { computeParentChildren } = require('../parent-children-view');
const { computeYearlyBreakdown } = require('../yearly-breakdown');
const { computeCategoryPivot } = require('../category-pivot');
const { computeWeeklyBreakdown } = require('../weekly-breakdown');
const { getModuleSchema, attachComputedToFlatRows } = require('./records-helpers');

const router = express.Router();

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
// I valori già usati di un campo di testo con «suggerisci» (per il menu a tendina mentre si scrive): solo se il campo è dichiarato così nello schema.
router.get('/:slug/valori/:key', requireAuth, requireModuleAccess, (req, res) => {
  const schema = getModuleSchema(req.params.slug) || {};
  const f = (schema.fields || []).find((x) => x.key === req.params.key);
  if (!f || !f.suggerisci || f.type !== 'text') return res.json([]);
  const rule = ruleFor(schema, req.user.role);
  if (rule && !rule.view) return res.status(403).json({ error: 'Non hai i permessi per vedere questo modulo' });
  res.json(valoriSuggeriti.valoriUsati(req.params.slug, req.params.key, f).map((x) => x.valore));
});

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

module.exports = router;
