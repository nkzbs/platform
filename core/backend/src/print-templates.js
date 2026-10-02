'use strict';
// ─── STAMPA / DOCUMENTI ────────────────────────────────────────────────────────
// Un modulo può avere blocchi 'document_template' (Builder, categoria Stampa):
// { id, nome, formato: '80mm'|'a4', contenuto_html }. contenuto_html è HTML con
// token da sostituire — stessa filosofia della sandbox espressioni di formula.js,
// ma qui serve interpolazione DENTRO un intero documento (più token, testo libero
// intorno), non un singolo valore calcolato: per questo è un piccolo resolver
// dedicato invece di riusare evaluateFormula (che restituisce UN solo valore).
//
// Token supportati:
//   {{campo:X}}         — campo X del record corrente. Se X è una relazione
//                         many_to_one, sostituisce l'id con il display_field del
//                         record collegato (altrimenti in stampa comparirebbe un
//                         numero invece del nome cliente/prodotto/ecc.).
//   {{azienda:X}}        — campo X delle impostazioni azienda del tenant (vedi
//                         routes/settings.js: ragione_sociale, indirizzo, piva,
//                         logo_url).
//   {{oggi}}              — data odierna, formato it-IT.
//   {{#righe modulo="X" campo="Y"}}...{{/righe}} — itera i record di X il cui
//                         campo Y punta al record corrente (stesso pattern di
//                         GET /records/:slug?rel=Y&value=ID già usato altrove);
//                         dentro il blocco, campo:/azienda: si scopano sulla riga
//                         figlia invece che sul padre.
const db = require('./db');
const { parseSchemaNormalized } = require('./schema-v3');
const { attachComputedFields } = require('./computed-fields');

function escapeHtml(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function getModuleSchema(slug) {
  const mod = db.prepare('SELECT schema_json FROM modules WHERE slug = ?').get(slug);
  if (!mod) return null;
  return parseSchemaNormalized(mod.schema_json);
}

function resolveCampo(schema, data, key) {
  const rel = (schema.relations || []).find((r) => r.key === key);
  if (rel && data[key] != null) {
    const targetRow = db.prepare('SELECT data FROM records WHERE module_slug = ? AND id = ?').get(rel.target_module, data[key]);
    if (targetRow && rel.display_field) {
      try { return JSON.parse(targetRow.data || '{}')[rel.display_field]; } catch (e) { return data[key]; }
    }
  }
  return data[key];
}

function renderTokens(str, schema, data, azienda) {
  return str
    .replace(/\{\{azienda:([a-zA-Z0-9_]+)\}\}/g, (m, key) => escapeHtml(azienda ? azienda[key] : ''))
    .replace(/\{\{oggi\}\}/g, () => new Date().toLocaleDateString('it-IT'))
    .replace(/\{\{campo:([a-zA-Z0-9_]+)\}\}/g, (m, key) => escapeHtml(resolveCampo(schema, data, key)));
}

function renderLoops(str, parentId, azienda) {
  const loopRe = /\{\{#righe\s+modulo="([a-zA-Z0-9_]+)"\s+campo="([a-zA-Z0-9_]+)"\}\}([\s\S]*?)\{\{\/righe\}\}/g;
  return str.replace(loopRe, (m, modulo, campo, body) => {
    const childSchema = getModuleSchema(modulo) || {};
    const rows = db.prepare('SELECT id, data FROM records WHERE module_slug = ?').all(modulo)
      .map((r) => ({ id: r.id, data: JSON.parse(r.data || '{}') }))
      .filter((r) => String(r.data[campo]) === String(parentId));
    return rows
      .map((r) => attachComputedFields(db, r, childSchema, modulo))
      .map((r) => renderTokens(body, childSchema, r.data, azienda))
      .join('');
  });
}

// template: il blocco document_template ({contenuto_html, formato, nome}).
// schema: schema (v2-normalizzato) del modulo del record corrente.
// record: { id, data } — data già passato per attachComputedFields dal chiamante.
// azienda: riga tenant_settings ({ragione_sociale, indirizzo, piva, logo_url}).
function renderDocumentTemplate(template, schema, record, azienda) {
  let html = template.contenuto_html || '';
  html = renderLoops(html, record.id, azienda);
  html = renderTokens(html, schema, record.data, azienda);
  return html;
}

module.exports = { renderDocumentTemplate };
