const db = require('./db');

// Stessa filosofia dell'audit log del Super Admin: mai bloccante, mai modificabile
// da UI. actor è lo username di chi ha fatto l'azione (req.user.username).
function logAudit(actor, action, target, details) {
  try {
    db.prepare('INSERT INTO audit_log (actor, action, target, details) VALUES (?, ?, ?, ?)')
      .run(actor || 'system', action, target || null, details ? JSON.stringify(details) : null);
  } catch (e) {
    console.error('audit-log: scrittura fallita (azione comunque eseguita):', e.message);
  }
}

module.exports = { logAudit };
