'use strict';
// Funzioni facoltative del tenant. Il nucleo è un motore generico (moduli, Builder, Libreria, record, automazioni); le funzioni qui sotto
// conoscono la finanza personale (spese, entrate, estratti conto...) e un tenant che non ne ha bisogno (es. Timbrature) non le deve
// vedere né pagare: spente, non compaiono nel menu e le loro rotte rispondono "funzione non attiva".
// Un tenant nuovo le ha tutte spente. Al primo avvio con questa tabella vuota, un tenant che ha già moduli di spese o entrate
// installati (cioè uno che le usa già) le trova accese: nessuna sorpresa per chi funziona già.
const db = require('./db');

const FEATURES = {
  movimenti: { label: 'Movimenti bancari', description: 'Carica gli estratti conto in PDF, vedi i movimenti reali e completa le spese che mancano.' },
  analisi: { label: 'Come sta andando', description: 'Scheda in dashboard con entrate, spese, risparmio, confronti e anomalie, spiegata dall\'assistente.' },
  bollette_ai: { label: 'Smistamento bollette con l\'assistente', description: 'Propone categoria, importo e scadenza per le bollette in arrivo da Gmail.' },
  riepilogo_mattino: { label: 'Riepilogo del mattino', description: 'Un messaggio WhatsApp al giorno con le spese di oggi, domani e in ritardo.' },
};
const KEYS = Object.keys(FEATURES);

db.exec('CREATE TABLE IF NOT EXISTS tenant_features (key TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0)');

// Prima inizializzazione: tabella vuota -> accese per chi ha già moduli di finanza installati, spente per gli altri.
function seedIfEmpty() {
  if (db.prepare('SELECT COUNT(*) c FROM tenant_features').get().c > 0) return false;
  const usesFinance = !!db.prepare("SELECT 1 FROM modules WHERE installed = 1 AND slug IN ('spese_personali', 'spese_casa', 'entrate')").get();
  const ins = db.prepare('INSERT INTO tenant_features (key, enabled) VALUES (?, ?)');
  db.transaction(() => { for (const k of KEYS) ins.run(k, usesFinance ? 1 : 0); })();
  return usesFinance;
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
