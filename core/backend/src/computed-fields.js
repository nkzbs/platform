// Calcola i campi di tipo 'computed'/'soglia'/'soglia_data' per un record, sempre a
// runtime — non sono mai salvati nel record stesso (coerente col principio "i moduli
// sono solo schema, mai codice/logica dedicata"). Estratto da routes/records.js in un
// modulo a sé per essere riusabile anche da automation-engine.js (che deve poter
// calcolare i campi computed di un record appena creato da un'automazione, prima di
// scatenare a sua volta il trigger 'nuovo_record' su quel record) — richiederlo da
// routes/records.js avrebbe creato una dipendenza circolare (records.js già richiede
// automation-engine.js per fireTrigger).
const { evaluateFormula, evaluateSteps } = require('./formula');
const { calcolaScaglioni, calcolaSogliaData, validateSogliaData } = require('./formula-soglia');

function attachComputedFields(db, record, schema, moduleSlug) {
  const computedFields = (schema.fields || []).filter((f) => f.type === 'computed' && ((f.steps && f.steps.length) || f.expr));
  if (computedFields.length > 0) {
    const context = { currentModule: moduleSlug, currentRecordId: record.id, currentRecordData: record.data };
    computedFields.forEach((f) => {
      const result = (f.steps && f.steps.length) ? evaluateSteps(f.steps, db, context) : evaluateFormula(f.expr, db, context);
      record.data[f.key] = result.valid ? result.value : null;
    });
  }
  // Campi di tipo 'soglia': calcolo a scaglioni progressivi su un campo numerico
  const sogliaFields = (schema.fields || []).filter((f) => f.type === 'soglia' && f.source_field && Array.isArray(f.scaglioni) && f.scaglioni.length > 0);
  sogliaFields.forEach((f) => {
    const raw = record.data[f.source_field];
    const val = parseFloat(raw);
    if (!Number.isNaN(val)) {
      try { record.data[f.key] = calcolaScaglioni(val, f.scaglioni).value; } catch (e) { record.data[f.key] = null; }
    }
  });
  // Campi di tipo 'soglia_data': calcolo periodo di competenza da una data (es. regola del 27)
  const sogliaDataFields = (schema.fields || []).filter((f) => f.type === 'soglia_data' && f.source_date_field && f.tipo);
  sogliaDataFields.forEach((f) => {
    const rawDate = record.data[f.source_date_field];
    if (rawDate) {
      try {
        const check = validateSogliaData(f);
        if (!check.valid) { record.data[f.key] = null; return; }
        const result = calcolaSogliaData(rawDate, f);
        record.data[f.key] = result.periodo;
        record.data[f.key + '_anno'] = result.anno;
        record.data[f.key + '_mese'] = result.mese;
      } catch (e) { record.data[f.key] = null; }
    }
  });
  return record;
}

module.exports = { attachComputedFields };
