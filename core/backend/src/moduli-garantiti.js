'use strict';
// Moduli che un tenant deve avere, con i loro primi record (dichiarati in seeds/moduli-garantiti.json: nomi e dati stanno lì, non nel codice).
// Un modulo manca (e, se dichiarato, i moduli da cui dipende ci sono) → si crea con il suo schema e i record di partenza, una volta sola; se c'è già (anche vuoto) non si tocca, e se lo elimini non torna.
const db = require('./db');
const { logAudit } = require('./audit-log');

const MODULI = require('./seeds/moduli-garantiti.json');

db.exec('CREATE TABLE IF NOT EXISTS moduli_garantiti_applicati (module_slug TEXT PRIMARY KEY, applied_at DATETIME DEFAULT CURRENT_TIMESTAMP)');

function apply(elenco = MODULI) {
  let n = 0;
  for (const [slug, def] of Object.entries(elenco)) {
    if (db.prepare('SELECT 1 FROM moduli_garantiti_applicati WHERE module_slug = ?').get(slug)) continue;
    if (db.prepare('SELECT 1 FROM modules WHERE slug = ?').get(slug)) { db.prepare('INSERT OR IGNORE INTO moduli_garantiti_applicati (module_slug) VALUES (?)').run(slug); continue; } // c'è già: non è roba nostra
    // Solo dove serve: `se_esiste` = almeno uno di questi moduli deve essere installato (es. i Fornitori solo dove ci sono piani e spese). Senza, si salta e si
    // riprova al prossimo avvio (un tenant che i moduli li installa dopo li riceve allora).
    if (Array.isArray(def.se_esiste) && def.se_esiste.length && !def.se_esiste.some((m) => db.prepare('SELECT 1 FROM modules WHERE slug = ? AND installed = 1').get(m))) continue;
    const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get();
    const dopo = (db.prepare('SELECT MAX(sort_order) m FROM modules').get().m || 0) + 1;
    db.transaction(() => {
      db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json, support_module) VALUES (?, ?, ?, ?, 1, 1, ?, ?, 0)")
        .run(def.name, slug, def.icon || 'box', def.color || '#2563EB', dopo, JSON.stringify(def.schema || { version: 3, steps: [] }));
      for (const r of def.records || []) db.prepare('INSERT INTO records (module_slug, user_id, data) VALUES (?, ?, ?)').run(slug, admin ? admin.id : null, JSON.stringify(r));
      db.prepare('INSERT INTO moduli_garantiti_applicati (module_slug) VALUES (?)').run(slug);
    })();
    try { logAudit('sistema', 'module.garantito', slug, { record: (def.records || []).length }); } catch (e) { /* il registro non deve fermare l'avvio */ }
    n++;
  }
  return n;
}

module.exports = { apply, MODULI };
