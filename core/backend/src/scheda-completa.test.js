'use strict';
// Scheda di acquisizione completa: l'estensione «scheda_completa» (campi mancanti + caselle che erano testo
// libero e diventano elenchi a scelta multipla, con i valori già scritti convertiti) e il documento
// «da firmare» che riproduce l'intero modulo dell'agenzia. Server reale, DB temporaneo.
// Eseguire con: node src/scheda-completa.test.js (porta 34838).

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const TEST_PORT = 34838;
const BASE = 'http://localhost:' + TEST_PORT;
process.env.DB_PATH = path.join(os.tmpdir(), 'scheda-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'scheda_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'scheda_internal_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'scheda_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'scheda-uploads-'));
process.env.SUPER_ADMIN_URL = 'http://localhost:1';
process.env.TENANT_SLUG = 'scheda';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; }
}
function assertEq(a, e, msg) { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${msg || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); }
function assertTrue(c, msg) { if (!c) throw new Error(msg || 'atteso true'); }
const F = (key, type = 'text', extra = {}) => ({ id: 'f_' + key, block_type: 'field', key, label: key, type, ...extra });

async function main() {
  require('./index.js');
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const db = require('./db');
  const { applicaSeed } = require('./seed-blocchi-verticale');
  const { percorsiUsati, SEGNAPOSTI_FISSI } = require('./lib/modello-documento');
  const estensioniPacchetto = require('../../../super-admin/backend/src/pacchetti/mediazione-immobiliare/estensioni.json');
  // la valutazione di mercato (azione esterna) ha il suo test: qui il modulo di prova non ha i campi che quel blocco cita
  const SENZA = ['valutazione_mercato', 'requisiti_stato']; // hanno i loro test: il modulo di prova non ha i campi che citano
  const estensioni = { immobili: estensioniPacchetto.immobili.filter((e) => !SENZA.includes(e.key)), clienti: estensioniPacchetto.clienti.filter((e) => !SENZA.includes(e.key)) };
  const documenti = require('../../../super-admin/backend/src/pacchetti/mediazione-immobiliare/documenti.json');
  const scheda = documenti.immobili.find((d) => d.key === 'scheda_immobile_completa');
  const est = estensioni.immobili[0];
  const estC = estensioni.clienti.find((e) => e.key === 'anagrafica_scheda');

  const mk = (slug, steps) => db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES (?, ?, 'box', '#000', 1, 1, 70, ?)").run(slug, slug, JSON.stringify({ version: 3, steps }));
  const rec = (slug, data) => db.prepare('INSERT INTO records (module_slug, data) VALUES (?, ?)').run(slug, JSON.stringify(data)).lastInsertRowid;
  const schemaDi = (slug) => JSON.parse(db.prepare('SELECT schema_json FROM modules WHERE slug = ?').get(slug).schema_json);
  const campo = (slug, key) => schemaDi(slug).steps.find((x) => x.key === key);

  // Come Immobili/Clienti di zucca prima di questa estensione: le caselle sono testo o scelta singola.
  const convertiti = new Set(est.converti.map((c) => c.key));
  const nuovi = new Set([...est.aggiungi.map((a) => a.key)]);
  const vecchioTipo = { posto_auto: ['select', { options: ['Nessuno', 'Di proprietà', 'Condominiale', 'Coperto', 'Scoperto'] }], pavimenti: ['select', { options: ['Parquet', 'Ceramica', 'Gres', 'Laminato', 'Altro'] }], tipologia_diffusione_riscaldamento: ['select', { options: ['A pavimento', 'Radiatori'] }], alimentazione_riscaldamento: ['select', { options: ['Metano', 'Altro'] }], documenti_disponibili: ['textarea', {}] };
  const usati = new Set([...percorsiUsati(scheda.body)].filter((p) => p && !p.includes('.') && !SEGNAPOSTI_FISSI.includes(p)));
  const campiVecchi = [...usati].filter((k) => !nuovi.has(k)).map((k) => (convertiti.has(k) && vecchioTipo[k]) ? F(k, vecchioTipo[k][0], vecchioTipo[k][1]) : F(k));
  const anagrafica = ['nome', 'data_nascita', 'codice_fiscale_piva', 'telefono', 'email'].map((k) => F(k));
  mk('clienti', anagrafica);
  const rel = (key) => ({ id: 'r_' + key, block_type: 'relation', key, label: key, target_module: 'clienti', type: 'many_to_one', display_field: 'nome' });
  mk('immobili', [...campiVecchi, rel('proprietario'), rel('comproprietario_2'), rel('comproprietario_3')]);
  const idProp = rec('clienti', { nome: 'Mario Bianchi', codice_fiscale_piva: 'BNCMRA80A01H501X', data_nascita: '1980-01-01', telefono: '3331112222', email: 'm@esempio.it' });
  const idImm = rec('immobili', { titolo: 'Villa', proprietario: idProp, composizione_vani: 'Ingresso, Soggiorno; Veranda', pavimenti: 'Parquet', documenti_disponibili: 'Atto di provenienza\nVisura catastale storica', sfogo_esterno: '', posto_auto: 'Coperto', superficie_mq: 120 });

  console.log('\n--- estensione «scheda_completa» ---');
  let esiti;
  await test('si applica: nuovi campi del tipo giusto e caselle trasformate in elenchi a scelta multipla', async () => {
    esiti = await applicaSeed(estensioni, { tipo: 'estensione' });
    assertEq(esiti.filter((e) => (e.slug === 'immobili' || e.slug === 'clienti') && e.key !== 'allegati' && e.key !== 'profilo_mediazione' && e.key !== 'verifica_soggetto' && e.key !== 'invio_pec').map((e) => e.slug + ':' + e.esito), ['immobili:applicato', 'clienti:applicato']);
    assertEq(campo('immobili', 'data_sopralluogo').type, 'date');
    assertEq(campo('immobili', 'prezzo_consigliato').type, 'currency');
    assertEq(campo('immobili', 'valore_ipe').type, 'number');
    assertEq(campo('immobili', 'punti_di_forza').type, 'textarea');
    for (const k of convertiti) assertEq(campo('immobili', k).type, 'multiselect', k);
    assertEq(campo('immobili', 'composizione_vani').options.length, 9);
    assertEq(campo('immobili', 'composizione_vani').id, 'f_composizione_vani', 'l\'id del campo non cambia');
    assertEq(campo('immobili', 'posto_auto').options, ['Di proprietà', 'Condominiale', 'Coperto', 'Scoperto']);
    for (const k of ['luogo_nascita', 'stato_civile', 'regime_patrimoniale', 'residenza', 'pec']) assertTrue(campo('clienti', k), 'manca ' + k + ' su Clienti');
    assertEq(campo('clienti', 'stato_civile').type, 'select');
    assertEq(campo('clienti', 'pec').type, 'email');
  });
  await test('i valori già scritti come testo diventano elenchi; il resto del record non si tocca', async () => {
    const d = JSON.parse(db.prepare('SELECT data FROM records WHERE id = ?').get(idImm).data);
    assertEq(d.composizione_vani, ['Ingresso', 'Soggiorno', 'Veranda']);
    assertEq(d.pavimenti, ['Parquet']);
    assertEq(d.documenti_disponibili, ['Atto di provenienza', 'Visura catastale storica']);
    assertEq(d.posto_auto, ['Coperto']);
    assertEq(d.sfogo_esterno, [], 'un testo vuoto diventa un elenco vuoto');
    assertEq([d.titolo, d.superficie_mq, d.proprietario], ['Villa', 120, idProp]);
  });
  await test('secondo avvio: niente da fare, e un campo di un tipo non convertibile blocca l\'estensione senza toccarlo', async () => {
    assertEq((await applicaSeed(estensioni, { tipo: 'estensione' })).filter((e) => e.slug === 'immobili' || e.slug === 'clienti'), []);
    mk('altro', [F('pavimenti', 'number')]);
    const prova = { altro: [{ key: 'x', converti: [{ key: 'pavimenti', type: 'multiselect', options: ['a'] }] }] };
    assertEq((await applicaSeed(prova, { tipo: 'estensione' })).map((e) => e.esito), ['non applicabile']);
    assertEq(campo('altro', 'pavimenti').type, 'number');
  });

  await test('profilo di mediazione: un Clienti generico a 6 campi riceve gli stessi campi di zucca, senza una copia del modulo', async () => {
    mk('clienti_generico', ['nome', 'email', 'telefono', 'azienda', 'indirizzo', 'note'].map((k) => F(k)));
    const estP = estensioni.clienti.find((e) => e.key === 'profilo_mediazione');
    assertEq((await applicaSeed({ clienti_generico: [estP] }, { tipo: 'estensione' })).map((e) => e.esito), ['applicato']);
    const chiavi = schemaDi('clienti_generico').steps.filter((x) => x.block_type === 'field').map((x) => x.key);
    for (const k of ['data_nascita', 'tipo_soggetto', 'codice_fiscale_piva', 'tipo_cliente', 'esigenza_acquisto', 'ricerca_tipologia', 'ricerca_budget_max', 'ricerca_zona']) assertTrue(chiavi.includes(k), 'manca ' + k);
    assertEq(campo('clienti_generico', 'tipo_cliente').options, ['Venditore', 'Acquirente']);
    assertEq((await applicaSeed({ clienti_generico: [estP] }, { tipo: 'estensione' })).map((e) => e.esito), [], 'secondo giro: niente da fare');
  });
  await test('allegati tipizzati: Clienti e Immobili ricevono il riquadro con i tipi di documento; un secondo riquadro non si aggiunge', async () => {
    for (const slug of ['clienti', 'immobili']) {
      const blocchi = schemaDi(slug).steps.filter((x) => x.block_type === 'allegati');
      assertEq(blocchi.length, 1, slug);
      assertTrue(blocchi[0].types.length >= 6, 'tipi di ' + slug);
    }
    assertTrue(schemaDi('clienti').steps.find((x) => x.block_type === 'allegati').types.includes('Attualità della residenza'), 'tipo richiesto dall\'agenzia');
    mk('con_allegati', [F('nome'), { id: 'a1', block_type: 'allegati', label: 'Allegati', types: ['X'] }]);
    const prova = { con_allegati: [{ key: 'a', aggiungi: [{ block_type: 'allegati', label: 'Allegati', types: ['Y'] }] }] };
    assertEq((await applicaSeed(prova, { tipo: 'estensione' })).map((e) => e.esito), ['non applicabile']);
    assertEq(schemaDi('con_allegati').steps.find((x) => x.block_type === 'allegati').types, ['X']);
  });

  console.log('\n--- documento «Scheda di acquisizione (da firmare)» ---');
  await test('si applica dopo l\'estensione ed è un documento da firmare', async () => {
    const e = await applicaSeed(documenti, { tipo: 'document_action' });
    assertTrue(e.some((x) => x.key === 'scheda_immobile_completa' && x.esito === 'applicato'), JSON.stringify(e));
    const d = schemaDi('immobili').steps.find((x) => x.key === 'scheda_immobile_completa');
    assertEq([d.delivery, d.signed_type], ['firma', 'scheda_immobile_firmata']);
  });

  const login = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: process.env.INITIAL_ADMIN_PASSWORD }) })).json();
  const H = { Authorization: 'Bearer ' + login.token, 'Content-Type': 'application/json' };
  await test('l\'anteprima riporta tutte le 11 sezioni del modulo, i dati del proprietario e le righe da compilare a mano', async () => {
    const r = await fetch(BASE + '/api/records/immobili/' + idImm + '/documento/scheda_immobile_completa/anteprima', { method: 'POST', headers: H, body: '{}' });
    assertEq(r.status, 200);
    const { corpo } = await r.json();
    for (const t of ['1. ANAGRAFICA', '2. LOCALIZZAZIONE', '3. CARATTERISTICHE INTERNE', '4. SERRAMENTI', '5. IMPIANTI', '6. SITUAZIONE URBANISTICA', '7. SPESE CONDOMINIALI', '8. VALUTAZIONE ECONOMICA', '9. PER VENDERE', '10. NOTE', '11. INFORMATIVA PRIVACY', 'Firma comproprietario 3', 'Firma agente acquisitore', 'Valore IPE', 'Prezzo consigliato di mercato', 'Data sopralluogo']) assertTrue(corpo.includes(t), 'manca «' + t + '»');
    assertTrue(corpo.includes('Cognome e nome: Mario Bianchi') && corpo.includes('BNCMRA80A01H501X'), 'dati del proprietario');
    assertTrue(corpo.includes('Composizione vani: Ingresso, Soggiorno, Veranda'), 'elenco a scelta multipla');
    assertTrue(corpo.includes('Cognome e nome: ___'), 'comproprietario 2 da compilare a mano');
    assertTrue(!corpo.includes('{{'), 'nessun segnaposto rimasto');
  });
  await test('il PDF da firmare si scarica', async () => {
    const r = await fetch(BASE + '/api/records/immobili/' + idImm + '/documento/scheda_immobile_completa/pdf', { method: 'POST', headers: H, body: JSON.stringify({ corpo: 'Prova\n\nSezione:\nTesto' }) });
    assertEq(r.status, 200);
    assertEq(Buffer.from(await r.arrayBuffer()).slice(0, 5).toString(), '%PDF-');
  });

  console.log(`\n${passed} passati, ${failed} falliti`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
