'use strict';
// Moduli segnaposto rimasti da versioni vecchie: "sito_web" e "sito_avanzato" sono moduli vuoti (nessun campo) e non installati, ma
// comparivano nella Libreria come "da installare" mentre il Sito Web vero è una funzione delle Impostazioni (scheda Sito Web).
// Si tolgono solo se sono davvero vuoti: non installati, schema senza blocchi e nessun record. Idempotente.
const db = require('./db');

const STUBS = ['sito_web', 'sito_avanzato'];

function removeStubModules() {
  const removed = [];
  for (const slug of STUBS) {
    const m = db.prepare('SELECT id, installed, schema_json FROM modules WHERE slug = ?').get(slug);
    if (!m || m.installed) continue;
    let steps = [];
    try { const s = JSON.parse(m.schema_json || '{}'); steps = s.steps || s.fields || []; } catch (e) { continue; } // schema illeggibile: non si tocca
    if (steps.length) continue;
    if (db.prepare('SELECT 1 FROM records WHERE module_slug = ? LIMIT 1').get(slug)) continue;
    db.prepare('DELETE FROM user_modules WHERE module_slug = ?').run(slug);
    db.prepare('DELETE FROM modules WHERE id = ?').run(m.id);
    removed.push(slug);
  }
  if (removed.length) console.log('Pulizia: moduli segnaposto rimossi (' + removed.join(', ') + ')');
  return removed;
}

module.exports = { removeStubModules, STUBS };
