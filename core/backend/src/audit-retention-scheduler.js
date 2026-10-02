const db = require('./db');
const { withLock } = require('./scheduler-lock');

// P3 (collaudo operativo 2026-09-03) — stesso gap chiuso in parallelo su
// super-admin/backend/src/audit-retention-scheduler.js: audit_log ed error_logs di
// QUESTO tenant non avevano mai una retention, crescono per sempre. Stessa soglia
// generosa (1 anno) e stesso principio — log di sicurezza/audit, non dati applicativi.
const RETENTION_DAYS = 365;

function startAuditRetentionScheduler() {
  const INTERVAL_MS = 24 * 60 * 60 * 1000;

  function tick() {
    try {
      const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400000).toISOString();
      const auditDeleted = db.prepare('DELETE FROM audit_log WHERE created_at < ?').run(cutoff).changes;
      const errorDeleted = db.prepare('DELETE FROM error_logs WHERE created_at < ?').run(cutoff).changes;
      if (auditDeleted > 0 || errorDeleted > 0) {
        console.log('audit-retention-scheduler: ' + auditDeleted + ' righe audit_log e ' + errorDeleted + ' righe error_logs oltre ' + RETENTION_DAYS + ' giorni rimosse');
      }
    } catch (e) {
      console.error('audit-retention-scheduler fallito:', e.message);
    }
  }

  const guardedTick = withLock('audit-retention', 5 * 60 * 1000, tick);
  setTimeout(guardedTick, 200 * 1000);
  setInterval(guardedTick, INTERVAL_MS);
  console.log('Retention audit log avviata — controllo una volta al giorno, soglia ' + RETENTION_DAYS + ' giorni');
}

module.exports = { startAuditRetentionScheduler };
