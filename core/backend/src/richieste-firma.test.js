'use strict';
// Richiesta di firma: dal record parte UN link; il cliente (senza account) vede i documenti, li scarica, carica i firmati e spunta i consensi; Platform allega, registra, cambia stato,
// avvisa l'agente e conferma al cliente. Solleciti dopo 3 e 7 giorni, scadenza a 14. Server reale, DB temporaneo, posta simulata. Eseguire con: node src/richieste-firma.test.js (porta 34862).
const path = require('path'), os = require('os'), fs = require('fs'), crypto = require('crypto');
const TEST_PORT = 34862, BASE = 'http://localhost:' + TEST_PORT;
process.env.DB_PATH = path.join(os.tmpdir(), 'rich-firma-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'rf_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'rf_internal_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'rf_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-uploads-'));
process.env.SUPER_ADMIN_URL = 'http://localhost:1';
process.env.TENANT_SLUG = 'rf';
let passed = 0, failed = 0;
async function test(n, fn) { try { await fn(); console.log('  ✓ ' + n); passed++; } catch (e) { console.error('  ✗ ' + n + '\n    ' + e.message); failed++; } }
const eq = (a, e, m) => { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${m || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m || 'atteso true'); };
const F = (key, label, type = 'text') => ({ id: 'f_' + key, block_type: 'field', key, label, type });

async function main() {
  require('./index.js');
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const db = require('./db');
  db.prepare("UPDATE tenant_settings SET ragione_sociale = 'Agenzia Prova', accent_color = '#9a4a2b' WHERE id = 1").run();
  // posta simulata: registra cosa parte
  const email = require('./lib/email'); const partite = []; let posta = true;
  email.invia = async (m) => { if (!posta) return { ok: false, motivo: 'server di posta spento' }; partite.push(m); return { ok: true, via: 'prova' }; };

  const privacy = { id: 'd1', block_type: 'document_action', key: 'privacy', label: 'Informativa privacy', icon: 'file', delivery: 'firma', recipient: 'email', body: 'INFORMATIVA\nGentile {{nome}},\nMarketing {{c_mkt|casella}}', signed_type: 'privacy_firmata', on_signed_state: 'ricevuti', version: '2026-11', consents: [{ field: 'c_mkt', label: 'Comunicazioni commerciali' }], signed_date_field: 'data_firma', version_field: 'versione' };
  const aml = { id: 'd2', block_type: 'document_action', key: 'aml', label: 'Antiriciclaggio', icon: 'shield', delivery: 'firma', recipient: 'email', body: 'ADEGUATA VERIFICA di {{nome}}', signed_type: 'aml_firmato' };
  const steps = [F('nome', 'Nome'), F('email', 'Email', 'email'), F('c_mkt', 'Marketing', 'checkbox'), F('data_firma', 'Data', 'date'), F('versione', 'Versione'),
    { id: 's1', block_type: 'workflow_state', key: 'nuovo', label: 'Nuovo', initial: true }, { id: 's2', block_type: 'workflow_state', key: 'ricevuti', label: 'Documenti ricevuti' },
    { id: 't1', block_type: 'workflow_transition', from: 'nuovo', to: 'ricevuti', label: 'Ricevuti' }, privacy, aml];
  db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES ('Clienti', 'clienti_t', 'box', '#000', 1, 1, 70, ?)").run(JSON.stringify({ version: 3, steps }));
  const rec = (data) => db.prepare('INSERT INTO records (module_slug, data) VALUES (?, ?)').run('clienti_t', JSON.stringify(data)).lastInsertRowid;
  const login = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: process.env.INITIAL_ADMIN_PASSWORD }) })).json();
  const H = { Authorization: 'Bearer ' + login.token, 'Content-Type': 'application/json' };
  const post = (p, b) => fetch(BASE + '/api' + p, { method: 'POST', headers: H, body: JSON.stringify(b || {}) });
  const LINK = 'https://clienti.esempio.it';
  const tokenDa = (mail) => (/\/firma\/([A-Za-z0-9_-]+)/.exec(mail.html) || [])[1];
  const pdfFinto = () => new Blob(['%PDF-1.4 firmato'], { type: 'application/pdf' });
  const invia = async (token, { file, consensi } = {}) => { const fd = new FormData(); for (const [k, v] of Object.entries(file || {})) fd.append('file_' + k, v, k + '.pdf'); fd.append('consensi', JSON.stringify(consensi || {})); return fetch(BASE + '/api/public-firma/' + token, { method: 'POST', body: fd }); };

  const id = rec({ nome: 'Mario Rossi', email: 'mario@esempio.it', _stato: 'nuovo' });
  let token, rid;

  await test('l\'agente manda la richiesta: una mail sola, col marchio, i documenti e UN pulsante; il destinatario lo decide il server', async () => {
    const r = await post(`/firma/clienti_t/${id}/richieste`, { link_base: LINK, destinatario: 'altro@hacker.it' });
    const j0 = await r.clone().json(); eq(r.status, 200, JSON.stringify(j0)); rid = j0.id;
    eq(partite.length, 1); eq(partite[0].to, 'mario@esempio.it', 'destinatario dal record, non dalla richiesta');
    ok(/Informativa privacy/.test(partite[0].html) && /Antiriciclaggio/.test(partite[0].html) && partite[0].html.includes('#9a4a2b') && partite[0].html.includes('Rivedi e firma') && /Buongiorno Mario/.test(partite[0].html), 'contenuto');
    ok(/2 documenti da firmare/.test(partite[0].subject), partite[0].subject);
    token = tokenDa(partite[0]); ok(token && token.length > 30, 'token nel link');
    ok(!db.prepare('SELECT token_hash FROM richieste_firma WHERE id = ?').get(rid).token_hash.includes(token), 'nel database non c\'è il token in chiaro');
  });
  await test('senza indirizzo email nel record o senza link_base: errore chiaro, nessuna mail', async () => {
    const senza = rec({ nome: 'Senza Mail', _stato: 'nuovo' });
    eq((await post(`/firma/clienti_t/${senza}/richieste`, { link_base: LINK })).status, 400);
    eq((await post(`/firma/clienti_t/${id}/richieste`, { link_base: 'http://non-sicuro' })).status, 400);
    eq(partite.length, 1);
  });
  await test('la posta non parte: errore, e la richiesta non resta in giro', async () => {
    posta = false; const prima = db.prepare('SELECT COUNT(*) c FROM richieste_firma').get().c;
    const r = await post(`/firma/clienti_t/${id}/richieste`, { link_base: LINK }); eq(r.status, 502);
    eq(db.prepare("SELECT COUNT(*) c FROM richieste_firma WHERE stato = 'inviata'").get().c, 1, 'resta solo quella buona'); posta = true;
    ok(db.prepare('SELECT COUNT(*) c FROM richieste_firma').get().c === prima + 1);
  });
  await test('pagina pubblica: nome dell\'agenzia, documenti e consensi; nessun dato del cliente né id del record', async () => {
    const r = await fetch(BASE + '/api/public-firma/' + token); eq(r.status, 200); const p = await r.json();
    eq(p.agenzia.nome, 'Agenzia Prova'); eq(p.documenti.map((d) => d.key), ['privacy', 'aml']); eq(p.documenti[0].consensi, [{ field: 'c_mkt', label: 'Comunicazioni commerciali' }]);
    ok(!JSON.stringify(p).includes('Mario') && !JSON.stringify(p).includes('mario@') && !('record_id' in p), 'niente dati del cliente');
    eq((await fetch(BASE + '/api/public-firma/token-inventato')).status, 410);
  });
  await test('il PDF di un documento si scarica dal link, col testo congelato all\'invio', async () => {
    const r = await fetch(BASE + '/api/public-firma/' + token + '/pdf/privacy'); eq(r.status, 200);
    eq(Buffer.from(await r.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
    eq((await fetch(BASE + '/api/public-firma/' + token + '/pdf/nope')).status, 404);
    const doc = JSON.parse(db.prepare('SELECT documenti FROM richieste_firma WHERE id = ?').get(rid).documenti)[0];
    ok(doc.corpo.includes('Gentile Mario Rossi'), 'testo già riempito');
  });
  await test('firma incompleta (manca un file) o file sbagliato: rifiutata, niente scritto, il cliente può riprovare', async () => {
    eq((await invia(token, { file: { privacy: pdfFinto() } })).status, 400);
    const exe = new Blob(['MZ'], { type: 'application/x-msdownload' });
    eq((await invia(token, { file: { privacy: pdfFinto(), aml: exe } })).status, 400);
    eq(db.prepare("SELECT COUNT(*) c FROM record_attachments WHERE module_slug = 'clienti_t'").get().c, 0);
    eq(db.prepare('SELECT stato FROM richieste_firma WHERE id = ?').get(rid).stato, 'inviata');
  });
  await test('firma completa: allegati col tipo giusto, consenso, data, versione, stato, avviso all\'agente e conferma al cliente', async () => {
    const prima = partite.length;
    const r = await invia(token, { file: { privacy: pdfFinto(), aml: pdfFinto() }, consensi: { privacy: { c_mkt: true } } });
    eq(r.status, 200, await r.clone().text());
    const dati = JSON.parse(db.prepare('SELECT data FROM records WHERE id = ?').get(id).data);
    eq(dati.c_mkt, true); eq(dati.versione, '2026-11'); eq(dati._stato, 'ricevuti'); eq(dati.data_firma, new Date().toISOString().slice(0, 10));
    eq(db.prepare("SELECT tipo FROM record_attachments WHERE module_slug = 'clienti_t' AND record_id = ? ORDER BY id").all(id).map((a) => a.tipo), ['privacy_firmata', 'aml_firmato']);
    ok(db.prepare("SELECT 1 FROM notifications WHERE category = 'firma' AND message LIKE '%Mario Rossi ha firmato%'").get(), 'avviso per l\'agente');
    eq(partite.length, prima + 1); ok(/Abbiamo ricevuto la tua firma/.test(partite[prima].subject) && /firmato/.test(partite[prima].html), 'conferma al cliente');
    ok(db.prepare("SELECT 1 FROM audit_log WHERE action = 'firma.completata'").get(), 'audit');
  });
  await test('dopo la firma il link non vale più: né rifirmare né scaricare', async () => {
    eq((await fetch(BASE + '/api/public-firma/' + token)).status, 410);
    eq((await invia(token, { file: { privacy: pdfFinto(), aml: pdfFinto() } })).status, 410);
    const p = await (await fetch(BASE + '/api/public-firma/' + token)).json(); eq(p.firmata, true);
  });

  // solleciti e scadenza
  const id2 = rec({ nome: 'Laura Verdi', email: 'laura@esempio.it', _stato: 'nuovo' });
  await post(`/firma/clienti_t/${id2}/richieste`, { link_base: LINK, documenti: ['aml'] });
  const r2 = db.prepare("SELECT * FROM richieste_firma WHERE record_id = ?").get(id2); const token2 = tokenDa(partite[partite.length - 1]);
  const firma = require('./lib/richieste-firma'); const GIORNO = 86400000, t0 = Date.parse(r2.creata_il.replace(' ', 'T') + 'Z');
  await test('solleciti: niente prima del terzo giorno; poi uno al terzo e uno al settimo, mai di più, con lo STESSO link', async () => {
    const n0 = partite.length;
    eq(await firma.eseguiSolleciti(t0 + 2 * GIORNO), [], 'a 2 giorni');
    eq(await firma.eseguiSolleciti(t0 + 3.1 * GIORNO), [r2.id]); eq(partite.length, n0 + 1);
    ok(/Ti manca solo una firma/.test(partite[n0].subject) && tokenDa(partite[n0]) === token2, 'sollecito col link di sempre');
    eq(await firma.eseguiSolleciti(t0 + 4 * GIORNO), [], 'non due volte');
    eq(await firma.eseguiSolleciti(t0 + 7.1 * GIORNO), [r2.id]);
    eq(await firma.eseguiSolleciti(t0 + 10 * GIORNO), [], 'dopo il secondo basta');
    eq(db.prepare('SELECT solleciti FROM richieste_firma WHERE id = ?').get(r2.id).solleciti, 2);
  });
  await test('scadenza a 14 giorni: il link smette di funzionare e lo dice', async () => {
    await firma.eseguiSolleciti(t0 + 15 * GIORNO);
    eq(db.prepare('SELECT stato FROM richieste_firma WHERE id = ?').get(r2.id).stato, 'scaduta');
    const r = await fetch(BASE + '/api/public-firma/' + token2); eq(r.status, 410); ok(/scaduto/.test((await r.json()).motivo));
  });
  await test('un documento archiviato non entra nel pacchetto; senza `recipient` si usa il campo email del record; `on_send_state` scatta alla partenza', async () => {
    const mod = JSON.parse(db.prepare("SELECT schema_json FROM modules WHERE slug = 'clienti_t'").get().schema_json);
    const vecchi = mod.steps.slice();
    mod.steps = mod.steps.map((b) => (b.key === 'aml' ? { ...b, archiviato: true } : b.key === 'privacy' ? { ...b, recipient: undefined, on_send_state: 'ricevuti' } : b));
    db.prepare("UPDATE modules SET schema_json = ? WHERE slug = 'clienti_t'").run(JSON.stringify(mod));
    const id4 = rec({ nome: 'Paola Gialli', email: 'paola@esempio.it', _stato: 'nuovo' });
    const n0 = partite.length; const r = await post(`/firma/clienti_t/${id4}/richieste`, { link_base: LINK }); const j = await r.json();
    eq(r.status, 200, JSON.stringify(j)); eq(partite[n0].to, 'paola@esempio.it'); ok(!/Antiriciclaggio/.test(partite[n0].html), 'archiviato escluso'); ok(/Un documento da firmare/.test(partite[n0].subject), partite[n0].subject);
    eq(j.stato_aggiornato, true); eq(JSON.parse(db.prepare('SELECT data FROM records WHERE id = ?').get(id4).data)._stato, 'ricevuti');
    mod.steps = vecchi; db.prepare("UPDATE modules SET schema_json = ? WHERE slug = 'clienti_t'").run(JSON.stringify(mod));
  });
  // ── firma con codice (eSignature simulata) ──
  const oit = require('./lib/openapi-it'); const chiamate = []; let statoFirma = 'WAIT_SIGN'; let servizio = true;
  oit.servizioAttivo = async () => (servizio ? { ok: true } : { ok: false, motivo: 'spento' });
  oit.chiama = async (c) => {
    chiamate.push({ metodo: c.metodo || 'GET', percorso: c.percorso, corpo: c.corpo });
    if (c.metodo === 'POST' && c.percorso === '/EU-SES') return { data: { id: 'sig-' + chiamate.length, state: 'WAIT_SIGN' } };
    if (/\/detail$/.test(c.percorso)) return { data: { state: statoFirma } };
    if (/\/signedDocument$/.test(c.percorso)) return { buffer: Buffer.from('%PDF-1.4 firmato da eSignature '.padEnd(200, 'x')), tipo: 'application/pdf' };
    throw new Error('chiamata inattesa ' + c.percorso);
  };
  const spesaPrima = () => { try { return db.prepare('SELECT COUNT(*) c FROM openapi_spese WHERE servizio = ?').get('esignature_ses').c; } catch (e) { return null; } };
  const id5 = rec({ nome: 'Elena Blu', email: 'elena@esempio.it', telefono: '333 111 2222', _stato: 'nuovo' });
  await post(`/firma/clienti_t/${id5}/richieste`, { link_base: LINK }); const tok5 = tokenDa(partite[partite.length - 1]);
  const codice = (t, b) => fetch(BASE + '/api/public-firma/' + t + '/codice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) });
  const controlla = (t) => fetch(BASE + '/api/public-firma/' + t + '/controlla', { method: 'POST' });
  await test('la pagina sa se la firma con codice c\'è, se il codice può andare per SMS e quanti tentativi restano', async () => {
    let p = await (await fetch(BASE + '/api/public-firma/' + tok5)).json(); eq(p.codice, { disponibile: true, sms: true, tentativi_residui: 2 });
    servizio = false; p = await (await fetch(BASE + '/api/public-firma/' + tok5)).json(); eq(p.codice.disponibile, false); servizio = true;
    const senzaTel = await (await fetch(BASE + '/api/public-firma/' + token)).json(); ok(senzaTel.valido === false, 'quella già firmata non è più valida');
  });
  await test('firma con codice: UN solo PDF con tutti i documenti e la pagina Firma, UN firmatario, la richiesta passa «in firma»', async () => {
    const n = chiamate.length; const r = await codice(tok5, { consensi: { privacy: { c_mkt: true } }, autenticazione: 'email' }); eq(r.status, 200, await r.clone().text()); eq((await r.json()).metodo, 'email');
    const c = chiamate.slice(n).find((x) => x.metodo === 'POST'); ok(c, 'una sola richiesta a eSignature');
    eq(c.corpo.inputDocuments.length, 1, 'un solo PDF'); const pdf = Buffer.from(c.corpo.inputDocuments[0].payload, 'base64'); eq(pdf.subarray(0, 5).toString(), '%PDF-');
    eq((pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length, 3, 'due documenti + pagina Firma');
    eq(c.corpo.signers.length, 1); eq(c.corpo.signers[0].email, 'elena@esempio.it'); eq(c.corpo.signers[0].name, 'Elena'); eq(c.corpo.signers[0].surname, 'Blu'); eq(c.corpo.signers[0].signatures[0].page, 3, 'la firma sta sull\'ultima pagina');
    eq(db.prepare('SELECT stato FROM richieste_firma WHERE id = (SELECT id FROM richieste_firma WHERE record_id = ?)').get(id5).stato, 'in_firma');
    eq((await invia(tok5, { file: { privacy: pdfFinto(), aml: pdfFinto() } })).status, 409, 'non si firma anche a mano mentre il codice è in corso');
    eq((await codice(tok5, {})).status, 409, 'non si riavvia');
    const p = await (await fetch(BASE + '/api/public-firma/' + tok5)).json(); eq(p.in_firma, { metodo: 'email' });
  });
  await test('mentre il codice è in corso non partono solleciti', async () => {
    const ric = db.prepare('SELECT * FROM richieste_firma WHERE record_id = ?').get(id5); const t = Date.parse(ric.creata_il.replace(' ', 'T') + 'Z');
    ok(!(await firma.eseguiSolleciti(t + 4 * GIORNO)).includes(ric.id), 'nessun sollecito a chi ha già il codice');
  });
  await test('ricontrollo: in attesa non cambia nulla; completata → un solo firmato scaricato, allegato a ogni documento, consensi, stato, avviso e conferma', async () => {
    let r = await (await controlla(tok5)).json(); eq(r.stato, 'in_attesa');
    statoFirma = 'DONE'; const n = partite.length; const prima = db.prepare("SELECT COUNT(*) c FROM record_attachments WHERE record_id = ? AND module_slug = 'clienti_t'").get(id5).c;
    r = await (await controlla(tok5)).json(); eq(r.stato, 'firmata');
    eq(db.prepare("SELECT tipo FROM record_attachments WHERE record_id = ? AND module_slug = 'clienti_t' ORDER BY id").all(id5).map((a) => a.tipo), ['privacy_firmata', 'aml_firmato']); eq(prima, 0);
    const dati = JSON.parse(db.prepare('SELECT data FROM records WHERE id = ?').get(id5).data); eq(dati.c_mkt, true); eq(dati._stato, 'ricevuti');
    ok(db.prepare("SELECT 1 FROM notifications WHERE message LIKE '%Elena Blu ha firmato%'").get(), 'avviso'); eq(partite.length, n + 1); ok(/Abbiamo ricevuto la tua firma/.test(partite[n].subject));
    eq((await controlla(tok5)).status, 200, 'una richiesta già firmata risponde senza rifare nulla');
  });
  await test('firma fallita o annullata: la richiesta torna disponibile; dopo due tentativi il codice non si riavvia più', async () => {
    const id6 = rec({ nome: 'Franco Verde', email: 'franco@esempio.it', _stato: 'nuovo' });
    await post(`/firma/clienti_t/${id6}/richieste`, { link_base: LINK }); const tok6 = tokenDa(partite[partite.length - 1]);
    statoFirma = 'WAIT_SIGN'; eq((await codice(tok6, {})).status, 200); statoFirma = 'ERROR'; eq((await (await controlla(tok6)).json()).stato, 'da_rifare');
    eq(db.prepare('SELECT stato FROM richieste_firma WHERE record_id = ?').get(id6).stato, 'inviata');
    eq((await codice(tok6, {})).status, 200); statoFirma = 'CANCELLED'; await controlla(tok6);
    const terzo = await codice(tok6, {}); eq(terzo.status, 409, 'oltre i tentativi'); ok(/stampa/.test((await terzo.json()).error));
    const p = await (await fetch(BASE + '/api/public-firma/' + tok6)).json(); eq(p.codice.tentativi_residui, 0);
    eq((await invia(tok6, { file: { privacy: pdfFinto(), aml: pdfFinto() } })).status, 200, 'la strada della stampa resta aperta');
  });
  await test('SMS: serve un cellulare valido nella scheda (si normalizza in +39…); senza, errore chiaro; servizio spento: «usa la stampa»', async () => {
    const id7 = rec({ nome: 'Gina Rosa', email: 'gina@esempio.it', telefono: '3331112222', _stato: 'nuovo' }); const id8 = rec({ nome: 'Hugo Neri', email: 'hugo@esempio.it', _stato: 'nuovo' });
    await post(`/firma/clienti_t/${id7}/richieste`, { link_base: LINK }); const tok7 = tokenDa(partite[partite.length - 1]);
    await post(`/firma/clienti_t/${id8}/richieste`, { link_base: LINK }); const tok8 = tokenDa(partite[partite.length - 1]);
    statoFirma = 'WAIT_SIGN'; const n = chiamate.length;
    eq((await codice(tok8, { autenticazione: 'sms' })).status, 409);
    eq((await codice(tok7, { autenticazione: 'sms' })).status, 200);
    const c = chiamate.slice(n).find((x) => x.metodo === 'POST'); eq(c.corpo.signers[0].mobile, '+393331112222'); eq(c.corpo.signers[0].authentication, ['sms']); ok(!('email' in c.corpo.signers[0]), 'solo il canale scelto');
    servizio = false; const r = await codice(tok8, {}); eq(r.status, 503); ok(/stampa/.test((await r.json()).error)); servizio = true;
  });
  // ── più firmatari: proprietario e comproprietari ──
  const REL = (key) => ({ id: 'r_' + key, block_type: 'relation', key, label: key, type: 'many_to_one', target_module: 'clienti_t', display_field: 'nome' });
  const scheda = { id: 'd5', block_type: 'document_action', key: 'scheda', label: 'Scheda di acquisizione', icon: 'file', delivery: 'firma', recipients: ['proprietario.email', 'comproprietario_2.email', 'comproprietario_3.email'], body: 'SCHEDA di {{titolo}}\nProprietario {{proprietario.nome}}', signed_type: 'scheda_firmata', on_signed_state: 'in_mandato' };
  db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES ('Immobili', 'immobili_t', 'box', '#000', 1, 1, 71, ?)").run(JSON.stringify({ version: 3, steps: [F('titolo', 'Titolo'), REL('proprietario'), REL('comproprietario_2'), REL('comproprietario_3'),
    { id: 'i1', block_type: 'workflow_state', key: 'da_valutare', label: 'Da valutare', initial: true }, { id: 'i2', block_type: 'workflow_state', key: 'in_mandato', label: 'In mandato' }, { id: 'i3', block_type: 'workflow_transition', from: 'da_valutare', to: 'in_mandato', label: 'Mandato' }, scheda] }));
  const cp = rec({ nome: 'Piero Alfa', email: 'piero@esempio.it', _stato: 'nuovo' }), cc = rec({ nome: 'Chiara Beta', email: 'chiara@esempio.it', telefono: '3339998888', _stato: 'nuovo' });
  const imm = db.prepare('INSERT INTO records (module_slug, data) VALUES (?, ?)').run('immobili_t', JSON.stringify({ titolo: 'Villa Rosa', proprietario: cp, comproprietario_2: cc, comproprietario_3: cp, _stato: 'da_valutare' })).lastInsertRowid; // il terzo è lo stesso del primo: una mail sola
  let tokP, tokC, gruppo;
  await test('immobile con comproprietari: una mail e un link per ognuno (senza doppioni), salutati col PROPRIO nome', async () => {
    const n = partite.length; const r = await post(`/firma/immobili_t/${imm}/richieste`, { link_base: LINK }); const j = await r.json(); eq(r.status, 200, JSON.stringify(j));
    eq(j.inviati.map((x) => x.destinatario).sort(), ['chiara@esempio.it', 'piero@esempio.it']); eq(partite.length, n + 2);
    const mP = partite.slice(n).find((m) => m.to === 'piero@esempio.it'), mC = partite.slice(n).find((m) => m.to === 'chiara@esempio.it');
    ok(/Buongiorno Piero/.test(mP.html) && /Buongiorno Chiara/.test(mC.html), 'ognuno col suo nome, non «Villa»'); tokP = tokenDa(mP); tokC = tokenDa(mC); ok(tokP !== tokC, 'link diversi');
    const lista = await (await fetch(BASE + `/api/firma/immobili_t/${imm}/richieste`, { headers: H })).json(); eq(lista.length, 2); eq(lista[0].gruppo, lista[1].gruppo); gruppo = lista[0].gruppo; ok(lista.some((x) => x.nome === 'Chiara Beta'), 'il nome del firmatario');
  });
  await test('firma il primo: i firmati sono allegati, lo stato NON cambia e l\'avviso dice chi manca; firma l\'ultimo: lo stato cambia una volta sola', async () => {
    eq((await invia(tokP, { file: { scheda: pdfFinto() } })).status, 200);
    eq(JSON.parse(db.prepare('SELECT data FROM records WHERE id = ?').get(imm).data)._stato, 'da_valutare', 'ancora in attesa di Chiara');
    ok(db.prepare("SELECT 1 FROM notifications WHERE message LIKE '%Piero Alfa ha firmato%Manca ancora: Chiara Beta%'").get(), 'avviso con chi manca');
    eq((await invia(tokC, { file: { scheda: pdfFinto() } })).status, 200);
    eq(JSON.parse(db.prepare('SELECT data FROM records WHERE id = ?').get(imm).data)._stato, 'in_mandato', 'ora hanno firmato tutti');
    eq(db.prepare("SELECT COUNT(*) c FROM record_attachments WHERE module_slug = 'immobili_t' AND record_id = ? AND tipo = 'scheda_firmata'").get(imm).c, 2, 'una copia a testa');
    ok(db.prepare("SELECT 1 FROM notifications WHERE message LIKE '%Chiara Beta ha firmato%' AND message NOT LIKE '%Manca%'").get(), 'l\'ultimo avviso non ha «manca»');
  });
  await test('annullare una richiesta: il link smette di funzionare; l\'elenco mostra gli stati', async () => {
    const id3 = rec({ nome: 'Carlo Neri', email: 'carlo@esempio.it', _stato: 'nuovo' });
    await post(`/firma/clienti_t/${id3}/richieste`, { link_base: LINK }); const tok3 = tokenDa(partite[partite.length - 1]);
    const lista = await (await fetch(BASE + `/api/firma/clienti_t/${id3}/richieste`, { headers: H })).json(); eq(lista[0].stato, 'inviata');
    eq((await fetch(BASE + '/api/firma/richieste/' + lista[0].id, { method: 'DELETE', headers: H })).status, 200);
    eq((await fetch(BASE + '/api/public-firma/' + tok3)).status, 410);
    eq((await fetch(BASE + `/api/firma/clienti_t/${id3}/richieste`)).status, 401, 'senza accesso non si elenca');
  });
  console.log(`\n${passed} passati, ${failed} falliti`); process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
