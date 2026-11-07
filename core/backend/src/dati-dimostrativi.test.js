'use strict';
// I dati dimostrativi (lib/dati-dimostrativi.js, rotte /api/connections/openapi_it/dati-dimostrativi): letti dal pacchetto, costo da confermare, record segnati `_demo`,
// rimozione di tutto e solo di quello. Server vero, DB temporaneo; OpenAPI.it è sostituito da un finto. Eseguire con: node src/dati-dimostrativi.test.js (porta 34873 libera).
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const TEST_PORT = 34873, BASE = 'http://localhost:' + TEST_PORT;
process.env.DB_PATH = path.join(os.tmpdir(), 'demo-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'dd_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'dd_internal_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'dd_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-uploads-'));

let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); console.log('  ✓ ' + name); passed++; } catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; } }
const eq = (a, e, m) => { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${m || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m || 'atteso true'); };

async function main() {
  let sandbox = true, impreseFallisce = false; const chiamate = [];
  require.cache[require.resolve('./lib/openapi-it')] = { id: 'fake', filename: 'fake', loaded: true, exports: {
    credenziali: () => ({ email: 'a@b.it', apiKey: 'x', sandbox }),
    cercaImprese: async (a) => { chiamate.push('imprese ' + a.provincia + ' ' + a.limite); if (impreseFallisce) { const e = new Error('Scope non consentito'); e.status = 403; throw e; } return { data: [{ id: 'i1', denominazione: 'ALFA S.R.L.', comune: 'BRESCIA', codice_natura_giuridica: 'SR' }, { id: 'i2', denominazione: 'BETA S.P.A.', comune: 'SALO', codice_natura_giuridica: 'SP' }] }; },
    valoreAlMqAvanzato: async (a) => { chiamate.push('valutazione ' + a.address); return { data: a.address.startsWith('Via Nessuna') ? {} : { coordinate: { lat: 45.4, lng: 10.5 } } }; },
    comparabili: async () => { chiamate.push('comparabili'); return { data: [{ property_type: 'Villa', address: 'Via Verdi 3', municipality: 'Desenzano', province_code: 'BS', total_sqm: 180, rooms: 6, price: 750000, campo_che_il_modulo_non_ha: 1 }, { property_type: 'Cantina strana', address: 'Via Rossi 1', municipality: 'Sirmione', total_sqm: 40, price: 90000 }] }; },
    omi: async () => ({ data: null }),
  } };
  require('./index.js');
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const db = require('./db'); const E = require('./seed-blocchi-verticale'); const S = require('./lib/openapi-spese'); const DD = require('./lib/dati-dimostrativi');
  const F = (key, type = 'text', extra = {}) => ({ id: 'f_' + key, block_type: 'field', key, label: key, type, ...extra });
  const mod = (slug, steps) => db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES (?, ?, 'box', '#000', 1, 1, 70, ?)").run(slug, slug, JSON.stringify({ version: 3, steps }));
  mod('clienti', [F('nome'), F('tipo_soggetto', 'select', { options: ['Persona fisica', 'Società'] }), F('indirizzo'), F('note')]);
  mod('immobili', [F('titolo'), F('tipologia', 'select', { options: ['Villa', 'Altro'] }), F('indirizzo'), F('comune'), F('provincia'), F('superficie_mq', 'number'), F('locali', 'number'), F('prezzo_richiesto', 'currency'), F('note')]);
  mod('trattative', [F('titolo'), { id: 'r1', block_type: 'relation', key: 'immobile', label: 'Immobile', type: 'many_to_one', target_module: 'immobili', display_field: 'titolo' },
    { id: 'r2', block_type: 'relation', key: 'cliente', label: 'Cliente', type: 'many_to_one', target_module: 'clienti', display_field: 'nome' },
    { id: 'w1', block_type: 'workflow_state', key: 'bozza', label: 'Bozza', initial: true }, { id: 'w2', block_type: 'workflow_state', key: 'avanzata', label: 'Avanzata' }, { id: 'wt', block_type: 'workflow_transition', from: 'bozza', to: 'avanzata', label: 'Avanza' }]);
  const reale = db.prepare("INSERT INTO records (module_slug, data) VALUES ('clienti', ?)").run(JSON.stringify({ nome: 'Cliente VERO' })).lastInsertRowid;
  const login = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: process.env.INITIAL_ADMIN_PASSWORD }) })).json();
  const H = { Authorization: 'Bearer ' + login.token, 'Content-Type': 'application/json' };
  const U = BASE + '/api/connections/openapi_it/dati-dimostrativi';
  const leggi = () => fetch(U, { headers: H }).then((r) => r.json());
  const carica = (corpo = {}) => fetch(U, { method: 'POST', headers: H, body: JSON.stringify(corpo) });
  const demoDi = (slug) => db.prepare("SELECT data FROM records WHERE module_slug = ? AND json_extract(data, '$._demo') = 1").all(slug).map((r) => JSON.parse(r.data));
  const PARTI = ['estensioni', 'documenti', 'abbinamenti', 'moduli', 'ruoli', 'relazioni', 'proprieta', 'sezioni'];
  const VUOTO = Object.fromEntries(PARTI.map((p) => [p, {}]));
  const DIM = {
    fonti: [
      { id: 'societa', tipo: 'imprese', modulo: 'clienti', provincia: 'BS', limite: 5, campi: { nome: '{denominazione}', tipo_soggetto: 'Società', indirizzo: '{comune}', note: 'Dato dimostrativo' } },
      { id: 'annunci', tipo: 'annunci', modulo: 'immobili', per_indirizzo: 4, indirizzi: ['Via Marconi 10, Desenzano', 'Via Nessuna 1, Luogo'], campi: {
        titolo: '{property_type} · {address}', tipologia: { da: 'property_type', mappa: { Villa: 'Villa' }, predefinito: 'Altro' }, indirizzo: '{address}, {municipality}', comune: '{municipality}', provincia: '{province_code}',
        superficie_mq: '{total_sqm}', locali: '{rooms}', prezzo_richiesto: '{price}', campo_inesistente: '{price}' } },
    ],
    statici: [
      { alias: 'persona', modulo: 'clienti', campi: { nome: 'Anna Esempio', tipo_soggetto: 'Persona fisica' } },
      { alias: 'trat', modulo: 'trattative', stato: 'avanzata', relazioni: { cliente: 'persona', immobile: 'fonte:annunci#0' }, campi: { titolo: 'Trattativa dimostrativa' } },
    ],
  };

  await test('senza un pacchetto attivo con dati dimostrativi: non disponibile (404 al caricamento)', async () => {
    const j = await leggi(); eq([j.disponibili, j.totale], [false, 0]); eq((await carica({ conferma: true })).status, 404);
  });
  await test('i modelli: valore intero (anche numero), testo con più dati, date relative, mappa con predefinito, dato mancante omesso', () => {
    const t = new Date('2026-11-07T10:00:00Z'), v = (m, d) => DD.valoreModello(m, d, t);
    eq([v('{price}', { price: 180000 }), v('{a} · {b}', { a: 'Villa', b: 'Via X' }), v('{oggi+14}', {}), v('{oggi-30}', {}), v('{manca}', {}), v('{a}, {b}', { a: 'Via Roma' })], [180000, 'Villa · Via X', '2026-11-21', '2026-10-08', undefined, 'Via Roma']);
    eq([v({ da: 't', mappa: { A: 'Alfa' }, predefinito: 'Altro' }, { t: 'A' }), v({ da: 't', mappa: { A: 'Alfa' }, predefinito: 'Altro' }, { t: 'Z' }), v({ da: 't', mappa: {} }, {})], ['Alfa', 'Altro', undefined]);
  });

  E.riceviPacchetto('prova', 1, { ...VUOTO, dimostrativi: DIM }); E.attivaPacchetto('prova');
  await test('con il pacchetto: disponibile, nulla caricato; senza conferma il server dà il piano dei costi (409) e non chiama niente', async () => {
    const j = await leggi(); eq([j.disponibili, j.totale], [true, 0]);
    const r = await carica(); eq(r.status, 409); const p = await r.json(); eq(p.code, 'conferma_costo'); eq(p.ambiente, 'prova');
    eq(p.piano.voci.map((v) => [v.servizio, v.richieste]), [['visure_ricerca_imprese', 1], ['valutazione_immobiliare', 2], ['real_estate_comparabili', 2]]);
    eq(p.piano.voci[0].costo_unitario, 0, 'la ricerca di imprese non costa'); ok(p.piano.ignoti >= 1, 'prezzi non noti segnalati');
    eq(chiamate, [], 'nessuna chiamata a OpenAPI.it'); eq(DD.totaleDemo(), 0);
  });
  await test('con la conferma carica: imprese e annunci veri, record inventati collegati; tutti segnati; campi che il modulo non ha saltati con un avviso; spese registrate', async () => {
    S.impostazioni({ prezzi: { valutazione_immobiliare: 0.5, real_estate_comparabili: 0.25 } });
    const r = await carica({ conferma: true }); eq(r.status, 200); const j = await r.json();
    eq(j.creati, { clienti: 3, immobili: 2, trattative: 1 });
    eq(demoDi('clienti').map((c) => c.nome).sort(), ['ALFA S.R.L.', 'Anna Esempio', 'BETA S.P.A.']);
    const imm = demoDi('immobili'); eq(imm.map((i) => i.titolo), ['Villa · Via Verdi 3', 'Cantina strana · Via Rossi 1']);
    eq([imm[0].tipologia, imm[1].tipologia, imm[0].superficie_mq, imm[0].prezzo_richiesto, imm[0].indirizzo], ['Villa', 'Altro', 180, 750000, 'Via Verdi 3, Desenzano'], 'mappa, numeri e testi');
    ok(imm.every((i) => i._demo === 1 && i.campo_inesistente === undefined), 'tutti segnati e senza il campo che il modulo non ha'); ok(j.avvisi.some((a) => /campo_inesistente/.test(a)), 'avviso sul campo che il modulo non ha');
    ok(j.avvisi.some((a) => /Via Nessuna/.test(a)), 'un indirizzo senza coordinate si dice, gli altri vanno avanti');
    const t = demoDi('trattative')[0]; const idImm = db.prepare("SELECT id FROM records WHERE module_slug = 'immobili' AND json_extract(data, '$._demo') = 1 ORDER BY id").get().id;
    eq([t._stato, t.immobile, typeof t.cliente], ['avanzata', idImm, 'number'], 'relazioni verso i record creati prima');
    eq(chiamate.filter((c) => /^valutazione/.test(c)).length, 2); ok(chiamate.includes('imprese BS 5'));
    const s = S.riepilogo(); eq([s.prova.richieste, s.prova.stimato], [4, 1.25], '1 ricerca (0) + 2 valutazioni (0,5) + 1 comparabili (0,25): il secondo indirizzo non ha coordinate, quindi niente richiesta di annunci; in prova'); eq(s.produzione.richieste, 0);
    eq(JSON.parse(db.prepare('SELECT data FROM records WHERE id = ?').get(reale).data)._demo, undefined, 'un record vero non viene segnato');
  });
  await test('non si caricano due volte; /GET dice cosa c\'è', async () => {
    eq((await carica({ conferma: true })).status, 409); const j = await leggi(); eq(j.presenti, { clienti: 3, immobili: 2, trattative: 1 }); eq(j.totale, 6);
  });
  await test('la rimozione toglie TUTTI e SOLI i record dimostrativi; il cliente vero resta', async () => {
    const r = await fetch(U, { method: 'DELETE', headers: H }); eq(r.status, 200); const j = await r.json(); eq(j.rimossi, { clienti: 3, immobili: 2, trattative: 1 }); eq(j.presenti, {});
    eq(DD.totaleDemo(), 0); eq(db.prepare("SELECT COUNT(*) c FROM records WHERE module_slug = 'clienti'").get().c, 1); eq(JSON.parse(db.prepare('SELECT data FROM records WHERE id = ?').get(reale).data).nome, 'Cliente VERO');
    eq((await fetch(U, { method: 'DELETE', headers: H })).status, 200, 'ripetere non fa danni');
  });
  await test('una fonte che non riesce (servizio non abilitato) si dice, e le altre fonti vanno avanti', async () => {
    impreseFallisce = true; const j = await (await carica({ conferma: true })).json(); impreseFallisce = false;
    ok(j.avvisi.some((a) => /societa.*non è riuscita.*Scope non consentito.*Controlla i servizi/.test(a)), JSON.stringify(j.avvisi)); eq(j.creati.immobili, 2); eq(j.creati.clienti, 1, 'solo la persona inventata');
    await fetch(U, { method: 'DELETE', headers: H });
  });
  await test('in produzione il tetto mensile blocca il caricamento (402) prima di chiamare OpenAPI.it', async () => {
    sandbox = false; S.impostazioni({ tetto_mensile: 1 }); const n = chiamate.length;
    const r = await carica({ conferma: true }); eq(r.status, 402); eq((await r.json()).code, 'tetto_superato'); eq(chiamate.length, n); eq(DD.totaleDemo(), 0);
    S.impostazioni({ tetto_mensile: null }); sandbox = true;
  });
  await test('solo l\'amministratore; il pacchetto vero ha dimostrativi ben formati (alias risolvibili, fonti con id unici)', async () => {
    eq((await fetch(U)).status, 401); eq((await fetch(U, { method: 'DELETE' })).status, 401);
    const d = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../super-admin/backend/src/pacchetti/mediazione-immobiliare/dimostrativi.json'), 'utf8'));
    const ids = d.fonti.map((f) => f.id); eq(new Set(ids).size, ids.length); ok(d.fonti.every((f) => ['imprese', 'annunci'].includes(f.tipo) && f.modulo && f.campi), 'fonti');
    const visti = new Set();
    for (const st of d.statici) { for (const rif of Object.values(st.relazioni || {})) ok(visti.has(rif) || /^fonte:/.test(rif) && ids.includes(rif.slice(6).split('#')[0]), 'riferimento «' + rif + '» non risolvibile in ' + st.alias); if (st.alias) visti.add(st.alias); }
    ok(d.statici.some((s) => s.modulo === 'trattative') && d.statici.some((s) => s.modulo === 'provvigioni'), 'trattativa e provvigione');
  });

  console.log(`\n${passed} passati, ${failed} falliti`);
  try { fs.unlinkSync(process.env.DB_PATH); } catch (e) {}
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
