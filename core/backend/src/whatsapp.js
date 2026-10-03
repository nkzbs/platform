'use strict';
// Invio WhatsApp via CallMeBot, con un esito che si può credere.
//
// Prima: la richiesta partiva senza aspettare la risposta e un errore finiva solo in console. CallMeBot
// risponde HTTP 200 anche quando rifiuta il messaggio (chiave sbagliata, numero non attivato), quindi
// il registro diceva "chiamata_reale" e nessuno scopriva mai che nulla era arrivato.
//
// Ora: si legge la risposta, si riprova se è un problema temporaneo (rete, servizio occupato), si
// registra l'esito vero per destinatario e, se il messaggio non parte, compare una notifica
// nell'app (al massimo una all'ora per lo stesso motivo). I messaggi escono uno alla volta, a
// distanza di qualche secondo, perché CallMeBot limita la frequenza.
const db = require('./db');

const SPACING_MS = process.env.WHATSAPP_SPACING_MS != null ? parseInt(process.env.WHATSAPP_SPACING_MS, 10) : 3000;
const RETRY_DELAYS_MS = process.env.WHATSAPP_RETRY_MS ? process.env.WHATSAPP_RETRY_MS.split(',').map(Number) : [2000, 6000];
const TIMEOUT_MS = 10000;

let queue = Promise.resolve();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Cosa ha risposto CallMeBot? Il successo è "Message queued. You will receive it in a few seconds".
function judge(status, body) {
  const text = String(body || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (status >= 500 || status === 429) return { ok: false, retry: true, reason: 'servizio WhatsApp non disponibile (HTTP ' + status + ')' };
  if (/queued|will receive/i.test(text)) return { ok: true };
  if (/too many|busy|try again|limit|wait/i.test(text)) return { ok: false, retry: true, reason: text.slice(0, 140) };
  return { ok: false, retry: false, reason: text ? text.slice(0, 140) : 'risposta vuota (HTTP ' + status + ')' };
}

async function sendOne({ numero, testo, apiKey }) {
  const clean = String(numero).replace(/\s+/g, '').replace(/^\+/, '');
  const url = 'https://api.callmebot.com/whatsapp.php?phone=' + encodeURIComponent(clean) + '&text=' + encodeURIComponent(testo) + '&apikey=' + encodeURIComponent(apiKey);
  let last = { ok: false, reason: 'non inviato' };
  for (let attempt = 1; attempt <= 1 + RETRY_DELAYS_MS.length; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      last = judge(res.status, await res.text());
    } catch (e) {
      last = { ok: false, retry: true, reason: e.name === 'TimeoutError' ? 'nessuna risposta entro ' + TIMEOUT_MS / 1000 + ' secondi' : 'rete non raggiungibile (' + e.message + ')' };
    }
    last.attempts = attempt;
    if (last.ok || !last.retry || attempt > RETRY_DELAYS_MS.length) break;
    await sleep(RETRY_DELAYS_MS[attempt - 1]);
  }
  return last;
}

// Mette un invio in coda: uno alla volta, con una pausa tra l'uno e l'altro.
function send(job) {
  const run = queue.then(async () => {
    const out = await sendOne(job);
    if (SPACING_MS > 0) await sleep(SPACING_MS);
    return out;
  });
  queue = run.catch(() => {});
  return run;
}

// Avviso nell'app quando un messaggio non parte. Una sola volta all'ora per lo stesso motivo.
function notifyFailure(nome, reason) {
  try {
    const message = 'WhatsApp non consegnato a ' + nome + ': ' + reason;
    const recent = db.prepare("SELECT 1 FROM notifications WHERE message = ? AND created_at >= datetime('now', '-1 hour')").get(message);
    if (recent) return;
    db.prepare('INSERT INTO notifications (message, module_slug, record_id, roles, category) VALUES (?, ?, ?, ?, ?)').run(message, null, null, JSON.stringify(['admin']), 'whatsapp');
  } catch (e) { /* mai bloccare l'invio per un avviso */ }
}

// Manda lo stesso testo a più destinatari. Ritorna { esito, dettaglio, risultati } dove esito è
// 'inviato' (tutti), 'parziale' (alcuni) o 'FALLITO' (nessuno).
async function sendAll({ destinatari, testo, apiKey }) {
  const risultati = [];
  for (const dest of destinatari) {
    const r = await send({ numero: dest.numero, testo, apiKey });
    risultati.push({ nome: dest.nome || dest.numero, ok: r.ok, reason: r.reason || null, attempts: r.attempts });
    if (!r.ok) notifyFailure(dest.nome || dest.numero, r.reason);
  }
  const ok = risultati.filter((r) => r.ok).length;
  const esito = !risultati.length ? 'nessun destinatario' : ok === risultati.length ? 'inviato' : ok === 0 ? 'FALLITO' : 'parziale';
  const dettaglio = risultati.map((r) => r.nome + (r.ok ? ' ✓' : ' ✗ ' + r.reason)).join('; ');
  return { esito, dettaglio, risultati };
}

module.exports = { sendAll, sendOne, judge, notifyFailure };
