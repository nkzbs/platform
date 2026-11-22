'use strict';
// Pulizia dei valori doppi o di prova in un campo «scelta» (dichiarata in seeds/pulizia-opzioni.json: nomi di moduli, campi e valori stanno lì, non nel codice).
//   unisci: { "vecchio": "nuovo" }          le righe che hanno «vecchio» passano a «nuovo» (che deve già esistere tra le scelte) e «vecchio» esce dall'elenco
//   togli_se_inutilizzata: ["valore", ...]  il valore esce dall'elenco solo se nessuna riga lo usa (se qualcuna lo usa resta, e non si fa niente)
// Una volta sola per modulo/campo/azione. Prima di cambiare le righe si salvano i valori vecchi (tabella pulizia_opzioni_copia). Schema con versione e storico;
// se c'è una bozza si ripulisce anche quella.
const db = require('./db');
const { isV3 } = require('./schema-v3');
const { logAudit } = require('./audit-log');

const PULIZIE = require('./seeds/pulizia-opzioni.json');

db.exec('CREATE TABLE IF NOT EXISTS pulizia_opzioni_applicate (module_slug TEXT NOT NULL, field_key TEXT NOT NULL, azione TEXT NOT NULL, applied_at DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (module_slug, field_key, azione))');
db.exec('CREATE TABLE IF NOT EXISTS pulizia_opzioni_copia (id INTEGER PRIMARY KEY AUTOINCREMENT, module_slug TEXT NOT NULL, record_id INTEGER NOT NULL, field_key TEXT NOT NULL, valore_prima TEXT, valore_dopo TEXT, at DATETIME DEFAULT CURRENT_TIMESTAMP)');

const valore = (o) => (typeof o === 'string' ? o : o && o.value);
const campo = (schema, key) => (isV3(schema) ? (Array.isArray(schema.steps) ? schema.steps : []).find((b) => b && b.block_type === 'field' && b.key === key) : (Array.isArray(schema.fields) ? schema.fields : []).find((f) => f && f.key === key)) || null;

// Toglie `v` dalle scelte del campo; true se c'era.
function togliScelta(schema, key, v) {
  const f = campo(schema, key);
  if (!f || !Array.isArray(f.options) || !f.options.some((o) => valore(o) === v)) return false;
  f.options = f.options.filter((o) => valore(o) !== v);
  return true;
}
const haScelta = (schema, key, v) => { const f = campo(schema, key); return !!(f && Array.isArray(f.options) && f.options.some((o) => valore(o) === v)); };

function apply(elenco = PULIZIE) {
  let n = 0;
  for (const [slug, campi] of Object.entries(elenco)) {
    for (const [key, regole] of Object.entries(campi)) {
      const row = db.prepare('SELECT id, schema_json, schema_json_draft, schema_version FROM modules WHERE slug = ? AND installed = 1').get(slug);
      if (!row) continue;
      let pubblicato, bozza = null;
      try { pubblicato = JSON.parse(row.schema_json || '{}'); if (row.schema_json_draft) bozza = JSON.parse(row.schema_json_draft); } catch (e) { continue; } // schema illeggibile: non si tocca
      let cambiato = false;
      const fatto = (azione) => db.prepare('SELECT 1 FROM pulizia_opzioni_applicate WHERE module_slug = ? AND field_key = ? AND azione = ?').get(slug, key, azione);
      const segna = (azione) => db.prepare('INSERT OR IGNORE INTO pulizia_opzioni_applicate (module_slug, field_key, azione) VALUES (?, ?, ?)').run(slug, key, azione);
      const righe = () => db.prepare('SELECT id, data FROM records WHERE module_slug = ?').all(slug).map((r) => { let d = null; try { d = JSON.parse(r.data); } catch (e) { /* riga illeggibile: si salta */ } return { id: r.id, d }; }).filter((r) => r.d);

      for (const [vecchio, nuovo] of Object.entries(regole.unisci || {})) {
        const azione = 'unisci:' + vecchio;
        if (fatto(azione)) continue;
        if (!haScelta(pubblicato, key, nuovo)) continue; // la destinazione deve esistere: altrimenti si riprova al prossimo avvio
        db.transaction(() => {
          for (const r of righe()) {
            if (r.d[key] !== vecchio) continue;
            db.prepare('INSERT INTO pulizia_opzioni_copia (module_slug, record_id, field_key, valore_prima, valore_dopo) VALUES (?, ?, ?, ?, ?)').run(slug, r.id, key, vecchio, nuovo);
            db.prepare('UPDATE records SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND module_slug = ?').run(JSON.stringify({ ...r.d, [key]: nuovo }), r.id, slug);
          }
          if (togliScelta(pubblicato, key, vecchio)) cambiato = true;
          if (bozza) togliScelta(bozza, key, vecchio);
          segna(azione);
        })();
        n++;
      }
      for (const v of regole.togli_se_inutilizzata || []) {
        const azione = 'togli:' + v;
        if (fatto(azione)) continue;
        if (righe().some((r) => r.d[key] === v)) continue; // qualcuno lo usa: resta, e si riprova al prossimo avvio
        const tolta = togliScelta(pubblicato, key, v);
        if (tolta) { cambiato = true; n++; }
        if (bozza) togliScelta(bozza, key, v);
        segna(azione); // anche se non c'era: niente da togliere, niente da riprovare
      }
      if (cambiato) {
        db.prepare('INSERT INTO modules_schema_history (module_id, schema_json, version, published_by) VALUES (?, ?, ?, NULL)').run(row.id, row.schema_json, row.schema_version);
        db.prepare('UPDATE modules SET schema_json = ?, schema_json_draft = ?, schema_version = schema_version + 1, published_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run(JSON.stringify(pubblicato), bozza ? JSON.stringify(bozza) : row.schema_json_draft, row.id);
        try { logAudit('sistema', 'module.pulizia_opzioni', slug, { campo: key }); } catch (e) { /* il registro non deve fermare l'avvio */ }
      }
    }
  }
  return n;
}

module.exports = { apply, PULIZIE };
