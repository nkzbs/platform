'use strict';
// Documento da modello end-to-end (blocco `document_action`): anteprima, invio, destinatario
// ricavato dal server, cambio di stato dopo l'invio, errori. Server reale, DB temporaneo; l'unica
// cosa sostituita è l'invio dell'email (nessuna chiamata di rete, niente spedito davvero).
// Eseguire con: node src/documento-da-modello.test.js (porta 34831).

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const TEST_PORT = 34831;
const BASE = 'http://localhost:' + TEST_PORT;
process.env.DB_PATH = path.join(os.tmpdir(), 'doc-modello-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'doc_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'doc_internal_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'doc_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-uploads-'));
process.env.SUPER_ADMIN_URL = 'http://localhost:1';
process.env.TENANT_SLUG = 'doc';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; }
}
function assertEq(a, e, msg) { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${msg || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); }
function assertTrue(c, msg) { if (!c) throw new Error(msg || 'atteso true'); }
const F = (key, label, type = 'text') => ({ id: 'f_' + key, block_type: 'field', key, label, type });

async function main() {
  require('./index.js');
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const db = require('./db');
  const email = require('./lib/email');

  // L'unica sostituzione: invece di chiamare Resend, registra cosa sarebbe partito.
  const inviate = [];
  let esito = { ok: true };
  email.invia = async (msg) => { inviate.push(msg); return esito; };

  db.prepare("UPDATE tenant_settings SET ragione_sociale = 'Studio Prova', piva = '01234567890' WHERE id = 1").run();

  const mk = (slug, steps) => db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES (?, ?, 'box', '#000', 1, 1, 70, ?)").run(slug, slug, JSON.stringify({ version: 3, steps }));
  const rec = (slug, data) => db.prepare('INSERT INTO records (module_slug, data) VALUES (?, ?)').run(slug, JSON.stringify(data)).lastInsertRowid;

  const AZIONE_CLIENTE = {
    id: 'd1', block_type: 'document_action', key: 'benvenuto', label: 'Benvenuto', icon: 'mail',
    subject: 'Ciao {{nome}}', body: 'Gentile {{nome}},\n{{@azienda}} — P.IVA {{@piva}}\nCF: {{cf|linea}}',
    recipient: 'email', on_send_state: 'inviato',
  };
  mk('persone_t', [
    F('nome', 'Nome'), F('email', 'Email'), F('cf', 'CF'),
    { id: 's1', block_type: 'workflow_state', key: 'nuovo', label: 'Nuovo', initial: true },
    { id: 's2', block_type: 'workflow_state', key: 'inviato', label: 'Inviato' },
    { id: 't1', block_type: 'workflow_transition', from: 'nuovo', to: 'inviato', label: 'Invia', roles: ['admin'] },
    AZIONE_CLIENTE,
  ]);
  mk('case_t', [
    F('titolo', 'Titolo'),
    { id: 'r1', block_type: 'relation', key: 'proprietario', label: 'Proprietario', target_module: 'persone_t', type: 'many_to_one', display_field: 'nome' },
    { id: 'd2', block_type: 'document_action', key: 'scheda', label: 'Scheda', subject: 'Scheda {{titolo}}', body: 'Proprietario: {{proprietario.nome}}', recipient: 'proprietario.email' },
  ]);

  const login = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: process.env.INITIAL_ADMIN_PASSWORD }) })).json();
  const H = { Authorization: 'Bearer ' + login.token, 'Content-Type': 'application/json' };
  const post = (p, body, headers = H) => fetch(BASE + '/api' + p, { method: 'POST', headers, body: JSON.stringify(body || {}) });

  const idAnna = rec('persone_t', { nome: 'Anna Rossi', email: 'anna@esempio.it', _stato: 'nuovo' });
  const idSenzaMail = rec('persone_t', { nome: 'Senza Posta', _stato: 'nuovo' });
  const idCasa = rec('case_t', { titolo: 'Trilocale', proprietario: idAnna });
  const idCasaOrfana = rec('case_t', { titolo: 'Senza proprietario' });

  console.log('\n--- anteprima: non spedisce nulla ---');
  await test('anteprima: oggetto e corpo compilati dal record, dati del tenant, destinatario dal campo', async () => {
    const r = await post(`/records/persone_t/${idAnna}/documento/benvenuto/anteprima`);
    assertEq(r.status, 200); const j = await r.json();
    assertEq(j.oggetto, 'Ciao Anna Rossi');
    assertTrue(j.corpo.startsWith('Gentile Anna Rossi,\nStudio Prova — P.IVA 01234567890\nCF: ___'), 'corpo: ' + j.corpo);
    assertEq(j.destinatario, 'anna@esempio.it');
  });
  await test('anteprima: destinatario da un record collegato (relazione.campo) e campo del collegato nel testo', async () => {
    const j = await (await post(`/records/case_t/${idCasa}/documento/scheda/anteprima`)).json();
    assertEq(j.corpo, 'Proprietario: Anna Rossi'); assertEq(j.destinatario, 'anna@esempio.it');
  });
  await test('anteprima: relazione vuota → «—» nel testo e destinatario vuoto, non un errore', async () => {
    const r = await post(`/records/case_t/${idCasaOrfana}/documento/scheda/anteprima`);
    assertEq(r.status, 200); const j = await r.json();
    assertEq(j.corpo, 'Proprietario: —'); assertEq(j.destinatario, '');
  });
  await test('un\'anteprima non spedisce mai nulla e non cambia lo stato', async () => {
    assertEq(inviate.length, 0);
    assertEq(JSON.parse(db.prepare('SELECT data FROM records WHERE id = ?').get(idAnna).data)._stato, 'nuovo');
  });
  await test('documento inesistente → 404; record inesistente → 404; modulo senza quel documento → 404', async () => {
    assertEq((await post(`/records/persone_t/${idAnna}/documento/boh/anteprima`)).status, 404);
    assertEq((await post(`/records/persone_t/99999/documento/benvenuto/anteprima`)).status, 404);
    assertEq((await post(`/records/case_t/${idCasa}/documento/benvenuto/anteprima`)).status, 404);
  });
  await test('senza accesso (nessun token) → 401, anche per l\'anteprima', async () => {
    assertEq((await post(`/records/persone_t/${idAnna}/documento/benvenuto/anteprima`, {}, { 'Content-Type': 'application/json' })).status, 401);
  });

  console.log('\n--- invio ---');
  await test('invio: spedisce esattamente il testo approvato, al destinatario ricavato dal server', async () => {
    const r = await post(`/records/persone_t/${idAnna}/documento/benvenuto/invia`, { oggetto: 'Oggetto rivisto', corpo: 'Testo modificato a mano', to: 'altro@esempio.it' });
    assertEq(r.status, 200);
    assertEq(inviate.length, 1);
    assertEq(inviate[0].to, 'anna@esempio.it', 'il destinatario NON può arrivare dalla richiesta');
    assertEq(inviate[0].subject, 'Oggetto rivisto');
    assertTrue(inviate[0].html.includes('Testo modificato a mano'));
  });
  await test('invio: dopo l\'invio lo stato passa a quello dichiarato (on_send_state)', async () => {
    assertEq(JSON.parse(db.prepare('SELECT data FROM records WHERE id = ?').get(idAnna).data)._stato, 'inviato');
  });
  await test('invio: l\'invio è tracciato in Attività con documento e destinatario', async () => {
    const riga = db.prepare("SELECT details FROM audit_log WHERE action = 'record.invia_documento' ORDER BY id DESC LIMIT 1").get();
    assertTrue(!!riga, 'riga di audit mancante');
    assertTrue(riga.details.includes('benvenuto') && riga.details.includes('anna@esempio.it'), riga.details);
  });
  await test('secondo invio: l\'email parte comunque, lo stato non si tocca (transizione non più ammessa) e non è un errore', async () => {
    const r = await post(`/records/persone_t/${idAnna}/documento/benvenuto/invia`, { corpo: 'di nuovo' });
    assertEq(r.status, 200); const j = await r.json();
    assertEq(j.ok, true); assertEq(j.stato_aggiornato, false);
    assertEq(inviate.length, 2);
  });
  await test('oggetto non indicato → si usa l\'etichetta del documento', async () => {
    await post(`/records/case_t/${idCasa}/documento/scheda/invia`, { corpo: 'x' });
    assertEq(inviate[inviate.length - 1].subject, 'Scheda');
  });
  await test('senza testo → 400 e non parte nulla', async () => {
    const prima = inviate.length;
    assertEq((await post(`/records/persone_t/${idSenzaMail}/documento/benvenuto/invia`, { corpo: '   ' })).status, 400);
    assertEq((await post(`/records/persone_t/${idSenzaMail}/documento/benvenuto/invia`, { oggetto: 'x' })).status, 400);
    assertEq(inviate.length, prima);
  });
  await test('destinatario vuoto → 400 con messaggio chiaro, nulla spedito, stato invariato', async () => {
    const prima = inviate.length;
    const r = await post(`/records/persone_t/${idSenzaMail}/documento/benvenuto/invia`, { corpo: 'ciao' });
    assertEq(r.status, 400); assertTrue(/indirizzo email/.test((await r.json()).error));
    assertEq(inviate.length, prima);
    assertEq(JSON.parse(db.prepare('SELECT data FROM records WHERE id = ?').get(idSenzaMail).data)._stato, 'nuovo');
  });
  await test('invio fallito (es. email non configurata) → 502, nessun cambio di stato, nessuna riga di Attività', async () => {
    esito = { ok: false, motivo: 'email non configurata' };
    const id = rec('persone_t', { nome: 'Bruno', email: 'bruno@esempio.it', _stato: 'nuovo' });
    const righePrima = db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action = 'record.invia_documento'").get().c;
    const r = await post(`/records/persone_t/${id}/documento/benvenuto/invia`, { corpo: 'ciao' });
    assertEq(r.status, 502); assertTrue(/non configurata/.test((await r.json()).error));
    assertEq(JSON.parse(db.prepare('SELECT data FROM records WHERE id = ?').get(id).data)._stato, 'nuovo');
    assertEq(db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action = 'record.invia_documento'").get().c, righePrima);
    esito = { ok: true };
  });
  await test('un modello con HTML non lo inietta nell\'email (il testo è sempre escapato)', async () => {
    await post(`/records/persone_t/${idAnna}/documento/benvenuto/invia`, { corpo: '<script>alert(1)</script>' });
    const html = inviate[inviate.length - 1].html;
    assertTrue(!html.includes('<script>') && html.includes('&lt;script&gt;'), html);
  });

  console.log('\n--- validazione alla pubblicazione ---');
  const pubblica = (slug) => post(`/builder/${slug}/publish`, {});
  const dettagli = async (r) => ((await r.json()).details || []).map((d) => (d.errors || []).join('; ')).join(' | ');
  const modulo = (slug, azione) => mk(slug, [
    F('nome', 'Nome'), F('email', 'Email'),
    { id: 'rel', block_type: 'relation', key: 'riferimento', label: 'Riferimento', target_module: 'persone_t', type: 'many_to_one', display_field: 'nome' },
    { id: 'st', block_type: 'workflow_state', key: 'a', label: 'A', initial: true },
    { id: 'st2', block_type: 'workflow_state', key: 'b', label: 'B' },
    { id: 'tr', block_type: 'workflow_transition', from: 'a', to: 'b', label: 'Vai', roles: ['admin'] },
    { id: 'da', block_type: 'document_action', key: 'doc', label: 'Doc', subject: 'Oggetto {{nome}}', body: 'Testo {{nome}}', recipient: 'email', ...azione },
  ]);
  await test('un documento corretto si pubblica', async () => {
    modulo('valido_t', {});
    const r = await pubblica('valido_t');
    assertEq(r.status, 200, await dettagli(r));
  });
  await test('campo inesistente nel testo → pubblicazione bloccata, con il nome del campo', async () => {
    modulo('typo_t', { body: 'Gentile {{nmoe}}' });
    const r = await pubblica('typo_t');
    assertEq(r.status, 400); const d = await dettagli(r);
    assertTrue(/nmoe/.test(d) && /non esiste in questo modulo/.test(d), d);
  });
  await test('campo inesistente nell\'oggetto, dentro una sezione e con un filtro → bloccato', async () => {
    modulo('typo2_t', { subject: '{{#nome}}{{cognome|maiuscolo}}{{/nome}}' });
    const r = await pubblica('typo2_t');
    assertEq(r.status, 400); assertTrue(/cognome/.test(await dettagli(r)));
  });
  await test('relazione inesistente, o campo inesistente nel modulo collegato → bloccato', async () => {
    modulo('rel1_t', { body: '{{altra.nome}}' });
    assertTrue(/relazione "altra" non esiste/.test(await dettagli(await pubblica('rel1_t'))));
    modulo('rel2_t', { body: '{{riferimento.telefono_inesistente}}' });
    assertTrue(/non esiste nel modulo collegato "persone_t"/.test(await dettagli(await pubblica('rel2_t'))));
  });
  await test('un campo di un record collegato che esiste si pubblica (relazione.campo)', async () => {
    modulo('rel3_t', { body: '{{riferimento.nome}}', recipient: 'riferimento.email' });
    const r = await pubblica('rel3_t');
    assertEq(r.status, 200, await dettagli(r));
  });
  await test('destinatario mancante o su un campo inesistente → bloccato', async () => {
    modulo('dest1_t', { recipient: '' });
    assertTrue(/manca il destinatario/.test(await dettagli(await pubblica('dest1_t'))));
    modulo('dest2_t', { recipient: 'posta' });
    assertTrue(/destinatario: il campo "posta"/.test(await dettagli(await pubblica('dest2_t'))));
  });
  await test('oggetto, testo ed etichetta vuoti → bloccato con un messaggio per ciascuno', async () => {
    modulo('vuoti_t', { subject: ' ', body: '', label: '' });
    const d = await dettagli(await pubblica('vuoti_t'));
    assertTrue(/oggetto/.test(d) && /testo del documento/.test(d) && /etichetta/.test(d), d);
  });
  await test('stato dopo l\'invio che non esiste nel workflow → bloccato; uno vero passa', async () => {
    modulo('stato1_t', { on_send_state: 'inventato' });
    assertTrue(/stato "inventato" non esiste/.test(await dettagli(await pubblica('stato1_t'))));
    modulo('stato2_t', { on_send_state: 'b' });
    assertEq((await pubblica('stato2_t')).status, 200);
  });
  await test('chiave non valida o duplicata → bloccato', async () => {
    modulo('chiave1_t', { key: 'Doc Con Spazi' });
    assertTrue(/chiave non valida/.test(await dettagli(await pubblica('chiave1_t'))));
    mk('chiave2_t', [
      F('nome', 'Nome'), F('email', 'Email'),
      { id: 'a', block_type: 'document_action', key: 'x', label: 'A', subject: 's', body: 'b {{nome}}', recipient: 'email' },
      { id: 'b', block_type: 'document_action', key: 'x', label: 'B', subject: 's', body: 'b {{nome}}', recipient: 'email' },
    ]);
    assertTrue(/usata due volte/.test(await dettagli(await pubblica('chiave2_t'))));
  });
  await test('un segnaposto fisso (@azienda, @oggi) non è un campo e non dà errore', async () => {
    modulo('fissi_t', { body: '{{@azienda}} {{@piva}} {{@indirizzo}} {{@oggi}} {{nome}}' });
    assertEq((await pubblica('fissi_t')).status, 200);
  });

  console.log('\n--- seed: i documenti del verticale applicati ai moduli (una volta sola) ---');
  const seed = require('./pacchetti/mediazione-immobiliare/documenti.json');
  const { applicaSeed } = require('./seed-blocchi-verticale');
  const { percorsiUsati, SEGNAPOSTI_FISSI } = require('./lib/modello-documento');
  // I campi che il seed crea da sé («aggiungi_campi») non vanno messi a mano nel modulo di prova.
  const creatiDalSeed = new Set(seed.clienti.flatMap((a) => (a.aggiungi_campi || []).map((f) => f.key)));
  const semplici = (slug) => new Set(seed[slug].flatMap((a) => [...percorsiUsati(a.subject || ''), ...percorsiUsati(a.body), a.recipient])
    .filter((p) => p && !p.includes('.') && !SEGNAPOSTI_FISSI.includes(p) && !creatiDalSeed.has(p)));
  const campiSeed = (slug) => [...semplici(slug)].map((k) => F(k, k));
  const statoSeed = [
    { id: 'w1', block_type: 'workflow_state', key: 'nuovo', label: 'Nuovo', initial: true },
    { id: 'w2', block_type: 'workflow_state', key: 'documenti_inviati', label: 'Documenti inviati' },
    { id: 'w3', block_type: 'workflow_transition', from: 'nuovo', to: 'documenti_inviati', label: 'Invia', roles: ['admin'] },
  ];
  // Dati anagrafici che i documenti leggono tramite la relazione col proprietario (non sono segnaposto «semplici»).
  const anagrafica = ['nome', 'data_nascita', 'codice_fiscale_piva', 'luogo_nascita', 'stato_civile', 'regime_patrimoniale', 'telefono', 'residenza', 'pec', 'email'].map((k) => F(k, k));
  const nomiCampiClienti = new Set(campiSeed('clienti').map((x) => x.key));
  mk('clienti', [...campiSeed('clienti'), ...anagrafica.filter((x) => !nomiCampiClienti.has(x.key)), ...statoSeed]);
  const rel = (key, label) => ({ id: 'r_' + key, block_type: 'relation', key, label, target_module: 'clienti', type: 'many_to_one', display_field: 'nome' });
  mk('immobili', [...campiSeed('immobili'), rel('proprietario', 'Proprietario'), rel('comproprietario_2', 'Comproprietario 2'), rel('comproprietario_3', 'Comproprietario 3')]);
  const documentiDi = (slug) => JSON.parse(db.prepare('SELECT schema_json FROM modules WHERE slug = ?').get(slug).schema_json);
  const chiaviDocumento = (slug) => { const sc = documentiDi(slug); return (sc.steps || []).filter((st) => st.block_type === 'document_action').map((st) => st.key).concat((sc.document_actions || []).map((d) => d.key)); };

  let primoGiro;
  await test('il seed reale si applica ai moduli che hanno i campi giusti (passa dalla validazione del Builder)', async () => {
    primoGiro = await applicaSeed(seed);
    assertEq(primoGiro.filter((e) => e.esito === 'applicato').map((e) => e.key).sort(), ['anagrafica_privacy', 'antiriciclaggio', 'privacy_incarico', 'scheda_immobile', 'scheda_immobile_completa']);
    assertEq(chiaviDocumento('clienti').sort(), ['anagrafica_privacy', 'antiriciclaggio', 'privacy_incarico']);
    // Il seed ha creato i campi dei consensi, del tipo giusto, e il documento è «da firmare».
    const campi = documentiDi('clienti').steps.filter((st) => st.block_type === 'field');
    assertEq(campi.find((f) => f.key === 'consenso_marketing').type, 'checkbox');
    assertEq(campi.find((f) => f.key === 'conservazione_fino_al').type, 'date');
    assertEq(documentiDi('clienti').steps.find((st) => st.key === 'anagrafica_privacy').delivery, 'firma');
    assertEq(chiaviDocumento('immobili'), ['scheda_immobile', 'scheda_immobile_completa']);
  });
  await test('dopo l\'applicazione i tre documenti funzionano davvero: anteprima di un cliente e di un immobile', async () => {
    const idC = rec('clienti', { nome: 'Mario Bianchi', email: 'mario@esempio.it', tipo_cliente: 'Venditore', _stato: 'nuovo' });
    const rc = await (await post(`/records/clienti/${idC}/documento/privacy_incarico/anteprima`)).json();
    assertTrue(rc.corpo.startsWith('INFORMATIVA PRIVACY (GDPR) E MODULO DI INCARICO\n\nStudio Prova (P.IVA 01234567890)'), rc.corpo.slice(0, 120));
    assertEq(rc.destinatario, 'mario@esempio.it'); assertEq(rc.oggetto, 'Documenti da firmare — Mario Bianchi');
    const idI = rec('immobili', { titolo: 'Villa', proprietario: idC });
    const ri = await (await post(`/records/immobili/${idI}/documento/scheda_immobile/anteprima`)).json();
    assertTrue(ri.corpo.includes('Proprietario: Mario Bianchi'), ri.corpo.slice(0, 200));
    assertEq(ri.destinatario, 'mario@esempio.it');
  });
  await test('secondo avvio: niente da fare, nessun documento duplicato', async () => {
    assertEq(await applicaSeed(seed), []);
    assertEq(chiaviDocumento('clienti').sort(), ['anagrafica_privacy', 'antiriciclaggio', 'privacy_incarico']);
  });
  await test('se il documento viene tolto dal Builder, al riavvio NON ricompare', async () => {
    const sc = documentiDi('clienti');
    sc.steps = sc.steps.filter((st) => st.key !== 'antiriciclaggio');
    db.prepare("UPDATE modules SET schema_json = ? WHERE slug = 'clienti'").run(JSON.stringify(sc));
    assertEq(await applicaSeed(seed), []);
    assertEq(chiaviDocumento('clienti').sort(), ['anagrafica_privacy', 'privacy_incarico']);
  });
  await test('un modulo con lo stesso nome ma senza i campi del modello non viene toccato (e non riprova all\'infinito)', async () => {
    mk('altro_t', [F('nome', 'Nome'), F('email', 'Email')]);
    const finto = { altro_t: [{ key: 'k', label: 'K', subject: '{{inesistente}}', body: 'x {{nome}}', recipient: 'email' }] };
    const esiti = await applicaSeed(finto);
    assertEq(esiti.map((e) => e.esito), ['non applicabile']);
    assertEq(chiaviDocumento('altro_t'), []);
    assertEq(await applicaSeed(finto), [], 'marcato: non riprova');
  });
  await test('un campo con la stessa chiave ma di tipo diverso: documento non applicato, campo intatto, nessun nuovo tentativo', async () => {
    mk('conflitto_t', [F('nome', 'Nome'), F('consenso', 'Consenso (testo libero)', 'text')]);
    const finto = { conflitto_t: [{ key: 'k', label: 'K', delivery: 'firma', body: 'x {{nome}} {{consenso|casella}}', consents: [{ field: 'consenso' }], aggiungi_campi: [{ key: 'consenso', label: 'Consenso', type: 'checkbox' }] }] };
    assertEq((await applicaSeed(finto)).map((e) => e.esito), ['non applicabile']);
    assertEq(chiaviDocumento('conflitto_t'), []);
    assertEq(documentiDi('conflitto_t').steps.find((st) => st.key === 'consenso').type, 'text');
    assertEq(await applicaSeed(finto), []);
  });
  await test('un modulo che non esiste nel tenant non fa nulla e non è un errore', async () => {
    assertEq(await applicaSeed({ inesistente_t: [{ key: 'k', label: 'K', subject: 's', body: 'b', recipient: 'email' }] }), []);
  });

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Risultato: ${passed} passati, ${failed} falliti`);
  process.exit(failed > 0 ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
