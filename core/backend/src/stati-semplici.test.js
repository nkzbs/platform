'use strict';
// Workflow semplificati (blocchi `stati_cliente_semplici`, `stati_trattativa_semplici`, `stati_attivita_semplici` del pacchetto Mediazione immobiliare, primitiva `stati`):
// il cliente passa da 3 a 2 stati, la trattativa da 7 a 4, l'attività da 3 a 2. I record negli stati tolti passano a quello di destinazione, i requisiti si uniscono, i trigger e i filtri
// delle automazioni seguono, i documenti non cambiano più stato all'invio. Eseguire con: node src/stati-semplici.test.js
const path = require('path'), os = require('os'), fs = require('fs'), crypto = require('crypto');
const TEST_PORT = 34863;
process.env.DB_PATH = path.join(os.tmpdir(), 'stati-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'st_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'st_i_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'st_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'stati-up-'));
process.env.SUPER_ADMIN_URL = 'http://localhost:1';
process.env.TENANT_SLUG = 'stati';
let passed = 0, failed = 0;
async function test(n, fn) { try { await fn(); console.log('  ✓ ' + n); passed++; } catch (e) { console.error('  ✗ ' + n + '\n    ' + e.message); failed++; } }
const eq = (a, e, m) => { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${m || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); };
const F = (key, type = 'text') => ({ id: 'f_' + key, block_type: 'field', key, label: key, type });
const S = (key, label, initial = false) => ({ id: 's_' + key, block_type: 'workflow_state', key, label, color: '#000', initial });
const T = (from, to, label) => ({ id: 't_' + from + '_' + to, block_type: 'workflow_transition', from, to, label });
const R = (stato, requisiti, bloccante = false) => ({ id: 'r_' + stato, block_type: 'state_requirements', stato, bloccante, requisiti });
const PAC = path.join(__dirname, '../../../super-admin/backend/src/pacchetti/mediazione-immobiliare/');

(async () => {
  require('./index.js');
  for (let i = 0; i < 100; i++) { try { if ((await fetch('http://localhost:' + TEST_PORT + '/health')).ok) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const db = require('./db'), { applicaSeed, semplificaStati } = require('./seed-blocchi-verticale');
  const est = require(PAC + 'estensioni.json');
  const blocco = (slug, key) => est[slug].find((e) => e.key === key);
  const mk = (slug, steps) => db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES (?, ?, 'box', '#000', 1, 1, 70, ?)").run(slug, slug, JSON.stringify({ version: 3, steps }));
  const steps = (slug) => JSON.parse(db.prepare('SELECT schema_json FROM modules WHERE slug = ?').get(slug).schema_json).steps;
  const rec = (slug, d) => db.prepare('INSERT INTO records (module_slug, data) VALUES (?, ?)').run(slug, JSON.stringify(d)).lastInsertRowid;
  const stato = (id) => JSON.parse(db.prepare('SELECT data FROM records WHERE id = ?').get(id).data)._stato;
  const chiavi = (slug) => steps(slug).filter((x) => x.block_type === 'workflow_state').map((x) => x.key);
  const passaggi = (slug) => steps(slug).filter((x) => x.block_type === 'workflow_transition').map((x) => x.from + '>' + x.to);
  const filtroAuto = (slug, label) => steps(slug).find((x) => x.block_type === 'automation' && x.label === label).trigger;

  // ── cliente ──
  mk('clienti', [F('nome'), S('verifica_identita_cliente', 'Verifica identità cliente', true), S('documenti_inviati', 'Documenti inviati'), S('cliente_verificato', 'Cliente verificato'),
    T('verifica_identita_cliente', 'documenti_inviati', 'Documenti inviati'), T('documenti_inviati', 'cliente_verificato', 'Documenti ricevuti e verificati'), T('documenti_inviati', 'verifica_identita_cliente', 'Documenti da rifare'),
    R('documenti_inviati', [{ label: 'Codice fiscale', tipo: 'campo', campo: 'nome' }]), R('verifica_identita_cliente', [{ label: 'Un nome', tipo: 'campo', campo: 'nome' }]), R('cliente_verificato', [{ label: 'Documento', tipo: 'allegato', valore: 'Documento di identità' }]),
    { id: 'a1', block_type: 'automation', label: 'Documenti mancanti', trigger: { evento: 'schedulato', modalita: 'per_record', filtro: [{ campo: '_stato', op: '==', valore: 'documenti_inviati' }] }, azioni: [] },
    { id: 'd1', block_type: 'document_action', key: 'antiriciclaggio', label: 'Antiriciclaggio', subject: 's', body: 'x', recipient: 'nome', on_send_state: 'documenti_inviati' }]);
  const c1 = rec('clienti', { nome: 'A', _stato: 'documenti_inviati' }), c2 = rec('clienti', { nome: 'B', _stato: 'cliente_verificato' }), c3 = rec('clienti', { nome: 'C', _stato: 'verifica_identita_cliente' });
  await test('cliente: da tre stati a due, passaggi nuovi, record e requisiti seguono', async () => {
    eq((await applicaSeed({ clienti: [blocco('clienti', 'stati_cliente_semplici')] }, { tipo: 'estensione' })).map((e) => e.esito), ['applicato']);
    eq(chiavi('clienti'), ['verifica_identita_cliente', 'cliente_verificato']);
    eq(steps('clienti').filter((x) => x.block_type === 'workflow_state').map((x) => x.label), ['Da verificare', 'Verificato']);
    eq(passaggi('clienti'), ['verifica_identita_cliente>cliente_verificato', 'cliente_verificato>verifica_identita_cliente']);
    eq([stato(c1), stato(c2), stato(c3)], ['verifica_identita_cliente', 'cliente_verificato', 'verifica_identita_cliente']);
    const req = steps('clienti').filter((x) => x.block_type === 'state_requirements');
    eq(req.map((x) => x.stato), ['verifica_identita_cliente', 'cliente_verificato']);
    eq(req[0].requisiti.map((q) => q.label), ['Codice fiscale', 'Un nome'], 'requisiti uniti');
  });
  await test('cliente: filtro dell\'avviso e documenti seguono; il documento non cambia più stato all\'invio', () => {
    eq(filtroAuto('clienti', 'Documenti mancanti').filtro[0].valore, 'verifica_identita_cliente');
    eq(steps('clienti').find((x) => x.block_type === 'document_action').on_send_state, undefined);
  });
  await test('secondo avvio: niente da fare', async () => { eq(await applicaSeed({ clienti: [blocco('clienti', 'stati_cliente_semplici')] }, { tipo: 'estensione' }), []); });

  // ── trattativa ──
  mk('trattative', [F('titolo'), F('data_rogito', 'date'), S('incontro_profilazione', 'Incontro e profilazione', true), S('catalogazione', 'Catalogazione immobile'), S('trattativa_in_corso', 'Trattativa in corso'), S('preliminare_firmato', 'Preliminare firmato'),
    S('rogito_completato', 'Rogito completato'), S('adempimenti_post_vendita', 'Adempimenti post-vendita'), S('chiusa', 'Chiusa'),
    T('incontro_profilazione', 'catalogazione', 'a'), T('catalogazione', 'trattativa_in_corso', 'b'), T('trattativa_in_corso', 'preliminare_firmato', 'c'), T('preliminare_firmato', 'rogito_completato', 'd'), T('rogito_completato', 'adempimenti_post_vendita', 'e'), T('adempimenti_post_vendita', 'chiusa', 'f'),
    R('trattativa_in_corso', [{ label: 'x', tipo: 'campo', campo: 'titolo' }]),
    R('rogito_completato', [{ label: 'Data del rogito', tipo: 'campo', campo: 'data_rogito' }, { label: 'Atto di rogito', tipo: 'allegato', valore: 'Atto di rogito' }]),
    { id: 'al', block_type: 'allegati', label: 'Allegati', types: ["Proposta d'acquisto", 'Contratto preliminare', 'Atto di rogito', 'Altro'] },
    { id: 'a2', block_type: 'automation', label: 'Sollecito: trattativa ferma', trigger: { evento: 'schedulato', modalita: 'per_record', filtro: [{ campo: '_stato', op: '==', valore: 'trattativa_in_corso' }] }, azioni: [] },
    { id: 'a3', block_type: 'automation', label: 'Provvigioni', trigger: { evento: 'cambio_stato', stato: 'preliminare_firmato' }, azioni: [] }]);
  const t1 = rec('trattative', { titolo: '1', _stato: 'incontro_profilazione' }), t2 = rec('trattative', { titolo: '2', _stato: 'catalogazione' }), t3 = rec('trattative', { titolo: '3', _stato: 'adempimenti_post_vendita' }), t4 = rec('trattative', { titolo: '4', _stato: 'preliminare_firmato' });
  await test('trattativa: da sette stati a quattro; lo stato iniziale passa a «In trattativa»; i record seguono', async () => {
    eq((await applicaSeed({ trattative: [blocco('trattative', 'stati_trattativa_semplici')] }, { tipo: 'estensione' })).map((e) => e.esito), ['applicato']);
    eq(chiavi('trattative'), ['trattativa_in_corso', 'preliminare_firmato', 'rogito_completato', 'chiusa']);
    eq(steps('trattative').filter((x) => x.block_type === 'workflow_state').filter((x) => x.initial).map((x) => x.key), ['trattativa_in_corso']);
    eq(steps('trattative').find((x) => x.key === 'trattativa_in_corso').label, 'In trattativa');
    eq(passaggi('trattative'), ['trattativa_in_corso>preliminare_firmato', 'preliminare_firmato>rogito_completato', 'rogito_completato>chiusa', 'chiusa>rogito_completato', 'preliminare_firmato>trattativa_in_corso']);
    eq([stato(t1), stato(t2), stato(t3), stato(t4)], ['trattativa_in_corso', 'trattativa_in_corso', 'chiusa', 'preliminare_firmato']);
  });
  await test('trattativa: i solleciti e le provvigioni restano sugli stati che esistono; per il rogito serve l\'Adeguata verifica firmata', () => {
    eq(filtroAuto('trattative', 'Sollecito: trattativa ferma').filtro[0].valore, 'trattativa_in_corso');
    eq(filtroAuto('trattative', 'Provvigioni').stato, 'preliminare_firmato');
    eq(steps('trattative').find((x) => x.block_type === 'allegati').types.includes('Adeguata verifica firmata'), true);
    eq(steps('trattative').find((x) => x.block_type === 'state_requirements' && x.stato === 'rogito_completato').requisiti.map((q) => q.label), ['Data del rogito', 'Atto di rogito', 'Adeguata verifica del cliente firmata']);
  });

  // ── attività ──
  mk('attivita', [F('titolo'), S('da_fare', 'Da fare', true), S('in_corso', 'In corso'), S('fatto', 'Fatto'), T('da_fare', 'in_corso', 'Inizia'), T('in_corso', 'fatto', 'Completa'), T('in_corso', 'da_fare', 'Rimetti in coda')]);
  const a1 = rec('attivita', { titolo: 'x', _stato: 'in_corso' });
  await test('attività: da tre stati a due; «In corso» torna «Da fare»', async () => {
    eq((await applicaSeed({ attivita: [blocco('attivita', 'stati_attivita_semplici')] }, { tipo: 'estensione' })).map((e) => e.esito), ['applicato']);
    eq(chiavi('attivita'), ['da_fare', 'fatto']); eq(passaggi('attivita'), ['da_fare>fatto', 'fatto>da_fare']); eq(stato(a1), 'da_fare');
  });

  await test('trattativa: «Chiusa senza vendita» (stato nuovo) si raggiunge da «In trattativa» e «Preliminare firmato» e si riapre; senza requisiti', async () => {
    eq((await applicaSeed({ trattative: [blocco('trattative', 'trattativa_chiusa_senza_vendita')] }, { tipo: 'estensione' })).map((e) => e.esito), ['applicato']);
    eq(chiavi('trattative').includes('chiusa_senza_vendita'), true);
    eq(steps('trattative').find((x) => x.key === 'chiusa_senza_vendita').label, 'Chiusa senza vendita');
    eq(['trattativa_in_corso>chiusa_senza_vendita', 'preliminare_firmato>chiusa_senza_vendita', 'chiusa_senza_vendita>trattativa_in_corso'].every((p) => passaggi('trattative').includes(p)), true);
    eq(steps('trattative').some((x) => x.block_type === 'state_requirements' && x.stato === 'chiusa_senza_vendita'), false);
    eq(await applicaSeed({ trattative: [blocco('trattative', 'trattativa_chiusa_senza_vendita')] }, { tipo: 'estensione' }), [], 'secondo avvio');
  });
  await test('firma: l\'Adeguata verifica firmata porta il cliente a «Verificato»; il Contratto di incarico firmato porta l\'immobile «In mandato»', async () => {
    eq((await applicaSeed({ clienti: [blocco('clienti', 'verificato_alla_firma')] }, { tipo: 'estensione' })).map((e) => e.esito), ['applicato']);
    eq(steps('clienti').find((x) => x.block_type === 'document_action' && x.key === 'antiriciclaggio').on_signed_state, 'cliente_verificato');
    mk('immobili', [F('titolo'), S('da_valutare', 'Da valutare', true), S('in_mandato', 'In mandato'), T('da_valutare', 'in_mandato', 'x'), { id: 'd2', block_type: 'document_action', key: 'contratto_incarico', label: 'Contratto', subject: 's', body: 'x', recipient: 'titolo' }]);
    eq((await applicaSeed({ immobili: [blocco('immobili', 'incarico_firmato_in_mandato')] }, { tipo: 'estensione' })).map((e) => e.esito), ['applicato']);
    eq(steps('immobili').find((x) => x.block_type === 'document_action').on_signed_state, 'in_mandato');
  });
  await test('funzione pura: un\'etichetta cambiata dall\'utente non si rinomina; uno stato che non c\'è non fa niente', () => {
    const base = [S('a', 'Mia etichetta', true), S('b', 'B'), T('a', 'b', 'x')];
    const r = semplificaStati(base, { rinomina: [{ key: 'a', da: 'Vecchia', a: 'Nuova' }], rimuovi: [{ key: 'zzz', verso: 'a' }] });
    eq(r.cambiato, false); eq(r.steps.find((x) => x.key === 'a').label, 'Mia etichetta');
  });
  await test('togli: l\'azione Firma elettronica sparisce, i campi restano, una sola volta', async () => {
    mk('trattative_f', [F('titolo'), F('firma_esito'), { id: 'x1', block_type: 'external_action', key: 'firma_elettronica', label: 'Firma elettronica', adapter: 'da_attivare' }, { id: 'x2', block_type: 'external_action', key: 'altra', label: 'Altra', adapter: 'da_attivare' }]);
    const bl = { ...blocco('trattative', 'senza_firma_elettronica'), richiede: { trattative_f: ['titolo'] } };
    eq((await applicaSeed({ trattative_f: [bl] }, { tipo: 'estensione' })).map((e) => e.esito), ['applicato']);
    eq(steps('trattative_f').map((x) => x.key), ['titolo', 'firma_esito', 'altra']);
    eq((await applicaSeed({ trattative_f: [bl] }, { tipo: 'estensione' })).length, 0);
  });
  await test('togli: un campo non si toglie mai', async () => {
    mk('trattative_g', [F('titolo'), F('dato')]);
    const bl = { key: 'x_togli', richiede: { trattative_g: ['titolo'] }, togli: [{ block_type: 'field', key: 'dato' }] };
    await applicaSeed({ trattative_g: [bl] }, { tipo: 'estensione' });
    eq(steps('trattative_g').map((x) => x.key), ['titolo', 'dato']);
  });
  console.log(`\n${passed} passati, ${failed} falliti`); process.exit(failed ? 1 : 0);
})();
