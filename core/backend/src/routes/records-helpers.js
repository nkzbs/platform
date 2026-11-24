// Funzioni di appoggio comuni alle rotte dei record (schema, campi calcolati, valori di default, univocità, storico).
// Stavano in routes/records.js; separate perché le rotte dei record sono ora divise per argomento e tutte le usano.
const db = require('../db');
const { evaluateFormula } = require('../formula');
const { parseSchemaNormalized } = require('../schema-v3');
const { attachComputedFields: attachComputedFieldsShared } = require('../computed-fields');

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


module.exports = { getModuleSchema, attachComputedFields, attachComputedToFlatRows, applyDefaults, checkUnique, checkCreationValidation, logHistory };
