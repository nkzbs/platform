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
const { encrypt, decrypt } = require('./crypto-fields');
const { logAudit } = require('./audit-log');

const API = 'https://api.telegram.org';
const CODE_TTL_MS = 10 * 60 * 1000;
const RATE_PER_MIN = 20;
const KINDS = ['pagare', 'smistare', 'scadute'];

// ── configurazione (riga 'telegram' di connections: token cifrato, segreto del webhook, nome del bot) ───────────────────
function creds() {
  try {
    const row = db.prepare("SELECT credentials FROM connections WHERE integration_id = 'telegram'").get();
    if (!row || !row.credentials) return null;
    const c = JSON.parse(row.credentials);
    if (!c.bot_token) return null;
    return { ...c, bot_token: decrypt(c.bot_token) };
  } catch (e) { return null; }
}
const isConfigured = () => !!creds();
function saveCreds(c) {
  const json = JSON.stringify({ ...c, bot_token: c.bot_token ? encrypt(c.bot_token) : null });
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
  return db.prepare('SELECT u.id, u.username, u.display_name, u.role FROM telegram_links l JOIN users u ON u.id = l.user_id WHERE l.chat_id = ? AND u.active = 1').get(String(chatId)) || null;
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
const AIUTO = '<b>Cosa so fare</b>\n/pagare — quanto devi pagare\n/scadute — le voci scadute, con il bottone «Pagata»\n/smistare — le righe da smistare\n/scollega — scollega questo telefono';
const NON_COLLEGATO = 'Questo telefono non è collegato a Finance.\nNell\'app: <b>Impostazioni → Report → Telegram → Collega il mio Telegram</b>, poi tocca il link che ti viene mostrato.';
const hits = new Map(); // chat → istanti degli ultimi messaggi
function tooMany(chatId, now) {
  const arr = (hits.get(chatId) || []).filter((t) => now - t < 60000);
  arr.push(now); hits.set(chatId, arr);
  return arr.length > RATE_PER_MIN;
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
  const kind = { '/pagare': 'pagare', '/scadute': 'scadute', '/smistare': 'smistare' }[cmd];
  if (kind) {
    const result = require('./reports').build(kind, new Date(now), scopeFor(user));
    if (!result) return sendMessage(chatId, kind === 'smistare' ? 'Niente da smistare: la coda è vuota. 👍' : 'Nessuna voce scaduta. 👍');
    const r = renderReport(kind, result);
    return sendMessage(chatId, r.html, r.keyboard);
  }
  return sendMessage(chatId, 'Non ho capito. Prova con /pagare, /scadute o /smistare (o /aiuto).');
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
  const m = /^(pay|undo):([a-z0-9_]+):(\d+)$/.exec(String(cb.data || ''));
  if (!m) return answer('Azione non riconosciuta.');
  const [, azione, slug, idStr] = m, id = parseInt(idStr, 10);

  const { visibleSlugsFor } = require('./routes/modules');
  if (!visibleSlugsFor(user).includes(slug)) return answer('Non hai accesso a questo modulo.');
  const decl = require('./module-roles').get(slug);
  const S = decl && decl.avvisi && decl.avvisi.states;
  if (!S || !S.da_fare || !S.fatto) return answer('Questo modulo non ha stati «da pagare» e «pagato».');
  const row = db.prepare('SELECT data FROM records WHERE id = ? AND module_slug = ?').get(id, slug);
  if (!row) return answer('Voce non trovata (forse è stata eliminata).');
  const R = { stato: '_stato', ...decl.roles };
  const stato = JSON.parse(row.data)[R.stato];
  const desc = String(JSON.parse(row.data)[R.descrizione || 'descrizione'] || 'voce');

  const target = azione === 'pay' ? S.fatto : S.da_fare;
  if (stato === target) { await refreshButton(cb, azione, slug, id, desc); return answer(azione === 'pay' ? 'Era già segnata come pagata.' : 'Era già «da pagare».'); }
  if (stato !== (azione === 'pay' ? S.da_fare : S.fatto)) return answer('Questa voce non è più «' + String(azione === 'pay' ? S.da_fare : S.fatto).replace(/_/g, ' ') + '».');

  const { runTransition } = require('./routes/records');
  const out = runTransition(user, slug, id, target);
  if (out.status !== 200) return answer(out.status === 422 ? (azione === 'undo' ? 'Da qui non si può annullare: fallo dall\'app.' : 'Non si può segnare pagata da questo stato.') : (out.body.error || 'Non riuscito.'));
  logAudit(user.username, 'telegram.' + azione, slug + '#' + id, { via: 'bot' });
  await refreshButton(cb, azione, slug, id, desc);
  return answer(azione === 'pay' ? '✅ Segnata pagata: ' + desc : '↩ Annullato: ' + desc);
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

module.exports = { KINDS, isConfigured, status, connect, disconnect, secretMatches, createLinkCode, consumeLinkCode, linkedUser, listLinks, revokeLink, scopeFor, renderReport, sendReportTo, sendMessage, handleUpdate, waToHtml, esc, _resetRate: () => hits.clear() };
