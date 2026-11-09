'use strict';
// «Verifica del soggetto» e «Credit score società» collegati a Risk di OpenAPI.it: la funzione resta «da attivare» finché il servizio non è abilitato e poi parte da sola,
// con consenso, conferma del costo, ricontrollo gratuito del report asincrono e PDF. OpenAPI.it è sostituito da un finto (nessuna rete). Porta 34872.
const path = require('path'), os = require('os'), fs = require('fs'), crypto = require('crypto');
const TEST_PORT = 34872, BASE = 'http://localhost:' + TEST_PORT;
process.env.DB_PATH = path.join(os.tmpdir(), 'risk-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'rk_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'rk_internal_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'rk_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rk-uploads-'));

let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); console.log('  ✓ ' + name); passed++; } catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; } }
const eq = (a, e, m) => { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${m || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m || 'atteso true'); };

async function main() {
  let attivo = false, reportPronto = false, statoServizio = 'processing'; const chiamate = [];
  const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(400, 'x')]);
  require.cache[require.resolve('./lib/openapi-it')] = { id: 'fake', filename: 'fake', loaded: true, exports: {
    credenziali: () => ({ email: 'a@b.it', apiKey: 'x', sandbox: false }),
    servizioAttivo: async () => (attivo ? { ok: true } : { ok: false, motivo: 'Il servizio non è abilitato sulla chiave collegata.' }),
    chiama: async ({ metodo = 'GET', percorso, corpo, binario }) => {
      chiamate.push(metodo + ' ' + percorso);
      if (metodo === 'POST' && /IT-report-persona/.test(percorso)) { ok(corpo.name === 'Mario' && corpo.surname === 'Rossi' && /^[A-Z]{6}\d{2}/.test(corpo.taxCode), 'corpo della richiesta'); return { data: { id: 'rep123', state: 'processing' } }; }
      if (/\/download$/.test(percorso)) { if (!reportPronto) throw Object.assign(new Error('not ready'), { status: 404 }); return { status: 200, tipo: 'application/pdf', buffer: PDF }; }
      if (percorso === '/visura_catastale') { ok(corpo.foglio === '273' && corpo.particella === '23' && corpo.subalterno === '60' && corpo.comune === 'BRESCIA' && corpo.provincia === 'BS', 'corpo visura ' + JSON.stringify(corpo)); return { data: { id: 'vis1', stato: 'in_erogazione' } }; }
      if (percorso === '/visura_catastale/vis1') return reportPronto ? { data: { id: 'vis1', stato: 'evasa', risultato: { Immobile: { DatiClassamento: { Categoria: 'A/2', RenditaEuro: '413,17' } } } } } : { data: { id: 'vis1', stato: 'in_erogazione' } };
      if (/IT-creditscore-start\//.test(percorso)) return { data: { organization_name: 'ACME SRL', risk_score: 'VERDE' } };
      if (/IT-creditscore-advanced\//.test(percorso)) return { data: { organization_name: 'ACME SRL', risk_score: 'GIALLO', rating: 'B2', operational_credit_limit: '25000' } };
      if (metodo === 'GET' && /IT-report-persona\/rep123$/.test(percorso)) return { data: { id: 'rep123', state: statoServizio, ...(/fail/.test(statoServizio) ? { message: 'soggetto non trovato' } : {}) } };
      throw new Error('chiamata inattesa ' + metodo + ' ' + percorso);
    },
  } };
  require.cache[require.resolve('./lib/ai-valutazione')] = { id: 'fake-ai', filename: 'fake-ai', loaded: true, exports: { considerazioni: async () => null } };
  require('./index.js');
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const db = require('./db');
  const F = (key, type = 'text') => ({ id: 'f_' + key, block_type: 'field', key, label: key, type });
  db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES ('Persone', 'persone', 'box', '#000', 1, 1, 70, ?)").run(JSON.stringify({ version: 3, steps: [
    F('nome'), F('codice_fiscale_piva'), F('tipo_soggetto'), F('privacy_firmata_il', 'date'), F('verifica_esito'), F('verifica_data', 'date'), F('credit_score_esito'), F('credit_score_data', 'date'),
    { id: 'ea1', block_type: 'external_action', key: 'verifica_soggetto', label: 'Verifica del soggetto', adapter: 'verifica_persona', campi: { nome: 'nome', codice_fiscale: 'codice_fiscale_piva', tipo_soggetto: 'tipo_soggetto', consenso: 'privacy_firmata_il' }, esito: { esito: 'verifica_esito', data: 'verifica_data' }, risultato_in: 'verifica_persona', pdf: true },
    { id: 'ea3', block_type: 'external_action', key: 'controllo_catastale', label: 'Controllo catastale', adapter: 'controllo_catastale', campi: { provincia: 'provincia', comune: 'comune', foglio: 'foglio', particella: 'particella', subalterno: 'sub', categoria: 'categoria', rendita: 'rendita' }, esito: { esito: 'verifica_esito', data: 'verifica_data' }, risultato_in: 'controllo_catastale' },
    { id: 'ea2', block_type: 'external_action', key: 'credit_score_societa', label: 'Credit score società', adapter: 'credit_score_societa', campi: { codice: 'codice_fiscale_piva', tipo_soggetto: 'tipo_soggetto' }, esito: { esito: 'credit_score_esito', data: 'credit_score_data' }, risultato_in: 'credit_score_societa', livello: 'advanced' },
  ] }));
  const rec = (d) => db.prepare("INSERT INTO records (module_slug, data) VALUES ('persone', ?)").run(JSON.stringify(d)).lastInsertRowid;
  const leggi = (id) => JSON.parse(db.prepare('SELECT data FROM records WHERE id = ?').get(id).data);
  const login = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: process.env.INITIAL_ADMIN_PASSWORD }) })).json();
  const H = { Authorization: 'Bearer ' + login.token, 'Content-Type': 'application/json' };
  const azione = (id, key, corpo = {}, sub = '') => fetch(BASE + '/api/records/persone/' + id + '/azione/' + key + sub, { method: 'POST', headers: H, body: JSON.stringify(corpo) });
  const spese = async () => (await fetch(BASE + '/api/connections/openapi_it/spese', { headers: H })).json();
  const persona = { nome: 'Mario Rossi', codice_fiscale_piva: 'RSSMRA80A01H501U', tipo_soggetto: 'Persona fisica', privacy_firmata_il: '2026-11-01' };

  await test('servizio non abilitato: «da attivare», nessuna conferma di costo, nessuna chiamata, nessuna spesa', async () => {
    const r = await azione(rec(persona), 'verifica_soggetto', { conferma: true }); eq(r.status, 501); const j = await r.json();
    eq(j.code, 'da_attivare'); ok(/da attivare/.test(j.error) && /non è abilitato/.test(j.error), j.error);
    eq(chiamate.length, 0); eq((await spese()).produzione.richieste, 0);
  });
  await test('azioni-stato dice quali azioni non possono partire (la scheda le mette in «Altre funzioni»)', async () => {
    const j = await (await fetch(BASE + '/api/records/persone/azioni-stato', { headers: H })).json();
    eq([j.verifica_soggetto.ok, j.credit_score_societa.ok], [false, false]); ok(j.verifica_soggetto.motivo);
    attivo = true;
    const g = await (await fetch(BASE + '/api/records/persone/azioni-stato', { headers: H })).json();
    eq([g.verifica_soggetto.ok, g.credit_score_societa.ok], [true, true], 'attivato il servizio parte da sola');
  });
  await test('persona: senza informativa firmata, società, o codice fiscale sbagliato → 400, niente costo né richieste', async () => {
    for (const [d, re] of [[{ ...persona, privacy_firmata_il: '' }, /consenso/i], [{ ...persona, tipo_soggetto: 'Società' }, /persone fisiche/], [{ ...persona, codice_fiscale_piva: 'ROSSI' }, /codice fiscale/i]]) {
      const r = await azione(rec(d), 'verifica_soggetto', { conferma: true }); eq(r.status, 400); ok(re.test((await r.json()).error));
    }
    eq(chiamate.length, 0); eq((await spese()).produzione.richieste, 0);
  });
  let id1;
  await test('persona: il server chiede prima il costo; con la conferma invia la richiesta, registra UNA spesa e salva l\'id (report non ancora pronto)', async () => {
    id1 = rec(persona);
    const c = await azione(id1, 'verifica_soggetto'); eq(c.status, 409); const j = await c.json(); eq([j.code, j.servizio, j.costo, j.noto], ['conferma_costo', 'risk_report_persona', 3.6, true]);
    const r = await azione(id1, 'verifica_soggetto', { conferma: true }); eq(r.status, 200);
    eq(leggi(id1).verifica_persona.stato, 'in_corso'); eq(leggi(id1).verifica_persona.id, 'rep123'); ok(/in preparazione/.test(leggi(id1).verifica_esito));
    const s = await spese(); eq([s.produzione.richieste, s.produzione.speso], [1, 3.6]);
  });
  await test('persona: premendo di nuovo il report in corso si ricontrolla SENZA costo e senza una seconda richiesta; quando è pronto lo dice', async () => {
    const prima = chiamate.filter((x) => x.startsWith('POST')).length;
    reportPronto = true;
    const r = await azione(id1, 'verifica_soggetto'); eq(r.status, 200, 'nessuna conferma di costo');
    eq(chiamate.filter((x) => x.startsWith('POST')).length, prima, 'nessun nuovo POST'); eq(leggi(id1).verifica_persona.stato, 'completata'); ok(/pronto/.test(leggi(id1).verifica_esito));
    eq((await spese()).produzione.richieste, 1, 'ancora una sola spesa');
  });
  await test('persona: il PDF del report si scarica dal server (nessuna nuova richiesta a pagamento)', async () => {
    const r = await azione(id1, 'verifica_soggetto', {}, '/pdf'); eq(r.status, 200); const b = Buffer.from(await r.arrayBuffer()); eq(b.slice(0, 4).toString(), '%PDF');
    eq((await spese()).produzione.richieste, 1);
  });
  await test('credit score: livello advanced → prezzo 0,15; con conferma scrive semaforo, rating e fido sul record; una persona è rifiutata', async () => {
    const id = rec({ nome: 'ACME SRL', codice_fiscale_piva: '01234567890', tipo_soggetto: 'Società' });
    const c = await (await azione(id, 'credit_score_societa')).json(); eq([c.servizio, c.costo], ['risk_creditscore_advanced', 0.15]);
    const r = await azione(id, 'credit_score_societa', { conferma: true }); eq(r.status, 200);
    const t = leggi(id).credit_score_esito; ok(/GIALLO/.test(t) && /B2/.test(t) && /25000/.test(t), t);
    const p = await azione(rec(persona), 'credit_score_societa', { conferma: true }); eq(p.status, 400);
  });

  await test('catasto: dati mancanti → 400; con conferma chiede la visura e salva l\'id; il ricontrollo (senza costo) confronta categoria e rendita con la scheda', async () => {
    reportPronto = false;
    const m = await azione(rec({ provincia: 'BS' }), 'controllo_catastale', { conferma: true }); eq(m.status, 400); ok(/comune/.test((await m.json()).error));
    const id = rec({ provincia: 'BS', comune: 'Brescia', foglio: '273', particella: '23', sub: '60', categoria: 'A/2', rendita: 413.17 });
    const c = await (await azione(id, 'controllo_catastale')).json(); eq([c.code, c.servizio, c.noto], ['conferma_costo', 'catasto_visura_immobile', false]);
    const prima = (await spese()).produzione.richieste;
    eq((await azione(id, 'controllo_catastale', { conferma: true })).status, 200); eq(leggi(id).controllo_catastale.stato, 'in_corso');
    eq((await spese()).produzione.richieste, prima + 1);
    reportPronto = true;
    eq((await azione(id, 'controllo_catastale')).status, 200, 'ricontrollo senza conferma');
    const t = leggi(id).verifica_esito; ok(/categoria coincide/.test(t) && /rendita coincide/.test(t), t); eq(leggi(id).controllo_catastale.stato, 'completata');
    eq((await spese()).produzione.richieste, prima + 1, 'nessuna seconda spesa');
  });

  await test('persona: lo stato presso OpenAPI.it si vede; una richiesta fallita non resta «in preparazione» per sempre e non si ricontrolla a vuoto', async () => {
    reportPronto = false; statoServizio = 'processing';
    const id2 = rec(persona); const prima = (await spese()).produzione.richieste;
    eq((await azione(id2, 'verifica_soggetto', { conferma: true })).status, 200);
    eq(leggi(id2).verifica_persona.stato, 'in_corso'); ok(/stato presso OpenAPI\.it: processing/.test(leggi(id2).verifica_esito), leggi(id2).verifica_esito);
    statoServizio = 'failed';
    eq((await azione(id2, 'verifica_soggetto')).status, 200, 'il ricontrollo non costa');
    eq(leggi(id2).verifica_persona.stato, 'fallita'); ok(/fallita/.test(leggi(id2).verifica_esito) && /soggetto non trovato/.test(leggi(id2).verifica_esito), leggi(id2).verifica_esito);
    const r = await azione(id2, 'verifica_soggetto'); eq(r.status, 409); eq((await r.json()).code, 'conferma_costo'); // una richiesta fallita non è più «in corso»: ne serve una nuova, con conferma del costo
    eq((await spese()).produzione.richieste, prima + 1, 'una sola spesa finora');
  });

  console.log('\n' + passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
