const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const db = require('./db');
const { logAudit } = require('./audit-log');
const { notifyBackupResult } = require('./notifier');
const { copyBackupOffsite } = require('./offsite-backup');
const { withLock } = require('./scheduler-lock');

// Logica di backup condivisa — usata da:
//   1. POST /:slug/backup (tasto manuale in UI)
//   2. lo scheduler automatico qui sotto
//   3. il backup di sicurezza prima di eliminare un tenant (DELETE /:slug in tenants.js)
// Centralizzata qui per evitare che le tre strade divergano nel tempo (stesso principio
// già applicato altrove nel progetto: un solo motore, non tre copie leggermente diverse).
async function runBackupForTenant(slug, { trigger = 'manual', actor = 'system' } = {}) {
  const tenant = db.prepare('SELECT * FROM tenants WHERE slug = ?').get(slug);
  if (!tenant) return { ok: false, error: 'Tenant non trovato' };

  const dir = '/data/backups/' + slug;
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destPath = path.join(dir, slug + '_' + trigger + '_' + stamp + '.db');

  try {
    const src = new Database(tenant.db_path, { readonly: true, timeout: 5000 });
    src.exec("VACUUM INTO '" + destPath.replace(/'/g, "''") + "'");
    src.close();
    const st = fs.statSync(destPath);
    const sizeMb = Math.round((st.size / 1024 / 1024) * 100) / 100;

    const backupRow = db.prepare('INSERT INTO tenant_backups (tenant_slug, file_path, size_mb, status, trigger) VALUES (?, ?, ?, ?, ?)')
      .run(slug, destPath, sizeMb, 'ok', trigger);
    logAudit(actor, 'tenant.backup', slug, { file: destPath, size_mb: sizeMb, trigger });

    // G18 — copia off-site, SOLO se questo tenant ha una destinazione configurata
    // (backup_offsite_url). Mai bloccante sul risultato del backup locale, già
    // scritto con successo qui sopra: un fallimento off-site aggiorna solo le
    // colonne offsite_* della stessa riga, non tocca 'status'/non fa fallire
    // questa funzione. Stesso log del backup locale (vedi commento sulle colonne
    // in db.js), non un sistema di tracciamento parallelo.
    const offsiteResult = await copyBackupOffsite(tenant, destPath, path.basename(destPath));
    if (!offsiteResult.skipped) {
      db.prepare('UPDATE tenant_backups SET offsite_status = ?, offsite_synced_at = ?, offsite_error = ? WHERE id = ?')
        .run(offsiteResult.ok ? 'ok' : 'error', offsiteResult.ok ? new Date().toISOString() : null, offsiteResult.ok ? null : offsiteResult.error, backupRow.lastInsertRowid);
      if (!offsiteResult.ok) logAudit(actor, 'tenant.backup.offsite_error', slug, { error: offsiteResult.error });
    }

    if (trigger === 'auto') applyRetention(slug, tenant.backup_auto_retention || 7);

    // Email di successo SOLO per backup non automatici (manuale dal tasto in UI, o di
    // sicurezza prima di un delete/restore) — chi l'ha chiesto esplicitamente vuole la
    // conferma. Un backup automatico riuscito ogni notte per 5 tenant è invece rumore
    // puro (lamentela reale: ogni backup, anche dev, mandava un'email) — silenzioso se
    // va bene, un fallimento resta SEMPRE notificato qui sotto indipendentemente dal
    // trigger, perché quello è l'unico caso che richiede davvero attenzione.
    const notify = trigger === 'auto' ? { sent: false, reason: 'auto_success_silenzioso' } : await notifyBackupResult({ tenantName: tenant.name, tenantSlug: slug, ok: true, sizeMb });
    return { ok: true, file: destPath, size_mb: sizeMb, email: notify };
  } catch (err) {
    db.prepare('INSERT INTO tenant_backups (tenant_slug, file_path, size_mb, status, trigger) VALUES (?, ?, ?, ?, ?)')
      .run(slug, destPath, null, 'error', trigger);
    logAudit(actor, 'tenant.backup', slug, { error: err.message, trigger });
    const notify = await notifyBackupResult({ tenantName: tenant.name, tenantSlug: slug, ok: false, error: err.message });
    return { ok: false, error: err.message, email: notify };
  }
}

// Tiene solo gli ultimi N backup con trigger='auto' per un tenant, elimina i più vecchi
// (file + riga). Non tocca MAI backup manuali, pre-delete o pre-restore — quelli restano
// finché qualcuno non li cancella a mano, sono reti di sicurezza deliberate, non rumore.
function applyRetention(slug, keep) {
  const autoBackups = db.prepare(
    "SELECT * FROM tenant_backups WHERE tenant_slug = ? AND trigger = 'auto' AND status = 'ok' ORDER BY created_at DESC"
  ).all(slug);
  const toDelete = autoBackups.slice(keep);
  for (const b of toDelete) {
    try { fs.unlinkSync(b.file_path); } catch (e) {} // file già assente: va bene così
    db.prepare('DELETE FROM tenant_backups WHERE id = ?').run(b.id);
  }
}

// Scheduler: ogni 15 minuti controlla tutti i tenant attivi con backup_auto_enabled=1 e
// lancia un backup se è passato almeno backup_auto_frequency_hours dall'ultimo backup
// automatico riuscito (o se non ne esiste ancora nessuno). Intervallo di controllo breve
// (15 min) ma frequenza di backup lunga (default 24h) — così un riavvio del container non
// sposta di molto l'orario reale dei backup, e un tenant creato a metà giornata riceve
// comunque il suo primo backup entro poco, non aspetta la mezzanotte.
function startBackupScheduler() {
  const CHECK_INTERVAL_MS = 15 * 60 * 1000;

  async function tick() {
    const tenants = db.prepare(
      "SELECT * FROM tenants WHERE status = 'active' AND backup_auto_enabled = 1"
    ).all();

    for (const tenant of tenants) {
      const freqHours = tenant.backup_auto_frequency_hours || 24;
      const last = db.prepare(
        "SELECT * FROM tenant_backups WHERE tenant_slug = ? AND trigger = 'auto' AND status = 'ok' ORDER BY created_at DESC LIMIT 1"
      ).get(tenant.slug);

      const dueForBackup = !last || (Date.now() - new Date(last.created_at).getTime()) >= freqHours * 60 * 60 * 1000;
      if (dueForBackup) {
        await runBackupForTenant(tenant.slug, { trigger: 'auto', actor: 'scheduler' });
      }
    }
  }

  // G14 — lock distribuito (no-op senza Redis), TTL 10 min: un backup reale di
  // più tenant può richiedere qualche minuto, margine comunque sotto i 15 min
  // tra un tick e il successivo.
  const guardedTick = withLock('backup', 10 * 60 * 1000, tick);
  // Primo giro poco dopo l'avvio (non subito, dà tempo al Docker socket/volume di essere
  // pronto), poi ogni CHECK_INTERVAL_MS.
  setTimeout(guardedTick, 60 * 1000);
  setInterval(guardedTick, CHECK_INTERVAL_MS);
  console.log('Backup scheduler avviato — controllo ogni 15 minuti, frequenza per-tenant configurabile');
}

module.exports = { runBackupForTenant, applyRetention, startBackupScheduler };
