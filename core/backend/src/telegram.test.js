'use strict';
// Bot Telegram (telegram.js, routes/telegram.js): collegamento sicuro, permessi dell'utente, bottone «Pagata», invio dei report. Telegram è simulato.
// Server reale, DB temporaneo. Eseguire con: node src/telegram.test.js (porta 34818).

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const TEST_PORT = 34818;
const BASE = 'http://localhost:' + TEST_PORT;
const dbPath = path.join(os.tmpdir(), 'telegram-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.DB_PATH = dbPath;
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'telegram_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'telegram_internal_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'telegram_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'telegram-uploads-'));
process.env.SUPER_ADMIN_URL = 'http://localhost:1';
process.env.TENANT_SLUG = 'telegram';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; }
}
const eq = (a, e, msg) => { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${msg || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); };
const ok = (c, msg) => { if (!c) throw new Error(msg || 'atteso true'); };
const F = (key, label, type, extra = {}) => ({ id: 'f_' + key, block_type: 'field', key, label, type, ...extra });
const WF = [
  { id: 'w1', block_type: 'workflow_state', key: 'da_smistare', label: 'Da smistare', initial: true }, { id: 'w2', block_type: 'workflow_state', key: 'da_pagare', label: 'Da pagare' }, { id: 'w3', block_type: 'workflow_state', key: 'pagato', label: 'Pagato' },
  { id: 't1', block_type: 'workflow_transition', from: 'da_smistare', to: 'da_pagare', label: 'Conferma' }, { id: 't2', block_type: 'workflow_transition', from: 'da_pagare', to: 'pagato', label: 'Pagata' }, { id: 't3', block_type: 'workflow_transition', from: 'pagato', to: 'da_pagare', label: 'Riapri' },
];
const SPESE = (extra = []) => ({ version: 3, steps: [F('descrizione', 'Descrizione', 'text'), F('importo', 'Importo', 'currency'), F('data', 'Data', 'date'), ...WF, ...extra] });
const SOLO_PROPRI = { id: 'p1', block_type: 'permissions', rules: [{ role: 'user', view: true, view_own_only: true, owner_field: '', create: true, edit: true, delete: true }] };

const TOKEN = '123456789:' + 'A'.repeat(35);
const calls = []; // chiamate a Telegram
const realFetch = global.fetch;
global.fetch = async (url, opt) => {
  const u = String(url);
  if (!u.startsWith('https://api.telegram.org/bot')) return realFetch(url, opt);
  const method = u.split('/').pop(); const body = opt && opt.body ? JSON.parse(opt.body) : {};
  calls.push({ method, body });
  if (body.__fail) return { status: 400, json: async () => ({ ok: false, error_code: 400, description: 'Bad Request' }) };
  return { status: 200, json: async () => ({ ok: true, result: method === 'getMe' ? { username: 'finance_test_bot' } : true }) };
};
const ultimi = (m) => calls.filter((c) => c.method === m);

async function main() {
  require('./index.js');
  for (let i = 0; i < 100; i++) { try { if ((await realFetch(BASE + '/health')).ok) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const db = require('./db'); const tg = require('./telegram'); const reports = require('./reports'); const roles = require('./module-roles');
  const bcrypt = require('bcryptjs'); const hash = bcrypt.hashSync('pw_di_prova_123', 4);
  const add = (slug, schema) => db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES (?, ?, 'box', '#000', 1, 1, 70, ?)").run(slug, slug, JSON.stringify(schema));
  add('spese_casa', SPESE()); add('spese_personali', SPESE([SOLO_PROPRI]));
  const AV = { states: { nuovo: 'da_smistare', da_fare: 'da_pagare', fatto: 'pagato' }, scadenze: true, nuovo: true, noun_s: 'bolletta', noun_p: 'bollette' };
  const RL = { importo: 'importo', data: 'data', descrizione: 'descrizione', stato: '_stato' };
  roles.set('spese_casa', { kind: 'spesa', uses: ['avvisi'], roles: RL, avvisi: { ...AV, label: 'casa' } }); roles.set('spese_personali', { kind: 'spesa', uses: ['avvisi'], roles: RL, avvisi: { ...AV, label: 'pers.' } });
  for (const k of require('./features').KEYS) require('./features').set(k, true);

  const mkUser = (id, username, role) => db.prepare("INSERT INTO users (id, username, password_hash, display_name, role) VALUES (?, ?, ?, ?, ?)").run(id, username, hash, username[0].toUpperCase() + username.slice(1), role);
  mkUser(5, 'nima', 'user'); mkUser(6, 'fede', 'user');
  db.prepare("INSERT INTO user_modules (user_id, module_slug) VALUES (6, 'spese_casa')").run(); // Federica: solo Casa
  const login = async (u, p) => (await (await realFetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) })).json()).token;
  const H = async (u, p = 'pw_di_prova_123') => ({ Authorization: 'Bearer ' + await login(u, p), 'Content-Type': 'application/json' });
  const HA = await H('admin', process.env.INITIAL_ADMIN_PASSWORD), HN = await H('nima'), HF = await H('fede');
  const api = (path, o = {}) => realFetch(BASE + '/api/telegram' + path, o);
  const put = (slug, d, uid) => db.prepare('INSERT INTO records (module_slug, user_id, data) VALUES (?, ?, ?)').run(slug, uid, JSON.stringify(d)).lastInsertRowid;
  const stato = (id) => JSON.parse(db.prepare('SELECT data FROM records WHERE id = ?').get(id).data)._stato;
  const IERI = new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10);

  console.log('\n--- collegare il bot ---');
  await test('solo l\'admin collega il bot; un codice con il formato sbagliato si rifiuta', async () => {
    eq((await api('/config', { method: 'PUT', headers: HN, body: JSON.stringify({ bot_token: TOKEN }) })).status, 403);
    eq((await api('/config', { method: 'PUT', headers: HA, body: JSON.stringify({ bot_token: 'boh' }) })).status, 400);
  });
  await test('collegato: il token resta cifrato nel database e non esce mai da /status; il webhook ha un segreto', async () => {
    calls.length = 0;
    const r = await api('/config', { method: 'PUT', headers: { ...HA, 'x-forwarded-proto': 'https', 'x-forwarded-host': 'finance.example.it' }, body: JSON.stringify({ bot_token: TOKEN }) });
    eq(r.status, 200); eq((await r.json()).bot_username, 'finance_test_bot');
    const wh = ultimi('setWebhook')[0].body; eq(wh.url, 'https://finance.example.it/api/telegram/webhook'); ok(wh.secret_token.length >= 32, 'segreto lungo');
    const raw = db.prepare("SELECT credentials FROM connections WHERE integration_id = 'telegram'").get().credentials;
    ok(!raw.includes(TOKEN), 'il token non è in chiaro'); ok(raw.startsWith('enc:'), 'tutto il JSON è cifrato'); eq(require('./secrets-at-rest').unseal(raw).bot_token, TOKEN, 'si rilegge');
    const st = await (await api('/status', { headers: HN })).json(); eq(st.configured, true); ok(!JSON.stringify(st).includes('AAAA'), 'nessun segreto in /status');
  });

  console.log('\n--- il webhook ---');
  const secret = () => require('./secrets-at-rest').unseal(db.prepare("SELECT credentials FROM connections WHERE integration_id = 'telegram'").get().credentials).secret;
  const upd = (chat, text, extra = {}) => ({ update_id: Math.floor(Math.random() * 1e9), message: { message_id: 1, chat: { id: chat, type: 'private' }, from: { id: chat, first_name: 'Prova' }, text, ...extra } });
  const post = (body, sec = secret()) => api('/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(sec ? { 'x-telegram-bot-api-secret-token': sec } : {}) }, body: JSON.stringify(body) });
  await test('senza il segreto giusto: 403 e il bot non risponde', async () => {
    calls.length = 0; tg._resetRate();
    eq((await post(upd(111, '/pagare'), null)).status, 403); eq((await post(upd(111, '/pagare'), 'sbagliato')).status, 403); eq(ultimi('sendMessage').length, 0);
  });
  await test('una chat non collegata non vede NIENTE: solo le istruzioni per collegarsi', async () => {
    put('spese_casa', { descrizione: 'Segreta', importo: 10, data: IERI, _stato: 'da_pagare' }, 5);
    calls.length = 0; eq((await post(upd(111, '/scadute'))).status, 200);
    const m = ultimi('sendMessage'); eq(m.length, 1); ok(/non è collegato/.test(m[0].body.text) && !/Segreta/.test(m[0].body.text), m[0].body.text);
  });
  await test('un gruppo non vale: ignorato', async () => {
    calls.length = 0; await post({ update_id: 1, message: { chat: { id: -100, type: 'group' }, text: '/pagare' } }); eq(ultimi('sendMessage').length, 0);
  });

  console.log('\n--- collegare il proprio telefono ---');
  const nuovoCodice = async (h) => (await (await api('/link-code', { method: 'POST', headers: h })).json());
  await test('il codice è monouso: collega la chat all\'utente che l\'ha generato, la seconda volta non vale', async () => {
    const c = await nuovoCodice(HN); eq(c.url, 'https://t.me/finance_test_bot?start=' + c.code); eq(c.expires_in, 600);
    calls.length = 0; await post(upd(555, '/start ' + c.code));
    ok(/Collegato come <b>Nima<\/b>/.test(ultimi('sendMessage')[0].body.text), ultimi('sendMessage')[0].body.text);
    eq(tg.linkedUser(555).username, 'nima');
    calls.length = 0; await post(upd(999, '/start ' + c.code)); ok(/non è valido o è scaduto/.test(ultimi('sendMessage')[0].body.text)); eq(tg.linkedUser(999), null);
  });
  await test('un codice scaduto non vale', async () => {
    const c = await nuovoCodice(HF); db.prepare('UPDATE telegram_link_codes SET expires_at = ? WHERE code = ?').run(Date.now() - 1000, c.code);
    calls.length = 0; await post(upd(666, '/start ' + c.code)); ok(/scaduto/.test(ultimi('sendMessage')[0].body.text)); eq(tg.linkedUser(666), null);
  });
  await test('Federica si collega con il suo codice', async () => {
    const c = await nuovoCodice(HF); await post(upd(666, '/start ' + c.code)); eq(tg.linkedUser(666).username, 'fede');
  });

  console.log('\n--- cosa vede ognuno ---');
  const tap = (chat, data, kb) => post({ update_id: 7, callback_query: { id: 'cb' + Math.random(), data, message: { message_id: 42, chat: { id: chat, type: 'private' }, reply_markup: { inline_keyboard: kb || [[{ text: '✅ Pagata · x', callback_data: data }]] } } } });
  const risposta = () => ultimi('answerCallbackQuery').slice(-1)[0].body.text;
  const idN = put('spese_personali', { descrizione: 'Benzina <b>', importo: 200, data: IERI, _stato: 'da_pagare' }, 5); // di Nima, personale
  const idC = put('spese_casa', { descrizione: 'Affitto', importo: 550, data: IERI, _stato: 'da_pagare' }, 5);
  await test('/scadute: Nima vede casa e personali, Federica solo Casa; il testo è «escapato»', async () => {
    tg._resetRate(); calls.length = 0; await post(upd(555, '/scadute')); const n = ultimi('sendMessage')[0].body;
    ok(n.text.includes('Affitto') && n.text.includes('Benzina &lt;b&gt;'), n.text); ok(!n.text.includes('<b>Benzina'), 'HTML iniettato');
    calls.length = 0; await post(upd(666, '/scadute')); const f = ultimi('sendMessage')[0].body;
    ok(f.text.includes('Affitto') && !f.text.includes('Benzina'), f.text);
    ok(JSON.stringify(f.reply_markup).includes('pay:spese_casa:') && !JSON.stringify(f.reply_markup).includes('spese_personali'), 'bottoni solo di Casa');
  });
  await test('anche con il modulo assegnato, le righe di un ALTRO utente non si vedono (regola «solo propri»), né nei report né con il bottone', async () => {
    db.prepare("INSERT INTO user_modules (user_id, module_slug) VALUES (6, 'spese_personali')").run();
    tg._resetRate(); calls.length = 0; await post(upd(666, '/scadute')); ok(!ultimi('sendMessage')[0].body.text.includes('Benzina'), 'Federica vede la spesa di Nima');
    calls.length = 0; await tap(666, 'pay:spese_personali:' + idN); eq(stato(idN), 'da_pagare'); ok(/permessi|Non hai/.test(risposta()), risposta());
    db.prepare("DELETE FROM user_modules WHERE user_id = 6 AND module_slug = 'spese_personali'").run();
  });
  await test('/pagare e /smistare funzionano; senza righe da smistare lo dice', async () => {
    tg._resetRate(); calls.length = 0; await post(upd(555, '/pagare')); ok(/Da pagare/.test(ultimi('sendMessage')[0].body.text));
    calls.length = 0; await post(upd(555, '/smistare')); ok(/Niente da segnalare per «Da smistare»/.test(ultimi('sendMessage')[0].body.text));
    calls.length = 0; await post(upd(555, 'ciao')); ok(/AI non è accesa/.test(ultimi('sendMessage')[0].body.text), ultimi('sendMessage')[0].body.text); // le frasi libere passano dall'AI, spenta qui
    calls.length = 0; await post(upd(555, '/boh')); ok(/Non ho capito/.test(ultimi('sendMessage')[0].body.text));
  });
  await test('i comandi dei report sono le definizioni accese: /report mostra un bottone per ognuna, un report nuovo ha il suo comando (nell\'aiuto solo se acceso)', async () => {
    const reports = require('./reports');
    tg._resetRate(); calls.length = 0; await post(upd(555, '/report'));
    const kb = ultimi('sendMessage')[0].body.reply_markup.inline_keyboard.flat(); ok(kb.some((b) => b.callback_data === 'rp:pagare') && kb.some((b) => b.callback_data === 'rp:smistare'), JSON.stringify(kb));
    calls.length = 0; await post({ update_id: 5, callback_query: { id: 'cbr', data: 'rp:smistare', message: { message_id: 9, chat: { id: 555, type: 'private' }, reply_markup: { inline_keyboard: [] } } } });
    ok(/Niente da segnalare per «Da smistare»/.test(ultimi('sendMessage')[0].body.text), 'il bottone esegue il report');
    const id = reports.addDefinition('coda', 'Altra coda').id; // nasce spenta: non è nell'aiuto, ma si può chiedere
    calls.length = 0; await post(upd(555, '/aiuto')); ok(!new RegExp('/' + id).test(ultimi('sendMessage')[0].body.text), 'spento: non nell\'aiuto');
    reports.saveSettings(id, { enabled: true });
    calls.length = 0; await post(upd(555, '/' + id)); ok(/Niente da segnalare per «Altra coda»/.test(ultimi('sendMessage')[0].body.text));
    calls.length = 0; await post(upd(555, '/aiuto')); ok(new RegExp('/' + id + ' — Altra coda').test(ultimi('sendMessage')[0].body.text), 'l\'aiuto elenca i comandi dalle definizioni');
    reports.removeDefinition(id);
  });

  console.log('\n--- il bottone «Pagata» ---');
  await test('«Pagata»: la voce passa a pagato come nell\'app, il bottone diventa «Annulla», e resta nel registro attività', async () => {
    tg._resetRate(); calls.length = 0; await tap(555, 'pay:spese_personali:' + idN);
    eq(stato(idN), 'pagato'); ok(/Segnata pagata/.test(risposta()), risposta());
    eq(ultimi('editMessageReplyMarkup')[0].body.reply_markup.inline_keyboard[0][0].callback_data, 'undo:spese_personali:' + idN);
    ok(db.prepare("SELECT 1 FROM audit_log WHERE action = 'telegram.pay' AND actor = 'nima'").get(), 'nel registro');
  });
  await test('premerlo due volte non fa danni', async () => { calls.length = 0; await tap(555, 'pay:spese_personali:' + idN); eq(stato(idN), 'pagato'); ok(/già/.test(risposta()), risposta()); });
  await test('«Annulla» riporta la voce a «da pagare»', async () => {
    calls.length = 0; await tap(555, 'undo:spese_personali:' + idN); eq(stato(idN), 'da_pagare'); ok(/Annullato/.test(risposta()));
  });
  await test('Federica NON può toccare le spese personali (modulo non suo), nemmeno forzando il bottone', async () => {
    calls.length = 0; await tap(666, 'pay:spese_personali:' + idN); eq(stato(idN), 'da_pagare'); ok(/Non hai accesso/.test(risposta()), risposta());
  });
  await test('Federica può chiudere una voce di Casa (il modulo è suo)', async () => {
    calls.length = 0; await tap(666, 'pay:spese_casa:' + idC); eq(stato(idC), 'pagato');
  });
  await test('una chat non collegata non può chiudere niente; dati manomessi o righe non «da pagare» si rifiutano', async () => {
    const x = put('spese_casa', { descrizione: 'Nuova', importo: 5, data: IERI, _stato: 'da_smistare' }, 5);
    calls.length = 0; await tap(111, 'pay:spese_casa:' + x); eq(stato(x), 'da_smistare'); ok(/non è collegato/.test(risposta()));
    calls.length = 0; await tap(555, 'pay:spese_casa:' + x); eq(stato(x), 'da_smistare'); ok(/non è più/.test(risposta()), risposta());
    calls.length = 0; await tap(555, 'pay:spese_casa:1;DROP'); ok(/non riconosciuta/.test(risposta()));
    calls.length = 0; await tap(555, 'pay:spese_casa:999999'); ok(/non trovata/.test(risposta()));
  });

  console.log('\n--- limiti ---');
  await test('più di 20 messaggi al minuto da una chat: dal 21° il bot tace', async () => {
    tg._resetRate(); calls.length = 0; for (let i = 0; i < 25; i++) await post(upd(555, '/aiuto')); eq(ultimi('sendMessage').length, 20);
  });

  console.log('\n--- i report arrivano su Telegram, ognuno con la sua versione ---');
  await test('il report «scadute»: Nima e Federica ricevono ciascuno il proprio, con i bottoni; WhatsApp non collegato non è un errore', async () => {
    tg._resetRate(); db.prepare("UPDATE records SET data = ? WHERE id = ?").run(JSON.stringify({ descrizione: 'Affitto', importo: 550, data: IERI, _stato: 'da_pagare' }), idC);
    calls.length = 0; const o = await reports.sendReport('scadute', {}); eq(o.esito, 'inviato'); ok(/Telegram: Nima ✓/.test(o.dettaglio) && /Fede ✓/.test(o.dettaglio), o.dettaglio);
    const m = ultimi('sendMessage'); eq(m.length, 2);
    const nima = m.find((x) => x.body.chat_id === '555'), fede = m.find((x) => x.body.chat_id === '666');
    ok(nima.body.text.includes('Benzina') && !fede.body.text.includes('Benzina'), 'versioni diverse');
    ok(JSON.stringify(nima.body.reply_markup).includes('pay:spese_personali:'), 'Nima ha il bottone dei personali');
  });
  await test('A CHI ARRIVA: un report può essere ristretto a certi utenti; nessuna scelta = tutti i telefoni collegati', async () => {
    const fede = db.prepare("SELECT id FROM users WHERE username = 'fede'").get().id;
    reports.saveSettings('scadute', { utenti: [fede] });
    calls.length = 0; let o = await reports.sendReport('scadute', {}); eq(o.esito, 'inviato'); eq(ultimi('sendMessage').map((m) => m.body.chat_id), ['666'], 'solo Federica');
    ok(reports.saveSettings('scadute', { utenti: [99999] }).error, 'utente inesistente'); ok(reports.saveSettings('scadute', { utenti: 'x' }).error, 'forma non valida');
    reports.saveSettings('scadute', { utenti: [] });
    calls.length = 0; o = await reports.sendReport('scadute', {}); eq(ultimi('sendMessage').map((m) => m.body.chat_id).sort(), ['555', '666'], 'nessuna scelta = tutti');
    ok(reports.saveSettings('scadute', { tag: 'due parole' }).error, 'tag non valido'); eq(reports.saveSettings('scadute', { tag: 'famiglia' }).settings.scadute.tag, 'famiglia'); reports.saveSettings('scadute', { tag: 'scadenza' });
  });
  await test('con Telegram spento nelle impostazioni dei report, non parte niente su Telegram', async () => {
    reports.saveSettings('canali', { telegram: false }); calls.length = 0; const o = await reports.sendReport('scadute', {});
    eq(o.esito, 'non configurato'); eq(ultimi('sendMessage').length, 0); reports.saveSettings('canali', { telegram: true });
  });
  await test('un errore di Telegram per un telefono non ferma gli altri e si vede nell\'esito', async () => {
    const orig = tg.sendReportTo; let n = 0;
    const real = global.fetch; global.fetch = async (url, opt) => { if (String(url).endsWith('/sendMessage') && ++n === 1) { calls.push({ method: 'sendMessage', body: JSON.parse(opt.body) }); return { status: 403, json: async () => ({ ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' }) }; } return real(url, opt); };
    const o = await reports.sendReport('scadute', {}); global.fetch = real;
    eq(o.esito, 'parziale'); ok(/✗ Forbidden/.test(o.dettaglio), o.dettaglio);
  });

  console.log('\n--- scollegare ---');
  await test('ognuno scollega solo il proprio telefono; l\'admin qualunque; /scollega dalla chat', async () => {
    const links = tg.listLinks(); const nimaLink = links.find((l) => l.chat_id === '555'), fedeLink = links.find((l) => l.chat_id === '666');
    eq((await api('/links/' + nimaLink.id, { method: 'DELETE', headers: HF })).status, 403, 'Federica non scollega Nima');
    eq((await api('/links/' + fedeLink.id, { method: 'DELETE', headers: HF })).status, 200);
    tg._resetRate(); calls.length = 0; await post(upd(555, '/scollega')); eq(tg.linkedUser(555), null);
  });
  await test('l\'admin toglie il bot: webhook cancellato, token e telefoni via; il webhook non risponde più', async () => {
    const c = await nuovoCodice(HN); await post(upd(777, '/start ' + c.code)); eq(tg.listLinks().length, 1);
    calls.length = 0; eq((await api('/config', { method: 'DELETE', headers: HA })).status, 200);
    eq(ultimi('deleteWebhook').length, 1); eq(tg.listLinks().length, 0); eq(tg.isConfigured(), false);
    eq((await post(upd(777, '/pagare'), 'qualunque')).status, 404);
    eq((await api('/link-code', { method: 'POST', headers: HN })).status, 409, 'senza bot non si genera un codice');
  });

  console.log(`\n${'='.repeat(60)}`);
  console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
  try { fs.unlinkSync(dbPath); } catch (e) {}
  process.exit(failed > 0 ? 1 : 0);
}
main().catch((e) => { console.error('Suite telegram fallita ad avviarsi:', e); process.exit(1); });
