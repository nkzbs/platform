'use strict';
// Valori di un campo "scelta" modificabili da chi usa il modulo: serve alla vista ad archivio, dove ogni valore è una cartella.
//   POST /api/field-options/:slug/:fieldKey   { action: 'rename', from, to } | { action: 'add', value } | { action: 'remove', value }
// Rinominare cambia il nome nello schema pubblicato (con una riga di cronologia, come una pubblicazione dal Builder) e in tutte le righe che lo usano,
// in un'unica transazione. Si rifiuta se il nome è già preso, o se il vecchio nome compare in altre regole del modulo (condizioni, automazioni):
// cambiarlo lì in silenzio le romperebbe. Togliere è possibile solo se nessuna riga lo usa. Chi può farlo: chi ha il permesso di modifica sul modulo.
const express = require('express');
const db = require('../db');
const { requireAuth, requireModuleAccess } = require('./auth');
const { parseSchemaNormalized } = require('../schema-v3');
const { ruleFor } = require('../permissions');
const { logAudit } = require('../audit-log');

const router = express.Router();
const KEY = /^[A-Za-z0-9_]+$/;
const optValue = (o) => (typeof o === 'string' ? o : o && o.value);
const fail = (res, status, error) => res.status(status).json({ error });
const clean = (v) => String(v == null ? '' : v).trim().replace(/\s+/g, ' ');

// Il valore compare in una regola (condizione, automazione, filtro…)? Si ignorano i testi che sono solo etichette: un titolo «Report» non è la cartella «Report».
const SOLO_TESTO = new Set(['label', 'name', 'title', 'description', 'placeholder', 'hint', 'id', 'key', 'block_key', 'icon', 'color', 'unit', 'format']);
function citaValore(node, valore) {
  if (Array.isArray(node)) return node.some((x) => citaValore(x, valore));
  if (node && typeof node === 'object') return Object.entries(node).some(([k, v]) => !SOLO_TESTO.has(k) && citaValore(v, valore));
  return node === valore;
}

// Applica la modifica a uno schema v3 (stringa JSON); ritorna { json, options } oppure { error }
function applyToSchema(raw, fieldKey, change) {
  let s;
  try { s = JSON.parse(raw); } catch (e) { return { error: 'Schema non leggibile' }; }
  const steps = Array.isArray(s.steps) ? s.steps : null;
  if (!steps) return { error: 'Questo modulo non ha lo schema nel formato atteso' };
  const f = steps.find((b) => b.block_type === 'field' && b.key === fieldKey && b.type === 'select');
  if (!f || !Array.isArray(f.options)) return { error: 'Campo a scelta non trovato' };
  change(f, steps);
  return { json: JSON.stringify(s), options: f.options.map(optValue) };
}

router.post('/:slug/:fieldKey', requireAuth, requireModuleAccess, (req, res) => {
  const { slug, fieldKey } = req.params;
  if (!KEY.test(fieldKey)) return fail(res, 400, 'Campo non valido');
  const mod = db.prepare('SELECT * FROM modules WHERE slug = ? AND installed = 1').get(slug);
  if (!mod) return fail(res, 404, 'Modulo non trovato');
  const schema = parseSchemaNormalized(mod.schema_json);
  const rule = ruleFor(schema, req.user.role);
  if (rule && !rule.edit) return fail(res, 403, 'Non hai i permessi per modificare questo modulo');

  const b = req.body || {};
  const action = b.action;
  const used = (value) => db.prepare("SELECT COUNT(*) n FROM records WHERE module_slug = ? AND json_extract(data, '$.' || ?) = ?").get(slug, fieldKey, value).n;

  // opzioni attuali dallo schema pubblicato
  const cur = applyToSchema(mod.schema_json, fieldKey, () => {});
  if (cur.error) return fail(res, 422, cur.error);

  let change, audit;
  if (action === 'add') {
    const v = clean(b.value);
    if (!v) return fail(res, 400, 'Scrivi il nome della cartella.');
    if (v.length > 60) return fail(res, 400, 'Il nome è troppo lungo (massimo 60 caratteri).');
    if (cur.options.some((o) => String(o).toLowerCase() === v.toLowerCase())) return fail(res, 409, 'Esiste già una cartella con questo nome.');
    change = (f) => { f.options.push(typeof f.options[0] === 'object' && f.options[0] ? { value: v, label: v } : v); };
    audit = { action: 'add', value: v };
  } else if (action === 'rename') {
    const from = String(b.from == null ? '' : b.from), to = clean(b.to);
    if (!cur.options.includes(from)) return fail(res, 404, 'Cartella non trovata.');
    if (!to) return fail(res, 400, 'Scrivi il nuovo nome.');
    if (to.length > 60) return fail(res, 400, 'Il nome è troppo lungo (massimo 60 caratteri).');
    if (to !== from && cur.options.some((o) => String(o).toLowerCase() === to.toLowerCase())) return fail(res, 409, 'Esiste già una cartella con questo nome.');
    if (to === from) return res.json({ ok: true, options: cur.options, righe: 0 });
    // il vecchio nome in altre parti dello schema (condizioni, automazioni…): non si cambia in silenzio
    const probe = applyToSchema(mod.schema_json, fieldKey, (f) => { f.options = []; });
    if (citaValore(JSON.parse(probe.json), from)) return fail(res, 409, 'Il nome «' + from + '» è usato anche in altre regole di questo modulo (condizioni o automazioni): rinominarlo da qui le romperebbe. Cambialo dal Builder.');
    change = (f) => { f.options = f.options.map((o) => (optValue(o) === from ? (typeof o === 'string' ? to : { ...o, value: to, label: to }) : o)); };
    audit = { action: 'rename', from, to };
  } else if (action === 'remove') {
    const v = String(b.value == null ? '' : b.value);
    if (!cur.options.includes(v)) return fail(res, 404, 'Cartella non trovata.');
    const n = used(v);
    if (n > 0) return fail(res, 409, 'La cartella non è vuota: contiene ' + n + (n === 1 ? ' documento' : ' documenti') + '. Spostali prima in un\'altra.');
    change = (f) => { f.options = f.options.filter((o) => optValue(o) !== v); };
    audit = { action: 'remove', value: v };
  } else return fail(res, 400, 'Azione non valida');

  const nuovo = applyToSchema(mod.schema_json, fieldKey, change);
  if (nuovo.error) return fail(res, 422, nuovo.error);
  // se c'è una bozza non ancora pubblicata nel Builder, la stessa modifica ci entra anche, altrimenti la prossima pubblicazione la annullerebbe
  let bozza = null;
  if (mod.schema_json_draft) { const d = applyToSchema(mod.schema_json_draft, fieldKey, change); if (!d.error) bozza = d.json; }

  let righe = 0;
  db.transaction(() => {
    db.prepare('INSERT INTO modules_schema_history (module_id, schema_json, version, published_by) VALUES (?, ?, ?, ?)').run(mod.id, mod.schema_json, mod.schema_version, req.user.id);
    db.prepare('UPDATE modules SET schema_json = ?, schema_json_draft = ?, schema_version = schema_version + 1, published_at = CURRENT_TIMESTAMP WHERE slug = ?')
      .run(nuovo.json, mod.schema_json_draft ? (bozza || mod.schema_json_draft) : null, slug);
    if (audit.action === 'rename') righe = db.prepare("UPDATE records SET data = json_set(data, '$.' || ?, ?), updated_at = CURRENT_TIMESTAMP WHERE module_slug = ? AND json_extract(data, '$.' || ?) = ?").run(fieldKey, audit.to, slug, fieldKey, audit.from).changes;
  })();
  logAudit(req.user.username, 'module.field_option.' + audit.action, slug + '.' + fieldKey, { ...audit, righe });
  res.json({ ok: true, options: nuovo.options, righe });
});

module.exports = router;
