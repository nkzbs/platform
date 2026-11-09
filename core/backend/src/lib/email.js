'use strict';
// Invio email generico: SMTP classico (connessione "email_smtp", via nodemailer) oppure Resend (connessione
// "email_resend"). Se sono collegati entrambi vince l'SMTP; se non c'è né l'uno né l'altro nessun invio finto:
// chi chiama riceve { ok:false, motivo } e decide come comunicarlo (qui mai bloccante — lo stato del record
// resta comunque coerente). Le stesse credenziali servono ai documenti ai clienti (records.js), ai messaggi
// ai clienti (messaggi-clienti.js) e al modulo di contatto del Sito Web (routes/site.js).
const db = require('../db');

function leggi(id) {
  const row = db.prepare('SELECT credentials, connected FROM connections WHERE integration_id = ?').get(id);
  if (!row || !row.credentials) return null;
  return { creds: require('../secrets-at-rest').unseal(row.credentials), connected: !!row.connected };
}
// Credenziali di Resend (nome storico, usato anche dai test).
function credenziali() { const r = leggi('email_resend'); return r ? r.creds : null; }
// Impostazioni SMTP complete e collegate, oppure null.
function smtp() {
  const r = leggi('email_smtp');
  if (!r || !r.connected || !r.creds || !r.creds.host || !r.creds.from_email) return null;
  const porta = parseInt(r.creds.port, 10) || 587;
  const cifratura = ['ssl', 'starttls', 'nessuna'].includes(r.creds.cifratura) ? r.creds.cifratura : (porta === 465 ? 'ssl' : 'starttls');
  return { host: String(r.creds.host).trim(), porta, cifratura, utente: r.creds.user || '', password: r.creds.pass || '', da: String(r.creds.from_email).trim(), nome: String(r.creds.from_name || '').trim() };
}
// Quale canale parte adesso: { ok, via: 'smtp'|'resend'|null, motivo }
function stato() {
  if (smtp()) return { ok: true, via: 'smtp', motivo: null };
  const c = credenziali();
  if (c && c.api_key && c.from_email) return { ok: true, via: 'resend', motivo: null };
  return { ok: false, via: null, motivo: 'La mail non è configurata (Impostazioni → Connessioni → Posta in uscita).' };
}

async function inviaSmtp(c, { to, subject, html }) {
  try {
    const t = require('nodemailer').createTransport({
      host: c.host, port: c.porta, secure: c.cifratura === 'ssl', requireTLS: c.cifratura === 'starttls', ignoreTLS: c.cifratura === 'nessuna',
      auth: c.utente ? { user: c.utente, pass: c.password } : undefined, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
    });
    await t.sendMail({ from: c.nome ? { name: c.nome, address: c.da } : c.da, to, subject, html });
    return { ok: true, via: 'smtp' };
  } catch (e) {
    return { ok: false, via: 'smtp', motivo: 'Il server di posta ha risposto: ' + (e.response || e.message) };
  }
}

async function invia({ to, subject, html }) {
  if (!to) return { ok: false, motivo: 'destinatario mancante' };
  const c = smtp();
  if (c) return inviaSmtp(c, { to, subject, html });
  const creds = credenziali();
  if (!creds || !creds.api_key || !creds.from_email) return { ok: false, motivo: 'email non configurata (Impostazioni → Connessioni → Posta in uscita)' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + creds.api_key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: creds.from_email, to: [to], subject, html }),
      signal: controller.signal,
    });
    return res.ok ? { ok: true, via: 'resend' } : { ok: false, motivo: 'Resend ha risposto ' + res.status };
  } catch (e) {
    return { ok: false, motivo: e.message };
  } finally {
    clearTimeout(timer);
  }
}

// Testo semplice -> HTML minimale per il corpo di un'email (indentazione/a-capo preservati,
// nessun markup): condiviso da tutti i documenti da modello (routes/records.js, blocco `document_action`).
function htmlDaTesto(testo) {
  const righe = String(testo || '').split('\n').map((r) => r.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
  return '<div style="font-family:system-ui,-apple-system,sans-serif;color:#1c1917;white-space:pre-wrap;line-height:1.6;max-width:640px">' + righe.join('<br>') + '</div>';
}

module.exports = { invia, htmlDaTesto, credenziali, smtp, stato };
