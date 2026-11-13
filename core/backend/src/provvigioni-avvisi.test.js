'use strict';
process.env.PLATFORM_PLUGINS = 'immobiliare'; // il plugin immobiliare è attivo in questa prova
// Estensioni del pacchetto Mediazione immobiliare: minimo garantito, trattenute all'agente, provvigioni allineate al prezzo concordato,
// solleciti per stato sulle trattative, avviso di conservazione dei dati scaduta. Server reale, DB temporaneo.
// Eseguire con: node src/provvigioni-avvisi.test.js (porta 34837).

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const TEST_PORT = 34837;
const BASE = 'http://localhost:' + TEST_PORT;
process.env.DB_PATH = path.join(os.tmpdir(), 'avvisi-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'avvisi_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'avvisi_internal_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'avvisi_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'avvisi-uploads-'));
process.env.SUPER_ADMIN_URL = 'http://localhost:1';
process.env.TENANT_SLUG = 'avvisi';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; }
}
function assertEq(a, e, msg) { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${msg || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); }
function assertTrue(c, msg) { if (!c) throw new Error(msg || 'atteso true'); }
const F = (key, label, type = 'text', extra = {}) => ({ id: 'f_' + key, block_type: 'field', key, label, type, ...extra });

async function main() {
  require('./index.js');
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const db = require('./db');
  const { applicaSeed } = require('./seed-blocchi-verticale');
  const { eseguiAutomazioneSchedulata } = require('./scheduler');
  const { fireTrigger } = require('./automation-engine');
  const { getAutomationSteps } = require('./schema-v3');
  const tutte = require('../../../super-admin/backend/src/pacchetti/mediazione-immobiliare/estensioni.json');
  const scegli = (lista, chiavi) => chiavi.map((k) => lista.find((e) => e.key === k));
  const seed = {
    provvigioni: scegli(tutte.provvigioni, ['due_parti', 'scaglioni', 'scaglioni_nel_totale', 'minimo_garantito_campo', 'minimo_garantito_nel_totale', 'trattenute_agente', 'allinea_al_prezzo']),
    trattative: scegli(tutte.trattative, ['solleciti_per_stato', 'riepilogo_settimanale']),
    clienti: scegli(tutte.clienti, ['conservazione_scaduta', 'avviso_documenti_mancanti', 'auguri_cliente']),
    immobili: scegli(tutte.immobili, ['avviso_documenti_mancanti', 'avviso_richieste_compatibili', 'controllo_catastale', 'stato_alla_firma_scheda', 'servizi_vicini']),
    attivita: scegli(tutte.attivita, ['avviso_in_agenda']),
  };

  const mk = (slug, steps) => db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES (?, ?, 'box', '#000', 1, 1, 70, ?)").run(slug, slug, JSON.stringify({ version: 3, steps }));
  const rec = (slug, data) => db.prepare('INSERT INTO records (module_slug, data) VALUES (?, ?)').run(slug, JSON.stringify(data)).lastInsertRowid;
  const schemaDi = (slug) => JSON.parse(db.prepare('SELECT schema_json FROM modules WHERE slug = ?').get(slug).schema_json);

  const stato = (key, iniziale) => ({ id: 'ws_' + key, block_type: 'workflow_state', key, label: key, ...(iniziale ? { initial: true } : {}) });
  mk('clienti', [F('nome', 'Nome'), F('conservazione_fino_al', 'Conservazione fino al', 'date'), F('privacy_firmata_il', 'Privacy firmata il', 'date'),
    F('tipo_cliente', 'Tipo', 'select', { options: ['Venditore', 'Acquirente'] }), F('ricerca_tipologia', 'Cerca tipologia'), F('ricerca_budget_max', 'Budget massimo', 'currency'), F('ricerca_zona', 'Zona'),
    stato('documenti_inviati', true), stato('cliente_verificato'),
    { id: 'wt_c', block_type: 'workflow_transition', from: 'documenti_inviati', to: 'cliente_verificato', label: 'Verifica' },
    { id: 'req_c', block_type: 'state_requirements', stato: 'cliente_verificato', bloccante: false, requisiti: [{ label: 'Documento d\'identità', tipo: 'allegato', valore: 'Documento di identità' }, { label: 'Privacy firmata', tipo: 'campo', campo: 'privacy_firmata_il' }] }]);
  mk('immobili', [F('titolo', 'Titolo'), F('tipologia', 'Tipologia'), F('prezzo_richiesto', 'Prezzo', 'currency'), F('comune', 'Comune'), F('indirizzo', 'Indirizzo'),
    { id: 'mp_i', block_type: 'map_view', key: 'posizione', label: 'Dove si trova', campi: ['indirizzo', 'comune'], paese: 'it' },
    { id: 'da_i', block_type: 'document_action', key: 'scheda_immobile_completa', label: 'Scheda di acquisizione', icon: 'file', delivery: 'firma', body: 'Scheda di {{titolo}}', signed_type: 'scheda_immobile_firmata' },
    stato('in_mandato', true), stato('in_vendita'), { id: 'wt_i', block_type: 'workflow_transition', from: 'in_mandato', to: 'in_vendita', label: 'Metti in vendita' },
    { id: 'req_i', block_type: 'state_requirements', stato: 'in_vendita', bloccante: false, requisiti: [{ label: 'Foto', tipo: 'allegato', valore: 'Foto' }, { label: 'Prezzo richiesto', tipo: 'campo', campo: 'prezzo_richiesto' }] },
    { id: 'mv_i', block_type: 'match_view', key: 'richieste_compatibili', label: 'Richieste compatibili', target_module: 'clienti', display_field: 'nome', target_filter: { field: 'tipo_cliente', equals: 'Acquirente' },
      rules: [{ mine: 'tipologia', theirs: 'ricerca_tipologia', op: 'testo', label: 'Tipologia' }, { mine: 'prezzo_richiesto', theirs: 'ricerca_budget_max', op: 'theirs>=mine', label: 'Nel budget', required: true }] }]);
  mk('attivita', [F('titolo', 'Titolo'), F('scadenza', 'Quando', 'date'), F('tipo', 'Tipo'), F('ora', 'Ora'), stato('da_fare', true), stato('fatto'), { id: 'wt_a', block_type: 'workflow_transition', from: 'da_fare', to: 'fatto', label: 'Fatto' }]);
  mk('provvigioni', [
    F('descrizione', 'Descrizione'), { id: 'r1', block_type: 'relation', key: 'trattativa', label: 'Trattativa', type: 'many_to_one', target_module: 'trattative', display_field: 'titolo' },
    { id: 'r2', block_type: 'relation', key: 'cliente', label: 'Cliente', type: 'many_to_one', target_module: 'clienti', display_field: 'nome' },
    F('tipo', 'Tipo', 'select', { options: ['Provvigione preliminare', 'Provvigione rogito', 'Altro'] }), F('importo', 'Importo', 'currency'), F('data_scadenza', 'Scadenza', 'date'),
    { id: 'w1', block_type: 'workflow_state', key: 'da_fatturare', label: 'Da fatturare', initial: true }, { id: 'w2', block_type: 'workflow_state', key: 'fatturata', label: 'Fatturata' },
    { id: 'wt', block_type: 'workflow_transition', from: 'da_fatturare', to: 'fatturata', label: 'Fattura emessa', roles: ['admin'] },
  ]);
  mk('trattative', [
    F('titolo', 'Titolo'), F('prezzo_concordato', 'Prezzo concordato', 'currency'), F('data_rogito', 'Rogito', 'date'),
    { id: 's1', block_type: 'workflow_state', key: 'trattativa_in_corso', label: 'In corso', initial: true },
    { id: 's2', block_type: 'workflow_state', key: 'preliminare_firmato', label: 'Preliminare firmato' },
    { id: 't1', block_type: 'workflow_transition', from: 'trattativa_in_corso', to: 'preliminare_firmato', label: 'Firma', roles: ['admin'] },
  ]);

  console.log('\n--- applicazione del seed ---');
  await test('le estensioni si applicano nell\'ordine giusto e passano dalla validazione', async () => {
    const esiti = await applicaSeed(seed, { tipo: 'estensione' });
    const mie = esiti.filter((e) => ['provvigioni', 'trattative', 'clienti', 'immobili', 'attivita'].includes(e.slug) && e.key !== 'allegati');
    assertEq(mie.map((e) => e.slug + ':' + e.key + ':' + e.esito), [
      'provvigioni:due_parti:applicato', 'provvigioni:scaglioni:applicato', 'provvigioni:scaglioni_nel_totale:applicato', 'provvigioni:minimo_garantito_campo:applicato',
      'provvigioni:minimo_garantito_nel_totale:applicato', 'provvigioni:trattenute_agente:applicato', 'provvigioni:allinea_al_prezzo:applicato',
      'trattative:solleciti_per_stato:applicato', 'trattative:riepilogo_settimanale:applicato', 'clienti:conservazione_scaduta:applicato', 'clienti:avviso_documenti_mancanti:applicato', 'clienti:auguri_cliente:applicato',
      'immobili:avviso_documenti_mancanti:applicato', 'immobili:avviso_richieste_compatibili:applicato', 'immobili:controllo_catastale:applicato', 'immobili:stato_alla_firma_scheda:applicato', 'immobili:servizi_vicini:applicato', 'attivita:avviso_in_agenda:applicato']);
  });
  await test('secondo avvio: niente da fare', async () => { assertEq(await applicaSeed(seed, { tipo: 'estensione' }), []); });

  const login = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: process.env.INITIAL_ADMIN_PASSWORD }) })).json();
  const H = { Authorization: 'Bearer ' + login.token, 'Content-Type': 'application/json' };
  const api = (m, p, body) => fetch(BASE + '/api' + p, { method: m, headers: H, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, body: await r.json() }));
  const nuova = async (dati) => { const r = await api('POST', '/records/provvigioni', dati); assertEq(r.status, 200); return r.body.id; };
  const leggi = async (id) => (await api('GET', '/records/provvigioni/' + id)).body.data;

  console.log('\n--- minimo garantito e trattenute ---');
  await test('senza minimo il totale è quello di prima (scaglione 3% su 250.000)', async () => {
    const d = await leggi(await nuova({ descrizione: 'A', base_imponibile: 250000, percentuale: 3, parte: 'Venditore' }));
    assertEq([d.importo_netto, d.iva, d.totale], [7500, 1650, 9150]);
  });
  await test('sotto il minimo vale il minimo, con IVA e totale', async () => {
    const d = await leggi(await nuova({ descrizione: 'B', base_imponibile: 100000, percentuale: 1, minimo_garantito: 2000, parte: 'Venditore' }));
    assertEq([d.importo_netto, d.iva, d.totale], [2000, 440, 2440]);
  });
  await test('sopra il minimo vale il calcolo', async () => {
    const d = await leggi(await nuova({ descrizione: 'C', base_imponibile: 100000, percentuale: 3, minimo_garantito: 2000, parte: 'Venditore' }));
    assertEq(d.importo_netto, 3000);
  });
  await test('trattenuta all\'agente: importo e quanto resta all\'agenzia', async () => {
    const d = await leggi(await nuova({ descrizione: 'D', base_imponibile: 250000, percentuale: 3, trattenuta_agente_perc: 40, agente: 'Rossi' }));
    assertEq([d.importo_netto, d.trattenuta_agente, d.netto_agenzia], [7500, 3000, 4500]);
  });
  await test('trattenuta e minimo insieme: la trattenuta parte dall\'importo col minimo', async () => {
    const d = await leggi(await nuova({ descrizione: 'E', base_imponibile: 100000, percentuale: 1, minimo_garantito: 2000, trattenuta_agente_perc: 50 }));
    assertEq([d.importo_netto, d.trattenuta_agente, d.netto_agenzia], [2000, 1000, 1000]);
  });

  console.log('\n--- provvigioni allineate al prezzo concordato ---');
  const automazione = (slug, label) => { const m = db.prepare('SELECT slug, schema_json FROM modules WHERE slug = ?').get(slug); return { mod: m, auto: getAutomationSteps(m.schema_json).find((a) => a.label === label) }; };
  await test('un cambio di prezzo arriva alle provvigioni da fatturare; fatturate e senza parte restano', async () => {
    const t = rec('trattative', { titolo: 'Vendita via Roma', prezzo_concordato: 200000, _stato: 'trattativa_in_corso' });
    const daAllineare = await nuova({ descrizione: 'Venditore', trattativa: t, parte: 'Venditore', percentuale: 3, base_imponibile: 100000, _stato: 'da_fatturare' });
    const fatturata = await nuova({ descrizione: 'Già fatturata', trattativa: t, parte: 'Acquirente', percentuale: 2, base_imponibile: 100000, _stato: 'fatturata' });
    const senzaParte = await nuova({ descrizione: 'A mano', trattativa: t, percentuale: 2, base_imponibile: 100000, _stato: 'da_fatturare' });
    const senzaTrattativa = await nuova({ descrizione: 'Libera', parte: 'Venditore', percentuale: 2, base_imponibile: 100000, _stato: 'da_fatturare' });
    const { mod, auto } = automazione('provvigioni', 'Provvigioni allineate al prezzo concordato');
    assertTrue(auto && auto.id, 'automazione senza id');
    eseguiAutomazioneSchedulata(mod, auto);
    const d = await leggi(daAllineare);
    assertEq([d.base_imponibile, d.importo_netto], [200000, 6000]);
    assertEq((await leggi(fatturata)).base_imponibile, 100000);
    assertEq((await leggi(senzaParte)).base_imponibile, 100000);
    assertEq((await leggi(senzaTrattativa)).base_imponibile, 100000);
  });

  const notifiche = () => db.prepare('SELECT message FROM notifications').all().map((n) => n.message);
  console.log('\n--- solleciti e conservazione ---');
  await test('trattative: rogito passato e trattativa ferma da oltre 30 giorni, non le altre', async () => {
    rec('trattative', { titolo: 'Rogito scaduto', _stato: 'preliminare_firmato', data_rogito: '2020-01-01' });
    rec('trattative', { titolo: 'Rogito futuro', _stato: 'preliminare_firmato', data_rogito: '2099-01-01' });
    const vecchia = rec('trattative', { titolo: 'Ferma da mesi', _stato: 'trattativa_in_corso' });
    db.prepare("UPDATE records SET created_at = datetime('now', '-40 days') WHERE id = ?").run(vecchia);
    rec('trattative', { titolo: 'Appena aperta', _stato: 'trattativa_in_corso' });
    for (const label of ['Sollecito: rogito oltre la data prevista', 'Sollecito: trattativa ferma da oltre 30 giorni']) {
      const { mod, auto } = automazione('trattative', label); assertTrue(auto, 'manca ' + label); eseguiAutomazioneSchedulata(mod, auto);
    }
    const n = notifiche();
    assertTrue(n.some((m) => m.includes('Rogito scaduto')), 'manca il rogito scaduto');
    assertTrue(n.some((m) => m.includes('Ferma da mesi')), 'manca la trattativa ferma');
    assertTrue(!n.some((m) => m.includes('Rogito futuro') || m.includes('Appena aperta')), 'avviso di troppo');
  });
  await test('clienti: solo chi ha la conservazione già scaduta', async () => {
    rec('clienti', { nome: 'Scaduto Rossi', conservazione_fino_al: '2020-06-01' });
    rec('clienti', { nome: 'Valido Bianchi', conservazione_fino_al: '2099-06-01' });
    rec('clienti', { nome: 'Senza Data' });
    const { mod, auto } = automazione('clienti', 'Conservazione dei dati scaduta'); eseguiAutomazioneSchedulata(mod, auto);
    const n = notifiche().filter((m) => m.includes('conservazione'));
    assertEq(n.length, 1);
    assertTrue(n[0].includes('Scaduto Rossi'));
  });

  console.log('\n--- avvisi: requisiti mancanti, abbinamenti, riepilogo, agenda, segnaposto ---');
  const nuoveDa = (prima) => notifiche().slice(prima);
  await test('clienti con documenti inviati: avvisa cosa manca (allegato e campo); con tutto a posto no', async () => {
    const mancante = rec('clienti', { nome: 'Incompleto Neri', _stato: 'documenti_inviati', privacy_firmata_il: '2026-01-01' });
    const ok = rec('clienti', { nome: 'Completo Gialli', _stato: 'documenti_inviati', privacy_firmata_il: '2026-01-01' });
    const up = db.prepare("INSERT INTO uploads (original_name, stored_name, mime_type, size) VALUES ('id.pdf', 'x', 'application/pdf', 1)").run().lastInsertRowid;
    db.prepare("INSERT INTO record_attachments (module_slug, record_id, upload_id, tipo) VALUES ('clienti', ?, ?, 'Documento di identità')").run(ok, up);
    const prima = notifiche().length;
    const { mod, auto } = automazione('clienti', 'Documenti mancanti per la verifica del cliente'); eseguiAutomazioneSchedulata(mod, auto);
    const n = nuoveDa(prima);
    assertEq(n.length, 1);
    assertTrue(n[0].includes('Incompleto Neri') && n[0].includes('Documento d\'identità') && !n[0].includes('Privacy'), n[0]);
    assertTrue(mancante > 0);
  });
  await test('immobile in mandato: avvisa cosa manca per la vendita', async () => {
    rec('immobili', { titolo: 'Villa Rosa', _stato: 'in_mandato', prezzo_richiesto: 300000 });
    const prima = notifiche().length;
    const { mod, auto } = automazione('immobili', 'Cosa manca per mettere in vendita'); eseguiAutomazioneSchedulata(mod, auto);
    const n = nuoveDa(prima);
    assertEq(n.length, 1);
    assertTrue(n[0].includes('Villa Rosa') && n[0].includes('Foto') && !n[0].includes('Prezzo'), n[0]);
  });
  await test('immobile in mandato: avvisa delle richieste compatibili (budget vincolante), niente se non ce ne sono', async () => {
    rec('clienti', { nome: 'Acquirente Verdi', tipo_cliente: 'Acquirente', ricerca_tipologia: 'Villa', ricerca_budget_max: 350000, _stato: 'cliente_verificato' });
    rec('clienti', { nome: 'Acquirente Poveri', tipo_cliente: 'Acquirente', ricerca_tipologia: 'Villa', ricerca_budget_max: 100000, _stato: 'cliente_verificato' });
    const compatibile = rec('immobili', { titolo: 'Villa Bella', tipologia: 'Villa', prezzo_richiesto: 300000, _stato: 'in_mandato' });
    const lontano = rec('immobili', { titolo: 'Castello', tipologia: 'Castello', prezzo_richiesto: 9000000, _stato: 'in_mandato' });
    const prima = notifiche().length;
    fireTrigger('immobili', 'cambio_stato', { titolo: 'Villa Bella', tipologia: 'Villa', prezzo_richiesto: 300000, _stato: 'in_mandato' }, compatibile, { stato: 'in_mandato' });
    fireTrigger('immobili', 'cambio_stato', { titolo: 'Castello', tipologia: 'Castello', prezzo_richiesto: 9000000, _stato: 'in_mandato' }, lontano, { stato: 'in_mandato' });
    const n = nuoveDa(prima);
    assertEq(n.length, 1);
    assertTrue(n[0].includes('Villa Bella') && n[0].includes('1 richieste') && n[0].includes('Acquirente Verdi') && !n[0].includes('Poveri'), n[0]);
  });
  await test('riepilogo: nuove e per stato, solo gli stati che hanno schede', async () => {
    const prima = notifiche().length;
    const { mod, auto } = automazione('trattative', 'Riepilogo settimanale delle trattative'); eseguiAutomazioneSchedulata(mod, auto);
    const n = nuoveDa(prima);
    assertEq(n.length, 1);
    assertTrue(/^Trattative, ultimi 7 giorni: \d+ nuove\./.test(n[0]) && n[0].includes('In corso') && n[0].includes('Preliminare firmato'), n[0]);
  });
  await test('agenda: solo le attività di oggi non ancora fatte', async () => {
    const oggi = new Date().toISOString().slice(0, 10);
    rec('attivita', { titolo: 'Visita via Dante', tipo: 'Visita', ora: '15:30', scadenza: oggi, _stato: 'da_fare' });
    rec('attivita', { titolo: 'Già fatta', tipo: 'Telefonata', scadenza: oggi, _stato: 'fatto' });
    rec('attivita', { titolo: 'Domani', tipo: 'Visita', scadenza: '2099-01-01', _stato: 'da_fare' });
    const prima = notifiche().length;
    const { mod, auto } = automazione('attivita', 'Attività in agenda oggi'); eseguiAutomazioneSchedulata(mod, auto);
    const n = nuoveDa(prima);
    assertEq(n.length, 1);
    assertTrue(n[0].includes('Visita via Dante') && n[0].includes('15:30'), n[0]);
  });
  await test('segnaposto «da attivare»: catasto e auguri dicono cosa serve', async () => {
    const trova = (slug, key) => schemaDi(slug).steps.find((x) => x.block_type === 'external_action' && x.key === key);
    for (const [slug, key] of [['immobili', 'controllo_catastale'], ['clienti', 'auguri_cliente']]) {
      const b = trova(slug, key); assertTrue(b && b.adapter === 'da_attivare' && b.servizio_richiesto && b.come_attivare, 'segnaposto incompleto: ' + key);
    }
  });
  await test('scheda firmata: il documento ha on_signed_state «in_mandato»; un valore già scelto non si tocca', async () => {
    const doc = () => schemaDi('immobili').steps.find((x) => x.block_type === 'document_action' && x.key === 'scheda_immobile_completa');
    assertEq(doc().on_signed_state, 'in_mandato');
    // un modulo dove l'utente ha già scelto un altro stato: l'estensione non lo cambia
    mk('immobili_b', [F('titolo', 'Titolo'), stato('in_mandato', true), stato('in_vendita'), { id: 'wt_b', block_type: 'workflow_transition', from: 'in_mandato', to: 'in_vendita', label: 'Vendita' },
      { id: 'da_b', block_type: 'document_action', key: 'scheda_immobile_completa', label: 'Scheda', icon: 'file', delivery: 'firma', body: 'Scheda', signed_type: 'scheda_immobile_firmata', on_signed_state: 'in_vendita' }]);
    const est = scegli(tutte.immobili, ['stato_alla_firma_scheda']);
    const esiti = await applicaSeed({ immobili_b: est }, { tipo: 'estensione' });
    assertEq(esiti.map((e) => e.esito), ['nulla da fare']);
    assertEq(schemaDi('immobili_b').steps.find((x) => x.key === 'scheda_immobile_completa').on_signed_state, 'in_vendita');
  });

  await test('mappa dell\'immobile: l\'estensione accende i servizi vicini sulla mappa già presente', async () => {
    assertEq(schemaDi('immobili').steps.find((x) => x.block_type === 'map_view' && x.key === 'posizione').servizi, true);
    const nuovo = tutte.immobili.find((e) => e.key === 'mappa_osm').aggiungi[0]; assertEq(nuovo.servizi, true, 'le installazioni nuove partono già con i servizi');
  });

  await test('solvibilità: i testi del segnaposto «Verifica del soggetto» si aggiornano solo se sono ancora quelli di prima; un testo scelto dall\'utente resta', async () => {
    const OLD = { id: 'xs1', block_type: 'external_action', key: 'verifica_soggetto', label: 'Verifica del soggetto', icon: 'search', descrizione: 'Controlla il nuovo cliente dal codice fiscale (negatività, protesti, report persona)', adapter: 'da_attivare', servizio_richiesto: 'Risk', come_attivare: 'x' };
    mk('clienti_a', [F('nome', 'Nome'), OLD]); mk('clienti_b', [F('nome', 'Nome'), { ...OLD, id: 'xs2', label: 'Il mio nome', descrizione: 'Testo mio' }]);
    const ext = scegli(tutte.clienti, ['verifica_soggetto_testi']);
    const esiti = await applicaSeed({ clienti_a: ext, clienti_b: ext }, { tipo: 'estensione' });
    assertEq(esiti.map((e) => e.slug + ':' + e.esito), ['clienti_a:applicato', 'clienti_b:nulla da fare']);
    const a = schemaDi('clienti_a').steps.find((x) => x.key === 'verifica_soggetto'), b = schemaDi('clienti_b').steps.find((x) => x.key === 'verifica_soggetto');
    assertEq(a.label, 'Verifica del soggetto e solvibilità'); assertTrue(/solvibil|CRIF/.test(a.descrizione + a.label) && /Credit score società/.test(a.descrizione), a.descrizione);
    assertEq([b.label, b.descrizione], ['Il mio nome', 'Testo mio']);
    const cs = tutte.clienti.find((e) => e.key === 'credit_score_societa').aggiungi[0]; assertTrue(cs.adapter === 'da_attivare' && /Risk/.test(cs.servizio_richiesto) && cs.come_attivare, 'credit score società: segnaposto completo');
    const nuovo = tutte.clienti.find((e) => e.key === 'verifica_soggetto').aggiungi[0]; assertEq(nuovo.label, 'Verifica del soggetto e solvibilità', 'le installazioni nuove partono già con il testo nuovo');
  });

  console.log(`\n${passed} passati, ${failed} falliti`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
