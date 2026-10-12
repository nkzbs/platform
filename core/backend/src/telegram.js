'use strict';
// Bot Telegram di Finance. Canale a doppio senso per i report: ti scrive (report con bottoni) e ti risponde (comandi in sola lettura, bottone «✅ Pagata»).
//
// Sicurezza (il bot NON ha il 2FA, quindi i confini stanno qui):
//   • un solo bot per il progetto; il suo token sta cifrato (crypto-fields) e non viene mai restituito;
//   • Telegram chiama il webhook con un segreto (header X-Telegram-Bot-Api-Secret-Token): senza, 403;
//   • una chat conta solo se è COLLEGATA a un utente, con un codice monouso (10 minuti) generato dall'app da loggato; si revoca dall'app;
//   • ogni azione passa dagli stessi controlli dell'app: moduli assegnati all'utente, permessi del ruolo (compresa «solo propri»), regole del
//     workflow, automazioni (runTransition di routes/records.js); ogni azione è nel registro attività;
//   • solo chat private; al massimo 20 messaggi al minuto per chat; mai scritture senza un tocco esplicito dell'utente (il bottone);
//   • le domande libere (AI) NON ci sono ancora: solo comandi fissi.
const crypto = require('crypto');
const db = require('./db');
const { decrypt } = require('./crypto-fields');
const { logAudit } = require('./audit-log');

const API = 'https://api.telegram.org';
const CODE_TTL_MS = 10 * 60 * 1000;
const RATE_PER_MIN = 20;
const KINDS = ['pagare', 'smistare', 'scadute'];

// ── configurazione (riga 'telegram' di connections: token cifrato, segreto del webhook, nome del bot) ───────────────────
function creds() {
  try {
    const row = db.prepare("SELECT credentials FROM connections WHERE integration_id = 'telegram'").get();
    const c = row && require('./secrets-at-rest').unseal(row.credentials);
    if (!c || !c.bot_token) return null;
    const token = decrypt(c.bot_token); // un vecchio valore cifrato per campo si legge ancora; uno in chiaro torna com'è
    return token && token !== '[errore decifratura]' ? { ...c, bot_token: token } : null;
  } catch (e) { return null; }
}
const isConfigured = () => !!creds();
function saveCreds(c) {
  const json = require('./secrets-at-rest').seal(c); // tutto il JSON cifrato a riposo
  if (db.prepare("SELECT 1 FROM connections WHERE integration_id = 'telegram'").get()) db.prepare("UPDATE connections SET credentials = ?, connected = ?, connected_at = CURRENT_TIMESTAMP WHERE integration_id = 'telegram'").run(json, c.bot_token ? 1 : 0);
  else db.prepare("INSERT INTO connections (integration_id, connected, credentials, connected_at) VALUES ('telegram', ?, ?, CURRENT_TIMESTAMP)").run(c.bot_token ? 1 : 0, json);
}

// ── chiamate alle API di Telegram ──────────────────────────────────────────────────────────────────────────────────────
async function call(token, method, body) {
  const res = await fetch(API + '/bot' + token + '/' + method, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  let j = null; try { j = await res.json(); } catch (e) { /* risposta non JSON */ }
  if (!j || !j.ok) { const err = new Error((j && j.description) || 'Telegram ha risposto con un errore (' + res.status + ')'); err.code = j && j.error_code; throw err; }
  return j.result;
}
async function api(method, body) { const c = creds(); if (!c) throw new Error('Telegram non è collegato'); return call(c.bot_token, method, body); }

const esc = (t) => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// I messaggi dei report sono scritti con *grassetto* di WhatsApp: per Telegram diventano HTML (testo sempre «escapato» prima).
const waToHtml = (text) => esc(text).replace(/\*([^*\n]+)\*/g, '<b>$1</b>');

async function sendMessage(chatId, html, keyboard) {
  const body = { chat_id: chatId, text: html, parse_mode: 'HTML', disable_web_page_preview: true };
  if (keyboard && keyboard.length) body.reply_markup = { inline_keyboard: keyboard };
  return api('sendMessage', body);
}

// ── collegare e scollegare il bot ───────────────────────────────────────────────────────────────────────────────────────
// `appUrl` è l'indirizzo pubblico di questo tenant (https://finance…): da lì Telegram chiama il webhook e il bottone «Apri l'app» porta qui.
async function connect(token, appUrl) {
  const t = String(token || '').trim();
  if (!/^\d{6,12}:[A-Za-z0-9_-]{30,}$/.test(t)) throw new Error('Il codice del bot non ha il formato giusto (es. 123456789:AA…).');
  if (!/^https:\/\//.test(appUrl || '')) throw new Error('Il collegamento a Telegram richiede un indirizzo https pubblico.');
  const me = await call(t, 'getMe');
  const secret = crypto.randomBytes(24).toString('hex');
  await call(t, 'setWebhook', { url: appUrl.replace(/\/$/, '') + '/api/telegram/webhook', secret_token: secret, allowed_updates: ['message', 'callback_query'], drop_pending_updates: true });
  saveCreds({ bot_token: t, secret, bot_username: me.username, app_url: appUrl.replace(/\/$/, '') });
  return { bot_username: me.username };
}
async function disconnect() {
  const c = creds();
  if (c) { try { await call(c.bot_token, 'deleteWebhook', { drop_pending_updates: true }); } catch (e) { /* il token potrebbe essere già revocato */ } }
  db.prepare("DELETE FROM connections WHERE integration_id = 'telegram'").run();
  db.prepare('DELETE FROM telegram_links').run();
  db.prepare('DELETE FROM telegram_link_codes').run();
}
function status() { const c = creds(); return { configured: !!c, bot_username: c ? c.bot_username : null, app_url: c ? c.app_url : null }; }
function secretMatches(header) {
  const c = creds();
  if (!c || !c.secret || typeof header !== 'string') return false;
  const a = Buffer.from(header), b = Buffer.from(c.secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ── collegamento chat ↔ utente ──────────────────────────────────────────────────────────────────────────────────────────
function createLinkCode(userId) {
  db.prepare('DELETE FROM telegram_link_codes WHERE user_id = ? OR expires_at < ?').run(userId, Date.now());
  const code = Array.from(crypto.randomBytes(8)).map((b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');
  db.prepare('INSERT INTO telegram_link_codes (code, user_id, expires_at) VALUES (?, ?, ?)').run(code, userId, Date.now() + CODE_TTL_MS);
  const c = creds();
  return { code, url: c && c.bot_username ? 'https://t.me/' + c.bot_username + '?start=' + code : null, expires_in: CODE_TTL_MS / 1000 };
}
function consumeLinkCode(code, chatId, label) {
  const row = db.prepare('SELECT * FROM telegram_link_codes WHERE code = ?').get(String(code || '').trim().toUpperCase());
  if (!row) return null;
  db.prepare('DELETE FROM telegram_link_codes WHERE code = ?').run(row.code); // monouso, valido o scaduto
  if (row.expires_at < Date.now()) return null;
  const user = db.prepare('SELECT id, username, display_name, role FROM users WHERE id = ? AND active = 1').get(row.user_id);
  if (!user) return null;
  db.prepare('INSERT INTO telegram_links (chat_id, user_id, label) VALUES (?, ?, ?) ON CONFLICT(chat_id) DO UPDATE SET user_id = excluded.user_id, label = excluded.label, created_at = CURRENT_TIMESTAMP').run(String(chatId), user.id, label || null);
  logAudit(user.username, 'telegram.link', String(chatId), null);
  return user;
}
function linkedUser(chatId) {
  return db.prepare('SELECT u.id, u.username, u.display_name, u.role, u.linked_module_slug, u.linked_record_id FROM telegram_links l JOIN users u ON u.id = l.user_id WHERE l.chat_id = ? AND u.active = 1').get(String(chatId)) || null;
}
const listLinks = () => db.prepare('SELECT l.id, l.chat_id, l.label, l.created_at, l.user_id, u.username, u.display_name FROM telegram_links l LEFT JOIN users u ON u.id = l.user_id ORDER BY l.id').all();
function revokeLink(id) { const l = db.prepare('SELECT * FROM telegram_links WHERE id = ?').get(id); if (l) db.prepare('DELETE FROM telegram_links WHERE id = ?').run(id); return l || null; }

// ── cosa vede un utente, e i messaggi dei report per Telegram ───────────────────────────────────────────────────────────
function scopeFor(user) {
  const { visibleSlugsFor } = require('./routes/modules');
  return { user, slugs: new Set(visibleSlugsFor(user)) };
}
const shorten = (t, n) => (String(t).length > n ? String(t).slice(0, n - 1) + '…' : String(t));
function payButton(item) { return { text: '✅ Pagata · ' + shorten(item.descrizione, 22) + ' ' + String(item.importo).replace('.', ','), callback_data: 'pay:' + item.slug + ':' + item.id }; }
function renderReport(kind, result) {
  const c = creds();
  const rows = [];
  if (kind === 'scadute' && Array.isArray(result.items)) result.items.forEach((it) => rows.push([payButton(it)]));
  if (c && c.app_url) rows.push([{ text: 'Apri l\'app', url: c.app_url }]);
  return { html: waToHtml(result.text), keyboard: rows };
}
async function sendReportTo(chatId, kind, result) {
  const r = renderReport(kind, result);
  try { await sendMessage(chatId, r.html, r.keyboard); return { ok: true }; } catch (e) { return { ok: false, reason: e.message }; }
}

// ── cosa fa il bot quando riceve qualcosa ───────────────────────────────────────────────────────────────────────────────
const AIUTO = '<b>Cosa so fare</b>\n/pagare — quanto devi pagare\n/scadute — le voci scadute, con il bottone «Pagata»\n/smistare — le righe da smistare\n/timbra — entrata e uscita (se hai le timbrature)\n/ore — le ore della settimana\n\n<b>Oppure scrivimi come parli</b>, per esempio:\n• «quanto ho speso di benzina a settembre?»\n• «ho pagato l\'affitto»\n• «smista la bolletta A2A in 3 rate»\n• «ho speso 20 euro di benzina»\n• «sono entrata», «uscita alle 12:30», «quante ore ho fatto questa settimana?»\n• mandami la <b>foto di uno scontrino</b> o il <b>PDF</b> di una bolletta e li leggo\n\nOgni modifica ti viene mostrata con un bottone di conferma: senza il tuo tocco non cambio niente (le timbrature si registrano subito, con il bottone «Annulla»).\n/scollega — scollega questo telefono';
const NON_COLLEGATO = 'Questo telefono non è collegato a Finance.\nNell\'app: <b>Impostazioni → Report → Telegram → Collega il mio Telegram</b>, poi tocca il link che ti viene mostrato.';
const hits = new Map(); // chat → istanti degli ultimi messaggi
function tooMany(chatId, now) {
  const arr = (hits.get(chatId) || []).filter((t) => now - t < 60000);
  arr.push(now); hits.set(chatId, arr);
  return arr.length > RATE_PER_MIN;
}


// ── file e messaggi: scaricare un PDF mandato in chat, modificare un messaggio già inviato ──────────────────────────────
async function downloadFile(fileId) {
  try {
    const c = creds(); if (!c) return { ok: false, error: 'Telegram non è collegato.' };
    const f = await call(c.bot_token, 'getFile', { file_id: fileId });
    const res = await fetch(API + '/file/bot' + c.bot_token + '/' + f.file_path, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) return { ok: false, error: 'Non riesco a scaricare il file da Telegram.' };
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 3 * 1024 * 1024) return { ok: false, error: 'Il file è troppo grande (massimo 3 MB).' };
    return { ok: true, base64: buf.toString('base64') };
  } catch (e) { return { ok: false, error: 'Non riesco a scaricare il file: ' + e.message }; }
}
async function editText(chatId, messageId, html, keyboard) {
  try { await api('editMessageText', { chat_id: chatId, message_id: messageId, text: html, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: { inline_keyboard: keyboard || [] } }); } catch (e) { /* messaggio troppo vecchio o invariato */ }
}
const aiHits = new Map(); // limite più stretto per le frasi che passano dall'AI: 8 al minuto per chat (costano)
function aiTooMany(chatId, now) { const arr = (aiHits.get(chatId) || []).filter((t) => now - t < 60000); arr.push(now); aiHits.set(chatId, arr); return arr.length > 8; }

// Una frase libera: l'AI la traduce in UNA azione dell'elenco; le letture rispondono subito, le scritture diventano una proposta con bottoni.
async function handleFree(chatId, user, text, now) {
  if (aiTooMany(chatId, now)) return sendMessage(chatId, 'Un momento, sto ricevendo troppe frasi: riprova tra un minuto.');
  api('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});
  const bot = require('./bot-ai'), act = require('./bot-actions');
  const r = await bot.interpret(text, user, new Date(now));
  if (r.error) return sendMessage(chatId, r.code === 'ai_unanswerable' ? 'Non ho capito. ' + 'Prova con /aiuto per vedere cosa posso fare.' : esc(r.error));
  const it = r.intent;
  if (it.azione === 'altro') return sendMessage(chatId, 'Questo non so ancora farlo (non elimino né modifico dati a piacere). Scrivi /aiuto per vedere cosa posso fare.');
  if (it.azione === 'elenco') return runCommand(chatId, user, it.cosa, now);
  if (it.azione === 'domanda') {
    const a = await bot.ask(text, user, new Date(now));
    return sendMessage(chatId, a.error ? (a.code === 'ai_unanswerable' ? 'Non riesco a rispondere a questa domanda con i dati che ho: prova a riformularla (periodo, categoria, modulo).' : esc(a.error)) : a.html);
  }
  if (it.azione === 'timbra' || it.azione === 'ore') {
    const tb = require('./bot-timbrature');
    const out = it.azione === 'timbra' ? await tb.timbra(user, chatId, it, new Date(now)) : tb.ore(user, it.periodo, new Date(now));
    return sendMessage(chatId, out.html, out.keyboard);
  }
  const p = act.proponi(user, it, chatId);
  return sendMessage(chatId, p.html, p.keyboard);
}

async function runCommand(chatId, user, kind, now) {
  const result = require('./reports').build(kind, new Date(now), scopeFor(user));
  if (!result) return sendMessage(chatId, kind === 'smistare' ? 'Niente da smistare: la coda è vuota. 👍' : 'Nessuna voce scaduta. 👍');
  const r = renderReport(kind, result);
  return sendMessage(chatId, r.html, r.keyboard);
}

async function handleMessage(msg, now) {
  if (!msg || !msg.chat || msg.chat.type !== 'private') return; // gruppi e canali: ignorati
  const chatId = String(msg.chat.id);
  if (tooMany(chatId, now)) return;
  const text = String(msg.text || '').trim();
  const [cmdRaw, ...args] = text.split(/\s+/);
  const cmd = cmdRaw.split('@')[0].toLowerCase();

  if (cmd === '/start' && args[0]) {
    const user = consumeLinkCode(args[0], chatId, [msg.from && msg.from.first_name, msg.from && msg.from.username && '@' + msg.from.username].filter(Boolean).join(' '));
    if (!user) return sendMessage(chatId, 'Il codice non è valido o è scaduto. Generane uno nuovo dall\'app (dura 10 minuti, si usa una volta sola).');
    return sendMessage(chatId, '✅ Collegato a Finance come <b>' + esc(user.display_name || user.username) + '</b>.\n\n' + AIUTO);
  }
  const user = linkedUser(chatId);
  if (!user) return sendMessage(chatId, NON_COLLEGATO);
  if (cmd === '/start' || cmd === '/aiuto' || cmd === '/help') return sendMessage(chatId, 'Ciao ' + esc(user.display_name || user.username) + '!\n\n' + AIUTO);
  if (cmd === '/scollega') { db.prepare('DELETE FROM telegram_links WHERE chat_id = ?').run(chatId); logAudit(user.username, 'telegram.unlink', chatId, null); return sendMessage(chatId, 'Scollegato. Per ricollegarti genera un nuovo codice dall\'app.'); }
  if (cmd === '/timbra' || cmd === '/ore') {
    const tb = require('./bot-timbrature');
    if (!tb.haPresenze(user)) return sendMessage(chatId, 'Non hai un modulo di timbrature.');
    const out = cmd === '/ore' ? tb.ore(user, 'settimana', new Date(now)) : tb.menu();
    return sendMessage(chatId, out.html, out.keyboard);
  }
  const kind = { '/pagare': 'pagare', '/scadute': 'scadute', '/smistare': 'smistare' }[cmd];
  if (kind) return runCommand(chatId, user, kind, now);
  // una foto (scontrino) o un file: la foto di uno scontrino e un PDF di bolletta si leggono con l'AI; poi tu confermi
  if (msg.photo && msg.photo.length) {
    if (aiTooMany(chatId, now)) return sendMessage(chatId, 'Un momento, sto ricevendo troppe richieste: riprova tra un minuto.');
    const act = require('./bot-actions'); const out = await act.importaFoto(user, chatId, act.fotoMigliore(msg.photo), downloadFile);
    return sendMessage(chatId, out.html, out.keyboard);
  }
  if (msg.document) {
    if (aiTooMany(chatId, now)) return sendMessage(chatId, 'Un momento, sto ricevendo troppe richieste: riprova tra un minuto.');
    const act = require('./bot-actions'); const d = msg.document;
    const out = /^image\//.test(d.mime_type || '') ? await act.importaFoto(user, chatId, d.file_size && d.file_size > 3 * 1024 * 1024 ? null : d, downloadFile) : await act.importaDocumento(user, chatId, d, downloadFile);
    return sendMessage(chatId, out.html, out.keyboard);
  }
  if (!text || text.startsWith('/')) return sendMessage(chatId, 'Non ho capito. Prova con /pagare, /scadute o /smistare (o /aiuto).');
  return handleFree(chatId, user, text, now);
}

// Il bottone «Pagata» / «Annulla»: stessi controlli dell'app, poi si aggiorna la tastiera del messaggio.
async function handleCallback(cb, now) {
  const chat = cb.message && cb.message.chat;
  if (!chat || chat.type !== 'private') return;
  const chatId = String(chat.id);
  const answer = (text) => api('answerCallbackQuery', { callback_query_id: cb.id, text: String(text).slice(0, 190) }).catch(() => {});
  if (tooMany(chatId, now)) return answer('Troppe richieste, riprova tra un minuto.');
  const user = linkedUser(chatId);
  if (!user) return answer('Questo telefono non è collegato a Finance.');
  const act = require('./bot-actions');
  const tbm = /^(tb|tu):([a-z0-9]+)$/.exec(String(cb.data || ''));
  if (tbm) {
    const tb = require('./bot-timbrature');
    if (tbm[1] === 'tu') { const out = await tb.annulla(user, chatId, tbm[2]); await answer(out.scaduta ? 'Scaduta.' : 'Fatto.'); return editText(chatId, cb.message.message_id, out.html, []); }
    if (!tb.haPresenze(user)) return answer('Non hai un modulo di timbrature.');
    const out = tbm[2] === 'o' ? tb.ore(user, 'settimana', new Date(now)) : await tb.timbra(user, chatId, { tipo: tbm[2] === 'e' ? 'entrata' : 'uscita', ora: null, data: null }, new Date(now));
    await answer('Fatto.');
    return sendMessage(chatId, out.html, out.keyboard);
  }
  const conf = /^(ok|dp|no|pk|im):([a-z0-9]+)(?::(\d+))?$/.exec(String(cb.data || ''));
  if (conf) {
    const [, kind, pid, idx] = conf;
    const out = kind === 'im' ? await act.scegliModuloImport(user, chatId, pid, idx, downloadFile) : await act.tocca(user, chatId, kind, pid, idx, { fileFn: downloadFile });
    await answer(kind === 'no' ? 'Annullato.' : out.scaduta ? 'Scaduta.' : 'Fatto.');
    return editText(chatId, cb.message.message_id, out.html, out.keyboard);
  }
  const m = /^(pay|undo):([a-z0-9_]+):(\d+)$/.exec(String(cb.data || ''));
  if (!m) return answer('Azione non riconosciuta.');
  const [, azione, slug, idStr] = m, id = parseInt(idStr, 10);
  const r = act.cambiaStato(user, slug, id, azione);
  if (r.ok) await refreshButton(cb, azione, slug, id, r.desc || 'voce');
  return answer(r.msg);
}
// Dopo «Pagata» il bottone diventa «↩ Annulla» (e viceversa): si ricostruisce solo quel bottone nella tastiera del messaggio.
async function refreshButton(cb, azione, slug, id, desc) {
  try {
    const old = (cb.message.reply_markup && cb.message.reply_markup.inline_keyboard) || [];
    const nuovo = old.map((row) => row.map((b) => {
      if (b.callback_data !== azione + ':' + slug + ':' + id) return b;
      return azione === 'pay' ? { text: '↩ Annulla · ' + shorten(desc, 28), callback_data: 'undo:' + slug + ':' + id } : { text: '✅ Pagata · ' + shorten(desc, 28), callback_data: 'pay:' + slug + ':' + id };
    }));
    await api('editMessageReplyMarkup', { chat_id: cb.message.chat.id, message_id: cb.message.message_id, reply_markup: { inline_keyboard: nuovo } });
  } catch (e) { /* il messaggio può essere troppo vecchio: l'azione è comunque fatta */ }
}

async function handleUpdate(update, now = Date.now()) {
  try {
    if (update && update.message) await handleMessage(update.message, now);
    else if (update && update.callback_query) await handleCallback(update.callback_query, now);
  } catch (e) { console.error('[telegram]', e.message); }
}

module.exports = { downloadFile, KINDS, isConfigured, status, connect, disconnect, secretMatches, createLinkCode, consumeLinkCode, linkedUser, listLinks, revokeLink, scopeFor, renderReport, sendReportTo, sendMessage, handleUpdate, waToHtml, esc, _resetRate: () => { hits.clear(); aiHits.clear(); } };
