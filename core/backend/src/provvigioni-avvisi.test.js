'use strict';
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
  const { getAutomationSteps } = require('./schema-v3');
  const tutte = require('../../../super-admin/backend/src/pacchetti/mediazione-immobiliare/estensioni.json');
  const scegli = (lista, chiavi) => chiavi.map((k) => lista.find((e) => e.key === k));
  const seed = {
    provvigioni: scegli(tutte.provvigioni, ['due_parti', 'scaglioni', 'scaglioni_nel_totale', 'minimo_garantito_campo', 'minimo_garantito_nel_totale', 'trattenute_agente', 'allinea_al_prezzo']),
    trattative: scegli(tutte.trattative, ['solleciti_per_stato']),
    clienti: scegli(tutte.clienti, ['conservazione_scaduta']),
  };

  const mk = (slug, steps) => db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES (?, ?, 'box', '#000', 1, 1, 70, ?)").run(slug, slug, JSON.stringify({ version: 3, steps }));
  const rec = (slug, data) => db.prepare('INSERT INTO records (module_slug, data) VALUES (?, ?)').run(slug, JSON.stringify(data)).lastInsertRowid;
  const schemaDi = (slug) => JSON.parse(db.prepare('SELECT schema_json FROM modules WHERE slug = ?').get(slug).schema_json);

  mk('clienti', [F('nome', 'Nome'), F('conservazione_fino_al', 'Conservazione fino al', 'date')]);
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
    const mie = esiti.filter((e) => ['provvigioni', 'trattative', 'clienti'].includes(e.slug) && e.key !== 'allegati');
    assertEq(mie.map((e) => e.slug + ':' + e.key + ':' + e.esito), [
      'provvigioni:due_parti:applicato', 'provvigioni:scaglioni:applicato', 'provvigioni:scaglioni_nel_totale:applicato', 'provvigioni:minimo_garantito_campo:applicato',
      'provvigioni:minimo_garantito_nel_totale:applicato', 'provvigioni:trattenute_agente:applicato', 'provvigioni:allinea_al_prezzo:applicato',
      'trattative:solleciti_per_stato:applicato', 'clienti:conservazione_scaduta:applicato']);
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

  console.log(`\n${passed} passati, ${failed} falliti`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
