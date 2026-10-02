const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const db = require('./db');
const { logAudit } = require('./audit-log');
const { notifyBackupVerifyFailure } = require('./notifier');
const { resolveFileDestination } = require('./offsite-backup');
const { withLock } = require('./scheduler-lock');

// G18 (PLATFORM-0.6-GAP-ANALYSIS.md, 2026-08-23) — "un backup esiste" e "un backup
// è davvero ripristinabile" non sono la stessa cosa: questo modulo verifica
// periodicamente la SECONDA, sulla copia OFF-SITE (non quella locale sullo stesso
// NAS di produzione — in un disastro reale è quella locale che sparisce insieme
// ai container, la copia off-site è l'unica che conta davvero). MAI tocca il
// tenant reale: nessuna chiamata a POST /:slug/restore/:backupId, nessuna
// scrittura sul suo db_path — solo una copia temporanea del file off-site,
// aperta in sola lettura, poi cancellata.

// Ricostruisce dove copyBackupOffsite ha scritto il file, senza salvare un
// percorso separato nel DB (stesso nome file del backup locale, root dedotta
// dallo stesso URL — un solo posto che sa come calcolarlo, offsite-backup.js).
function offsitePathFor(tenant, backup) {
  if (!tenant.backup_offsite_url) return null;
  let url;
  try {
    url = new URL(tenant.backup_offsite_url);
  } catch (e) {
    return null;
  }
  if (url.protocol !== 'file:') return null; // solo file:// verificabile oggi, stesso limite di copyBackupOffsite
  try {
    const destDir = resolveFileDestination(url);
    return path.join(destDir, path.basename(backup.file_path));
  } catch (e) {
    return null;
  }
}

// Copia in un file temporaneo (mai apre l'originale in scrittura, mai lo tocca),
// verifica integrità SQLite + una query reale su una tabella che deve sempre
// esistere in un vero .db di tenant — un file vuoto/troncato passerebbe
// PRAGMA integrity_check ma fallirebbe qui.
function verifyBackupFile(filePath) {
  const tmpPath = path.join(os.tmpdir(), 'backup-verify-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.db');
  fs.copyFileSync(filePath, tmpPath);
  try {
    const testDb = new Database(tmpPath, { readonly: true, fileMustExist: true });
    try {
      const integrity = testDb.prepare('PRAGMA integrity_check').get();
      if (!integrity || integrity.integrity_check !== 'ok') {
        return { ok: false, error: 'integrity_check: ' + (integrity && integrity.integrity_check) };
      }
      testDb.prepare('SELECT COUNT(*) as n FROM modules').get();
      return { ok: true };
    } finally {
      testDb.close();
    }
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    try { fs.unlinkSync(tmpPath); } catch (e) {} // già assente: va bene così
  }
}

async function verifyOffsiteBackups() {
  const tenants = db.prepare("SELECT * FROM tenants WHERE backup_offsite_url IS NOT NULL AND status != 'deleted'").all();
  const results = [];
  for (const tenant of tenants) {
    // Solo l'ultimo backup sincronizzato con successo — verificare ogni riga
    // storica ad ogni giro sarebbe lavoro crescente senza un beneficio in più:
    // se l'ultimo è ripristinabile, il meccanismo funziona.
    const backup = db.prepare(
      "SELECT * FROM tenant_backups WHERE tenant_slug = ? AND status = 'ok' AND offsite_status = 'ok' ORDER BY created_at DESC LIMIT 1"
    ).get(tenant.slug);
    if (!backup) continue;

    const offsitePath = offsitePathFor(tenant, backup);
    const result = (offsitePath && fs.existsSync(offsitePath))
      ? verifyBackupFile(offsitePath)
      : { ok: false, error: 'File off-site non trovato al percorso atteso' };

    db.prepare('UPDATE tenant_backups SET verify_status = ?, verify_checked_at = ?, verify_error = ? WHERE id = ?')
      .run(result.ok ? 'ok' : 'error', new Date().toISOString(), result.ok ? null : result.error, backup.id);

    if (!result.ok) {
      logAudit('scheduler', 'tenant.backup.verify_error', tenant.slug, { backup_id: backup.id, error: result.error });
      await notifyBackupVerifyFailure({ tenantName: tenant.name, tenantSlug: tenant.slug, error: result.error });
    }
    results.push({ slug: tenant.slug, backup_id: backup.id, ok: result.ok });
  }
  return results;
}

// Cadenza settimanale, non 15 minuti come il backup stesso: questo verifica
// l'integrità STRUTTURALE di una copia già sincronizzata, non un segnale
// operativo che serve sapere entro pochi minuti — un giro a settimana basta a
// scoprire un problema molto prima del giorno di un disastro reale.
function startBackupVerifyScheduler() {
  const CHECK_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
  const guardedTick = withLock('backup-verify', 30 * 60 * 1000, verifyOffsiteBackups);
  setTimeout(guardedTick, 2 * 60 * 1000);
  setInterval(guardedTick, CHECK_INTERVAL_MS);
  console.log('Backup verify scheduler avviato — verifica settimanale che la copia off-site sia davvero ripristinabile');
}

module.exports = { verifyOffsiteBackups, startBackupVerifyScheduler };
