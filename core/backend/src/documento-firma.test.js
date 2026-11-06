'use strict';
// Documento da scaricare, firmare e ricaricare (`document_action` con `delivery: 'firma'`):
// PDF scaricabile, copia firmata allegata, consensi/data/versione/scadenza scritti sul record,
// cambio di stato, errori. Server reale, DB temporaneo. Eseguire con: node src/documento-firma.test.js (porta 34835).

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const TEST_PORT = 34835;
const BASE = 'http://localhost:' + TEST_PORT;
process.env.DB_PATH = path.join(os.tmpdir(), 'doc-firma-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'firma_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'firma_internal_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'firma_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'firma-uploads-'));
process.env.SUPER_ADMIN_URL = 'http://localhost:1';
process.env.TENANT_SLUG = 'firma';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; }
}
function assertEq(a, e, msg) { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${msg || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); }
function assertTrue(c, msg) { if (!c) throw new Error(msg || 'atteso true'); }
const F = (key, label, type = 'text') => ({ id: 'f_' + key, block_type: 'field', key, label, type });

const { calcolaAggiornamento, aggiungiMesi } = require('./lib/documento-firmato');
const { creaPdf } = require('./lib/documento-pdf');
const { renderModello } = require('./lib/modello-documento');

async function main() {
  console.log('\n--- funzioni pure ---');
  await test('aggiungiMesi: fine mese e cambio anno', async () => {
    assertEq(aggiungiMesi('2026-01-31', 1), '2026-02-28');
    assertEq(aggiungiMesi('2026-11-06', 24), '2028-11-06');
    assertEq(aggiungiMesi('2026-12-15', 1), '2027-01-15');
  });
  await test('calcolaAggiornamento: solo i campi dichiarati, consenso mai «per sbaglio» vero', async () => {
    const az = { consents: [{ field: 'c_mkt' }, { field: 'c_terzi' }], signed_date_field: 'data_f', version_field: 'ver', version: '2026-11', retention_field: 'scad', retention_months: 120 };
    const p = calcolaAggiornamento(az, { c_mkt: true, c_terzi: 'si', nome: 'hack' }, '2026-11-06');
    assertEq(p, { c_mkt: true, c_terzi: false, data_f: '2026-11-06', ver: '2026-11', scad: '2036-11-06' });
    assertEq(calcolaAggiornamento({ consents: [{ field: 'c_mkt' }] }, {}, '2026-11-06'), {}, 'consenso non indicato = non toccato');
  });
  await test('filtro casella: [X] / [ ]', async () => {
    const get = (k) => ({ a: true, b: false, c: 'Sì' }[k]);
    assertEq(renderModello('{{a|casella}} {{b|casella}} {{c|casella}} {{zz|casella}}', get), '[X] [ ] [X] [ ]');
  });
  await test('creaPdf: un PDF vero, più pagine se il testo è lungo', async () => {
    const corto = await creaPdf({ titolo: 'Informativa', corpo: 'INFORMATIVA\nTesto àèìòù.\n\n[X] Consenso', azienda: 'Studio', riquadroFirma: true });
    assertEq(corto.subarray(0, 5).toString(), '%PDF-');
    const lungo = await creaPdf({ titolo: 'Lungo', corpo: Array.from({ length: 200 }, (_, i) => 'Riga numero ' + i).join('\n'), riquadroFirma: true });
    assertTrue((lungo.toString('latin1').match(/\/Type \/Page\b/g) || []).length >= 3, 'attese almeno 3 pagine');
    assertTrue(lungo.length > corto.length);
  });

  require('./index.js');
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const db = require('./db');
  db.prepare("UPDATE tenant_settings SET ragione_sociale = 'Studio Prova' WHERE id = 1").run();

  const mk = (slug, steps) => db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES (?, ?, 'box', '#000', 1, 1, 70, ?)").run(slug, slug, JSON.stringify({ version: 3, steps }));
  const rec = (slug, data) => db.prepare('INSERT INTO records (module_slug, data) VALUES (?, ?)').run(slug, JSON.stringify(data)).lastInsertRowid;
  const FIRMA = {
    id: 'd1', block_type: 'document_action', key: 'privacy', label: 'Informativa privacy', icon: 'file', delivery: 'firma',
    body: 'INFORMATIVA\nGentile {{nome}},\nMarketing {{c_mkt|casella}}\nTerzi {{c_terzi|casella}}',
    signed_type: 'privacy_firmata', on_signed_state: 'verificato', version: '2026-11',
    consents: [{ field: 'c_mkt', label: 'Marketing' }, { field: 'c_terzi', label: 'Terzi' }],
    signed_date_field: 'data_firma', version_field: 'versione', retention_field: 'scadenza', retention_months: 120,
  };
  const steps = (extra = []) => [
    F('nome', 'Nome'), F('c_mkt', 'Marketing', 'checkbox'), F('c_terzi', 'Terzi', 'checkbox'), F('data_firma', 'Data firma', 'date'), F('versione', 'Versione'), F('scadenza', 'Scadenza', 'date'),
    { id: 's1', block_type: 'workflow_state', key: 'nuovo', label: 'Nuovo', initial: true },
    { id: 's2', block_type: 'workflow_state', key: 'verificato', label: 'Verificato' },
    { id: 't1', block_type: 'workflow_transition', from: 'nuovo', to: 'verificato', label: 'Verifica', roles: ['admin'] },
    ...extra,
  ];
  mk('anagrafica_t', steps([FIRMA]));

  const login = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: process.env.INITIAL_ADMIN_PASSWORD }) })).json();
  const H = { Authorization: 'Bearer ' + login.token, 'Content-Type': 'application/json' };
  const post = (p, body) => fetch(BASE + '/api' + p, { method: 'POST', headers: H, body: JSON.stringify(body || {}) });
  const carica = async (nome, tipo, contenuto) => {
    const fd = new FormData(); fd.append('file', new Blob([contenuto], { type: tipo }), nome);
    const r = await fetch(BASE + '/api/uploads', { method: 'POST', headers: { Authorization: 'Bearer ' + login.token }, body: fd });
    return (await r.json()).id;
  };

  const id = rec('anagrafica_t', { nome: 'Anna Rossi', _stato: 'nuovo' });

  console.log('\n--- PDF da scaricare ---');
  await test('anteprima con caselle vuote e PDF dello stesso testo', async () => {
    const a = await (await post(`/records/anagrafica_t/${id}/documento/privacy/anteprima`)).json();
    assertTrue(a.corpo.includes('Marketing [ ]') && a.corpo.includes('Terzi [ ]'), a.corpo);
    const r = await post(`/records/anagrafica_t/${id}/documento/privacy/pdf`, { corpo: a.corpo });
    assertEq(r.status, 200);
    assertTrue((r.headers.get('content-type') || '').startsWith('application/pdf'));
    assertTrue((r.headers.get('content-disposition') || '').includes('privacy-' + id + '.pdf'));
    assertEq(Buffer.from(await r.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
  });
  await test('PDF senza testo → 400; documento inesistente → 404', async () => {
    assertEq((await post(`/records/anagrafica_t/${id}/documento/privacy/pdf`, { corpo: '  ' })).status, 400);
    assertEq((await post(`/records/anagrafica_t/${id}/documento/nope/pdf`, { corpo: 'x' })).status, 404);
  });

  console.log('\n--- firmato ---');
  await test('senza file → 400; file di tipo sbagliato → 400', async () => {
    assertEq((await post(`/records/anagrafica_t/${id}/documento/privacy/firmato`, {})).status, 400);
    const exe = await carica('a.txt', 'text/plain', 'ciao');
    assertEq((await post(`/records/anagrafica_t/${id}/documento/privacy/firmato`, { upload_id: exe })).status, 400);
  });
  await test('firmato: allegato col tipo giusto, consensi, data, versione, scadenza e stato', async () => {
    const up = await carica('firmato.pdf', 'application/pdf', '%PDF-1.4 finto');
    const r = await post(`/records/anagrafica_t/${id}/documento/privacy/firmato`, { upload_id: up, consensi: { c_mkt: true, c_terzi: false } });
    assertEq(r.status, 200); const j = await r.json();
    assertEq(j.tipo, 'privacy_firmata'); assertEq(j.stato_aggiornato, true);
    const dati = JSON.parse(db.prepare('SELECT data FROM records WHERE id = ?').get(id).data);
    const oggi = new Date().toISOString().slice(0, 10);
    assertEq(dati.c_mkt, true); assertEq(dati.c_terzi, false); assertEq(dati.data_firma, oggi); assertEq(dati.versione, '2026-11');
    assertEq(dati.scadenza, aggiungiMesi(oggi, 120)); assertEq(dati._stato, 'verificato'); assertEq(dati.nome, 'Anna Rossi');
    const att = db.prepare('SELECT tipo FROM record_attachments WHERE module_slug = ? AND record_id = ?').all('anagrafica_t', id);
    assertEq(att.map((a) => a.tipo), ['privacy_firmata']);
    assertTrue(db.prepare("SELECT 1 FROM audit_log WHERE action = 'record.documento_firmato'").get(), 'audit mancante');
  });
  await test('revoca: un secondo firmato aggiorna i consensi e aggiunge una copia (lo stato non si ripete)', async () => {
    const up = await carica('revoca.pdf', 'application/pdf', '%PDF-1.4 revoca');
    const r = await post(`/records/anagrafica_t/${id}/documento/privacy/firmato`, { upload_id: up, consensi: { c_mkt: false, c_terzi: false } });
    assertEq(r.status, 200); assertEq((await r.json()).stato_aggiornato, false);
    const dati = JSON.parse(db.prepare('SELECT data FROM records WHERE id = ?').get(id).data);
    assertEq(dati.c_mkt, false);
    assertEq(db.prepare('SELECT COUNT(*) c FROM record_attachments WHERE module_slug = ? AND record_id = ?').get('anagrafica_t', id).c, 2);
  });
  await test('un documento per email non accetta il firmato', async () => {
    mk('mail_t', [F('nome', 'Nome'), F('email', 'Email', 'email'), { id: 'd9', block_type: 'document_action', key: 'ciao', label: 'Ciao', subject: 'Ciao', body: 'Ciao {{nome}}', recipient: 'email' }]);
    const rid = rec('mail_t', { nome: 'X', email: 'x@y.it' });
    const up = await carica('f.pdf', 'application/pdf', '%PDF-1.4');
    assertEq((await post(`/records/mail_t/${rid}/documento/ciao/firmato`, { upload_id: up })).status, 400);
  });

  console.log('\n--- validazione in pubblicazione ---');
  const pubblica = async (slug, azione) => {
    const schema = { version: 3, steps: steps([{ ...FIRMA, ...azione }]) };
    const b = await fetch(BASE + '/api/builder/' + slug + '/draft', { method: 'PUT', headers: H, body: JSON.stringify({ schema }) });
    if (!b.ok) return { ok: false, body: await b.text() };
    const p = await fetch(BASE + '/api/builder/' + slug + '/publish', { method: 'POST', headers: H, body: '{}' });
    return { ok: p.ok, body: await p.text() };
  };
  await test('firma: oggetto e destinatario non servono; un campo sbagliato viene rifiutato con il suo nome', async () => {
    assertTrue((await pubblica('anagrafica_t', {})).ok, 'una firma valida deve pubblicarsi senza oggetto né destinatario');
    const r = await pubblica('anagrafica_t', { consents: [{ field: 'nome' }] });
    assertTrue(!r.ok && r.body.includes('checkbox'), r.body);
    const r2 = await pubblica('anagrafica_t', { retention_field: 'scadenza', retention_months: 0 });
    assertTrue(!r2.ok && r2.body.includes('mesi'), r2.body);
    const r3 = await pubblica('anagrafica_t', { on_signed_state: 'inesistente' });
    assertTrue(!r3.ok && r3.body.includes('inesistente'), r3.body);
  });

  console.log(`\n${passed} passati, ${failed} falliti`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
