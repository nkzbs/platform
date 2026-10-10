'use strict';
// Backup settimanale via mail: ogni lunedì (dalle 08:00 ora italiana, o al primo controllo utile della settimana se il NAS era spento) manda
// all'indirizzo di NOTIFY_EMAIL_TO la copia del database del tenant, compressa e cifrata con una passphrase propria del tenant.
// Cifratura compatibile con openssl (AES-256-CBC, PBKDF2-SHA256, 10000 giri, formato "Salted__"): si riapre con un comando da Terminale,
// senza software nostro (il comando è scritto nella mail stessa). Contiene solo il database, non i file caricati.
// Acceso/spento per tenant (colonna backup_mail_weekly). Un fallimento si segnala con la stessa mail degli altri errori di backup.
const fs = require('fs');
const zlib = require('zlib');
const crypto = require('crypto');
const db = require('./db');
const { logAudit } = require('./audit-log');
const { encrypt: encryptSecret, decrypt: decryptSecret } = require('./crypto-secrets');
const { sendWeeklyBackupMail, notifyBackupResult } = require('./notifier');
const { withLock } = require('./scheduler-lock');

const MAX_ATTACHMENT_MB = 18; // Gmail rifiuta oltre 25 MB in tutto; margine per il testo e la codifica base64

function opensslEncrypt(buffer, passphrase) {
  const salt = crypto.randomBytes(8);
  const key = crypto.pbkdf2Sync(passphrase, salt, 10000, 48, 'sha256');
  const c = crypto.createCipheriv('aes-256-cbc', key.subarray(0, 32), key.subarray(32, 48));
  return Buffer.concat([Buffer.from('Salted__'), salt, c.update(buffer), c.final()]);
}

const newPassphrase = () => crypto.randomBytes(18).toString('base64url');

function getPassphrase(tenant) {
  return tenant.backup_mail_passphrase ? decryptSecret(tenant.backup_mail_passphrase) : null;
}

// Accende (creando la passphrase la prima volta) o spegne. La passphrase non si cambia da sé: cambiarla renderebbe illeggibili le mail vecchie.
function setEnabled(slug, enabled) {
  const t = db.prepare('SELECT * FROM tenants WHERE slug = ?').get(slug);
  if (!t) return null;
  if (enabled && !t.backup_mail_passphrase) db.prepare('UPDATE tenants SET backup_mail_passphrase = ? WHERE slug = ?').run(encryptSecret(newPassphrase()), slug);
  db.prepare('UPDATE tenants SET backup_mail_weekly = ? WHERE slug = ?').run(enabled ? 1 : 0, slug);
  return db.prepare('SELECT * FROM tenants WHERE slug = ?').get(slug);
}

const romeParts = (now = new Date()) => {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false, weekday: 'short' }).formatToParts(now);
  const g = (t) => p.find((x) => x.type === t).value;
  return { date: g('year') + '-' + g('month') + '-' + g('day'), hour: parseInt(g('hour'), 10) % 24, weekday: g('weekday') };
};
// Chiave della settimana (lunedì della settimana italiana): una sola mail per settimana.
function weekKey(now = new Date()) {
  const { date } = romeParts(now);
  const d = new Date(date + 'T00:00:00Z');
  const dow = (d.getUTCDay() + 6) % 7; // lunedì = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

async function sendNow(slug, { actor = 'system', now = new Date() } = {}) {
  const tenant = db.prepare('SELECT * FROM tenants WHERE slug = ?').get(slug);
  if (!tenant) return { ok: false, error: 'Tenant non trovato' };
  const pass = getPassphrase(tenant);
  if (!pass) return { ok: false, error: 'Backup via mail non attivo per questo tenant.' };
  try {
    // copia fresca se l'ultima ha più di 30 ore, altrimenti quella
    let b = db.prepare("SELECT * FROM tenant_backups WHERE tenant_slug = ? AND status = 'ok' ORDER BY created_at DESC LIMIT 1").get(slug);
    const vecchio = !b || !fs.existsSync(b.file_path) || (Date.now() - new Date(b.created_at.replace(' ', 'T') + 'Z').getTime()) > 30 * 3600 * 1000;
    if (vecchio) {
      const { runBackupForTenant } = require('./backup-scheduler');
      const r = await runBackupForTenant(slug, { trigger: 'auto', actor });
      if (!r.ok) return { ok: false, error: 'Backup non riuscito: ' + r.error };
      b = db.prepare("SELECT * FROM tenant_backups WHERE tenant_slug = ? AND status = 'ok' ORDER BY id DESC LIMIT 1").get(slug);
    }
    const raw = fs.readFileSync(b.file_path);
    const blob = opensslEncrypt(zlib.gzipSync(raw, { level: 9 }), pass);
    const sizeMb = Math.round((blob.length / 1024 / 1024) * 100) / 100;
    if (sizeMb > MAX_ATTACHMENT_MB) return { ok: false, error: 'La copia pesa ' + sizeMb + ' MB: troppo grande per una mail (limite ' + MAX_ATTACHMENT_MB + ' MB).' };
    const oggi = romeParts(now).date;
    const out = await sendWeeklyBackupMail({ tenantName: tenant.name, tenantSlug: slug, attachmentName: slug + '-' + oggi + '.db.gz.enc', attachment: blob, sizeMb, backupDate: oggi.split('-').reverse().join('/') });
    if (!out.sent) return { ok: false, error: out.reason === 'smtp_not_configured' ? 'La posta non è configurata su Super Admin.' : 'Invio non riuscito: ' + out.reason };
    db.prepare('UPDATE tenants SET backup_mail_last_sent = ? WHERE slug = ?').run(now.toISOString(), slug);
    logAudit(actor, 'tenant.backup_mail.sent', slug, { size_mb: sizeMb });
    return { ok: true, size_mb: sizeMb };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function tick(now = new Date()) {
  const { weekday, hour } = romeParts(now);
  if (weekday === 'Mon' && hour < 8) return []; // il lunedì non prima delle 8
  const key = weekKey(now);
  const out = [];
  for (const t of db.prepare("SELECT * FROM tenants WHERE status = 'active' AND backup_mail_weekly = 1").all()) {
    const last = t.backup_mail_last_sent ? weekKey(new Date(t.backup_mail_last_sent)) : null;
    if (last === key) continue;
    // Se la settimana è già iniziata e non è partita, parte al primo controllo (utile se il NAS era spento il lunedì mattina).
    const r = await sendNow(t.slug, { actor: 'scheduler', now });
    if (r.ok) { out.push({ slug: t.slug, ok: true }); continue; }
    // Errore: lo si segnala e si segna il tentativo, per non ripetere ogni 15 minuti; il prossimo è la settimana dopo (o "Invia ora").
    await notifyBackupResult({ tenantName: t.name, tenantSlug: t.slug, ok: false, error: 'Backup settimanale via mail: ' + r.error });
    db.prepare('UPDATE tenants SET backup_mail_last_sent = ? WHERE slug = ?').run(now.toISOString(), t.slug);
    out.push({ slug: t.slug, ok: false, error: r.error });
  }
  return out;
}

function startWeeklyBackupMail() {
  const guarded = withLock('backup-mail', 10 * 60 * 1000, () => tick());
  setTimeout(guarded, 2 * 60 * 1000);
  setInterval(guarded, 15 * 60 * 1000);
  console.log('Backup settimanale via mail: controllo ogni 15 minuti (spento finché non lo accendi per un tenant)');
}

module.exports = { setEnabled, sendNow, tick, weekKey, romeParts, getPassphrase, opensslEncrypt, startWeeklyBackupMail };
