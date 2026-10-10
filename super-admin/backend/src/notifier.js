// Notifiche via mail per eventi amministrativi (oggi: solo backup tenant completato/
// fallito). Deliberatamente "spento" finché non vengono configurate credenziali SMTP
// reali (SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/NOTIFY_EMAIL_TO) — nessuna finta email
// inviata in sviluppo, coerente col principio di onestà su cosa è reale e cosa no.
// Quando SMTP_HOST non è impostato, la funzione si limita a loggare in console e
// restituisce { sent: false, reason: 'smtp_not_configured' } — chi la chiama decide se
// segnalarlo in UI.

let transporter = null;
let nodemailer = null;
try {
  nodemailer = require('nodemailer');
} catch (e) {
  // pacchetto non installato — succede solo se qualcuno rimuove la dipendenza da
  // package.json senza rimuovere questo file; degrada allo stesso comportamento
  // di "SMTP non configurato".
}

function getTransporter() {
  if (!nodemailer || !process.env.SMTP_HOST) return null;
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    // Alcuni relay SMTP degli operatori accettano connessioni solo dalla loro
    // stessa rete (es. solo dall'IP di casa, non da un ambiente di sviluppo
    // esterno) — senza un timeout esplicito una connessione rifiutata "in
    // silenzio" (nessun RST, il pacchetto si perde) blocca la richiesta HTTP
    // che ha chiesto il backup fino al timeout del gateway nginx (504).
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 8000,
  });
  return transporter;
}

// Wrapper HTML comune per tutte le mail di notifica — un solo posto da toccare
// per lo stile, invece di stringhe HTML ripetute in ogni funzione notify*.
function wrapMailHtml({ accentColor, title, lines, footer }) {
  const rows = lines.map((l) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.5;color:#333;">${l}</p>`).join('');
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e5ea;">
<tr><td style="background:${accentColor};padding:20px 24px;">
<span style="color:#fff;font-size:17px;font-weight:600;">${title}</span>
</td></tr>
<tr><td style="padding:24px;">
${rows}
</td></tr>
<tr><td style="padding:14px 24px;background:#fafafa;border-top:1px solid #eee;">
<span style="font-size:12px;color:#999;">${footer}</span>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

async function notifyBackupResult({ tenantName, tenantSlug, ok, sizeMb, error }) {
  const to = process.env.NOTIFY_EMAIL_TO;
  const t = getTransporter();
  if (!t || !to) {
    console.log('[notifier] email non inviata (SMTP non configurato) — backup', tenantSlug, ok ? 'ok' : 'fallito');
    return { sent: false, reason: 'smtp_not_configured' };
  }
  const subject = ok
    ? `Backup completato — ${tenantName}`
    : `Backup FALLITO — ${tenantName}`;
  const text = ok
    ? `Il backup del tenant "${tenantName}" (${tenantSlug}) è stato completato con successo.\nDimensione: ${sizeMb} MB.`
    : `Il backup del tenant "${tenantName}" (${tenantSlug}) è fallito.\nErrore: ${error}`;
  const html = ok
    ? wrapMailHtml({
        accentColor: '#16a34a',
        title: `✓ Backup completato`,
        lines: [
          `Il backup del tenant <b>"${tenantName}"</b> (${tenantSlug}) è stato completato con successo.`,
          `Dimensione: <b>${sizeMb} MB</b>.`,
        ],
        footer: 'Platform Super Admin — notifica automatica',
      })
    : wrapMailHtml({
        accentColor: '#dc2626',
        title: `⚠ Backup fallito`,
        lines: [
          `Il backup del tenant <b>"${tenantName}"</b> (${tenantSlug}) è <b>fallito</b>.`,
          `Errore: <code>${error}</code>`,
        ],
        footer: 'Platform Super Admin — notifica automatica',
      });
  try {
    await t.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to, subject, text, html });
    return { sent: true };
  } catch (e) {
    console.error('[notifier] invio email fallito:', e.message);
    return { sent: false, reason: e.message };
  }
}

// G18 (2026-08-23) — solo fallimento notificato, mai un successo: stesso principio
// già in uso per il backup automatico stesso (un successo settimanale silenzioso
// per N tenant è rumore, un fallimento è l'unico caso che richiede attenzione —
// qui specificamente "la copia off-site non è davvero ripristinabile", la cosa
// peggiore da scoprire solo il giorno di un disastro vero).
async function notifyBackupVerifyFailure({ tenantName, tenantSlug, error }) {
  const to = process.env.NOTIFY_EMAIL_TO;
  const t = getTransporter();
  if (!t || !to) {
    console.log('[notifier] email non inviata (SMTP non configurato) — verifica backup off-site fallita per', tenantSlug);
    return { sent: false, reason: 'smtp_not_configured' };
  }
  const subject = `Verifica backup off-site FALLITA — ${tenantName}`;
  const text = `La verifica periodica del backup off-site del tenant "${tenantName}" (${tenantSlug}) è fallita.\nErrore: ${error}\nLa copia off-site potrebbe non essere ripristinabile in caso di disastro reale.`;
  const html = wrapMailHtml({
    accentColor: '#dc2626',
    title: '⚠ Verifica backup off-site fallita',
    lines: [
      `La verifica periodica del backup off-site del tenant <b>"${tenantName}"</b> (${tenantSlug}) è <b>fallita</b>.`,
      `Errore: <code>${error}</code>`,
      `La copia off-site potrebbe non essere ripristinabile in caso di disastro reale — verificare al più presto.`,
    ],
    footer: 'Platform Super Admin — notifica automatica',
  });
  try {
    await t.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to, subject, text, html });
    return { sent: true };
  } catch (e) {
    console.error('[notifier] invio email fallito:', e.message);
    return { sent: false, reason: e.message };
  }
}

// Avviso sul tetto di spesa AI (80% e 100%), una volta per mese e livello.
async function notifyAIBudget({ level, spentEur, budgetEur, tenantSlug }) {
  const di = tenantSlug ? ' (' + tenantSlug + ')' : '';
  const to = process.env.NOTIFY_EMAIL_TO;
  const t = getTransporter();
  if (!t || !to) {
    console.log('[notifier] email non inviata (SMTP non configurato) — tetto AI al ' + level + '%');
    return { sent: false, reason: 'smtp_not_configured' };
  }
  const reached = level >= 100;
  const subject = reached ? 'Tetto mensile AI raggiunto' + di + ': chiamate sospese' : 'Spesa AI' + di + ' all\'' + level + '% del tetto mensile';
  const text = `Spesa AI${di} del mese: ${spentEur.toFixed(2)} € su ${budgetEur.toFixed(2)} € (${level}%).` + (reached ? '\nLe nuove chiamate sono sospese fino al mese prossimo.' : '');
  const html = wrapMailHtml({
    accentColor: reached ? '#dc2626' : '#d97706',
    title: reached ? 'Tetto mensile AI raggiunto' : 'Spesa AI all\'' + level + '% del tetto',
    lines: [
      `Spesa AI del mese: <b>${spentEur.toFixed(2)} €</b> su ${budgetEur.toFixed(2)} € (${level}%).`,
      reached ? 'Le nuove chiamate sono <b>sospese</b> fino al mese prossimo.' : 'Raggiunto il tetto, le chiamate si fermano da sole.',
    ],
    footer: 'Platform Super Admin — notifica automatica',
  });
  try {
    await t.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to, subject, text, html });
    return { sent: true };
  } catch (e) {
    console.error('[notifier] invio email fallito:', e.message);
    return { sent: false, reason: e.message };
  }
}

// Mail settimanale con la copia cifrata del database di un tenant in allegato (vedi weekly-backup-mail.js).
async function sendWeeklyBackupMail({ tenantName, tenantSlug, attachmentName, attachment, sizeMb, backupDate }) {
  const to = process.env.NOTIFY_EMAIL_TO;
  const t = getTransporter();
  if (!t || !to) return { sent: false, reason: 'smtp_not_configured' };
  const subject = 'Backup settimanale ' + tenantName + ' — ' + backupDate;
  const comando = 'openssl enc -d -aes-256-cbc -pbkdf2 -in ' + attachmentName + ' -out ' + tenantSlug + '.db.gz && gunzip ' + tenantSlug + '.db.gz';
  const text = 'In allegato la copia del database di "' + tenantName + '" del ' + backupDate + ' (' + sizeMb + ' MB, compressa e cifrata).\n\n'
    + 'Per riaprirla serve la passphrase (Super Admin → Tenant → Backup → "Mostra passphrase"). Poi, da Terminale:\n' + comando + '\n\n'
    + 'Contiene solo il database, NON i file caricati (documenti, PDF, foto).';
  const html = wrapMailHtml({
    accentColor: '#2563eb',
    title: 'Backup settimanale — ' + tenantName,
    lines: [
      'In allegato la copia del database di <b>' + tenantName + '</b> del ' + backupDate + ' (' + sizeMb + ' MB, compressa e cifrata).',
      'Per riaprirla serve la <b>passphrase</b> (Super Admin → Tenant → Backup → «Mostra passphrase»). Poi, da Terminale:<br><code style="font-size:12px;word-break:break-all;">' + comando + '</code>',
      'Contiene solo il database, <b>non</b> i file caricati (documenti, PDF, foto).',
    ],
    footer: 'Platform Super Admin — backup settimanale',
  });
  try {
    await t.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to, subject, text, html, attachments: [{ filename: attachmentName, content: attachment }] });
    return { sent: true };
  } catch (e) {
    console.error('[notifier] invio backup settimanale fallito:', e.message);
    return { sent: false, reason: e.message };
  }
}

module.exports = { notifyBackupResult, notifyBackupVerifyFailure, notifyAIBudget, sendWeeklyBackupMail };
