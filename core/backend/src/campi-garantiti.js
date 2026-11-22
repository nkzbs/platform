'use strict';
// Campi che certi moduli devono avere (dichiarati in seeds/campi-garantiti.json: nomi di moduli e di campi stanno lì, non nel codice).
// Serve ai tenant già in uso: un modulo creato prima che il campo esistesse lo riceve una volta sola, all'avvio.
// Regole: il campo si aggiunge solo se il modulo c'è e non ha già un campo con quella chiave; una volta aggiunto si ricorda, così se
// l'amministratore lo toglie dal Builder non ricompare ad ogni avvio. Se c'è una bozza dello schema, il campo entra anche lì (la bozza non si butta).
const db = require('./db');
const { isV3 } = require('./schema-v3');
const { logAudit } = require('./audit-log');

const GARANTITI = require('./seeds/campi-garantiti.json');

db.exec('CREATE TABLE IF NOT EXISTS campi_garantiti_applicati (module_slug TEXT NOT NULL, field_key TEXT NOT NULL, applied_at DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (module_slug, field_key))');

const chiavi = (schema) => {
  const out = new Set();
  const visita = (x) => { if (x && typeof x === 'object') { if (typeof x.key === 'string' && x.block_type === 'field') out.add(x.key); if (Array.isArray(x)) x.forEach(visita); else Object.values(x).forEach(visita); } };
  visita(schema.steps); (schema.fields || []).forEach((f) => out.add(f.key));
  return out;
};

// Inserisce il campo in uno schema (oggetto) dopo il campo `dopo`, o in fondo ai campi se non c'è. Ritorna true se ha cambiato qualcosa.
function inserisci(schema, def) {
  if (chiavi(schema).has(def.key)) return false;
  if (isV3(schema)) {
    const blocco = { id: 'fld_' + Math.random().toString(36).slice(2, 12), block_type: 'field', key: def.key, label: def.label, type: def.type };
    const steps = Array.isArray(schema.steps) ? schema.steps : [];
    const i = steps.findIndex((s) => s && s.block_type === 'field' && s.key === def.dopo);
    const ultimo = steps.reduce((m, s, k) => (s && s.block_type === 'field' ? k : m), -1);
    const pos = i >= 0 ? i + 1 : ultimo + 1;
    schema.steps = [...steps.slice(0, pos), blocco, ...steps.slice(pos)];
  } else {
    const campi = Array.isArray(schema.fields) ? schema.fields : [];
    const i = campi.findIndex((f) => f.key === def.dopo);
    const nuovo = { key: def.key, label: def.label, type: def.type };
    schema.fields = i >= 0 ? [...campi.slice(0, i + 1), nuovo, ...campi.slice(i + 1)] : [...campi, nuovo];
  }
  return true;
}

function apply(elenco = GARANTITI) {
  let n = 0;
  for (const [slug, defs] of Object.entries(elenco)) {
    if (slug === '_blocchi') continue; // sono i blocchi, li gestisce applyBlocchi
    const row = db.prepare('SELECT id, schema_json, schema_json_draft, schema_version FROM modules WHERE slug = ? AND installed = 1').get(slug);
    if (!row) continue;
    for (const def of defs) {
      if (db.prepare('SELECT 1 FROM campi_garantiti_applicati WHERE module_slug = ? AND field_key = ?').get(slug, def.key)) continue;
      let pubblicato, bozza = null;
      try { pubblicato = JSON.parse(row.schema_json || '{}'); if (row.schema_json_draft) bozza = JSON.parse(row.schema_json_draft); } catch (e) { continue; } // schema illeggibile: non si tocca
      const cambiato = inserisci(pubblicato, def);
      if (bozza) inserisci(bozza, def);
      if (cambiato) {
        db.prepare('INSERT INTO modules_schema_history (module_id, schema_json, version, published_by) VALUES (?, ?, ?, NULL)').run(row.id, row.schema_json, row.schema_version);
        db.prepare('UPDATE modules SET schema_json = ?, schema_json_draft = ?, schema_version = schema_version + 1, published_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run(JSON.stringify(pubblicato), bozza ? JSON.stringify(bozza) : row.schema_json_draft, row.id);
        try { logAudit('sistema', 'module.campo_garantito', slug, { campo: def.key }); } catch (e) { /* il registro non deve fermare l'avvio */ }
        n++;
      }
      db.prepare('INSERT OR IGNORE INTO campi_garantiti_applicati (module_slug, field_key) VALUES (?, ?)').run(slug, def.key);
      // per il giro successivo dello stesso modulo (più campi) si rilegge la riga
      Object.assign(row, db.prepare('SELECT schema_json, schema_json_draft, schema_version FROM modules WHERE id = ?').get(row.id));
    }
  }
  return n;
}

// ── Blocchi garantiti (stessa idea dei campi): un blocco dello schema che un modulo deve avere, es. i requisiti per passare a «pagato».
// Dichiarati in seeds/campi-garantiti.json sotto `_blocchi` ({ modulo: [blocco] }); un blocco si aggiunge solo se il modulo non ne ha già uno
// dello stesso tipo e per lo stesso stato; una volta sola (se lo togli dal Builder non ricompare). Anche nella bozza, se c'è.
const chiaveBlocco = (b) => 'blocco:' + b.block_type + ':' + (b.stato || '');
const haBlocco = (schema, b) => (Array.isArray(schema.steps) ? schema.steps : []).some((x) => x && x.block_type === b.block_type && (x.stato || '') === (b.stato || ''));
function inserisciBlocco(schema, b) {
  if (!isV3(schema) || haBlocco(schema, b)) return false;
  schema.steps = [...(Array.isArray(schema.steps) ? schema.steps : []), { id: 'blk_' + Math.random().toString(36).slice(2, 12), ...b }];
  return true;
}
function applyBlocchi(elenco = GARANTITI._blocchi || {}) {
  let n = 0;
  for (const [slug, blocchi] of Object.entries(elenco)) {
    for (const b of blocchi) {
      const row = db.prepare('SELECT id, schema_json, schema_json_draft, schema_version FROM modules WHERE slug = ? AND installed = 1').get(slug);
      if (!row) continue;
      if (db.prepare('SELECT 1 FROM campi_garantiti_applicati WHERE module_slug = ? AND field_key = ?').get(slug, chiaveBlocco(b))) continue;
      let pubblicato, bozza = null;
      try { pubblicato = JSON.parse(row.schema_json || '{}'); if (row.schema_json_draft) bozza = JSON.parse(row.schema_json_draft); } catch (e) { continue; }
      const cambiato = inserisciBlocco(pubblicato, b);
      if (bozza) inserisciBlocco(bozza, b);
      if (cambiato) {
        db.prepare('INSERT INTO modules_schema_history (module_id, schema_json, version, published_by) VALUES (?, ?, ?, NULL)').run(row.id, row.schema_json, row.schema_version);
        db.prepare('UPDATE modules SET schema_json = ?, schema_json_draft = ?, schema_version = schema_version + 1, published_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run(JSON.stringify(pubblicato), bozza ? JSON.stringify(bozza) : row.schema_json_draft, row.id);
        try { logAudit('sistema', 'module.blocco_garantito', slug, { blocco: chiaveBlocco(b) }); } catch (e) { /* il registro non deve fermare l'avvio */ }
        n++;
      }
      db.prepare('INSERT OR IGNORE INTO campi_garantiti_applicati (module_slug, field_key) VALUES (?, ?)').run(slug, chiaveBlocco(b));
    }
  }
  return n;
}

module.exports = { apply, applyBlocchi, inserisci, inserisciBlocco, GARANTITI };
