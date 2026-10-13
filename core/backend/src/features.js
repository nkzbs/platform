'use strict';
// Funzioni facoltative del tenant. Il nucleo è un motore generico (moduli, Builder, Libreria, record, automazioni); le funzioni qui sotto
// conoscono la finanza personale (spese, entrate, estratti conto...) e un tenant che non ne ha bisogno (es. Timbrature) non le deve
// vedere né pagare: spente, non compaiono nel menu e le loro rotte rispondono "funzione non attiva".
// Un tenant nuovo le ha tutte spente. Al primo avvio con questa tabella vuota, un tenant che ha già moduli di spese o entrate
// installati (cioè uno che le usa già) le trova accese: nessuna sorpresa per chi funziona già.
const db = require('./db');

const FEATURES = {
  whatsapp: { label: 'Notifiche WhatsApp', description: 'Destinatari e messaggi WhatsApp: avvisi e riepiloghi inviati a chi scegli. Serve il collegamento WhatsApp in Connessioni.' },
  gmail: { label: 'Mail che diventano righe', description: 'Regole su Gmail: le mail di certi mittenti diventano righe da smistare. Serve Google collegato in Connessioni.' },
  sito_web: { label: 'Sito Web', description: 'Pagine pubbliche del progetto, con il loro editor. Resta spento al pubblico finché non lo attivi dalla scheda Sito Web.' },
  movimenti: { label: 'Movimenti bancari', description: 'Carica gli estratti conto in PDF, vedi i movimenti reali e completa le spese che mancano.' },
  analisi: { label: 'Come sta andando', description: 'Scheda in dashboard con entrate, spese, risparmio, confronti e anomalie, spiegata dall\'assistente.' },
  // la chiave tecnica resta «riepilogo_mattino» (è salvata nei tenant esistenti); oggi accende i report su WhatsApp
  riepilogo_mattino: { label: 'Report', description: 'Report pianificati su WhatsApp e Telegram, configurabili: quanto pagare, righe da trattare, voci in ritardo, ore lavorate e straordinari.' },
};
const KEYS = Object.keys(FEATURES);

db.exec('CREATE TABLE IF NOT EXISTS tenant_features (key TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0)');

// Valore di partenza per una funzione senza scelta salvata: accesa solo se il progetto già la usa, altrimenti spenta. Così un progetto nuovo
// parte da zero e uno che funziona già non perde niente.
function defaultFor(key) {
  const has = (sql) => { try { return !!db.prepare(sql).get(); } catch (e) { return false; } };
  if (['movimenti', 'analisi', 'riepilogo_mattino'].includes(key)) return has('SELECT 1 FROM module_roles r JOIN modules m ON m.slug = r.module_slug WHERE m.installed = 1 AND r.kind IN (\'spesa\', \'entrata\')'); // almeno un modulo ha dichiarato di essere una spesa o un'entrata
  if (key === 'whatsapp') return has('SELECT 1 FROM whatsapp_recipients LIMIT 1') || has("SELECT 1 FROM connections WHERE integration_id = 'whatsapp_callmebot' AND connected = 1");
  if (key === 'gmail') return has('SELECT 1 FROM gmail_rules LIMIT 1');
  if (key === 'sito_web') return has('SELECT 1 FROM tenant_settings WHERE site_enabled = 1') || has('SELECT 1 FROM site_pages LIMIT 1');
  return false;
}

// All'avvio: ogni funzione senza scelta salvata riceve il suo valore di partenza (le scelte già fatte non si toccano). Ritorna le chiavi accese.
function seedIfEmpty() {
  const have = new Set(db.prepare('SELECT key FROM tenant_features').all().map((r) => r.key));
  const ins = db.prepare('INSERT INTO tenant_features (key, enabled) VALUES (?, ?)');
  const turnedOn = [];
  db.transaction(() => { for (const k of KEYS) if (!have.has(k)) { const on = defaultFor(k); ins.run(k, on ? 1 : 0); if (on) turnedOn.push(k); } })();
  return turnedOn.length > 0;
}

function isEnabled(key) {
  const r = db.prepare('SELECT enabled FROM tenant_features WHERE key = ?').get(key);
  return !!(r && r.enabled);
}

function all() {
  const rows = Object.fromEntries(db.prepare('SELECT key, enabled FROM tenant_features').all().map((r) => [r.key, !!r.enabled]));
  return Object.fromEntries(KEYS.map((k) => [k, !!rows[k]]));
}

function set(key, on) {
  if (!FEATURES[key]) return false;
  db.prepare('INSERT INTO tenant_features (key, enabled) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET enabled = excluded.enabled').run(key, on ? 1 : 0);
  return true;
}

// Middleware: la rotta risponde solo se la funzione è accesa.
const requireFeature = (key) => (req, res, next) => (isEnabled(key) ? next() : res.status(403).json({ error: 'Funzione non attiva su questo progetto', code: 'feature_off', feature: key }));

module.exports = { FEATURES, KEYS, seedIfEmpty, isEnabled, all, set, requireFeature };
