// Esportazione e importazione dei record in CSV. Montato da routes/records.js nello stesso punto in cui stava.
const express = require('express');
const db = require('../db');
const { requireAuth, requireModuleAccess } = require('./auth');
const { encryptFields, decryptFields } = require('../crypto-fields');
const { ruleFor, filterViewable } = require('../permissions');
const { getModuleSchema, applyDefaults, checkUnique } = require('./records-helpers');

const router = express.Router();

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

module.exports = router;
