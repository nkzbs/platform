'use strict';
// Piccoli ritocchi a un blocco dello schema di un modulo già in uso (dichiarati in seeds/ritocchi-schema.json: nomi di moduli, blocchi e valori stanno lì,
// non nel codice). Es.: il nome delle rate generate da un piano passa da «campo:nome» a «numerata:nome» («Nome — rata 3 su 11»).
// Regole: si cambia solo se il valore attuale è quello atteso (`da`): una scelta già fatta dal Builder non si tocca. Ogni ritocco si fa una volta sola
// (si ricorda per modulo e id), con versione e storico dello schema; se c'è una bozza si ritocca anche quella.
const db = require('./db');
const { logAudit } = require('./audit-log');

const RITOCCHI = require('./seeds/ritocchi-schema.json');

db.exec('CREATE TABLE IF NOT EXISTS ritocchi_schema_applicati (module_slug TEXT NOT NULL, ritocco_id TEXT NOT NULL, applied_at DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (module_slug, ritocco_id))');

const trovaBlocco = (schema, id) => {
  let out = null;
  const visita = (x) => { if (out || !x || typeof x !== 'object') return; if (!Array.isArray(x) && x.id === id) { out = x; return; } (Array.isArray(x) ? x : Object.values(x)).forEach(visita); };
  visita(schema.steps); visita(schema.automations); visita(schema.blocks);
  return out;
};

// Porta `r.percorso` (es. «azioni.0.config.dati.descrizione») dentro il blocco; ritorna { oggetto, chiave } o null se il percorso non c'è.
function raggiungi(blocco, percorso) {
  const parti = String(percorso).split('.');
  let cur = blocco;
  for (let i = 0; i < parti.length - 1; i++) { if (cur == null || typeof cur !== 'object') return null; cur = cur[parti[i]]; }
  return cur && typeof cur === 'object' ? { oggetto: cur, chiave: parti[parti.length - 1] } : null;
}

// Ritocca uno schema (oggetto) in place; true se ha cambiato qualcosa.
function ritocca(schema, r) {
  const b = trovaBlocco(schema, r.blocco);
  const t = b && raggiungi(b, r.percorso);
  if (!t || t.oggetto[t.chiave] !== r.da) return false;
  t.oggetto[t.chiave] = r.a;
  return true;
}

function apply(elenco = RITOCCHI) {
  let n = 0;
  for (const [slug, lista] of Object.entries(elenco)) {
    for (const r of lista) {
      const row = db.prepare('SELECT id, schema_json, schema_json_draft, schema_version FROM modules WHERE slug = ? AND installed = 1').get(slug);
      if (!row) continue;
      if (db.prepare('SELECT 1 FROM ritocchi_schema_applicati WHERE module_slug = ? AND ritocco_id = ?').get(slug, r.id)) continue;
      let pubblicato, bozza = null;
      try { pubblicato = JSON.parse(row.schema_json || '{}'); if (row.schema_json_draft) bozza = JSON.parse(row.schema_json_draft); } catch (e) { continue; } // schema illeggibile: non si tocca
      const cambiato = ritocca(pubblicato, r);
      if (bozza) ritocca(bozza, r);
      if (cambiato) {
        db.prepare('INSERT INTO modules_schema_history (module_id, schema_json, version, published_by) VALUES (?, ?, ?, NULL)').run(row.id, row.schema_json, row.schema_version);
        db.prepare('UPDATE modules SET schema_json = ?, schema_json_draft = ?, schema_version = schema_version + 1, published_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run(JSON.stringify(pubblicato), bozza ? JSON.stringify(bozza) : row.schema_json_draft, row.id);
        try { logAudit('sistema', 'module.ritocco_schema', slug, { ritocco: r.id }); } catch (e) { /* il registro non deve fermare l'avvio */ }
        n++;
      }
      db.prepare('INSERT OR IGNORE INTO ritocchi_schema_applicati (module_slug, ritocco_id) VALUES (?, ?)').run(slug, r.id); // anche se non serviva: il valore era già una scelta
    }
  }
  return n;
}

module.exports = { apply, ritocca, RITOCCHI };
