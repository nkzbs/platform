'use strict';
// Bot Telegram «full powered» (bot-ai.js, bot-actions.js): frasi libere → una azione di un elenco chiuso → proposta con bottoni → esecuzione come l'utente. Telegram e AI simulati.
// Server reale, DB temporaneo. Eseguire con: node src/telegram-bot.test.js (porta 34819).

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const TEST_PORT = 34819;
const BASE = 'http://localhost:' + TEST_PORT;
const dbPath = path.join(os.tmpdir(), 'tgbot-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.DB_PATH = dbPath;
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'tgbot_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'tgbot_internal_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'tgbot_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tgbot-uploads-'));
process.env.SUPER_ADMIN_URL = 'http://localhost:1';
process.env.TENANT_SLUG = 'tgbot';

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
const SPESE = (extra = []) => ({ version: 3, steps: [F('descrizione', 'Descrizione', 'text'), F('importo', 'Importo', 'currency'), F('data', 'Data', 'date'), F('scadenza', 'Scadenza', 'date'), F('data_pagamento', 'Pagata il', 'date'), F('categoria', 'Categoria', 'select', { options: ['Benzina', 'Luce', 'Affitto'] }), F('note', 'Note', 'text'), ...WF, ...extra] });
const SOLO_PROPRI = { id: 'p1', block_type: 'permissions', rules: [{ role: 'user', view: true, view_own_only: true, owner_field: '', create: true, edit: true, delete: true }] };
const TOKEN = '123456789:' + 'A'.repeat(35);

const calls = []; const intents = {}; const asks = {}; let saDown = false;
const realFetch = global.fetch;
global.fetch = async (url, opt) => {
  const u = String(url), body = opt && opt.body ? JSON.parse(opt.body) : {};
  if (u.startsWith('https://api.telegram.org/file/')) return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array(Buffer.from('%PDF-1.4 bolletta di prova')).buffer };
  if (u.startsWith('https://api.telegram.org/bot')) {
    const method = u.split('/').pop(); calls.push({ method, body });
    return { status: 200, json: async () => ({ ok: true, result: method === 'getMe' ? { username: 'finance_test_bot' } : method === 'getFile' ? { file_path: 'docs/file_1.pdf' } : true }) };
  }
  if (u.includes('/api/tenant-ai/')) {
    if (saDown) throw new Error('rete giù');
    const frase = (body.data && (body.data.frase || body.data.domanda)) || '';
    const tabella = u.includes('bot-intent') ? intents : asks;
    const r = tabella[frase];
    if (!r) return { ok: false, status: 422, json: async () => ({ error: 'non so', code: 'ai_unanswerable' }) };
    if (r.__status) return { ok: false, status: r.__status, json: async () => ({ error: 'errore AI', code: 'ai_limit' }) };
    return { ok: true, status: 200, json: async () => (u.includes('bot-intent') ? { intent: r } : { query: r }) };
  }
  return realFetch(url, opt);
};
const ultimi = (m) => calls.filter((c) => c.method === m);

async function main() {
  require('./index.js');
  for (let i = 0; i < 100; i++) { try { if ((await realFetch(BASE + '/health')).ok) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const db = require('./db'); const tg = require('./telegram'); const roles = require('./module-roles'); const moduleAi = require('./module-ai');
  const bcrypt = require('bcryptjs'); const hash = bcrypt.hashSync('pw_di_prova_123', 4);
  const add = (slug, name, schema) => db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES (?, ?, 'box', '#000', 1, 1, 70, ?)").run(name, slug, JSON.stringify(schema));
  add('spese_casa', 'Spese Casa', SPESE()); add('spese_personali', 'Spese Personali', SPESE([SOLO_PROPRI]));
  const AV = { states: { nuovo: 'da_smistare', da_fare: 'da_pagare', fatto: 'pagato' }, scadenze: true, nuovo: true, noun_s: 'bolletta', noun_p: 'bollette' };
  const RL = { importo: 'importo', data: 'data', scadenza: 'scadenza', data_pagamento: 'data_pagamento', categoria: 'categoria', descrizione: 'descrizione', stato: '_stato' };
  roles.set('spese_casa', { kind: 'spesa', uses: ['avvisi', 'riepiloghi'], roles: RL, avvisi: { ...AV, label: 'casa' } }); roles.set('spese_personali', { kind: 'spesa', uses: ['avvisi', 'riepiloghi'], roles: RL, avvisi: { ...AV, label: 'pers.' } });
  for (const k of require('./features').KEYS) require('./features').set(k, true);
  const mkUser = (id, username, role) => db.prepare("INSERT INTO users (id, username, password_hash, display_name, role) VALUES (?, ?, ?, ?, ?)").run(id, username, hash, username[0].toUpperCase() + username.slice(1), role);
  mkUser(5, 'nima', 'user'); mkUser(6, 'fede', 'user');
  db.prepare("INSERT INTO user_modules (user_id, module_slug) VALUES (6, 'spese_casa')").run();
  await tg.connect(TOKEN, 'https://finance.example.it');
  db.prepare("INSERT INTO telegram_links (chat_id, user_id, label) VALUES ('555', 5, 'nima'), ('666', 6, 'fede')").run();
  const secret = require('./secrets-at-rest').unseal(db.prepare("SELECT credentials FROM connections WHERE integration_id = 'telegram'").get().credentials).secret;
  const post = (body) => realFetch(BASE + '/api/telegram/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-telegram-bot-api-secret-token': secret }, body: JSON.stringify(body) });
  const upd = (chat, text, extra = {}) => ({ update_id: 1, message: { message_id: 1, chat: { id: chat, type: 'private' }, from: { id: chat, first_name: 'P' }, text, ...extra } });
  const say = async (chat, text) => { tg._resetRate(); calls.length = 0; await post(upd(chat, text)); return ultimi('sendMessage').slice(-1)[0] ? ultimi('sendMessage').slice(-1)[0].body : null; };
  const tap = async (chat, data) => { tg._resetRate(); calls.length = 0; await post({ update_id: 2, callback_query: { id: 'cb' + Math.random(), data, message: { message_id: 77, chat: { id: chat, type: 'private' }, reply_markup: { inline_keyboard: [] } } } }); return { risposta: (ultimi('answerCallbackQuery').slice(-1)[0] || { body: {} }).body.text, modifica: (ultimi('editMessageText').slice(-1)[0] || { body: {} }).body }; };
  const put = (slug, d, uid) => db.prepare('INSERT INTO records (module_slug, user_id, data) VALUES (?, ?, ?)').run(slug, uid, JSON.stringify(d)).lastInsertRowid;
  const rec = (id) => { const r = db.prepare('SELECT * FROM records WHERE id = ?').get(id); return r ? { ...r, d: JSON.parse(r.data) } : null; };
  const bottoni = (m) => ((m && m.reply_markup && m.reply_markup.inline_keyboard) || []).flat();
  const cb = (m, inizio) => (bottoni(m).find((b) => b.callback_data.startsWith(inizio)) || {}).callback_data;
  const DOMANI = new Date(Date.now() + 86400000).toISOString().slice(0, 10), IERI = new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10);

  console.log('\n--- l\'AI è spenta o non risponde ---');
  await test('con l\'AI spenta le frasi libere lo dicono; i comandi fissi funzionano lo stesso', async () => {
    ok(/AI non è accesa/.test((await say(555, 'ho pagato l\'affitto')).text)); ok(/Da pagare|Niente|pagare/i.test((await say(555, '/pagare')).text));
  });
  moduleAi.setMaster(true);
  await test('l\'AI non risponde / non capisce / limite: messaggi chiari, niente cambia', async () => {
    ok(/Non ho capito/.test((await say(555, 'frase misteriosa')).text), 'non capisce (422)');
    intents['frase limite'] = { __status: 429 }; ok(/errore AI/.test((await say(555, 'frase limite')).text));
    saDown = true; ok(/non è raggiungibile/.test((await say(555, 'qualunque cosa')).text)); saDown = false;
  });
  await test('un intento fuori elenco (es. «elimina tutto») o un id deciso dal modello non fanno niente', async () => {
    const id = put('spese_casa', { descrizione: 'Affitto', importo: 550, data: IERI, _stato: 'da_pagare' }, 5);
    intents['elimina tutto'] = { azione: 'elimina_tutto' }; ok(/non so ancora farlo/.test((await say(555, 'elimina tutto')).text));
    intents['pago id'] = { azione: 'segna_pagata', cerca: 'zzznessuna', id, slug: 'spese_casa' }; ok(/Non trovo/.test((await say(555, 'pago id')).text)); eq(rec(id).d._stato, 'da_pagare', 'l\'id del modello non conta');
    db.prepare('DELETE FROM records WHERE id = ?').run(id);
  });

  console.log('\n--- segnare pagata ---');
  const idAff = put('spese_casa', { descrizione: 'Affitto ottobre', importo: 550, data: IERI, _stato: 'da_pagare' }, 5);
  intents['ho pagato l\'affitto'] = { azione: 'segna_pagata', cerca: 'affitto' };
  await test('la frase propone, NON esegue: la voce cambia solo dopo il tocco', async () => {
    const m = await say(555, 'ho pagato l\'affitto'); ok(/Segno come <b>pagata<\/b>/.test(m.text) && /Affitto ottobre/.test(m.text), m.text);
    eq(rec(idAff).d._stato, 'da_pagare', 'ancora da pagare'); ok(cb(m, 'ok:') && cb(m, 'no:'));
    const t = await tap(555, cb(m, 'ok:')); eq(rec(idAff).d._stato, 'pagato'); ok(/Segnata pagata/.test(t.modifica.text), JSON.stringify(t));
    ok(db.prepare("SELECT 1 FROM audit_log WHERE action = 'telegram.pay' AND actor = 'nima'").get(), 'nel registro');
  });
  await test('una proposta vale una volta sola; «No» annulla; un\'altra persona non può usare la tua proposta', async () => {
    db.prepare("UPDATE records SET data = ? WHERE id = ?").run(JSON.stringify({ descrizione: 'Affitto ottobre', importo: 550, data: IERI, _stato: 'da_pagare' }), idAff);
    const m = await say(555, 'ho pagato l\'affitto'); const ok1 = cb(m, 'ok:');
    ok(/scaduta|già stata usata/.test((await tap(666, ok1)).modifica.text), 'Federica non può'); eq(rec(idAff).d._stato, 'da_pagare');
    await tap(555, cb(m, 'no:')); eq(rec(idAff).d._stato, 'da_pagare', 'No annulla');
    ok(/scaduta|già stata usata/.test((await tap(555, ok1)).modifica.text), 'dopo il No non vale più');
    const m2 = await say(555, 'ho pagato l\'affitto'); const ok2 = cb(m2, 'ok:'); await tap(555, ok2); eq(rec(idAff).d._stato, 'pagato');
    ok(/scaduta|già stata usata/.test((await tap(555, ok2)).modifica.text), 'seconda volta');
  });
  await test('più voci simili: il bot chiede QUALE, e il tocco su una la chiude; le altre restano', async () => {
    const a = put('spese_personali', { descrizione: 'Spese Mese', importo: 200, data: IERI, _stato: 'da_pagare' }, 5), b = put('spese_personali', { descrizione: 'Spese Mese Extra', importo: 80, data: IERI, _stato: 'da_pagare' }, 5);
    intents['pago le spese mese'] = { azione: 'segna_pagata', cerca: 'spese mese' };
    const m = await say(555, 'pago le spese mese'); ok(/Quale/.test(m.text), m.text); eq(bottoni(m).filter((x) => x.callback_data.startsWith('pk:')).length, 2);
    await tap(555, bottoni(m).filter((x) => x.callback_data.startsWith('pk:'))[0].callback_data);
    eq([rec(a).d._stato, rec(b).d._stato].sort(), ['da_pagare', 'pagato']);
  });
  await test('voce non trovata, già pagata o ancora da smistare: lo dice, senza toccare niente', async () => {
    intents['pago la luce'] = { azione: 'segna_pagata', cerca: 'zzz' }; ok(/Non trovo/.test((await say(555, 'pago la luce')).text));
    ok(/già pagata/.test((await say(555, 'ho pagato l\'affitto')).text), 'l\'affitto è già pagato');
    put('spese_casa', { descrizione: 'Bolletta Gas nuova', importo: 0, data: IERI, _stato: 'da_smistare' }, 5);
    intents['pago il gas'] = { azione: 'segna_pagata', cerca: 'gas' }; ok(/da smistare/.test((await say(555, 'pago il gas')).text));
  });
  await test('«riapri» rimette da pagare una voce pagata (dopo conferma)', async () => {
    intents['riapri l\'affitto'] = { azione: 'riapri', cerca: 'affitto' };
    const m = await say(555, 'riapri l\'affitto'); ok(/Rimetto <b>da pagare/.test(m.text)); await tap(555, cb(m, 'ok:')); eq(rec(idAff).d._stato, 'da_pagare');
  });
  await test('Federica non trova (e non può toccare) le spese personali di Nima', async () => {
    intents['pago le spese mese di nima'] = { azione: 'segna_pagata', cerca: 'spese mese' };
    ok(/Non trovo/.test((await say(666, 'pago le spese mese di nima')).text));
  });

  console.log('\n--- smistare ---');
  const idBol = put('spese_casa', { descrizione: 'A2A Energia luce', importo: 44, data: IERI, _stato: 'da_smistare' }, 5);
  await test('un pagamento: propone e, dopo il tocco, la bolletta passa a «da pagare» (stessa rotta dell\'app)', async () => {
    intents['smista a2a'] = { azione: 'smista', cerca: 'a2a', modo: 'uno', n_rate: null, importo: null, scadenza: null };
    const m = await say(555, 'smista a2a'); ok(/come <b>un pagamento<\/b>/.test(m.text), m.text); eq(rec(idBol).d._stato, 'da_smistare');
    const t = await tap(555, cb(m, 'ok:')); eq(rec(idBol).d._stato, 'da_pagare'); ok(/Smistata/.test(t.modifica.text), JSON.stringify(t.modifica));
  });
  await test('già pagata con importo corretto; in rate senza dire quante: lo chiede', async () => {
    const id2 = put('spese_casa', { descrizione: 'Internet Intred', importo: 0, data: IERI, _stato: 'da_smistare' }, 5);
    intents['smista intred pagata 77'] = { azione: 'smista', cerca: 'intred', modo: 'pagata', n_rate: null, importo: 77.12, scadenza: null };
    const m = await say(555, 'smista intred pagata 77'); ok(/già pagata/.test(m.text) && /77,12/.test(m.text), m.text); await tap(555, cb(m, 'ok:'));
    eq(rec(id2).d._stato, 'pagato'); eq(rec(id2).d.importo, 77.12);
    const id3 = put('spese_casa', { descrizione: 'Acqua condominio', importo: 120, data: IERI, _stato: 'da_smistare' }, 5);
    intents['smista acqua in rate'] = { azione: 'smista', cerca: 'acqua', modo: 'rate', n_rate: null, importo: null, scadenza: null }; ok(/In quante rate/.test((await say(555, 'smista acqua in rate')).text)); eq(rec(id3).d._stato, 'da_smistare');
  });

  console.log('\n--- registrare una spesa ---');
  await test('«ho speso 20 euro di benzina»: propone, e dopo il tocco la riga esiste, di Nima, pagata, con la data di pagamento', async () => {
    intents['ho speso 20 euro di benzina'] = { azione: 'nuova_spesa', descrizione: 'Benzina', importo: 20, data: null, modulo: 'spese_personali', pagata: true, categoria: 'Benzina' };
    const prima = db.prepare("SELECT COUNT(*) c FROM records WHERE module_slug = 'spese_personali'").get().c;
    const m = await say(555, 'ho speso 20 euro di benzina'); ok(/Spese Personali/.test(m.text) && /già pagata/.test(m.text) && /20,00/.test(m.text), m.text);
    eq(db.prepare("SELECT COUNT(*) c FROM records WHERE module_slug = 'spese_personali'").get().c, prima, 'niente scritto prima del tocco');
    const t = await tap(555, cb(m, 'ok:')); ok(/Aggiunta/.test(t.modifica.text), JSON.stringify(t.modifica));
    const nuova = db.prepare("SELECT * FROM records WHERE module_slug = 'spese_personali' ORDER BY id DESC LIMIT 1").get(); const d = JSON.parse(nuova.data);
    eq([nuova.user_id, d.descrizione, d.importo, d._stato, d.categoria], [5, 'Benzina', 20, 'pagato', 'Benzina']); ok(d.data_pagamento, 'data pagamento');
    ok(db.prepare("SELECT 1 FROM audit_log WHERE action = 'telegram.nuova_spesa'").get());
  });
  await test('senza modulo e con due moduli chiede dove; una spesa «da pagare» prende la scadenza dalla data', async () => {
    intents['devo pagare 45 euro a mario'] = { azione: 'nuova_spesa', descrizione: 'Mario', importo: 45, data: DOMANI, modulo: null, pagata: false, categoria: null };
    const m = await say(555, 'devo pagare 45 euro a mario'); ok(/Dove la aggiungo/.test(m.text), m.text); eq(bottoni(m).filter((b) => b.callback_data.startsWith('pk:')).length, 2);
    const m2 = (await tap(555, bottoni(m).filter((b) => b.callback_data.startsWith('pk:'))[0].callback_data)).modifica; ok(/da pagare/.test(m2.text), m2.text);
    await tap(555, bottoni(m2).find((b) => b.callback_data.startsWith('ok:')).callback_data);
    const r = db.prepare("SELECT * FROM records WHERE module_slug = 'spese_casa' ORDER BY id DESC LIMIT 1").get(); const d = JSON.parse(r.data); eq([d.descrizione, d._stato, d.scadenza, d.data], ['Mario', 'da_pagare', DOMANI, DOMANI]);
  });
  await test('Federica: la spesa va in Casa (l\'unico suo modulo) anche se il modello nomina le personali', async () => {
    intents['fede spende 10'] = { azione: 'nuova_spesa', descrizione: 'Pane', importo: 10, data: null, modulo: 'spese_personali', pagata: true, categoria: null };
    const m = await say(666, 'fede spende 10'); ok(/Spese Casa/.test(m.text) && !/Spese Personali/.test(m.text), m.text);
  });
  await test('una categoria inventata dal modello non passa: la spesa si propone senza categoria', async () => {
    intents['cena 30 personali'] = { azione: 'nuova_spesa', descrizione: 'Cena', importo: 30, data: null, modulo: 'spese_personali', pagata: true, categoria: 'Ristoranti inventati' };
    const m = await say(555, 'cena 30 personali'); ok(/Cena/.test(m.text) && !/categoria/.test(m.text), m.text);
    await tap(555, cb(m, 'no:'));
  });
  await test('importi assurdi o descrizione mancante: rifiutati prima ancora di proporre', async () => {
    intents['spendo 999999999'] = { azione: 'nuova_spesa', descrizione: 'Yacht', importo: 999999999, data: null, modulo: null, pagata: true, categoria: null };
    ok(/Non ho capito/.test((await say(555, 'spendo 999999999')).text));
    intents['spendo meno 5'] = { azione: 'nuova_spesa', descrizione: 'X1', importo: -5, data: null, modulo: null, pagata: true, categoria: null }; ok(/Non ho capito/.test((await say(555, 'spendo meno 5')).text));
  });

  console.log('\n--- domande sui dati ---');
  await test('«quanto ho speso»: risposta calcolata dal codice, con i permessi di chi chiede (Federica non vede le personali)', async () => {
    intents['quanto ho speso in totale'] = { azione: 'domanda' };
    asks['quanto ho speso in totale'] = { modulo: 'spese_personali', calcolo: 'somma', periodo: null, filtri: [], raggruppa: 'nessuno', titolo: 'Totale spese personali' };
    const n = await say(555, 'quanto ho speso in totale'); ok(/Totale spese personali/.test(n.text) && /Totale: <b>/.test(n.text), n.text);
    const f = await say(666, 'quanto ho speso in totale'); ok(/Non riesco a rispondere/.test(f.text) && !/Totale spese personali/.test(f.text), f.text);
  });

  console.log('\n--- PDF mandati in chat ---');
  const pdfDoc = (extra = {}) => ({ document: { file_id: 'F1', file_name: 'bolletta.pdf', mime_type: 'application/pdf', file_size: 1000, ...extra } });
  const ai = require('./ai-suggestions'); const orig = ai.proposeFromDocument;
  ai.proposeFromDocument = async () => ({ proposta: { fornitore: 'A2A Energia', importo: 64, scadenza: '2026-11-07', categoria: 'Luce', confidenza: 'alta' } });
  const sayDoc = async (chat, extra) => { tg._resetRate(); calls.length = 0; await post(upd(chat, undefined, extra)); return ultimi('sendMessage').slice(-1)[0].body; };
  await test('foto o file che non è un PDF, o troppo grande: spiegato, niente letto', async () => {
    ok(/solo i <b>PDF/.test((await sayDoc(555, { photo: [{ file_id: 'p' }] })).text)); ok(/solo i <b>PDF/.test((await sayDoc(555, pdfDoc({ mime_type: 'image/png', file_name: 'a.png' }))).text));
    ok(/troppo grande/.test((await sayDoc(555, pdfDoc({ file_size: 9 * 1024 * 1024 }))).text));
  });
  await test('senza «Importare» acceso su nessun modulo: lo dice', async () => { ok(/non è accesa su nessuno/.test((await sayDoc(555, pdfDoc())).text)); });
  moduleAi.set('spese_casa', ['import']);
  await test('con un modulo che importa: l\'AI propone i campi, tu confermi, e la riga nasce «da smistare» con il PDF allegato', async () => {
    const m = await sayDoc(555, pdfDoc()); ok(/Ho letto il PDF/.test(m.text) && /A2A Energia/.test(m.text) && /64,00/.test(m.text), m.text);
    const prima = db.prepare("SELECT COUNT(*) c FROM records WHERE module_slug = 'spese_casa'").get().c;
    const t = await tap(555, cb(m, 'ok:')); ok(/Riga creata/.test(t.modifica.text), JSON.stringify(t.modifica));
    eq(db.prepare("SELECT COUNT(*) c FROM records WHERE module_slug = 'spese_casa'").get().c, prima + 1);
    const r = db.prepare("SELECT * FROM records WHERE module_slug = 'spese_casa' ORDER BY id DESC LIMIT 1").get(); eq(JSON.parse(r.data)._stato, 'da_smistare'); eq(db.prepare('SELECT COUNT(*) c FROM record_attachments WHERE record_id = ?').get(r.id).c, 1);
  });
  await test('con due moduli che importano chiede dove; Federica vede solo Casa', async () => {
    moduleAi.set('spese_personali', ['import']);
    const m = await sayDoc(555, pdfDoc()); ok(/Dove lo importo/.test(m.text)); eq(bottoni(m).filter((b) => b.callback_data.startsWith('im:')).length, 2);
    const t = await tap(555, bottoni(m).find((b) => b.callback_data.startsWith('im:')).callback_data); ok(/Ho letto il PDF/.test(t.modifica.text), JSON.stringify(t.modifica));
    const f = await sayDoc(666, pdfDoc()); ok(/Ho letto il PDF/.test(f.text), 'Federica ha un solo modulo: niente domanda');
  });
  ai.proposeFromDocument = orig;

  console.log('\n--- limiti ---');
  await test('dalla nona frase al minuto che passa dall\'AI, il bot chiede di aspettare (le prime otto passano)', async () => {
    tg._resetRate(); const testi = [];
    for (let i = 0; i < 9; i++) { calls.length = 0; await post(upd(666, 'frase senza senso numero ' + i)); testi.push(ultimi('sendMessage').slice(-1)[0].body.text); }
    ok(testi.slice(0, 8).every((t) => /Non ho capito/.test(t)), testi.slice(0, 8).join(' | ')); ok(/troppe frasi/.test(testi[8]), testi[8]);
  });

  console.log(`\n${'='.repeat(60)}`);
  console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
  try { fs.unlinkSync(dbPath); } catch (e) {}
  process.exit(failed > 0 ? 1 : 0);
}
main().catch((e) => { console.error('Suite telegram-bot fallita ad avviarsi:', e); process.exit(1); });
