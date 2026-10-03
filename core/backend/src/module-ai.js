'use strict';
// Potenziamenti AI per modulo: ogni modulo accende da solo quelli che vuole (smistare, spiegare, importare). Senza interruttore acceso
// un modulo non ha AI. Questo è l'unico punto che dice se un potenziamento è attivo su un modulo: le funzioni AI chiedono qui,
// non conoscono nomi di moduli. Per ora si salvano solo gli interruttori; i potenziamenti si collegano uno alla volta.
const db = require('./db');
const moduleRoles = require('./module-roles');

// Cosa serve a ogni potenziamento: ruoli che il modulo deve avere dichiarato (module-roles.js).
const FEATURES = {
  triage: { label: 'Smistare', description: 'Propone categoria, importo e scadenza per le righe da smistare.', needs: ['importo', 'categoria', 'stato'] },
  explain: { label: 'Spiegare', description: 'Racconta i numeri del modulo (totali, confronti, anomalie).', needs: ['importo', 'data'] },
  import: { label: 'Importare', description: 'Legge allegati e PDF e propone le righe da creare.', needs: ['importo', 'data'] },
};
const KEYS = Object.keys(FEATURES);

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
  return !!FEATURES[key] && get(slug).includes(key) && missing(slug, key).length === 0;
}

// Per un widget: lo decide la sua configurazione ("explainable"), come ogni altra impostazione del widget.
function widgetExplainable(widget) {
  let cfg = widget && widget.config; if (typeof cfg === 'string') { try { cfg = JSON.parse(cfg); } catch (e) { cfg = {}; } }
  return !!(cfg && cfg.explainable);
}

module.exports = { FEATURES, KEYS, get, set, missing, can, widgetExplainable };
