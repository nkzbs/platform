const db = require('./db');
const { withLock } = require('./scheduler-lock');

// P3 (collaudo operativo 2026-09-03) — audit_log ed error_logs non avevano MAI avuto
// una retention: crescono per sempre, nessun bug oggi (le tabelle sono indicizzate su
// created_at, vedi db.js) ma un problema misurabile solo in futuro, non urgente ora.
// RETENTION_DAYS deliberatamente generoso (1 anno) — è un log di sicurezza/audit
// amministrativo (chi ha fatto cosa), non dati applicativi: meglio tenerne di più che
// perdere una traccia che potrebbe servire per un'indagine tardiva. Regolabile qui,
// nessuna configurazione per-tenant (a differenza della retention backup, che è
// deliberatamente per-tenant — questo è un unico log platform-wide).
const RETENTION_DAYS = 365;

// Esportata a sé (non solo chiusa dentro lo scheduler) per essere testabile senza
// dover aspettare un vero tick — stesso principio di reconcileOne in
// tenant-status-reconciler.js.
function purgeOldLogs() {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400000).toISOString();
  const auditDeleted = db.prepare('DELETE FROM audit_log WHERE created_at < ?').run(cutoff).changes;
  const errorDeleted = db.prepare('DELETE FROM error_logs WHERE created_at < ?').run(cutoff).changes;
  if (auditDeleted > 0 || errorDeleted > 0) {
    console.log('audit-retention-scheduler: ' + auditDeleted + ' righe audit_log e ' + errorDeleted + ' righe error_logs oltre ' + RETENTION_DAYS + ' giorni rimosse');
  }
  return { auditDeleted, errorDeleted };
}

function startAuditRetentionScheduler() {
  const INTERVAL_MS = 24 * 60 * 60 * 1000; // una volta al giorno, stesso ritmo di client-tasks-scheduler

  function tick() {
    try { purgeOldLogs(); }
    catch (e) { console.error('audit-retention-scheduler fallito:', e.message); }
  }

  const guardedTick = withLock('audit-retention', 5 * 60 * 1000, tick);
  setTimeout(guardedTick, 200 * 1000); // dopo gli altri scheduler all'avvio, stesso principio di scaglionamento
  setInterval(guardedTick, INTERVAL_MS);
  console.log('Retention audit log avviata — controllo una volta al giorno, soglia ' + RETENTION_DAYS + ' giorni');
}

module.exports = { startAuditRetentionScheduler, purgeOldLogs, RETENTION_DAYS };
