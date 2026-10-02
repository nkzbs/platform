const express = require('express');
const db = require('../db');
const { requireAuth } = require('./auth');
const { parseSchemaNormalized } = require('../schema-v3');

const router = express.Router();

// G12 — records_fts (db.js) è la via veloce; se non disponibile su questo
// build di SQLite (verificato una volta sola, non ad ogni richiesta) si
// ricade sul full-scan di sempre, comportamento identico a prima di G12.
let ftsAvailable = true;
try { db.prepare('SELECT 1 FROM records_fts LIMIT 1').get(); } catch (e) { ftsAvailable = false; }

// FTS5 tratta ", *, (, ) ecc. come sintassi di query, non caratteri letterali —
// avvolgere l'intera query utente in un'unica frase tra virgolette (raddoppiando
// quelle interne) la rende un letterale puro, nessuna interpretazione di
// operatori, stesso principio di un parametro bind ma per la sintassi FTS5.
function escapeFtsPhrase(q) {
  return '"' + q.replace(/"/g, '""') + '"';
}

function ruleFor(schema, role) {
  const rules = schema && schema.permissions && schema.permissions.rules;
  if (!Array.isArray(rules) || rules.length === 0) return null;
  const found = rules.find((r) => r.role === role);
  if (found) return found;
  if (role === 'admin') return { role, view: true };
  return { role, view: false };
}

router.get('/', requireAuth, (req, res) => {
  const q = (req.query.q || '').trim().toLowerCase();
  if (!q || q.length < 2) return res.json([]);

  const modules = db.prepare("SELECT slug, name, icon, color FROM modules WHERE installed = 1 AND slug != 'dashboard'").all();
  const results = [];

  for (const mod of modules) {
    if (results.length >= 40) break;
    let schema;
    try {
      const row = db.prepare('SELECT schema_json FROM modules WHERE slug = ?').get(mod.slug);
      schema = parseSchemaNormalized(row && row.schema_json) || {};
    } catch { schema = {}; }

    const rule = ruleFor(schema, req.user.role);
    if (rule && !rule.view) continue;

    const labelField = (schema.fields || []).find((f) => f.type === 'text' && !['computed', 'soglia'].includes(f.type))
      || (schema.fields || [])[0];

    // Trigram indicizza n-grammi di 3 caratteri: una query più corta non può
    // dare candidati dall'indice (non un bug, la matematica dei trigrammi) —
    // per q di 2 caratteri si torna al full-scan, unico caso in cui serve.
    const records = (ftsAvailable && q.length >= 3)
      ? db.prepare('SELECT r.id, r.data FROM records r JOIN records_fts f ON f.rowid = r.id WHERE r.module_slug = ? AND f.searchtext MATCH ?')
          .all(mod.slug, escapeFtsPhrase(q))
      : db.prepare('SELECT id, data FROM records WHERE module_slug = ?').all(mod.slug);
    // L'indice FTS restringe i candidati (velocità), ma il match vero resta
    // SEMPRE questo .includes() qui sotto, identico a prima di G12 — un
    // trigram-match sul testo concatenato non garantisce che la sottostringa
    // cada dentro un SINGOLO valore (es. valore1="ab"+valore2="cd" potrebbe
    // far scattare il trigramma di "b c" a cavallo dei due), quindi l'indice
    // è solo un pre-filtro, mai l'arbitro finale — zero falsi positivi possibili.
    for (const r of records) {
      let data; try { data = JSON.parse(r.data); } catch { continue; }
      const vals = Object.values(data).filter((v) => v !== null && v !== undefined && typeof v !== 'object');
      if (vals.some((v) => String(v).toLowerCase().includes(q))) {
        const label = labelField ? String(data[labelField.key] ?? '#' + r.id) : '#' + r.id;
        results.push({
          module_slug: mod.slug,
          module_name: mod.name,
          module_icon: mod.icon,
          module_color: mod.color,
          record_id: r.id,
          label,
        });
        if (results.length >= 40) break;
      }
    }
  }

  res.json(results);
});

module.exports = router;
