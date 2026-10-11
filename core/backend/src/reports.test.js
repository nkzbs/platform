'use strict';
// Report su WhatsApp (reports.js): da pagare il 27 (venerdì prima se cade nel weekend), da smistare ogni sera finché ce n'è, scadute il lunedì.
// Giorno e ora italiani; CallMeBot simulato. Eseguire con: node src/reports.test.js

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

process.env.DB_PATH = path.join(os.tmpdir(), 'reports-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'reports-test-uploads-'));
process.env.WHATSAPP_SPACING_MS = '0';
process.env.WHATSAPP_RETRY_MS = '1,1';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; }
}
function eq(a, e, msg) { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${msg || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); }
function ok(c, msg) { if (!c) throw new Error(msg || 'atteso true'); }

let sent = [];
const realFetch = global.fetch;
global.fetch = async (url) => {
  if (!String(url).startsWith('https://api.callmebot.com/')) return realFetch(url);
  sent.push(decodeURIComponent(new URL(url).searchParams.get('text')));
  return { status: 200, text: async () => 'Message queued. You will receive it in a few seconds.' };
};

(async () => {
  const db = require('./db');
  for (const [slug, n] of [['spese_casa', 'Spese casa'], ['spese_personali', 'Spese personali'], ['entrate', 'Entrate']]) db.prepare("INSERT OR IGNORE INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES (?, ?, 'box', '#000', 1, 1, 70, '{\"version\":3,\"steps\":[]}')").run(n, slug);
  require('./module-roles').seedIfEmpty();
  for (const k of require('./features').KEYS) require('./features').set(k, true);
  const R = require('./reports');
  // Entrate dichiara quali categorie sono stipendio (come fa Finance in Builder → Riepiloghi)
  require('./module-roles').set('entrate', { kind: 'entrata', uses: ['riepiloghi'], roles: { importo: 'importo', data: 'data', categoria: 'categoria', descrizione: 'descrizione' }, riepiloghi: { salary_categories: ['Stipendio'] } });

  const put = (slug, d) => db.prepare('INSERT INTO records (module_slug, user_id, data) VALUES (?, NULL, ?)').run(slug, JSON.stringify(d));
  const reset = () => { db.prepare("DELETE FROM records WHERE module_slug IN ('spese_casa', 'spese_personali', 'entrate')").run(); db.prepare('DELETE FROM report_sent').run(); db.prepare('DELETE FROM automation_logs').run(); sent = []; };
  const stato = (s) => ({ _stato: s });
  // ora italiana → istante UTC (CEST d'estate = UTC+2, CET d'inverno = UTC+1)
  const rome = (iso, h, m = 0, offset = 2) => new Date(Date.parse(iso + 'T00:00:00Z') + ((h - offset) * 60 + m) * 60000);

  console.log('\n--- quando parte il report «da pagare» ---');
  await test('il 27 se è un giorno feriale, il venerdì prima se cade di sabato o domenica', () => {
    eq(R.sendDateFor('2026-10-10', 27), '2026-10-27', 'martedì');
    eq(R.sendDateFor('2026-11-10', 27), '2026-11-27', 'venerdì');
    eq(R.sendDateFor('2026-12-10', 27), '2026-12-25', 'domenica 27 → venerdì 25');
    eq(R.sendDateFor('2027-02-10', 27), '2027-02-26', 'sabato 27 → venerdì 26');
  });
  await test('il periodo va dal giorno del report al 26 del mese dopo (anche a cavallo d\'anno)', () => {
    eq(R.endOfWindow('2026-10-27', 27), '2026-11-26'); eq(R.endOfWindow('2026-12-25', 27), '2027-01-26');
  });
  const S = { enabled: true, day: 27, hour: 18, stipendio: true };
  await test('dovuto solo dall\'ora scelta nel giorno stabilito; il giorno prima no; se il NAS era spento parte dopo, fino al giorno-paga', () => {
    eq(R.dueKey('pagare', S, rome('2026-10-27', 17, 59, 1)), null, 'prima delle 18');
    eq(R.dueKey('pagare', S, rome('2026-10-27', 18, 0, 1)), '2026-10-27');
    eq(R.dueKey('pagare', S, rome('2026-10-26', 20, 0, 1)), null, 'il giorno prima');
    eq(R.dueKey('pagare', S, rome('2026-12-25', 9, 0, 1)), null, 'venerdì ma presto'); eq(R.dueKey('pagare', S, rome('2026-12-25', 18, 0, 1)), '2026-12-25');
    eq(R.dueKey('pagare', S, rome('2026-12-26', 9, 0, 1)), '2026-12-25', 'sabato: NAS spento venerdì, parte appena torna');
    eq(R.dueKey('pagare', S, rome('2026-12-28', 9, 0, 1)), null, 'dopo il giorno-paga non più');
  });

  console.log('\n--- cosa dice il report «da pagare» ---');
  const IL27 = rome('2026-10-27', 18, 0, 1); // dal 25/10 ora solare
  const fixture = () => {
    reset();
    put('spese_casa', { descrizione: 'Affitto ottobre', importo: 550, data: '2026-10-27', ...stato('da_pagare') });
    put('spese_personali', { descrizione: 'Benzina + treno', importo: 200, data: '2026-10-27', ...stato('da_pagare') });
    put('spese_casa', { descrizione: 'A2A Energia', importo: 44, data: '2026-11-01', scadenza: '2026-11-05', ...stato('da_pagare') }); // la scadenza batte la data
    put('spese_casa', { descrizione: 'Troppo avanti', importo: 999, data: '2026-11-27', ...stato('da_pagare') }); // dopo il 26/11
    put('spese_casa', { descrizione: 'Già pagata', importo: 777, data: '2026-10-28', ...stato('pagato') });
    put('spese_personali', { descrizione: 'Scaduta di recente', importo: 50.17, data: '2026-10-20', ...stato('da_pagare') });
    put('spese_personali', { descrizione: 'Residuo antico', importo: 77, data: '2026-07-01', ...stato('da_pagare') });
    put('spese_casa', { descrizione: 'Bolletta nuova', importo: 0, data: '2026-10-25', ...stato('da_smistare') });
    put('entrate', { descrizione: 'Stipendio ottobre', importo: 1799.58, data: '2026-09-25', categoria: 'Stipendio' });
  };
  await test('totale con le scadute, diviso per modulo; esclude il pagato, il lontano, il residuo antico e le righe da smistare', () => {
    fixture(); const r = R.buildPagare(IL27);
    ok(r.text.includes('Da pagare dal 27/10 al 26/11'), r.text);
    ok(r.text.includes('*Totale: 844,17 €*'), r.text); // 550 + 200 + 44 + 50,17
    ok(r.text.includes('casa 594,00 €') && r.text.includes('pers. 250,17 €'), r.text);
    ok(r.text.includes('di cui scadute: 50,17 €'), r.text);
    ['Già pagata', 'Troppo avanti', 'Residuo antico', 'Bolletta nuova'].forEach((x) => ok(!r.text.includes(x), 'non deve esserci ' + x));
    eq(r.counts.scadute, 1);
  });
  await test('le righe sono in ordine di data, con la scadenza che batte la data, e le scadute segnate', () => {
    const t = R.buildPagare(IL27).text;
    ok(t.indexOf('20/10 Scaduta di recente') < t.indexOf('27/10 Affitto') && t.indexOf('27/10 Affitto') < t.indexOf('05/11 A2A'), t);
    ok(t.includes('20/10 Scaduta di recente — 50,17 € (pers.) ⚠'), t);
  });
  await test('«ultimo stipendio → ti restano»: lo stipendio meno il totale; spegnibile; se manca lo stipendio la riga non c\'è', () => {
    ok(R.buildPagare(IL27).text.includes('Ultimo stipendio 1799,58 € (25/09) → ti restano 955,41 €'));
    R.saveSettings('pagare', { stipendio: false }); ok(!R.buildPagare(IL27).text.includes('Ultimo stipendio')); R.saveSettings('pagare', { stipendio: true });
    db.prepare("DELETE FROM records WHERE module_slug = 'entrate'").run(); ok(!R.buildPagare(IL27).text.includes('Ultimo stipendio'));
  });
  await test('se il totale supera lo stipendio dice «mancano»', () => {
    put('entrate', { descrizione: 'Stipendio', importo: 100, data: '2026-09-26', categoria: 'Stipendio' }); // più recente: conta questo
    ok(R.buildPagare(IL27).text.includes('mancano 744,17 €'), R.buildPagare(IL27).text);
  });
  await test('oltre 25 righe: le prime 25 e «… e altre N», con il totale su tutte', () => {
    reset(); for (let i = 1; i <= 28; i++) put('spese_casa', { descrizione: 'Voce ' + i, importo: 10, data: '2026-11-' + String(Math.min(i, 25)).padStart(2, '0'), ...stato('da_pagare') });
    const t = R.buildPagare(IL27).text; ok(t.includes('… e altre 3'), t); ok(t.includes('280,00 €'));
  });
  await test('niente da pagare: il report lo dice (è mensile, una conferma serve)', () => {
    reset(); ok(R.buildPagare(IL27).text.includes('Niente da pagare'));
  });

  console.log('\n--- da smistare: ogni sera, finché ce n\'è ---');
  const SERA = rome('2026-10-12', 19, 5);
  await test('elenca le righe nello stato «nuovo» con l\'importo (o «da verificare») e dice che arriverà ogni sera', () => {
    reset(); put('spese_casa', { descrizione: 'A2A Energia', importo: 44, data: '2026-10-01', ...stato('da_smistare') }); put('spese_personali', { descrizione: 'Internet', importo: 0, data: '2026-10-02', ...stato('da_smistare') });
    const r = R.buildSmistare(); ok(r.text.includes('Da smistare: 2'), r.text); ok(r.text.includes('A2A Energia — 44,00 €') && r.text.includes('Internet — importo da verificare'), r.text); ok(/ogni sera/.test(r.text));
  });
  await test('coda vuota → nessun messaggio', () => { reset(); eq(R.buildSmistare(), null); });
  const SM = { enabled: true, hour: 19 };
  await test('dovuto dalle 19 per 5 ore, non prima né dopo', () => {
    eq(R.dueKey('smistare', SM, rome('2026-10-12', 18, 59)), null); eq(R.dueKey('smistare', SM, SERA), '2026-10-12'); eq(R.dueKey('smistare', SM, rome('2026-10-13', 0, 30)), null, 'mezzanotte e mezza: oltre la finestra');
  });

  console.log('\n--- scadute: il lunedì ---');
  await test('elenca le voci scadute con «da N giorni»; non le pagate, non le future, non i residui di mesi', () => {
    reset(); put('spese_personali', { descrizione: 'Benzina + treno', importo: 200, data: '2026-09-27', ...stato('da_pagare') }); put('spese_casa', { descrizione: 'Pagata', importo: 5, data: '2026-09-27', ...stato('pagato') });
    put('spese_casa', { descrizione: 'Futura', importo: 5, data: '2026-10-30', ...stato('da_pagare') }); put('spese_casa', { descrizione: 'Antica', importo: 5, data: '2026-06-01', ...stato('da_pagare') });
    const t = R.buildScadute(rome('2026-10-12', 19)).text;
    ok(t.includes('Voci scadute (1) — 200,00 €') && t.includes('da 15 giorni (27/09)'), t); ['Pagata', 'Futura', 'Antica'].forEach((x) => ok(!t.includes(x), x));
  });
  await test('nessuna scaduta → nessun messaggio', () => { reset(); eq(R.buildScadute(rome('2026-10-12', 19)), null); });
  const SC = { enabled: true, weekday: 1, hour: 19 };
  await test('solo di lunedì (12/10/2026 è lunedì), dall\'ora scelta', () => {
    eq(R.dueKey('scadute', SC, rome('2026-10-12', 19, 1)), '2026-10-12'); eq(R.dueKey('scadute', SC, rome('2026-10-13', 19, 1)), null, 'martedì'); eq(R.dueKey('scadute', SC, rome('2026-10-12', 18)), null);
  });

  console.log('\n--- invio, doppioni e impostazioni ---');
  db.prepare("INSERT OR REPLACE INTO connections (integration_id, connected, credentials) VALUES ('whatsapp_callmebot', 1, ?)").run(JSON.stringify({ api_key: 'k' }));
  await test('senza destinatari con il tag «scadenza» non parte nulla e lo dice', async () => {
    reset(); put('spese_casa', { descrizione: 'X', importo: 5, data: '2026-10-27', ...stato('da_pagare') });
    eq((await R.sendReport('pagare', { now: IL27 })).esito, 'non configurato'); eq(sent.length, 0);
  });
  db.prepare("INSERT INTO whatsapp_recipients (nome, numero, triggers, attivo) VALUES ('Nima', '+39 333 111 1111', ?, 1)").run(JSON.stringify(['scadenza']));
  await test('il controllo manda il report dovuto UNA volta sola, anche se gira ogni minuto', async () => {
    fixture(); sent = [];
    await R.tick(IL27); await R.tick(rome('2026-10-27', 18, 1, 1)); await R.tick(rome('2026-10-27', 19, 30, 1));
    eq(sent.filter((t) => t.includes('Da pagare dal')).length, 1);
    eq(db.prepare("SELECT COUNT(*) c FROM report_sent WHERE kind = 'pagare'").get().c, 1);
  });
  await test('da smistare: parte la sera, resta muto se la coda è vuota, e il giorno dopo ritorna se c\'è ancora qualcosa', async () => {
    reset(); sent = [];
    await R.tick(SERA); eq(sent.length, 0, 'coda vuota');
    put('spese_casa', { descrizione: 'A2A', importo: 44, data: '2026-10-01', ...stato('da_smistare') });
    await R.tick(rome('2026-10-12', 20)); eq(sent.length, 1, 'ora c\'è una bolletta'); await R.tick(rome('2026-10-12', 21)); eq(sent.length, 1, 'non due volte lo stesso giorno');
    await R.tick(rome('2026-10-13', 19, 2)); eq(sent.length, 2, 'il giorno dopo ancora');
    db.prepare("UPDATE records SET data = ? WHERE module_slug = 'spese_casa'").run(JSON.stringify({ descrizione: 'A2A', importo: 44, data: '2026-10-01', _stato: 'da_pagare' }));
    await R.tick(rome('2026-10-14', 19, 2)); eq(sent.filter((t) => t.includes('Da smistare')).length, 2, 'smistata: smette');
  });
  await test('un report spento non parte; le impostazioni si salvano e si controllano', async () => {
    fixture(); sent = []; R.saveSettings('pagare', { enabled: false }); await R.tick(IL27); eq(sent.length, 0); R.saveSettings('pagare', { enabled: true });
    eq(R.saveSettings('pagare', { hour: 30 }).error != null, true); eq(R.saveSettings('pagare', { day: 29 }).error != null, true); eq(R.saveSettings('scadute', { weekday: 9 }).error != null, true);
    eq(R.saveSettings('pagare', { day: 25, hour: 17 }).settings.pagare.day, 25); R.saveSettings('pagare', { day: 27, hour: 18 });
  });
  await test('con la funzione spenta niente parte', async () => {
    require('./features').set('riepilogo_mattino', false); eq((await R.tick(IL27)).skipped, 'funzione non attiva'); require('./features').set('riepilogo_mattino', true);
  });
  await test('con i report accesi gli avvisi «scadenza» per riga restano muti', () => {
    ok(R.isEnabled()); R.saveSettings('pagare', { enabled: false }); R.saveSettings('smistare', { enabled: false }); R.saveSettings('scadute', { enabled: false }); eq(R.isEnabled(), false);
    ['pagare', 'smistare', 'scadute'].forEach((k) => R.saveSettings(k, { enabled: true }));
  });

  console.log(`\n${'='.repeat(60)}\n${passed} passati, ${failed} falliti su ${passed + failed} test.`);
  try { fs.unlinkSync(process.env.DB_PATH); } catch (e) {}
  process.exit(failed > 0 ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
