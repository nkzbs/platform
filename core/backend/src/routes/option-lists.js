'use strict';
// Liste di opzioni condivise tra campi select/multiselect di moduli diversi (Builder,
// Fase 2 della semplificazione ispirata a Collections — vedi db.js per il perché delle
// due tabelle). Una lista è gestita qui; i suoi valori restano COPIATI dentro
// field.options di ogni campo collegato (list_id), così nessun punto che legge options
// oggi (FieldEditorInput, l'anteprima del Builder, suggestions.js, le automazioni...)
// deve cambiare — questo file è l'unico posto che scrive sia qui sia là, in transazione.
//
// Stesso impianto di field-options.js (rename con guardia "citato altrove", remove con
// guardia "righe che lo usano", cronologia + bozza allineate), esteso a TUTTI i moduli
// che hanno un campo con quello list_id, non a uno solo.
const express = require('express');
const db = require('../db');
const { requireAuth } = require('./auth');
const { parseSchemaNormalized } = require('../schema-v3');
const { ruleFor } = require('../permissions');
const { logAudit } = require('../audit-log');

const router = express.Router();
const fail = (res, status, error) => res.status(status).json({ error });
const clean = (v) => String(v == null ? '' : v).trim().replace(/\s+/g, ' ');
const optValue = (o) => (typeof o === 'string' ? o : o && o.value);

const SOLO_TESTO = new Set(['label', 'name', 'title', 'description', 'placeholder', 'hint', 'id', 'key', 'block_key', 'icon', 'color', 'unit', 'format']);
function citaValore(node, valore) {
  if (Array.isArray(node)) return node.some((x) => citaValore(x, valore));
  if (node && typeof node === 'object') return Object.entries(node).some(([k, v]) => !SOLO_TESTO.has(k) && citaValore(v, valore));
  return node === valore;
}

// I campi di un modulo, in QUALUNQUE forma sia salvato il suo schema — v3 (steps[], solo i block_type
// 'field'/'computed') o v2 "classico" (fields[] piatto, come lo riscrive il Builder a ogni pubblicazione:
// vedi builder.js, "downgrade silenzioso"). Prima qui si leggeva solo v3: una lista condivisa collegata a un
// campo di un modulo pubblicato dal Builder classico (la quasi totalità, in pratica) non trovava mai quel
// campo — "collegato" restava sempre vuoto, l'aggiunta di una voce non arrivava mai lì (segnalato dall'utente
// il 29/10, già un limite noto prima d'ora: stesso di field-options.js).
function fieldsOf(s) {
  if (Array.isArray(s.steps)) return s.steps.filter((st) => st.block_type === 'field' || st.block_type === 'computed');
  if (Array.isArray(s.fields)) return s.fields;
  return null;
}

// Ogni campo (in QUALUNQUE modulo installato) che ha field.list_id === listId, con il
// modulo a cui appartiene.
function findLinkedFields(listId) {
  const mods = db.prepare('SELECT * FROM modules WHERE installed = 1').all();
  const out = [];
  for (const mod of mods) {
    let s;
    try { s = JSON.parse(mod.schema_json); } catch (e) { continue; }
    const fields = fieldsOf(s);
    if (!fields) continue;
    for (const f of fields) {
      if (f.list_id === listId && Array.isArray(f.options)) out.push({ mod, fieldKey: f.key });
    }
  }
  return out;
}

// Applica `change(field)` al campo `fieldKey` dentro lo schema (stringa JSON, v2 o v3) e
// ritorna { json, options } — stesso schema di field-options.js#applyToSchema.
function applyToSchema(raw, fieldKey, change) {
  let s;
  try { s = JSON.parse(raw); } catch (e) { return { error: 'Schema non leggibile' }; }
  const fields = fieldsOf(s);
  if (!fields) return { error: 'Schema non nel formato atteso' };
  const f = fields.find((b) => b.key === fieldKey);
  if (!f) return { error: 'Campo non trovato' };
  change(f, fields);
  return { json: JSON.stringify(s), options: (f.options || []).map(optValue) };
}

// Scrive `change` sul campo `fieldKey` del modulo `mod`, pubblicato + bozza, con una
// riga di cronologia (come una pubblicazione dal Builder) e — se passato — la cascata
// del rename sulle righe già esistenti. Richiamata una volta per ogni modulo collegato.
function writeToModule(mod, fieldKey, change, actorId, cascadeRename) {
  const nuovo = applyToSchema(mod.schema_json, fieldKey, change);
  if (nuovo.error) return nuovo;
  let bozza = null;
  if (mod.schema_json_draft) { const d = applyToSchema(mod.schema_json_draft, fieldKey, change); if (!d.error) bozza = d.json; }
  let righe = 0;
  db.transaction(() => {
    db.prepare('INSERT INTO modules_schema_history (module_id, schema_json, version, published_by) VALUES (?, ?, ?, ?)').run(mod.id, mod.schema_json, mod.schema_version, actorId);
    db.prepare('UPDATE modules SET schema_json = ?, schema_json_draft = ?, schema_version = schema_version + 1, published_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(nuovo.json, mod.schema_json_draft ? (bozza || mod.schema_json_draft) : null, mod.id);
    if (cascadeRename) {
      righe = db.prepare("UPDATE records SET data = json_set(data, '$.' || ?, ?), updated_at = CURRENT_TIMESTAMP WHERE module_slug = ? AND json_extract(data, '$.' || ?) = ?")
        .run(fieldKey, cascadeRename.to, mod.slug, fieldKey, cascadeRename.from).changes;
    }
  })();
  return { ok: true, righe };
}

function requireEditAnyModule(req, res, mods) {
  for (const { mod } of mods) {
    const schema = parseSchemaNormalized(mod.schema_json);
    const rule = ruleFor(schema, req.user.role);
    if (rule && !rule.edit) { fail(res, 403, `Non hai i permessi per modificare "${mod.name}"`); return false; }
  }
  return true;
}

router.get('/', requireAuth, (req, res) => {
  const lists = db.prepare(`
    SELECT l.id, l.name, l.created_at, (SELECT COUNT(*) FROM option_list_items i WHERE i.list_id = l.id) as item_count
    FROM option_lists l ORDER BY l.name COLLATE NOCASE
  `).all();
  res.json(lists);
});

router.get('/:id', requireAuth, (req, res) => {
  const list = db.prepare('SELECT id, name, created_at FROM option_lists WHERE id = ?').get(req.params.id);
  if (!list) return fail(res, 404, 'Lista non trovata');
  const items = db.prepare('SELECT id, value, weight FROM option_list_items WHERE list_id = ? ORDER BY weight, id').all(list.id);
  const linked = findLinkedFields(list.id).map(({ mod, fieldKey }) => ({ module_slug: mod.slug, module_name: mod.name, field_key: fieldKey }));
  res.json({ ...list, items, linked });
});

router.post('/', requireAuth, (req, res) => {
  const name = clean((req.body || {}).name);
  if (!name) return fail(res, 400, 'Scrivi un nome per la lista.');
  if (name.length > 60) return fail(res, 400, 'Il nome è troppo lungo (massimo 60 caratteri).');
  const info = db.prepare('INSERT INTO option_lists (name) VALUES (?)').run(name);
  logAudit(req.user.username, 'option_list.create', name, { id: info.lastInsertRowid });
  res.json({ id: info.lastInsertRowid, name, items: [] });
});

router.patch('/:id', requireAuth, (req, res) => {
  const list = db.prepare('SELECT id FROM option_lists WHERE id = ?').get(req.params.id);
  if (!list) return fail(res, 404, 'Lista non trovata');
  const name = clean((req.body || {}).name);
  if (!name) return fail(res, 400, 'Scrivi un nome per la lista.');
  if (name.length > 60) return fail(res, 400, 'Il nome è troppo lungo (massimo 60 caratteri).');
  db.prepare('UPDATE option_lists SET name = ? WHERE id = ?').run(name, list.id);
  logAudit(req.user.username, 'option_list.rename', name, { id: list.id });
  res.json({ ok: true });
});

// Elimina la lista. Non tocca le options già copiate nei campi collegati (restano come
// valori fissi, congelati all'ultimo stato noto) — toglie solo list_id, così quei campi
// tornano "lista propria del campo" invece di sparire o rompersi.
router.delete('/:id', requireAuth, (req, res) => {
  const list = db.prepare('SELECT id, name FROM option_lists WHERE id = ?').get(req.params.id);
  if (!list) return fail(res, 404, 'Lista non trovata');
  const linked = findLinkedFields(list.id);
  if (!requireEditAnyModule(req, res, linked)) return;
  db.transaction(() => {
    for (const { mod, fieldKey } of linked) {
      writeToModule(mod, fieldKey, (f) => { delete f.list_id; }, req.user.id, null);
    }
    db.prepare('DELETE FROM option_lists WHERE id = ?').run(list.id);
  })();
  logAudit(req.user.username, 'option_list.delete', list.name, { id: list.id, campi_scollegati: linked.length });
  res.json({ ok: true });
});

router.post('/:id/items', requireAuth, (req, res) => {
  const list = db.prepare('SELECT id FROM option_lists WHERE id = ?').get(req.params.id);
  if (!list) return fail(res, 404, 'Lista non trovata');
  const v = clean((req.body || {}).value);
  if (!v) return fail(res, 400, 'Scrivi il valore.');
  if (v.length > 60) return fail(res, 400, 'Il valore è troppo lungo (massimo 60 caratteri).');
  const existing = db.prepare('SELECT value FROM option_list_items WHERE list_id = ?').all(list.id).map((r) => r.value);
  if (existing.some((o) => o.toLowerCase() === v.toLowerCase())) return fail(res, 409, 'Esiste già un valore con questo nome.');

  const linked = findLinkedFields(list.id);
  if (!requireEditAnyModule(req, res, linked)) return;
  const maxWeight = db.prepare('SELECT COALESCE(MAX(weight), -1) w FROM option_list_items WHERE list_id = ?').get(list.id).w;
  db.transaction(() => {
    db.prepare('INSERT INTO option_list_items (list_id, value, weight) VALUES (?, ?, ?)').run(list.id, v, maxWeight + 1);
    for (const { mod, fieldKey } of linked) {
      writeToModule(mod, fieldKey, (f) => { f.options.push(typeof f.options[0] === 'object' && f.options[0] ? { value: v, label: v } : v); }, req.user.id, null);
    }
  })();
  logAudit(req.user.username, 'option_list.item.add', v, { list_id: list.id, moduli: linked.length });
  res.json({ ok: true, moduli_aggiornati: linked.length });
});

router.patch('/:id/items/:itemId', requireAuth, (req, res) => {
  const list = db.prepare('SELECT id FROM option_lists WHERE id = ?').get(req.params.id);
  if (!list) return fail(res, 404, 'Lista non trovata');
  const item = db.prepare('SELECT id, value FROM option_list_items WHERE id = ? AND list_id = ?').get(req.params.itemId, list.id);
  if (!item) return fail(res, 404, 'Valore non trovato');
  const to = clean((req.body || {}).value);
  if (!to) return fail(res, 400, 'Scrivi il nuovo valore.');
  if (to.length > 60) return fail(res, 400, 'Il valore è troppo lungo (massimo 60 caratteri).');
  if (to === item.value) return res.json({ ok: true, righe: 0 });
  const existing = db.prepare('SELECT value FROM option_list_items WHERE list_id = ? AND id != ?').all(list.id, item.id).map((r) => r.value);
  if (existing.some((o) => o.toLowerCase() === to.toLowerCase())) return fail(res, 409, 'Esiste già un valore con questo nome.');

  const linked = findLinkedFields(list.id);
  if (!requireEditAnyModule(req, res, linked)) return;
  // il vecchio valore compare in regole (condizioni, automazioni…) di uno qualunque dei moduli collegati? non si rinomina in silenzio, come field-options.js —
  // azzerando prima le options del campo stesso: altrimenti il valore "cita se stesso" dentro il proprio elenco di opzioni, falso positivo su ogni rename.
  for (const { mod, fieldKey } of linked) {
    const probe = applyToSchema(mod.schema_json, fieldKey, (f) => { f.options = []; });
    if (probe.error) continue;
    if (citaValore(JSON.parse(probe.json), item.value)) return fail(res, 409, `Il valore «${item.value}» è usato anche in regole del modulo "${mod.name}" (condizioni o automazioni): rinominarlo da qui le romperebbe. Cambialo dal Builder.`);
  }

  let righeTotali = 0;
  db.transaction(() => {
    db.prepare('UPDATE option_list_items SET value = ? WHERE id = ?').run(to, item.id);
    for (const { mod, fieldKey } of linked) {
      const r = writeToModule(mod, fieldKey, (f) => {
        f.options = f.options.map((o) => (optValue(o) === item.value ? (typeof o === 'string' ? to : { ...o, value: to, label: to }) : o));
      }, req.user.id, { from: item.value, to });
      righeTotali += r.righe || 0;
    }
  })();
  logAudit(req.user.username, 'option_list.item.rename', `${item.value} -> ${to}`, { list_id: list.id, moduli: linked.length, righe: righeTotali });
  res.json({ ok: true, righe: righeTotali, moduli_aggiornati: linked.length });
});

router.delete('/:id/items/:itemId', requireAuth, (req, res) => {
  const list = db.prepare('SELECT id FROM option_lists WHERE id = ?').get(req.params.id);
  if (!list) return fail(res, 404, 'Lista non trovata');
  const item = db.prepare('SELECT id, value FROM option_list_items WHERE id = ? AND list_id = ?').get(req.params.itemId, list.id);
  if (!item) return fail(res, 404, 'Valore non trovato');

  const linked = findLinkedFields(list.id);
  if (!requireEditAnyModule(req, res, linked)) return;
  // nessuna riga, in nessuno dei moduli collegati, deve già usare questo valore — stessa guardia di field-options.js, estesa a tutti i moduli
  for (const { mod, fieldKey } of linked) {
    const n = db.prepare("SELECT COUNT(*) n FROM records WHERE module_slug = ? AND json_extract(data, '$.' || ?) = ?").get(mod.slug, fieldKey, item.value).n;
    if (n > 0) return fail(res, 409, `Il valore «${item.value}» è usato da ${n} ${n === 1 ? 'riga' : 'righe'} nel modulo "${mod.name}": spostale prima su un altro valore.`);
  }

  db.transaction(() => {
    db.prepare('DELETE FROM option_list_items WHERE id = ?').run(item.id);
    for (const { mod, fieldKey } of linked) {
      writeToModule(mod, fieldKey, (f) => { f.options = f.options.filter((o) => optValue(o) !== item.value); }, req.user.id, null);
    }
  })();
  logAudit(req.user.username, 'option_list.item.remove', item.value, { list_id: list.id, moduli: linked.length });
  res.json({ ok: true, moduli_aggiornati: linked.length });
});

module.exports = router;
