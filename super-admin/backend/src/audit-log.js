const db = require('./db');

// Chiamata da qualunque route dopo un'azione amministrativa riuscita. Non blocca mai
// il flusso principale: se il logging fallisse per qualche motivo, l'azione vera
// (creare un tenant, generare una chiave, ecc.) resta comunque valida.
function logAudit(actor, action, target, details) {
  try {
    db.prepare('INSERT INTO audit_log (actor, action, target, details) VALUES (?, ?, ?, ?)')
      .run(actor || 'system', action, target || null, details ? JSON.stringify(details) : null);
  } catch (e) {
    console.error('audit-log: scrittura fallita (azione comunque eseguita):', e.message);
  }
}

module.exports = { logAudit };
