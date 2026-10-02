const db = require('./db');

// Chiamata dal middleware di errore globale (index.js) per qualunque eccezione non
// gestita in una route. Non blocca mai la risposta all'utente — se il logging fallisse,
// l'errore originale viene comunque risposto al client (vedi index.js).
function logError(route, method, err) {
  try {
    db.prepare('INSERT INTO error_logs (route, method, message, stack) VALUES (?, ?, ?, ?)')
      .run(route || null, method || null, (err && err.message) || String(err), (err && err.stack) || null);
  } catch (e) {
    console.error('error-log: scrittura fallita:', e.message);
  }
}

module.exports = { logError };
