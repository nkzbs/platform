'use strict';
// Backup settimanale via mail (weekly-backup-mail.js): la copia cifrata si riapre DAVVERO con il comando openssl scritto nella mail,
// una sola mail a settimana, non prima di lunedì 08:00 ora italiana, e un errore non si ripete ogni 15 minuti.
// Eseguire con: node src/weekly-backup-mail.test.js

const path = require('path');
const os = require('os');
const fs = require('fs');
const zlib = require('zlib');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wbm-'));
process.env.DB_PATH = path.join(tmp, 'sa.db');
process.env.SMTP_HOST = 'smtp.test'; process.env.NOTIFY_EMAIL_TO = 'a@test.it';

let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); console.log('  ✓ ' + name); passed++; } catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; } }
const eq = (a, e, m) => { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${m || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); };

// niente posta vera: si intercetta l'invio e si guarda cosa partirebbe
const sent = [];
const notifier = require('./notifier');
let smtpOk = true;
notifier.sendWeeklyBackupMail = async (m) => { if (!smtpOk) return { sent: false, reason: 'smtp giù' }; sent.push(m); return { sent: true }; };
const failMails = [];
notifier.notifyBackupResult = async (m) => { failMails.push(m); return { sent: true }; };

const db = require('./db');
const wbm = require('./weekly-backup-mail');

async function main() {
  // un tenant con un file di backup reale già pronto
  const dbFile = path.join(tmp, 'finance.db');
  fs.writeFileSync(dbFile, Buffer.concat([Buffer.from('SQLite format 3\0'), crypto.randomBytes(5000)]));
  db.prepare("INSERT INTO tenants (name, slug, port, status, db_path) VALUES ('Finance', 'finance', 4002, 'active', ?)").run(dbFile);
  db.prepare("INSERT INTO tenant_backups (tenant_slug, file_path, size_mb, status, trigger) VALUES ('finance', ?, 0.01, 'ok', 'auto')").run(dbFile);

  console.log('\n--- cifratura ---');
  await test('la copia cifrata si riapre con il comando openssl della mail e torna identica', async () => {
    const orig = crypto.randomBytes(20000);
    const pass = 'frase-di-prova-Abc123';
    const enc = wbm.opensslEncrypt(zlib.gzipSync(orig), pass);
    eq(enc.subarray(0, 8).toString(), 'Salted__');
    const f = path.join(tmp, 'x.db.gz.enc'); fs.writeFileSync(f, enc);
    const out = path.join(tmp, 'x.db.gz');
    execFileSync('openssl', ['enc', '-d', '-aes-256-cbc', '-pbkdf2', '-in', f, '-out', out, '-pass', 'pass:' + pass]);
    eq(zlib.gunzipSync(fs.readFileSync(out)).equals(orig), true, 'contenuto identico');
  });
  await test('con la passphrase sbagliata non si apre', async () => {
    const enc = wbm.opensslEncrypt(Buffer.from('segreto'), 'giusta'); const f = path.join(tmp, 'y.enc'); fs.writeFileSync(f, enc);
    let fallito = false;
    try { execFileSync('openssl', ['enc', '-d', '-aes-256-cbc', '-pbkdf2', '-in', f, '-out', path.join(tmp, 'y.out'), '-pass', 'pass:sbagliata'], { stdio: 'pipe' }); } catch (e) { fallito = true; }
    eq(fallito, true);
  });

  console.log('\n--- accensione e passphrase ---');
  await test('spento di default; acceso crea una passphrase (cifrata a riposo) che non cambia riaccendendo', async () => {
    eq(db.prepare("SELECT backup_mail_weekly w FROM tenants WHERE slug='finance'").get().w, 0);
    const t = wbm.setEnabled('finance', true); eq(t.backup_mail_weekly, 1);
    const p1 = wbm.getPassphrase(t); eq(typeof p1, 'string'); eq(p1.length >= 20, true);
    eq(t.backup_mail_passphrase.startsWith('enc:'), true, 'a riposo è cifrata');
    wbm.setEnabled('finance', false); const t2 = wbm.setEnabled('finance', true);
    eq(wbm.getPassphrase(t2), p1, 'stessa passphrase: le mail vecchie restano leggibili');
  });

  console.log('\n--- quando parte ---');
  const lun = (h) => new Date(Date.UTC(2026, 9, 12, h - 2, 5)); // lunedì 12/10/2026 h:05 ora italiana (CEST = UTC+2)
  await test('weekKey è il lunedì della settimana italiana', async () => {
    eq(wbm.weekKey(new Date(Date.UTC(2026, 9, 12, 9, 0))), '2026-10-12');
    eq(wbm.weekKey(new Date(Date.UTC(2026, 9, 18, 20, 0))), '2026-10-12', 'domenica sera');
    eq(wbm.weekKey(new Date(Date.UTC(2026, 9, 19, 9, 0))), '2026-10-19');
  });
  await test('il lunedì prima delle 08:00 non parte niente', async () => { sent.length = 0; await wbm.tick(lun(7)); eq(sent.length, 0); });
  await test('il lunedì alle 08:05 parte una mail con un allegato cifrato che si riapre', async () => {
    sent.length = 0; await wbm.tick(lun(8));
    eq(sent.length, 1); eq(sent[0].tenantSlug, 'finance'); eq(/^finance-\d{4}-\d{2}-\d{2}\.db\.gz\.enc$/.test(sent[0].attachmentName), true);
    const f = path.join(tmp, 'z.enc'); fs.writeFileSync(f, sent[0].attachment);
    execFileSync('openssl', ['enc', '-d', '-aes-256-cbc', '-pbkdf2', '-in', f, '-out', path.join(tmp, 'z.gz'), '-pass', 'pass:' + wbm.getPassphrase(db.prepare("SELECT * FROM tenants WHERE slug='finance'").get())]);
    eq(zlib.gunzipSync(fs.readFileSync(path.join(tmp, 'z.gz'))).equals(fs.readFileSync(dbFile)), true, 'è il database');
  });
  await test('nella stessa settimana non ne parte una seconda, la settimana dopo sì', async () => {
    sent.length = 0;
    await wbm.tick(new Date(Date.UTC(2026, 9, 14, 12, 0))); eq(sent.length, 0, 'mercoledì stessa settimana');
    await wbm.tick(new Date(Date.UTC(2026, 9, 19, 8, 0))); eq(sent.length, 1, 'lunedì dopo');
  });
  await test('se il NAS era spento il lunedì, parte al primo controllo utile della settimana', async () => {
    db.prepare("UPDATE tenants SET backup_mail_last_sent = NULL WHERE slug='finance'").run();
    sent.length = 0; await wbm.tick(new Date(Date.UTC(2026, 9, 21, 9, 0))); eq(sent.length, 1, 'martedì');
  });
  await test('un errore di invio avvisa una volta e non si ripete ogni 15 minuti', async () => {
    db.prepare("UPDATE tenants SET backup_mail_last_sent = NULL WHERE slug='finance'").run();
    smtpOk = false; failMails.length = 0;
    await wbm.tick(new Date(Date.UTC(2026, 9, 26, 8, 0))); await wbm.tick(new Date(Date.UTC(2026, 9, 26, 8, 15))); await wbm.tick(new Date(Date.UTC(2026, 9, 26, 8, 30)));
    eq(failMails.length, 1); smtpOk = true;
  });
  await test('un tenant con il backup via mail spento non riceve niente', async () => {
    wbm.setEnabled('finance', false); sent.length = 0;
    await wbm.tick(new Date(Date.UTC(2026, 10, 2, 9, 0))); eq(sent.length, 0);
  });

  console.log(`\n${'='.repeat(60)}\n${passed} passati, ${failed} falliti su ${passed + failed} test.`);
  process.exit(failed > 0 ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
