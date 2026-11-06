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

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Risultato: ${passed} passati, ${failed} falliti`);
  process.exit(failed > 0 ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
