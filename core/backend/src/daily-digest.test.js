'use strict';
// Riepilogo del mattino (daily-digest.js): un messaggio al giorno con le spese di oggi, domani e in
// ritardo. Giorno e ora sono quelli italiani; la scadenza è `scadenza` se c'è, altrimenti `data`.
// CallMeBot è simulato.
//
// Eseguire con: node src/daily-digest.test.js

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const dbPath = path.join(os.tmpdir(), 'digest-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.DB_PATH = dbPath;
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'digest-test-uploads-'));
process.env.WHATSAPP_SPACING_MS = '0';
process.env.WHATSAPP_RETRY_MS = '1,1';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; }
}
function assertEq(a, e, msg) { if (a !== e) throw new Error(`${msg || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); }
function assertTrue(c, msg) { if (!c) throw new Error(msg || 'atteso true'); }

let sent = [];
const realFetch = global.fetch;
global.fetch = async (url) => {
  if (!String(url).startsWith('https://api.callmebot.com/')) return realFetch(url);
  sent.push(decodeURIComponent(new URL(url).searchParams.get('text')));
  return { status: 200, text: async () => 'Message queued. You will receive it in a few seconds.' };
};

(async () => {
  const db = require('./db');
  for (const k of require('./features').KEYS) require('./features').set(k, true); // funzione facoltativa: qui serve accesa
  const digest = require('./daily-digest');
  const { runAzioni } = require('./automation-engine');

  const put = (slug, d) => db.prepare('INSERT INTO records (module_slug, user_id, data) VALUES (?, NULL, ?)').run(slug, JSON.stringify(d));
  const reset = () => { db.prepare("DELETE FROM records WHERE module_slug IN ('spese_casa', 'spese_personali')").run(); db.prepare('DELETE FROM automation_logs').run(); db.prepare('DELETE FROM notifications').run(); sent = []; };
  // sabato 3 ottobre 2026, 08:30 in Italia (06:30 UTC, ora legale)
  const MATTINO = new Date('2026-10-03T06:30:00Z');

  const fixture = () => {
    reset();
    put('spese_casa', { descrizione: 'A2A Energia', importo: 64, data: '2026-10-03', _stato: 'da_pagare' });
    put('spese_casa', { descrizione: 'Rata TV', importo: 135.87, data: '2026-09-27', scadenza: '2026-10-03', _stato: 'da_pagare' }); // la scadenza batte la data
    put('spese_casa', { descrizione: 'Già pagata', importo: 999, data: '2026-10-03', _stato: 'pagato' });
    put('spese_casa', { descrizione: 'Domani casa', importo: 40, data: '2026-10-04', _stato: 'da_pagare' });
    put('spese_personali', { descrizione: 'Rata Romaniello', importo: 100, data: '2026-10-04', _stato: 'da_pagare' });
    put('spese_personali', { descrizione: 'Cartella in ritardo', importo: 50.17, data: '2026-09-20', _stato: 'da_pagare' });
    put('spese_personali', { descrizione: 'Residuo antico', importo: 77, data: '2026-07-01', _stato: 'da_pagare' });
    put('spese_casa', { descrizione: 'Bolletta nuova', importo: 0, data: '2026-10-02', _stato: 'da_smistare' });
    put('spese_personali', { descrizione: 'Altra bolletta', importo: 0, data: '2026-10-02', _stato: 'da_smistare' });
  };

  console.log('\n--- cosa finisce nel messaggio ---');

  await test('raggruppa in Oggi, Domani, In ritardo, con totali e numero di bollette da smistare', () => {
    fixture();
    const d = digest.buildDigest(MATTINO);
    assertEq(d.counts.oggi, 2); assertEq(d.counts.domani, 2); assertEq(d.counts.ritardo, 1); assertEq(d.counts.daSmistare, 2);
    assertTrue(d.text.includes('*Oggi (2)* — 199,87 €'), d.text);
    assertTrue(d.text.includes('*Domani (2)* — 140,00 €'), d.text);
    assertTrue(d.text.includes('*In ritardo (1)* — 50,17 €'), d.text);
    assertTrue(d.text.includes('*Da smistare:* 2 bollette'), d.text);
  });

  await test('una riga si legge con descrizione, modulo e importo; quelle in ritardo dicono da quando', () => {
    const t = digest.buildDigest(MATTINO).text;
    assertTrue(t.includes('• A2A Energia (casa) 64,00 €'), t);
    assertTrue(t.includes('• Cartella in ritardo (pers.) 50,17 € dal 20/09'), t);
  });

  await test('la scadenza batte la data: la rata con scadenza oggi è tra quelle di oggi', () => {
    assertTrue(digest.buildDigest(MATTINO).text.includes('Rata TV'));
  });

  await test('le righe già pagate non compaiono mai', () => {
    assertTrue(!digest.buildDigest(MATTINO).text.includes('Già pagata'));
  });

  await test('un residuo vecchio di mesi non è un "ritardo": non entra nel riepilogo', () => {
    assertTrue(!digest.buildDigest(MATTINO).text.includes('Residuo antico'));
  });

  await test('in intestazione c\'è il giorno in italiano', () => {
    assertTrue(/Buongiorno!\* Sab/.test(digest.buildDigest(MATTINO).text), digest.buildDigest(MATTINO).text.split('\n')[0]);
  });

  await test('oltre 5 righe in un gruppo: le prime 5 e "… e altre N"', () => {
    reset();
    for (let i = 1; i <= 7; i++) put('spese_casa', { descrizione: 'Voce ' + i, importo: 10 * i, data: '2026-10-03', _stato: 'da_pagare' });
    const d = digest.buildDigest(MATTINO);
    assertEq((d.text.match(/^• /gm) || []).length, 5);
    assertTrue(d.text.includes('… e altre 2'));
    assertTrue(d.text.includes('280,00 €'), 'il totale conta TUTTE le righe, non solo le 5 mostrate');
  });

  await test('niente da segnalare -> nessun messaggio', () => {
    reset();
    put('spese_casa', { descrizione: 'Lontana', importo: 5, data: '2027-03-01', _stato: 'da_pagare' });
    assertEq(digest.buildDigest(MATTINO), null);
  });

  console.log('\n--- giorno e ora italiani ---');

  await test('subito dopo la mezzanotte in Italia è già il giorno dopo, anche se in UTC no', () => {
    fixture();
    const p = digest.romeParts(new Date('2026-10-03T22:30:00Z')); // 00:30 del 4 ottobre in Italia
    assertEq(p.date, '2026-10-04');
    const d = digest.buildDigest(new Date('2026-10-03T22:30:00Z'));
    assertEq(d.counts.oggi, 2, 'il 4 ottobre: "Domani casa" e "Rata Romaniello"');
  });

  await test('con l\'ora solare (inverno) lo scarto è di un\'ora, non due', () => {
    const p = digest.romeParts(new Date('2026-12-15T07:30:00Z'));
    assertEq(p.hour, 8);
    assertEq(p.date, '2026-12-15');
  });

  console.log('\n--- invio e pianificazione ---');

  db.prepare("INSERT OR REPLACE INTO connections (integration_id, connected, credentials) VALUES ('whatsapp_callmebot', 1, ?)").run(JSON.stringify({ api_key: 'k' }));

  await test('senza destinatari con il tag "scadenza" non parte nulla e lo dice', async () => {
    fixture();
    const out = await digest.sendDigest({ now: MATTINO });
    assertEq(out.esito, 'non configurato');
    assertEq(sent.length, 0);
  });

  db.prepare("INSERT INTO whatsapp_recipients (nome, numero, triggers, attivo) VALUES ('Nima', '+39 333 111 1111', ?, 1)").run(JSON.stringify(['scadenza']));

  await test('con un destinatario parte UN solo messaggio con tutto dentro, e il registro lo dice', async () => {
    fixture();
    const out = await digest.sendDigest({ now: MATTINO });
    assertEq(out.esito, 'inviato');
    assertEq(sent.length, 1);
    assertTrue(sent[0].includes('Oggi (2)') && sent[0].includes('Domani (2)'));
    const log = db.prepare("SELECT esito, action_desc FROM automation_logs WHERE automation_label = 'Riepilogo del mattino'").get();
    assertEq(log.esito, 'inviato');
  });

  await test('se non c\'è nulla da segnalare non manda un messaggio vuoto', async () => {
    reset();
    const out = await digest.sendDigest({ now: MATTINO });
    assertEq(out.esito, 'nulla da segnalare');
    assertEq(sent.length, 0);
  });

  await test('spento (default): il controllo del minuto non fa nulla', async () => {
    fixture();
    assertEq(digest.settings().enabled, false);
    assertEq((await digest.tick(MATTINO)).skipped, 'spento');
    assertEq(sent.length, 0);
  });

  await test('acceso, all\'ora scelta: parte; lo stesso giorno non riparte', async () => {
    fixture();
    digest.saveSettings({ enabled: true, hour: 8 });
    assertEq((await digest.tick(MATTINO)).esito, 'inviato');
    assertEq((await digest.tick(new Date('2026-10-03T06:45:00Z'))).skipped, 'già inviato oggi');
    assertEq(sent.length, 1);
  });

  await test('fuori dall\'ora scelta non parte (alle 9:30 italiane con l\'ora fissata alle 8)', async () => {
    fixture();
    db.prepare('UPDATE tenant_settings SET digest_last_sent = NULL WHERE id = 1').run();
    assertEq((await digest.tick(new Date('2026-10-03T07:30:00Z'))).skipped, 'non è l\'ora');
  });

  await test('il giorno dopo riparte', async () => {
    fixture();
    const out = await digest.tick(new Date('2026-10-04T06:30:00Z'));
    assertEq(out.esito, 'inviato');
  });

  await test('l\'ora si può cambiare, ma solo tra le 5 e le 12', () => {
    assertEq(digest.saveSettings({ hour: 9 }).hour, 9);
    assertEq(digest.saveSettings({ hour: 23 }).hour, 9, 'un valore fuori scala non si accetta');
    digest.saveSettings({ hour: 8 });
  });

  console.log('\n--- gli avvisi per riga ---');
  const AZIONE = [{ target: '__interno__', azione: 'invia_notifica', config: { trigger_tag: 'scadenza', messaggio: 'Scade oggi: {{descrizione}}' } }];
  const lastLog = () => db.prepare("SELECT esito FROM automation_logs WHERE automation_label = 'Notifica scadenza' ORDER BY id DESC").get();

  await test('con il riepilogo acceso l\'avviso "scadenza oggi" per riga NON parte (c\'è già nel riepilogo)', async () => {
    reset();
    assertEq(digest.isEnabled(), true);
    runAzioni(AZIONE, { descrizione: 'A2A' }, 'spese_casa', 'Notifica scadenza', 1, { triggerDesc: 't' }, {});
    await new Promise((r) => setTimeout(r, 50));
    assertEq(sent.length, 0);
    assertEq(lastLog().esito, 'sostituita dal riepilogo');
  });

  await test('con il riepilogo spento l\'avviso per riga funziona come prima', async () => {
    reset();
    digest.saveSettings({ enabled: false });
    runAzioni(AZIONE, { descrizione: 'A2A' }, 'spese_casa', 'Notifica scadenza', 1, { triggerDesc: 't' }, {});
    for (let i = 0; i < 50 && lastLog() && lastLog().esito === 'in invio'; i++) await new Promise((r) => setTimeout(r, 20));
    assertEq(sent.length, 1);
    assertEq(lastLog().esito, 'inviato');
  });

  await test('gli avvisi con un altro tag (bolletta, rata) non vengono toccati dal riepilogo', async () => {
    reset();
    digest.saveSettings({ enabled: true });
    db.prepare("UPDATE whatsapp_recipients SET triggers = ?").run(JSON.stringify(['scadenza', 'bolletta']));
    runAzioni([{ target: '__interno__', azione: 'invia_notifica', config: { trigger_tag: 'bolletta', messaggio: 'Nuova bolletta' } }], {}, 'spese_casa', 'Notifica bolletta', 2, { triggerDesc: 't' }, {});
    for (let i = 0; i < 50 && sent.length === 0; i++) await new Promise((r) => setTimeout(r, 20));
    assertEq(sent.length, 1);
  });

  console.log('\n--- avvio nel server ---');

  await test('startDailyDigest: il controllo ogni minuto gira senza errori (con e senza Redis)', async () => {
    // Bug trovato in produzione: withLock() restituisce una funzione, non una promessa, e il
    // codice chiamava .catch() su di essa: ogni minuto un TypeError e il riepilogo non partiva mai.
    const realSetInterval = global.setInterval;
    let cb = null;
    global.setInterval = (fn) => { cb = fn; return 0; };
    const errors = [];
    const realErr = console.error;
    console.error = (...a) => errors.push(a.join(' '));
    try {
      digest.startDailyDigest();
      assertTrue(typeof cb === 'function', 'deve programmare il controllo');
      cb();
      await new Promise((r) => setTimeout(r, 50));
    } finally { global.setInterval = realSetInterval; console.error = realErr; }
    assertEq(errors.length, 0, 'errori: ' + errors.join(' | '));
  });

  console.log(`\n${'='.repeat(60)}`);
  console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
  try { fs.unlinkSync(dbPath); } catch (e) {}
  process.exit(failed > 0 ? 1 : 0);
})().catch((e) => { console.error('Suite riepilogo fallita ad avviarsi:', e); process.exit(1); });
