'use strict';
// Invio WhatsApp con esito vero (whatsapp.js) e registro delle automazioni. CallMeBot è simulato.
//
// Prima: CallMeBot risponde HTTP 200 anche quando rifiuta il messaggio (chiave sbagliata, numero non
// attivato), la richiesta partiva senza attendere la risposta e il registro diceva "chiamata_reale":
// nessuno poteva sapere se un messaggio era arrivato.
//
// Eseguire con: node src/whatsapp.test.js

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const dbPath = path.join(os.tmpdir(), 'whatsapp-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.DB_PATH = dbPath;
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'whatsapp-test-uploads-'));
process.env.WHATSAPP_SPACING_MS = '40';
process.env.WHATSAPP_RETRY_MS = '5,5';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; }
}
function assertEq(a, e, msg) { if (a !== e) throw new Error(`${msg || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); }
function assertTrue(c, msg) { if (!c) throw new Error(msg || 'atteso true'); }

// CallMeBot finto: una coda di risposte, ognuna { status, body } oppure { throw }.
let replies = [];
let calls = [];
const realFetch = global.fetch;
global.fetch = async (url) => {
  if (!String(url).startsWith('https://api.callmebot.com/')) return realFetch(url);
  calls.push({ url: String(url), at: Date.now() });
  const r = replies.length > 1 ? replies.shift() : replies[0];
  if (r.throw) { const e = new Error(r.throw); e.name = r.name || 'Error'; throw e; }
  return { status: r.status, text: async () => r.body };
};
const OK = { status: 200, body: '<p>Message queued. You will receive it in a few seconds.</p>' };
const BAD_KEY = { status: 200, body: 'ERROR: APIKey is invalid or phone number is not activated' };

(async () => {
  const wa = require('./whatsapp');
  const db = require('./db');

  console.log('\n--- come si legge la risposta di CallMeBot ---');

  await test('"Message queued" -> inviato', () => {
    assertEq(wa.judge(200, OK.body).ok, true);
  });

  await test('HTTP 200 con un errore nel testo -> NON inviato, e non si riprova (è inutile)', () => {
    const j = wa.judge(200, BAD_KEY.body);
    assertEq(j.ok, false);
    assertEq(j.retry, false);
    assertTrue(/APIKey is invalid/.test(j.reason), 'il motivo deve dire cosa risponde CallMeBot: ' + j.reason);
  });

  await test('servizio occupato o HTTP 5xx -> si riprova', () => {
    assertEq(wa.judge(503, '').retry, true);
    assertEq(wa.judge(200, 'Server busy, try again later').retry, true);
  });

  await test('risposta vuota -> NON inviato, con un motivo leggibile', () => {
    const j = wa.judge(200, '');
    assertEq(j.ok, false);
    assertTrue(j.reason.length > 0);
  });

  console.log('\n--- invio con tentativi ---');

  await test('invio riuscito al primo colpo; il numero parte senza "+" e il testo codificato', async () => {
    calls = []; replies = [OK];
    const r = await wa.sendOne({ numero: '+39 333 123 4567', testo: 'Scade oggi: bolletta & rata', apiKey: 'chiave' });
    assertEq(r.ok, true);
    assertEq(r.attempts, 1);
    assertTrue(calls[0].url.includes('phone=393331234567'), 'numero: ' + calls[0].url);
    assertTrue(calls[0].url.includes('text=Scade%20oggi%3A%20bolletta%20%26%20rata'), 'testo codificato: ' + calls[0].url);
  });

  await test('chiave sbagliata: un solo tentativo, motivo restituito', async () => {
    calls = []; replies = [BAD_KEY];
    const r = await wa.sendOne({ numero: '393331234567', testo: 'x', apiKey: 'sbagliata' });
    assertEq(r.ok, false);
    assertEq(calls.length, 1, 'nessun tentativo inutile');
    assertTrue(/invalid/i.test(r.reason));
  });

  await test('rete che cade una volta: al secondo tentativo parte', async () => {
    calls = []; replies = [{ throw: 'ECONNRESET' }, OK];
    const r = await wa.sendOne({ numero: '393331234567', testo: 'x', apiKey: 'k' });
    assertEq(r.ok, true);
    assertEq(r.attempts, 2);
  });

  await test('rete sempre giù: 3 tentativi in tutto, poi fallisce con un motivo chiaro', async () => {
    calls = []; replies = [{ throw: 'getaddrinfo ENOTFOUND api.callmebot.com' }];
    const r = await wa.sendOne({ numero: '393331234567', testo: 'x', apiKey: 'k' });
    assertEq(r.ok, false);
    assertEq(calls.length, 3);
    assertTrue(/rete non raggiungibile/.test(r.reason), r.reason);
  });

  await test('nessuna risposta entro il tempo massimo -> motivo "nessuna risposta"', async () => {
    calls = []; replies = [{ throw: 'timeout', name: 'TimeoutError' }];
    const r = await wa.sendOne({ numero: '393331234567', testo: 'x', apiKey: 'k' });
    assertTrue(/nessuna risposta/.test(r.reason), r.reason);
  });

  console.log('\n--- più destinatari ---');

  await test('uno parte e uno no -> esito "parziale", con il motivo per chi non ha ricevuto', async () => {
    db.prepare('DELETE FROM notifications').run();
    calls = []; replies = [OK, BAD_KEY];
    const out = await wa.sendAll({ destinatari: [{ nome: 'Nima', numero: '3331111111' }, { nome: 'Fede', numero: '3332222222' }], testo: 'ciao', apiKey: 'k' });
    assertEq(out.esito, 'parziale');
    assertTrue(out.dettaglio.includes('Nima ✓'), out.dettaglio);
    assertTrue(out.dettaglio.includes('Fede ✗'), out.dettaglio);
  });

  await test('ogni invio finisce nel registro, con il tipo e l\'esito vero per destinatario', () => {
    const l = wa.recentLog(5)[0];
    assertEq(l.esito, 'parziale'); assertEq(l.kind, 'altro'); assertEq(l.testo, 'ciao');
    assertTrue(l.dettaglio.includes('Nima ✓') && l.dettaglio.includes('Fede ✗'), l.dettaglio);
  });

  await test('chi non riceve il messaggio ha un avviso nell\'app, riservato all\'admin', () => {
    const n = db.prepare("SELECT message, roles, category FROM notifications").all();
    assertEq(n.length, 1);
    assertTrue(n[0].message.includes('WhatsApp non consegnato a Fede'), n[0].message);
    assertEq(n[0].roles, '["admin"]');
  });

  await test('lo stesso errore non riempie l\'app di avvisi: uno solo all\'ora', async () => {
    calls = []; replies = [BAD_KEY];
    await wa.sendAll({ destinatari: [{ nome: 'Fede', numero: '3332222222' }], testo: 'ciao', apiKey: 'k' });
    assertEq(db.prepare('SELECT COUNT(*) c FROM notifications').get().c, 1);
  });

  await test('tutti ricevono -> "inviato", e nessun avviso', async () => {
    db.prepare('DELETE FROM notifications').run();
    calls = []; replies = [OK];
    const out = await wa.sendAll({ destinatari: [{ nome: 'Nima', numero: '3331111111' }], testo: 'ciao', apiKey: 'k' });
    assertEq(out.esito, 'inviato');
    assertEq(db.prepare('SELECT COUNT(*) c FROM notifications').get().c, 0);
  });

  await test('nessun destinatario -> lo dice, senza chiamare nessuno', async () => {
    calls = [];
    const out = await wa.sendAll({ destinatari: [], testo: 'ciao', apiKey: 'k' });
    assertEq(out.esito, 'nessun destinatario');
    assertEq(calls.length, 0);
  });

  await test('i messaggi escono UNO ALLA VOLTA, a distanza l\'uno dall\'altro (CallMeBot limita la frequenza)', async () => {
    calls = []; replies = [OK];
    await Promise.all([1, 2, 3].map((i) => wa.sendAll({ destinatari: [{ nome: 'N' + i, numero: '333000000' + i }], testo: 't' + i, apiKey: 'k' })));
    assertEq(calls.length, 3);
    assertTrue(calls[1].at - calls[0].at >= 35, 'tra il 1° e il 2°: ' + (calls[1].at - calls[0].at) + ' ms');
    assertTrue(calls[2].at - calls[1].at >= 35, 'tra il 2° e il 3°: ' + (calls[2].at - calls[1].at) + ' ms');
  });

  console.log('\n--- dentro un\'automazione vera ---');

  const { runAzioni } = require('./automation-engine');
  db.prepare("INSERT OR REPLACE INTO connections (integration_id, connected, credentials) VALUES ('whatsapp_callmebot', 1, ?)").run(JSON.stringify({ api_key: 'chiave-finta' }));
  db.prepare("INSERT INTO whatsapp_recipients (nome, numero, triggers, attivo) VALUES ('Nima', '+39 333 111 1111', ?, 1)").run(JSON.stringify(['scadenza']));
  const AZIONE = [{ target: '__interno__', azione: 'invia_notifica', config: { trigger_tag: 'scadenza', messaggio: 'Scade oggi: {{descrizione}}' } }];
  const lastLog = () => db.prepare("SELECT esito, action_desc FROM automation_logs WHERE automation_label = 'Notifica scadenza' ORDER BY id DESC").get();
  const waitDone = async () => { for (let i = 0; i < 100; i++) { const l = lastLog(); if (l && l.esito !== 'in invio') return l; await new Promise((r) => setTimeout(r, 20)); } return lastLog(); };

  await test('il registro nasce "in invio" e poi riporta l\'esito vero: inviato', async () => {
    db.prepare('DELETE FROM automation_logs').run();
    calls = []; replies = [OK];
    runAzioni(AZIONE, { descrizione: 'A2A Energia' }, 'spese_casa', 'Notifica scadenza', 7, { triggerDesc: 'ogni giorno alle 8' }, {});
    assertEq(lastLog().esito, 'in invio', 'subito dopo la chiamata');
    const l = await waitDone();
    assertEq(l.esito, 'inviato');
    assertTrue(l.action_desc.includes('Nima ✓'), l.action_desc);
    assertTrue(decodeURIComponent(calls[0].url).includes('Scade oggi: A2A Energia'), 'testo interpolato col campo del record');
  });

  await test('chiave sbagliata: il registro dice FALLITO con il motivo (prima diceva "chiamata_reale")', async () => {
    db.prepare('DELETE FROM automation_logs').run();
    db.prepare('DELETE FROM notifications').run();
    calls = []; replies = [BAD_KEY];
    runAzioni(AZIONE, { descrizione: 'Rata TV' }, 'spese_casa', 'Notifica scadenza', 8, { triggerDesc: 'ogni giorno alle 8' }, {});
    const l = await waitDone();
    assertEq(l.esito, 'FALLITO');
    assertTrue(/invalid/i.test(l.action_desc), l.action_desc);
    assertTrue(db.prepare('SELECT COUNT(*) c FROM notifications').get().c >= 1, 'avviso nell\'app');
  });

  await test('anteprima (dryRun): nessun messaggio parte davvero', async () => {
    calls = []; replies = [OK];
    const dryLog = [];
    runAzioni(AZIONE, { descrizione: 'x' }, 'spese_casa', 'Notifica scadenza', 9, { triggerDesc: 't' }, { dryRun: true, dryLog });
    await new Promise((r) => setTimeout(r, 80));
    assertEq(calls.length, 0);
    assertTrue(dryLog.length > 0, 'l\'anteprima descrive cosa farebbe');
  });

  console.log(`\n${'='.repeat(60)}`);
  console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
  try { fs.unlinkSync(dbPath); } catch (e) {}
  process.exit(failed > 0 ? 1 : 0);
})().catch((e) => { console.error('Suite WhatsApp fallita ad avviarsi:', e); process.exit(1); });
