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
  const S = R.definizione('pagare');
  await test('dovuto solo dall\'ora scelta nel giorno stabilito; il giorno prima no; se il NAS era spento parte dopo, fino al giorno-paga', () => {
    eq(R.dueKey(S, rome('2026-10-27', 17, 59, 1)), null, 'prima delle 18');
    eq(R.dueKey(S, rome('2026-10-27', 18, 0, 1)), '2026-10-27');
    eq(R.dueKey(S, rome('2026-10-26', 20, 0, 1)), null, 'il giorno prima');
    eq(R.dueKey(S, rome('2026-12-25', 9, 0, 1)), null, 'venerdì ma presto'); eq(R.dueKey(S, rome('2026-12-25', 18, 0, 1)), '2026-12-25');
    eq(R.dueKey(S, rome('2026-12-26', 9, 0, 1)), '2026-12-25', 'sabato: NAS spento venerdì, parte appena torna');
    eq(R.dueKey(S, rome('2026-12-28', 9, 0, 1)), null, 'dopo il giorno-paga non più');
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
    fixture(); const r = R.build('pagare', IL27);
    ok(r.text.includes('*Da pagare* · fino al 26/11'), r.text);
    ok(r.text.includes('*844,17 €*'), r.text); // 550 + 200 + 44 + 50,17
    ok(r.text.includes('casa 594 €') && r.text.includes('pers. 250,17 €'), r.text);
    ok(r.text.includes('⚠ Attenzione, *50,17 €* è già scaduto — 1 voce dal 20/10') && r.text.includes('«Voci scadute»'), r.text);
    ['Già pagata', 'Troppo avanti', 'Residuo antico', 'Bolletta nuova'].forEach((x) => ok(!r.text.includes(x), 'non deve esserci ' + x));
    eq(r.counts.scadute, 1);
  });
  await test('le righe «in arrivo» sono in ordine di data, con la scadenza che batte la data; le scadute non si ripetono se hanno il loro messaggio', () => {
    const t = R.build('pagare', IL27).text;
    ok(t.indexOf('*27/10*  Affitto') < t.indexOf('*27/10*  Benzina') && t.indexOf('*27/10*  Benzina') < t.indexOf('*05/11*  A2A'), t);
    ok(t.includes('• *27/10*  Affitto ottobre — 550 €') && t.includes('• *05/11*  A2A Energia — 44 €'), t);
    ok(!t.includes('Scaduta di recente'), 'le scadute le elenca il loro messaggio');
  });
  await test('con il messaggio «scadute» spento, le scadute si elencano nel messaggio del 27', () => {
    R.saveSettings('scadute', { enabled: false }); const t = R.build('pagare', IL27).text; R.saveSettings('scadute', { enabled: true });
    ok(t.includes('• *20/10*  Scaduta di recente — 50,17 €') && !t.includes('«Voci scadute»'), t);
  });
  await test('«ultimo stipendio → ti restano»: lo stipendio meno il totale; spegnibile; se manca lo stipendio la riga non c\'è', () => {
    ok(R.build('pagare', IL27).text.includes('💰 Con lo stipendio di 1.799,58 € ti restano *955,41 €* liberi'));
    R.saveSettings('pagare', { stipendio: false }); ok(!R.build('pagare', IL27).text.includes('💰 Stipendio')); R.saveSettings('pagare', { stipendio: true });
    db.prepare("DELETE FROM records WHERE module_slug = 'entrate'").run(); ok(!R.build('pagare', IL27).text.includes('💰 Stipendio'));
  });
  await test('se il totale supera lo stipendio dice «mancano»', () => {
    put('entrate', { descrizione: 'Stipendio', importo: 100, data: '2026-09-26', categoria: 'Stipendio' }); // più recente: conta questo
    ok(R.build('pagare', IL27).text.includes('mancano *744,17 €*'), R.build('pagare', IL27).text);
  });
  await test('elenco completo di default (nessun «+ altre»); se abbassi le righe mostrate: le prime N e «+ altre», con il totale su tutte', () => {
    reset(); for (let i = 1; i <= 28; i++) put('spese_casa', { descrizione: 'Voce ' + i, importo: 10, data: '2026-11-' + String(Math.min(i, 25)).padStart(2, '0'), ...stato('da_pagare') });
    let t = R.build('pagare', IL27).text; ok(t.includes('Voce 28') && !t.includes('+ altre'), t); ok(t.includes('*280,00 €*'), t);
    R.saveSettings('pagare', { max_righe: 8 });
    t = R.build('pagare', IL27).text; ok(t.includes('+ altre 20'), t); ok(t.includes('*280,00 €*'), t);
    R.saveSettings('pagare', { max_righe: 100 });
  });
  await test('niente da pagare: il report lo dice (è mensile, una conferma serve)', () => {
    reset(); ok(R.build('pagare', IL27).text.includes('Niente da pagare'));
  });

  console.log('\n--- da smistare: ogni sera, finché ce n\'è ---');
  const SERA = rome('2026-10-12', 19, 5);
  await test('elenca le righe nello stato «nuovo» con l\'importo (o «da verificare») e dice che arriverà ogni sera', () => {
    reset(); put('spese_casa', { descrizione: 'A2A Energia', importo: 44, data: '2026-10-01', ...stato('da_smistare') }); put('spese_personali', { descrizione: 'Internet', importo: 0, data: '2026-10-02', ...stato('da_smistare') });
    const r = R.build('smistare'); ok(r.text.includes('*Da smistare* · 2'), r.text); ok(r.text.includes('A2A Energia — 44 €') && r.text.includes('Internet — importo da verificare'), r.text); ok(/ogni sera/.test(r.text));
  });
  await test('coda vuota → nessun messaggio', () => { reset(); eq(R.build('smistare'), null); });
  const SM = R.definizione('smistare');
  await test('dovuto dalle 19 per 5 ore, non prima né dopo', () => {
    eq(R.dueKey(SM, rome('2026-10-12', 18, 59)), null); eq(R.dueKey(SM, SERA), '2026-10-12'); eq(R.dueKey(SM, rome('2026-10-13', 0, 30)), null, 'mezzanotte e mezza: oltre la finestra');
  });

  console.log('\n--- scadute: il lunedì ---');
  await test('elenca le voci scadute con «da N giorni»; non le pagate, non le future, non i residui di mesi', () => {
    reset(); put('spese_personali', { descrizione: 'Benzina + treno', importo: 200, data: '2026-09-27', ...stato('da_pagare') }); put('spese_casa', { descrizione: 'Pagata', importo: 5, data: '2026-09-27', ...stato('pagato') });
    put('spese_casa', { descrizione: 'Futura', importo: 5, data: '2026-10-30', ...stato('da_pagare') }); put('spese_casa', { descrizione: 'Antica', importo: 5, data: '2026-06-01', ...stato('da_pagare') });
    const t = R.build('scadute', rome('2026-10-12', 19)).text;
    ok(t.includes('*Scadute* · 200,00 € (1 voce)') && t.includes('da 15 gg'), t); ['Pagata', 'Futura', 'Antica'].forEach((x) => ok(!t.includes(x), x));
  });
  await test('nessuna scaduta → nessun messaggio', () => { reset(); eq(R.build('scadute', rome('2026-10-12', 19)), null); });
  const SC = R.definizione('scadute');
  await test('solo di lunedì (12/10/2026 è lunedì), dall\'ora scelta', () => {
    eq(R.dueKey(SC, rome('2026-10-12', 19, 1)), '2026-10-12'); eq(R.dueKey(SC, rome('2026-10-13', 19, 1)), null, 'martedì'); eq(R.dueKey(SC, rome('2026-10-12', 18)), null);
  });

  console.log('\n--- invio, doppioni e impostazioni ---');
  db.prepare("INSERT OR REPLACE INTO connections (integration_id, connected, credentials) VALUES ('whatsapp_callmebot', 1, ?)").run(JSON.stringify({ api_key: 'k' }));
  await test('senza destinatari con il tag «scadenza» non parte nulla e lo dice', async () => {
    reset(); put('spese_casa', { descrizione: 'X', importo: 5, data: '2026-10-27', ...stato('da_pagare') });
    eq((await R.sendReport('pagare', { now: IL27 })).esito, 'non configurato'); eq(sent.length, 0);
  });
  db.prepare("INSERT INTO whatsapp_recipients (nome, numero, triggers, attivo) VALUES ('Nima', '+39 333 111 1111', ?, 1)").run(JSON.stringify(['scadenza']));
  await test('A CHI ARRIVA su WhatsApp: ogni report ha il suo tag dei destinatari', async () => {
    fixture(); sent = [];
    R.saveSettings('pagare', { tag: 'famiglia' }); const o = await R.sendReport('pagare', { now: IL27 });
    eq(o.esito, 'non configurato'); ok(/tag "famiglia"/.test(o.motivo), o.motivo); eq(sent.length, 0);
    R.saveSettings('pagare', { tag: 'scadenza' });
  });
  await test('il controllo manda il report dovuto UNA volta sola, anche se gira ogni minuto', async () => {
    fixture(); sent = [];
    await R.tick(IL27); await R.tick(rome('2026-10-27', 18, 1, 1)); await R.tick(rome('2026-10-27', 19, 30, 1));
    eq(sent.filter((t) => t.includes('*Da pagare*')).length, 1);
    eq(db.prepare("SELECT COUNT(*) c FROM report_sent WHERE kind = 'pagare'").get().c, 1);
  });
  await test('da smistare: parte la sera, resta muto se la coda è vuota, e il giorno dopo ritorna se c\'è ancora qualcosa', async () => {
    reset(); sent = [];
    await R.tick(SERA); eq(sent.length, 0, 'coda vuota');
    put('spese_casa', { descrizione: 'A2A', importo: 44, data: '2026-10-01', ...stato('da_smistare') });
    await R.tick(rome('2026-10-12', 20)); eq(sent.length, 1, 'ora c\'è una bolletta'); await R.tick(rome('2026-10-12', 21)); eq(sent.length, 1, 'non due volte lo stesso giorno');
    await R.tick(rome('2026-10-13', 19, 2)); eq(sent.length, 2, 'il giorno dopo ancora');
    db.prepare("UPDATE records SET data = ? WHERE module_slug = 'spese_casa'").run(JSON.stringify({ descrizione: 'A2A', importo: 44, data: '2026-10-01', _stato: 'da_pagare' }));
    await R.tick(rome('2026-10-14', 19, 2)); eq(sent.filter((t) => t.includes('*Da smistare*')).length, 2, 'smistata: smette');
  });
  await test('un report spento non parte; le impostazioni si salvano e si controllano', async () => {
    fixture(); sent = []; R.saveSettings('pagare', { enabled: false }); await R.tick(IL27); eq(sent.length, 0); R.saveSettings('pagare', { enabled: true });
    eq(R.saveSettings('pagare', { ora: 30 }).error != null, true); eq(R.saveSettings('pagare', { giorno: 29 }).error != null, true); eq(R.saveSettings('scadute', { weekday: 9 }).error != null, true);
    eq(R.saveSettings('pagare', { giorno: 25, ora: 17 }).settings.pagare.giorno, 25); R.saveSettings('pagare', { giorno: 27, ora: 18 });
  });
  await test('con la funzione spenta niente parte', async () => {
    require('./features').set('riepilogo_mattino', false); eq((await R.tick(IL27)).skipped, 'funzione non attiva'); require('./features').set('riepilogo_mattino', true);
  });
  await test('con i report accesi gli avvisi «scadenza» per riga restano muti', () => {
    ok(R.isEnabled()); R.saveSettings('pagare', { enabled: false }); R.saveSettings('smistare', { enabled: false }); R.saveSettings('scadute', { enabled: false }); eq(R.isEnabled(), false);
    ['pagare', 'smistare', 'scadute'].forEach((k) => R.saveSettings(k, { enabled: true }));
  });

  console.log('\n--- definizioni: report configurabili, anche nuovi ---');
  await test('le impostazioni salvate nella forma vecchia diventano definizioni (stesso id, stessi valori), senza rimandare un report già mandato', () => {
    db.prepare('UPDATE tenant_settings SET report_settings = ? WHERE id = 1').run(JSON.stringify({ canali: { whatsapp: true, telegram: false }, pagare: { enabled: true, day: 25, hour: 17, stipendio: false }, smistare: { enabled: false, hour: 20 }, scadute: { enabled: true, weekday: 3, hour: 8 } }));
    const st = R.settings(), ids = st.definizioni.map((d) => d.id);
    eq(ids, ['pagare', 'smistare', 'scadute']); eq([st.pagare.giorno, st.pagare.ora, st.pagare.stipendio, st.smistare.enabled, st.smistare.ora, st.scadute.weekday, st.scadute.ora], [25, 17, false, false, 20, 3, 8]);
    eq(st.canali.telegram, false);
    db.prepare('UPDATE tenant_settings SET report_settings = NULL WHERE id = 1').run();
  });
  await test('si aggiunge un report di un tipo (spento), si configura e si toglie; l\'id è il comando del bot', () => {
    const a = R.addDefinition('ore_periodo', 'Ore del mese'); eq(a.id, 'ore_periodo_1'); eq(R.definizione('ore_periodo_1').enabled, false); eq(R.definizione('ore_periodo_1').nome, 'Ore del mese');
    eq(R.addDefinition('ore_periodo').id, 'ore_periodo_2');
    ok(R.addDefinition('boh').error); ok(R.saveSettings('ore_periodo_1', { freq: 'giornaliera' }).error, 'frequenza non ammessa per il tipo'); ok(R.saveSettings('pagare', { freq: 'settimanale' }).error);
    ok(R.saveSettings('ore_periodo_1', { periodo: 'sempre' }).error); ok(R.saveSettings('coda_9', {}).error);
    eq(R.saveSettings('ore_periodo_1', { periodo: 'settimana_scorsa', freq: 'settimanale', weekday: 1, ora: 8, titolo: 'Ore *di* settimana', enabled: true }).settings.ore_periodo_1.titolo, 'Ore di settimana');
    eq(R.removeDefinition('ore_periodo_2').settings.definizioni.length, 4); ok(R.removeDefinition('ore_periodo_2').error);
  });
  await test('un tipo con un altro stato: la coda può guardare lo stato «da fare», con un titolo suo', () => {
    reset(); put('spese_casa', { descrizione: 'Affitto', importo: 500, data: '2026-10-01', scadenza: '2026-10-30', ...stato('da_pagare') });
    R.addDefinition('coda', 'Da pagare in coda'); R.saveSettings('coda_1', { stato: 'da_fare', titolo: 'In coda', piede: '', emoji: '🔔', enabled: true });
    const r = R.build('coda_1'); ok(r.text.startsWith('🔔 *In coda* · 1 bolletta') || r.text.startsWith('🔔 *In coda* · 1 '), r.text); ok(r.text.includes('Affitto — 500 €') && !/Ti ricordo/.test(r.text), r.text);
    R.removeDefinition('coda_1');
  });
  await test('ore lavorate: per persona, anche a cavallo della mezzanotte; i turni aperti non contano; ogni utente vede le sue', () => {
    const SCHEMA_TMB = JSON.stringify({ version: 3, steps: [{ id: 'f1', block_type: 'field', key: 'data', label: 'Data', type: 'date' }, { id: 'f2', block_type: 'field', key: 'entrata', label: 'Entrata', type: 'time' }, { id: 'f3', block_type: 'field', key: 'uscita', label: 'Uscita', type: 'time' }, { id: 'p1', block_type: 'permissions', rules: [{ role: 'user', view: true, view_own_only: true, owner_field: '', create: true, edit: true, delete: true }] }] });
    db.prepare("INSERT OR IGNORE INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES ('Timbrature', 'tmb', 'box', '#000', 1, 1, 60, ?)").run(SCHEMA_TMB);
    require('./module-roles').set('tmb', { kind: 'presenze', uses: [], roles: { data: 'data', inizio: 'entrata', fine: 'uscita' } });
    const u1 = db.prepare("INSERT INTO users (username, password_hash, display_name, role) VALUES ('ann', 'x', 'Anna', 'user')").run().lastInsertRowid;
    const u2 = db.prepare("INSERT INTO users (username, password_hash, display_name, role) VALUES ('bea', 'x', 'Bea', 'user')").run().lastInsertRowid;
    const riga = (u, d) => db.prepare("INSERT INTO records (module_slug, user_id, data) VALUES ('tmb', ?, ?)").run(u, JSON.stringify(d));
    riga(u1, { data: '2026-09-10', entrata: '07:00', uscita: '12:30' }); riga(u1, { data: '2026-09-11', entrata: '22:00', uscita: '01:00' }); riga(u1, { data: '2026-09-12', entrata: '15:00' }); riga(u2, { data: '2026-09-14', entrata: '08:00', uscita: '16:00' }); riga(u2, { data: '2026-08-31', entrata: '08:00', uscita: '10:00' });
    const id = R.addDefinition('ore_periodo').id;
    const t = R.build(id, rome('2026-10-12', 9)).text;
    ok(t.startsWith('🕒 *Ore lavorate* · Mese scorso'), t); ok(/Bea — \*8h\* \(1 giorno\)/.test(t) && /Anna — \*8h 30m\* \(2 giorni\)/.test(t), t); ok(/Totale: \*16h 30m\*/.test(t), t); ok(/1 turno è ancora aperto/.test(t), t);
    const mia = R.build(id, rome('2026-10-12', 9), { user: { id: u2, role: 'user' }, slugs: new Set(['tmb']) });
    ok(mia === null || !/Anna/.test(mia.text), 'chi non è admin non vede le ore degli altri');
    eq(R.build(id, rome('2027-03-12', 9)), null, 'nessuna timbratura nel periodo → nessun messaggio');
    eq(R.dueKey(R.definizione(id), rome('2026-10-01', 9, 0)), '2026-10-01', 'mensile, senza spostamento nel weekend'); eq(R.dueKey(R.definizione(id), rome('2026-10-01', 8, 0)), null);
    R.removeDefinition(id); R.removeDefinition('ore_periodo_1'); db.prepare("DELETE FROM records WHERE module_slug = 'tmb'").run();
  });

  await test('RIEPILOGO ORE E STRAORDINARI (domenica sera): settimana, mese finora, straordinario oltre la soglia; ogni persona vede il suo', async () => {
    const SCHEMA = JSON.stringify({ version: 3, steps: [{ id: 'f1', block_type: 'field', key: 'data', label: 'Data', type: 'date' }, { id: 'f2', block_type: 'field', key: 'entrata', label: 'Entrata', type: 'time' }, { id: 'f3', block_type: 'field', key: 'uscita', label: 'Uscita', type: 'time' }, { id: 'p1', block_type: 'permissions', rules: [{ role: 'user', view: true, view_own_only: true, owner_field: '', create: true, edit: true, delete: true }] }] });
    db.prepare("INSERT OR IGNORE INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES ('Timbrature', 'tmb', 'box', '#000', 1, 1, 60, ?)").run(SCHEMA);
    require('./module-roles').set('tmb', { kind: 'presenze', uses: [], roles: { data: 'data', inizio: 'entrata', fine: 'uscita' } });
    const fede = db.prepare("INSERT INTO users (username, password_hash, display_name, role) VALUES ('federica', 'x', 'Federica', 'user')").run().lastInsertRowid;
    const altra = db.prepare("INSERT INTO users (username, password_hash, display_name, role) VALUES ('altra', 'x', 'Altra', 'user')").run().lastInsertRowid;
    const riga = (u, g, e, f) => db.prepare("INSERT INTO records (module_slug, user_id, data) VALUES ('tmb', ?, ?)").run(u, JSON.stringify({ data: g, entrata: e, uscita: f }));
    // settimana 5–11 ottobre 2026: 5 turni da 8h30 = 42h30 (straordinario 2h30 oltre le 40h); 1–2 ottobre (giovedì e venerdì della settimana precedente): 2 turni da 8h = 16h
    for (const g of ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09']) riga(fede, g, '07:00', '15:30');
    riga(fede, '2026-10-01', '08:00', '16:00'); riga(fede, '2026-10-02', '08:00', '16:00'); riga(altra, '2026-10-06', '08:00', '12:00');
    const id = R.addDefinition('ore_settimana', 'Ore di Federica').id;
    const def = R.definizione(id); eq([def.freq, def.weekday, def.ora, def.soglia_ore], ['settimanale', 0, 20, 40]);
    const DOM = rome('2026-10-11', 20, 0);
    eq(R.dueKey(def, DOM), '2026-10-11'); eq(R.dueKey(def, rome('2026-10-11', 19, 59)), null, 'prima delle 20'); eq(R.dueKey(def, rome('2026-10-12', 20, 0)), null, 'lunedì no');
    const mia = R.build(id, DOM, { user: { id: fede, role: 'user' }, slugs: new Set(['tmb']) }).text;
    ok(mia.startsWith('🕒 *Ore lavorate* · settimana 05/10–11/10'), mia); ok(/Settimana 05\/10–11\/10: \*42h 30m\*/.test(mia), mia);
    ok(/Straordinario della settimana: \*2h 30m\* \(oltre 40h\)/.test(mia), mia);
    ok(/Mese di ottobre finora: \*58h 30m\* in 7 giorni/.test(mia), mia);   // 42h30 + 16h
    ok(/Straordinario del mese: \*2h 30m\*/.test(mia), mia); ok(!/Altra/.test(mia), 'non vede le ore degli altri');
    const tutte = R.build(id, DOM).text; ok(/\*Federica\*/.test(tutte) && /\*Altra\*/.test(tutte), 'senza limiti (WhatsApp) tutte le persone');
    R.saveSettings(id, { soglia_ore: 45 }); ok(/Straordinario della settimana: nessuno \(soglia 45h\)/.test(R.build(id, DOM).text));
    R.saveSettings(id, { mese: false }); ok(!/Mese di ottobre/.test(R.build(id, DOM).text), 'il recap mensile si può spegnere');
    ok(R.saveSettings(id, { soglia_ore: 0 }).error);
    eq(R.build(id, rome('2027-03-14', 20)), null, 'nessuna timbratura questa settimana → niente messaggio');
    R.removeDefinition(id); db.prepare("DELETE FROM records WHERE module_slug = 'tmb'").run();
  });

  console.log('\n--- mensile nuovo: per settimana e pagato dell\'anno ---');
  await test('le voci in arrivo sono raggruppate per settimana (lunedì–domenica) con il totale di ogni settimana', () => {
    reset();
    put('spese_casa', { descrizione: 'Luce', importo: 80, data: '2026-10-27', ...stato('da_pagare') });        // martedì: questa settimana
    put('spese_casa', { descrizione: 'Gas', importo: 20, data: '2026-10-30', ...stato('da_pagare') });        // stessa settimana
    put('spese_personali', { descrizione: 'Palestra', importo: 30, data: '2026-11-03', ...stato('da_pagare') }); // settimana dal 02/11
    put('spese_casa', { descrizione: 'Condominio', importo: 200, data: '2026-11-10', ...stato('da_pagare') });  // settimana dal 09/11
    const t = R.build('pagare', IL27).text;
    ok(t.includes('*In arrivo* · 4 voci'), t);
    ok(t.includes('*Questa settimana* · 100 €'), t); ok(t.includes('*Dal 02/11 al 08/11* · 30 €'), t); ok(t.includes('*Dal 09/11 al 15/11* · 200 €'), t);
    ok(t.indexOf('Luce') < t.indexOf('Palestra') && t.indexOf('Palestra') < t.indexOf('Condominio'), 'in ordine di data');
    R.saveSettings('pagare', { settimane: false }); ok(!R.build('pagare', IL27).text.includes('Questa settimana'), 'si può tornare all\'elenco semplice'); R.saveSettings('pagare', { settimane: true });
  });
  await test('«Pagato nel 2026»: totale dell\'anno, per modulo, di cui nel mese; data di pagamento se c\'è, altrimenti la data della spesa', () => {
    reset();
    put('spese_casa', { descrizione: 'Da pagare', importo: 50, data: '2026-10-28', ...stato('da_pagare') });
    put('spese_casa', { descrizione: 'Pagata A', importo: 1000, data: '2026-03-10', data_pagamento: '2026-03-12', ...stato('pagato') });
    put('spese_casa', { descrizione: 'Pagata B', importo: 200, data: '2026-10-05', ...stato('pagato') });            // senza data di pagamento: vale la data
    put('spese_personali', { descrizione: 'Pagata C', importo: 300, data: '2026-10-09', data_pagamento: '2026-10-09', ...stato('pagato') });
    put('spese_casa', { descrizione: 'Anno scorso', importo: 999, data: '2025-12-30', ...stato('pagato') });         // altro anno: non conta
    const t = R.build('pagare', IL27).text;
    ok(t.includes('✅ *Pagato nel 2026*: *1.500 €*'), t); ok(/casa 1\.200 €/.test(t) && /pers\. 300 €/.test(t), t); ok(t.includes('Di cui in ottobre: 500 €'), t);
    R.saveSettings('pagare', { pagato_anno: false }); ok(!R.build('pagare', IL27).text.includes('Pagato nel'), 'si può spegnere'); R.saveSettings('pagare', { pagato_anno: true });
  });

  console.log('\n--- prossimi giorni e promemoria a N giorni ---');
  const LUN = rome('2026-10-26', 8, 5, 1);
  await test('prossimi_giorni: le voci dei prossimi 7 giorni con il totale; niente nel periodo → nessun messaggio', () => {
    reset();
    put('spese_casa', { descrizione: 'Luce', importo: 80, data: '2026-10-27', ...stato('da_pagare') });
    put('spese_casa', { descrizione: 'Tra otto giorni', importo: 5, data: '2026-11-03', ...stato('da_pagare') });
    const { id } = R.addDefinition('prossimi_giorni', 'Settimana');
    const t = R.build(id, LUN).text; ok(t.includes('Prossimi giorni* · 7 giorni · 80,00 €'), t); ok(t.includes('Luce') && !t.includes('Tra otto giorni'), t);
    reset(); eq(R.build(id, LUN), null); R.removeDefinition(id);
  });
  await test('«esatto»: solo le voci che scadono tra esattamente N giorni (un promemoria per voce)', () => {
    reset();
    put('spese_casa', { descrizione: 'Rata cartella', importo: 291.26, data: '2026-11-02', ...stato('da_pagare') }); // 07 giorni dopo il 26/10 → 02/11
    put('spese_casa', { descrizione: 'Prima', importo: 5, data: '2026-10-30', ...stato('da_pagare') });
    const { id } = R.addDefinition('prossimi_giorni', 'Rata vicina'); R.saveSettings(id, { esatto: true, freq: 'giornaliera', giorni_prima: 7 });
    const t = R.build(id, LUN).text; ok(t.includes('tra 7 giorni, il 02/11') && t.includes('Rata cartella') && !t.includes('Prima'), t);
    eq(R.build(id, rome('2026-10-27', 8, 5, 1)), null, 'il giorno dopo non c\'è nulla che scada tra esattamente 7 giorni'); R.removeDefinition(id);
  });

  console.log('\n--- com\'è andata: pagato del mese o dell\'anno ---');
  const PRIMO = rome('2026-11-01', 9, 5, 1);
  await test('mese scorso: totale, per categoria con le percentuali, confronto con il mese prima', () => {
    reset();
    put('spese_casa', { descrizione: 'Luce', importo: 300, categoria: 'Utenze', data: '2026-10-05', data_pagamento: '2026-10-06', ...stato('pagato') });
    put('spese_personali', { descrizione: 'Cena', importo: 100, categoria: 'Svago', data: '2026-10-12', data_pagamento: '2026-10-12', ...stato('pagato') });
    put('spese_casa', { descrizione: 'Luce set', importo: 250, categoria: 'Utenze', data: '2026-09-05', data_pagamento: '2026-09-06', ...stato('pagato') });
    put('spese_casa', { descrizione: 'Non pagata', importo: 777, categoria: 'Utenze', data: '2026-10-20', ...stato('da_pagare') });
    const { id } = R.addDefinition('pagato_periodo', 'Com\'è andata');
    const t = R.build(id, PRIMO).text;
    ok(t.includes('ottobre · 400,00 €'), t); ok(t.includes('• Utenze — 300 € (75%)') && t.includes('• Svago — 100 € (25%)'), t); ok(t.includes('Rispetto a settembre: *+60%* (era 250 €)'), t);
    ok(!t.includes('777'), 'una voce non pagata non conta');
    R.saveSettings(id, { max_righe: 1 }); ok(R.build(id, PRIMO).text.includes('+ altre 1 categoria'));
    db.prepare("DELETE FROM records WHERE module_slug IN ('spese_casa', 'spese_personali')").run(); eq(R.build(id, PRIMO), null, 'niente di pagato → nessun messaggio'); R.removeDefinition(id);
  });
  await test('annuale: parte il 31/12 dall\'ora scelta, fino a 3 giorni dopo se il NAS era spento; il report dell\'anno è quello giusto anche il 2 gennaio', () => {
    reset();
    put('spese_casa', { descrizione: 'Luce', importo: 300, categoria: 'Utenze', data: '2026-03-05', data_pagamento: '2026-03-06', ...stato('pagato') });
    put('spese_casa', { descrizione: 'Nuova', importo: 40, categoria: 'Utenze', data: '2027-01-02', data_pagamento: '2027-01-02', ...stato('pagato') });
    const { id } = R.addDefinition('pagato_periodo', 'Fine anno'); R.saveSettings(id, { freq: 'annuale', periodo: 'anno', mese_anno: 12, giorno: 31, ora: 9 });
    const d = R.definizione(id);
    eq(R.dueKey(d, rome('2026-12-31', 8, 59, 1)), null, 'prima delle 9'); eq(R.dueKey(d, rome('2026-12-31', 9, 0, 1)), '2026-12-31');
    eq(R.dueKey(d, rome('2027-01-02', 10, 0, 1)), '2026-12-31', 'NAS spento: parte appena torna'); eq(R.dueKey(d, rome('2027-01-05', 10, 0, 1)), null, 'dopo 3 giorni non più'); eq(R.dueKey(d, rome('2026-06-15', 10, 0, 1)), null, 'a giugno no');
    const t = R.build(id, rome('2027-01-02', 10, 0, 1)).text; ok(t.includes('2026 · 300,00 €') && !t.includes('40'), 'è il 2026, non il 2027: ' + t);
    ok(R.saveSettings(id, { giorno: 32 }).error, 'giorno oltre 31'); ok(R.saveSettings(id, { mese_anno: 13 }).error, 'mese oltre 12'); R.removeDefinition(id);
  });
  await test('validazioni: righe mostrate fino a 100; periodo «anno» solo per il pagato; il giorno del mensile resta fino a 28', () => {
    ok(R.saveSettings('pagare', { max_righe: 101 }).error); ok(!R.saveSettings('pagare', { max_righe: 100 }).error);
    const a = R.addDefinition('pagato_periodo', 'x'); ok(!R.saveSettings(a.id, { periodo: 'anno' }).error); R.removeDefinition(a.id);
    const o = R.addDefinition('ore_periodo', 'y'); ok(R.saveSettings(o.id, { periodo: 'anno' }).error); R.removeDefinition(o.id);
    ok(R.saveSettings('pagare', { giorno: 29 }).error);
  });

  console.log(`\n${'='.repeat(60)}\n${passed} passati, ${failed} falliti su ${passed + failed} test.`);
  try { fs.unlinkSync(process.env.DB_PATH); } catch (e) {}
  process.exit(failed > 0 ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
