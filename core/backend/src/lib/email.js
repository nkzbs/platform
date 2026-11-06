'use strict';
// Invio email generico via il connettore "email_resend" — stesse credenziali già in uso per
// il form di contatto del Sito Web (routes/site.js: sendLeadEmail), estratte qui perché un
// secondo punto del prodotto (documenti clienti: records.js) ne ha bisogno adesso. Nessun
// invio finto se non configurato: chi chiama riceve { ok:false, motivo } e decide come
// comunicarlo (qui mai bloccante — lo stato del record resta comunque coerente).
const db = require('../db');

function credenziali() {
  const row = db.prepare("SELECT credentials FROM connections WHERE integration_id = 'email_resend'").get();
  if (!row || !row.credentials) return null;
  return require('../secrets-at-rest').unseal(row.credentials);
}

async function invia({ to, subject, html }) {
  const creds = credenziali();
  if (!creds || !creds.api_key || !creds.from_email) return { ok: false, motivo: 'email non configurata (connessione email_resend mancante — Impostazioni → Connessioni)' };
  if (!to) return { ok: false, motivo: 'destinatario mancante' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + creds.api_key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: creds.from_email, to: [to], subject, html }),
      signal: controller.signal,
    });
    return res.ok ? { ok: true } : { ok: false, motivo: 'Resend ha risposto ' + res.status };
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

module.exports = { invia, htmlDaTesto };
