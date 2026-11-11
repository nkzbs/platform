'use strict';
// Messaggi ai clienti: auguri di compleanno e invio di massa (mail + SMS di OpenAPI.it). Servizi esterni sostituiti da finti. Porta 34873.
const path = require('path'), os = require('os'), fs = require('fs'), crypto = require('crypto');
const TEST_PORT = 34873, BASE = 'http://localhost:' + TEST_PORT;
process.env.DB_PATH = path.join(os.tmpdir(), 'msg-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'mg_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'mg_internal_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'mg_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-uploads-'));

let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); console.log('  ✓ ' + name); passed++; } catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; } }
const eq = (a, e, m) => { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${m || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m || 'atteso true'); };

async function main() {
  let smsAttivo = true; const mail = [], sms = [];
  require.cache[require.resolve('./lib/openapi-it')] = { id: 'fake', filename: 'fake', loaded: true, exports: {
    credenziali: () => ({ email: 'a@b.it', apiKey: 'x', sandbox: false }),
    servizioAttivo: async () => (smsAttivo ? { ok: true } : { ok: false, motivo: 'no' }),
    chiama: async ({ corpo }) => { sms.push(corpo); return { data: { id: 's' + sms.length, recipient: corpo.recipient, messageCount: 1, totalPrice: 0.036 } }; },
  } };
  require.cache[require.resolve('./lib/email')] = { id: 'fake-mail', filename: 'fake-mail', loaded: true, exports: {
    credenziali: () => ({ api_key: 'k', from_email: 'x@y.it' }),
    stato: () => ({ ok: true, via: 'resend', motivo: null }),
    htmlDaTesto: (t, o) => '<p>' + t + '</p>' + (o && o.piede ? '<p>' + o.piede + '</p>' : ''),
    invia: async ({ to, subject, html }) => { mail.push({ to, subject, html }); return { ok: true }; },
  } };
  require.cache[require.resolve('./lib/ai-valutazione')] = { id: 'fake-ai', filename: 'fake-ai', loaded: true, exports: { considerazioni: async () => null } };
  require('./index.js');
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const db = require('./db'); const M = require('./lib/messaggi-clienti');
  const F = (key, type = 'text') => ({ id: 'f_' + key, block_type: 'field', key, label: key, type });
  db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES ('Persone', 'persone', 'box', '#000', 1, 1, 70, ?)").run(JSON.stringify({ version: 3, steps: [
    F('nome'), F('email'), F('telefono'), F('consenso_marketing', 'checkbox'), F('data_nascita', 'date'),
    { id: 'ea1', block_type: 'external_action', key: 'auguri_cliente', label: 'Auguri', adapter: 'messaggio_cliente', automatico: 'compleanno', campi: { nome: 'nome', email: 'email', telefono: 'telefono', consenso: 'consenso_marketing', data_nascita: 'data_nascita' } },
  ] }));
  const rec = (d) => db.prepare("INSERT INTO records (module_slug, data) VALUES ('persone', ?)").run(JSON.stringify(d)).lastInsertRowid;
  const login = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: process.env.INITIAL_ADMIN_PASSWORD }) })).json();
  const H = { Authorization: 'Bearer ' + login.token, 'Content-Type': 'application/json' };
  const put = (b) => fetch(BASE + '/api/messaggi/impostazioni', { method: 'PUT', headers: H, body: JSON.stringify(b) });
  const massivo = (b) => fetch(BASE + '/api/messaggi/persone/massivo/auguri_cliente', { method: 'POST', headers: H, body: JSON.stringify(b) });
  const reset = () => { mail.length = 0; sms.length = 0; db.prepare('DELETE FROM messaggi_inviati').run(); };

  await test('numeri di telefono: 333…, +39…, 0039… diventano E.164; sbagliati → nessun invio', async () => {
    eq([M.numeroE164('333 123 4567'), M.numeroE164('+39 333 1234567'), M.numeroE164('00393331234567'), M.numeroE164('12345'), M.numeroE164('')], ['+393331234567', '+393331234567', '+393331234567', null, null]);
    eq([M.haConsenso(true), M.haConsenso('Sì'), M.haConsenso(''), M.haConsenso(false)], [true, true, false, false]);
    eq(M.riempi('Ciao {nome} {cognome}', { n: 'Mario De Luca' }, { nome: 'n' }), 'Ciao Mario De Luca');
  });
  await test('impostazioni: mittente SMS non valido o tetto fuori misura → 400; valide si salvano', async () => {
    eq((await put({ sms_mittente: 'ab' })).status, 400); eq((await put({ tetto_giornaliero: 0 })).status, 400);
    eq((await put({ auguri: { attivi: true, canali: [] } })).status, 400);
    const r = await put({ sms_mittente: 'STUDIO', tetto_giornaliero: 3, auguri: { attivi: false, canali: ['mail', 'sms'], oggetto: 'Auguri {nome}', testo: 'Ciao {nome}, auguri!' } }); eq(r.status, 200);
  });
  const a = rec({ nome: 'Mario Rossi', email: 'm@x.it', telefono: '333 111 2222', consenso_marketing: true });
  const b = rec({ nome: 'Anna Verdi', email: 'a@x.it', telefono: '', consenso_marketing: true });
  const c = rec({ nome: 'Luca Senza', email: 'l@x.it', telefono: '3331112233', consenso_marketing: false });
  const d = rec({ nome: 'Eva Vuota', consenso_marketing: true });
  await test('anteprima: nessun invio; conta chi riceve, chi è saltato e perché; senza conferma non parte niente', async () => {
    reset();
    const r = await (await massivo({ ids: [a, b, c, d], canali: ['mail', 'sms'], oggetto: 'Ciao', testo: 'Ciao {nome}', anteprima: true })).json();
    eq([r.pronti, r.mail, r.sms, r.saltati, r.costo_sms], [2, 2, 1, 2, 0.049]); ok(r.saltati_motivi.some((m) => /consenso/.test(m)) && r.saltati_motivi.some((m) => /contatto/.test(m)));
    eq(r.esempio.testo, 'Ciao Mario'); eq([mail.length, sms.length], [0, 0]);
    const s = await massivo({ ids: [a], canali: ['mail'], oggetto: 'x', testo: 'y' }); eq((await s.json()).conferma_richiesta, true); eq(mail.length, 0, 'senza conferma non parte');
  });
  await test('invio di massa con conferma: mail e SMS ai soli aventi consenso e contatto; registro completo; footer di disiscrizione nella mail', async () => {
    reset();
    const r = await (await massivo({ ids: [a, b, c, d], canali: ['mail', 'sms'], oggetto: 'Ciao {nome}', testo: 'Ciao {nome}, novità!', conferma: true })).json();
    eq([r.inviati, r.falliti], [3, 0]); eq(mail.map((m) => m.to), ['m@x.it', 'a@x.it']); eq(mail[0].subject, 'Ciao Mario'); ok(/Rispondi a questa mail/.test(mail[0].html));
    eq(sms.length, 1); eq([sms[0].sender, sms[0].recipient, sms[0].message], ['STUDIO', '+393331112222', 'Ciao Mario, novità!']);
    eq(db.prepare("SELECT COUNT(*) n FROM messaggi_inviati WHERE esito='inviato'").get().n, 3);
    eq(db.prepare("SELECT COUNT(*) n FROM openapi_spese WHERE servizio='sms_italia'").get().n >= 1, true, 'la spesa SMS finisce nel registro delle spese');
  });
  await test('tetto giornaliero (3): i messaggi oltre il tetto si fermano e restano scritti nel registro, non spariscono', async () => {
    const r = await (await massivo({ ids: [a, b], canali: ['mail', 'sms'], oggetto: 'x', testo: 'y', conferma: true })).json();
    eq(r.inviati, 0); eq(r.fermati_dal_tetto >= 1, true); ok(db.prepare("SELECT COUNT(*) n FROM messaggi_inviati WHERE esito='fermato'").get().n >= 1);
  });
  await test('SMS non abilitato: il canale si salta e lo dice, la mail parte lo stesso', async () => {
    reset(); smsAttivo = false; await put({ tetto_giornaliero: 100 });
    const r = await (await massivo({ ids: [a], canali: ['mail', 'sms'], oggetto: 'x', testo: 'y', conferma: true })).json();
    eq([r.inviati, mail.length, sms.length], [1, 1, 0]); eq(r.canali.non_disponibili[0].canale, 'sms'); smsAttivo = true;
  });
  await test('auguri automatici: spenti non partono; accesi mandano a chi compie gli anni oggi (con consenso), una sola volta all\'anno', async () => {
    reset(); const oggi = new Date(); const iso = (y) => y + '-' + String(oggi.getMonth() + 1).padStart(2, '0') + '-' + String(oggi.getDate()).padStart(2, '0');
    const e = rec({ nome: 'Carla Festa', email: 'c@x.it', telefono: '3339998888', consenso_marketing: true, data_nascita: iso(1980) });
    rec({ nome: 'Paolo NoConsenso', email: 'p@x.it', consenso_marketing: false, data_nascita: iso(1975) });
    rec({ nome: 'Altro Giorno', email: 'z@x.it', consenso_marketing: true, data_nascita: '1990-01-01' === iso(1990) ? '1990-02-02' : '1990-01-01' });
    eq((await M.eseguiAuguri()).saltato, 'auguri non attivi'); eq(mail.length, 0);
    await put({ auguri: { attivi: true, canali: ['mail', 'sms'], oggetto: 'Auguri {nome}!', testo: 'Buon compleanno {nome}' } });
    const r1 = await M.eseguiAuguri(); eq(r1.fatto[0].compleanni, 2); eq(mail.map((m) => m.to), ['c@x.it']); eq(sms.length, 1);
    eq(db.prepare("SELECT motivo FROM messaggi_inviati WHERE esito='saltato'").get().motivo.includes('consenso'), true, 'il saltato per consenso è nel registro');
    const prima = mail.length; await M.eseguiAuguri(); eq(mail.length, prima, 'non una seconda volta nello stesso anno');
    const w = await fetch(BASE + '/api/records/persone/' + e + '/azione/auguri_cliente', { method: 'POST', headers: H, body: '{}' }); eq(w.status, 200, 'pulsante sul singolo cliente');
  });
  await test('solo gli amministratori usano le rotte dei messaggi', async () => {
    const r = await fetch(BASE + '/api/messaggi/impostazioni'); eq(r.status, 401);
  });

  console.log('\n' + passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
