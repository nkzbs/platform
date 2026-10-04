'use strict';
// Potenziamenti AI per modulo: ogni modulo accende da solo quelli che vuole (smistare, spiegare, importare). Senza interruttore acceso
// un modulo non ha AI. Sopra tutto c'è l'**interruttore generale** (Impostazioni → AI): spento, nessun potenziamento lavora. Questo è l'unico punto che
// dice se un potenziamento è attivo su un modulo: le funzioni AI chiedono qui, non conoscono nomi di moduli.
const db = require('./db');
const moduleRoles = require('./module-roles');

// Cosa serve a ogni potenziamento: ruoli che il modulo deve avere dichiarato (module-roles.js).
const FEATURES = {
  triage: { label: 'Smistare', description: 'Propone categoria, importo e scadenza per le righe da smistare.', needs: ['importo', 'categoria', 'stato'] },
  explain: { label: 'Spiegare', description: 'Racconta i numeri del modulo (totali, confronti, anomalie).', needs: ['importo', 'data'] },
  import: { label: 'Importare', description: 'Da un PDF caricato (bolletta, fattura) propone la riga da creare.', needs: ['importo', 'data'] },
};
const KEYS = Object.keys(FEATURES);

// Interruttore generale dell'AI per questo progetto (spento di default).
function masterOn() {
  try { const r = db.prepare('SELECT ai_enabled FROM tenant_settings WHERE id = 1').get(); return !!(r && r.ai_enabled); } catch (e) { return false; }
}
function setMaster(on) { db.prepare('UPDATE tenant_settings SET ai_enabled = ? WHERE id = 1').run(on ? 1 : 0); return masterOn(); }

db.exec("CREATE TABLE IF NOT EXISTS module_ai (module_slug TEXT PRIMARY KEY, features TEXT NOT NULL DEFAULT '[]')");

function get(slug) {
  const row = db.prepare('SELECT features FROM module_ai WHERE module_slug = ?').get(slug);
  let on = []; try { on = JSON.parse((row && row.features) || '[]'); } catch (e) { /* vuoto */ }
  return KEYS.filter((k) => on.includes(k));
}

function set(slug, features) {
  const on = KEYS.filter((k) => Array.isArray(features) && features.includes(k));
  db.prepare('INSERT INTO module_ai (module_slug, features) VALUES (?, ?) ON CONFLICT(module_slug) DO UPDATE SET features = excluded.features').run(slug, JSON.stringify(on));
  return on;
}

// Mancano dei ruoli per far lavorare un potenziamento su un modulo? (elenco dei ruoli mancanti)
function missing(slug, key) {
  const r = moduleRoles.get(slug);
  const have = (r && r.roles) || {};
  return FEATURES[key].needs.filter((role) => !have[role]);
}

// Il potenziamento è acceso su quel modulo E il modulo ha i ruoli che servono.
function can(slug, key) {
  return masterOn() && !!FEATURES[key] && get(slug).includes(key) && missing(slug, key).length === 0;
}

// Per un widget: con l'AI accesa è spiegabile di default; si può spegnere dal widget ("explainable": false), come ogni altra impostazione.
function widgetExplainable(widget) {
  if (!masterOn()) return false;
  let cfg = widget && widget.config; if (typeof cfg === 'string') { try { cfg = JSON.parse(cfg); } catch (e) { cfg = {}; } }
  return !!widget && !(cfg && cfg.explainable === false);
}

// Esiste un widget di quel tipo che ha acceso "spiegabile"? (per i widget che non sono di un solo modulo, come "Come sta andando")
function anyExplainableWidget(type) {
  try {
    return db.prepare('SELECT config FROM dashboard_widgets WHERE type = ?').all(type).some((w) => widgetExplainable(w));
  } catch (e) { return false; }
}

// Stato per la pagina Impostazioni → AI: i moduli che hanno dichiarato a cosa servono, con i potenziamenti accesi e quelli possibili.
function overviewModules() {
  return moduleRoles.list({}).map((m) => {
    const on = get(m.module_slug);
    return { slug: m.module_slug, name: m.name, features: KEYS.map((k) => ({ key: k, label: FEATURES[k].label, enabled: on.includes(k), missing_roles: missing(m.module_slug, k) })) };
  });
}

// "Potenzia": accende, su ogni modulo, i potenziamenti collegati che i suoi ruoli permettono. Ritorna cosa è stato acceso.
const CONNECTED = ['triage', 'explain', 'import'];
function powerUp() {
  const out = [];
  for (const m of moduleRoles.list({})) {
    const now = get(m.module_slug);
    const add = CONNECTED.filter((k) => !now.includes(k) && missing(m.module_slug, k).length === 0);
    if (!add.length) continue;
    set(m.module_slug, [...now, ...add]);
    out.push({ slug: m.module_slug, name: m.name, attivati: add });
  }
  return out;
}

module.exports = { masterOn, setMaster, overviewModules, powerUp, anyExplainableWidget, FEATURES, KEYS, get, set, missing, can, widgetExplainable };
