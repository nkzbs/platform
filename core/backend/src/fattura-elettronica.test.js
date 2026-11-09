'use strict';
// Fattura elettronica: l'XML (FatturaPA 1.2) è valido secondo lo schema ufficiale dell'Agenzia delle Entrate (se xmllint c'è), mancano-i-dati si dicono in italiano, e l'adattatore invia una volta sola,
// numera per anno, ricontrolla lo stato e rimanda con lo stesso numero una fattura scartata. OpenAPI.it è finto (nessuna rete). Eseguire con: node src/fattura-elettronica.test.js
const path = require('path'); const os = require('os'); const fs = require('fs'); const crypto = require('crypto'); const { spawnSync } = require('child_process');
process.env.DB_PATH = path.join(os.tmpdir(), 'sdi-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.JWT_SECRET = 'jwt_' + crypto.randomBytes(8).toString('hex');
process.env.ENCRYPTION_KEY = 'sdi_test_encryption_key_0000000';
process.env.INTERNAL_API_SECRET = 'int_' + crypto.randomBytes(8).toString('hex');
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sdi-up-'));
let passati = 0, falliti = 0;
async function test(nome, fn) { try { await fn(); console.log('  ✓ ' + nome); passati++; } catch (e) { console.error('  ✗ ' + nome + '\n    ' + e.message); falliti++; } }
const ok = (c, m) => { if (!c) throw new Error(m || 'atteso true'); };
const fp = require('./lib/fatturapa');
const CED = { denominazione: 'Agenzia Esempio S.r.l.', piva: '12345678903', indirizzo: 'Via Roma 1', cap: '25121', comune: 'Brescia', provincia: 'BS', regime: 'RF01' };
const CES = { nome: 'Mario', cognome: 'Rossi', codice_fiscale: 'RSSMRA85T10A562S', indirizzo: 'Via Verdi 3', cap: '25100', comune: 'Brescia', pec: 'mario@pec.it' };
const DOC = { numero: '1/2026', data: '2026-11-09', descrizione: 'Provvigione venditore — Via Verdi «prova» €', imponibile: 4560, totale: 5563.2 };

(async () => {
  console.log('--- XML ---');
  const xmllint = spawnSync('xmllint', ['--version']); const haXmllint = !xmllint.error;
  const valida = (xml) => { const f = path.join(os.tmpdir(), 'fp-' + crypto.randomBytes(4).toString('hex') + '.xml'); fs.writeFileSync(f, xml); const r = spawnSync('xmllint', ['--noout', '--schema', path.join(__dirname, 'xsd', 'Schema_FatturaPA_v1.2.2.xsd'), f], { encoding: 'utf8' }); fs.unlinkSync(f); return { ok: r.status === 0, out: r.stderr }; };
  await test('l\'XML di una persona con IBAN e PEC è valido secondo lo schema ufficiale' + (haXmllint ? '' : ' (saltato: manca xmllint)'), () => { if (!haXmllint) return; const v = valida(fp.costruisci({ cedente: CED, cessionario: CES, documento: DOC, pagamento: { scadenza: '2026-11-30', iban: 'IT60X0542811101000000123456' } })); ok(v.ok, v.out.slice(0, 400)); });
  await test('l\'XML di una società con codice destinatario, senza pagamento, con & nel nome, è valido' + (haXmllint ? '' : ' (saltato)'), () => { if (!haXmllint) return; const v = valida(fp.costruisci({ cedente: CED, cessionario: { denominazione: 'Edilnord & Figli S.r.l.', piva: '12345678903', indirizzo: 'Via Industria 5', cap: '25100', comune: 'Brescia', codice_destinatario: 'abcdefg' }, documento: DOC })); ok(v.ok, v.out.slice(0, 400)); });
  await test('i caratteri fuori da Latin-1 (trattini lunghi, €, virgolette) non finiscono nell\'XML', () => {
    const x = fp.costruisci({ cedente: CED, cessionario: CES, documento: DOC }); ok(!/[—€]/.test(x) && /Provvigione venditore - Via Verdi/.test(x) && /EUR/.test(x), x.slice(x.indexOf('<Causale>'), x.indexOf('<Causale>') + 120));
  });
  await test('con dati mancanti dice in italiano cosa manca, tutto insieme', () => {
    let e; try { fp.costruisci({ cedente: { denominazione: 'X', piva: '123' }, cessionario: { nome: 'A', cognome: 'B', codice_fiscale: 'XX', cap: '1' }, documento: { numero: '1/2026', data: '2026-01-01', descrizione: 'd', imponibile: 0 } }); } catch (x) { e = x; }
    ok(e && /partita IVA valida/.test(e.message) && /CAP dell'azienda/.test(e.message) && /codice fiscale del cliente/.test(e.message) && /CAP del cliente/.test(e.message) && /importo maggiore di zero/.test(e.message), e && e.message);
  });
  await test('un totale che non torna con imponibile + IVA si ferma', () => {
    let e; try { fp.costruisci({ cedente: CED, cessionario: CES, documento: { ...DOC, totale: 9999 } }); } catch (x) { e = x; }
    ok(e && /non torna/.test(e.message), e && e.message);
  });

  console.log('--- adattatore ---');
  const db = require('./db'); const sigillo = require('./secrets-at-rest');
  db.prepare('DELETE FROM modules').run();
  const F = (key, extra = {}) => ({ id: 'f_' + key, block_type: 'field', key, label: key, type: 'text', ...extra });
  db.prepare('INSERT INTO modules (name, slug, installed, schema_json) VALUES (?, ?, 1, ?)').run('Clienti', 'clienti', JSON.stringify({ version: 3, steps: [F('nome'), F('codice_fiscale_piva'), F('tipo_soggetto'), F('indirizzo'), F('cap'), F('comune'), F('pec')] }));
  db.prepare('INSERT INTO modules (name, slug, installed, schema_json) VALUES (?, ?, 1, ?)').run('Provvigioni', 'provvigioni', JSON.stringify({ version: 3, steps: [F('descrizione'), F('importo_netto', { type: 'number' }), F('totale', { type: 'number' }), F('data_scadenza', { type: 'date' }), { id: 'r', block_type: 'relation', key: 'cliente', label: 'Cliente', type: 'many_to_one', target_module: 'clienti', display_field: 'nome' }] }));
  db.prepare("UPDATE tenant_settings SET ragione_sociale = 'Agenzia Esempio S.r.l.', indirizzo = 'Via Roma 1', piva = '12345678903' WHERE id = 1").run();
  db.prepare("INSERT INTO connections (integration_id, connected, credentials) VALUES ('openapi_it', 1, ?)").run(sigillo.seal({ email: 'a@b.it', api_key: 'CHIAVE', ambiente: 'sandbox', sdi_cap: '25121', sdi_comune: 'Brescia', sdi_provincia: 'BS', sdi_iban: 'IT60X0542811101000000123456' }));
  const cliente = db.prepare("INSERT INTO records (module_slug, user_id, data) VALUES ('clienti', 1, ?)").run(JSON.stringify({ nome: 'Mario Rossi', codice_fiscale_piva: 'RSSMRA85T10A562S', tipo_soggetto: 'Persona fisica', indirizzo: 'Via Verdi 3', cap: '25100', comune: 'Brescia', pec: 'mario@pec.it' })).lastInsertRowid;
  const prov = (extra = {}) => db.prepare("INSERT INTO records (module_slug, user_id, data) VALUES ('provvigioni', 1, ?)").run(JSON.stringify({ descrizione: 'Provvigione venditore — Via Verdi', importo_netto: 4560, totale: 5563.2, data_scadenza: '2026-11-30', cliente, ...extra })).lastInsertRowid;
  const CONFIG = { key: 'fattura_elettronica', label: 'Fattura elettronica', adapter: 'fattura_elettronica', campi: { descrizione: 'descrizione', imponibile: 'importo_netto', totale: 'totale', scadenza: 'data_scadenza' }, cliente: { relazione: 'cliente', campi: { nome: 'nome', codice_fiscale: 'codice_fiscale_piva', tipo_soggetto: 'tipo_soggetto', indirizzo: 'indirizzo', cap: 'cap', comune: 'comune', pec: 'pec' } }, esito: { esito: 'fattura_esito', data: 'fattura_data' }, risultato_in: 'fattura_elettronica' };
  const dati = (id) => JSON.parse(db.prepare('SELECT data FROM records WHERE id = ?').get(id).data);
  const chiamate = []; let sdi = 'BOOKED', statoFattura = 'SENT', rifiutaConfig = true; const veroFetch = global.fetch;
  global.fetch = async (url, opts = {}) => {
    const u = String(url); if (!/openapi\.(com|it)/.test(u)) return veroFetch(url, opts);
    chiamate.push({ metodo: opts.method || 'GET', url: u, tipo: opts.headers && opts.headers['Content-Type'], corpo: opts.body });
    const r = (s, corpo) => ({ ok: s < 300, status: s, json: async () => corpo });
    if (u.endsWith('/tokens')) return r(200, { data: { token: 'tok' } });
    if (u.endsWith('/IT-configurations')) { rifiutaConfig = false; return r(200, { data: { fiscal_id: '12345678903' } }); }
    if (/\/IT-invoices$/.test(u) && opts.method === 'POST') return rifiutaConfig ? r(403, { message: 'customer_invoice non abilitato per questo fiscal_id' }) : r(200, { data: { id: 'inv-' + chiamate.length, state: 'SENT', details: { sdi_status: 'BOOKED' } } });
    if (/\/IT-invoices\/inv-/.test(u)) return r(200, { data: { id: 'inv', state: statoFattura, details: { sdi_status: sdi, sdi_message: sdi === 'REJECTED' ? 'Codice destinatario non valido (00311)' : null } } });
    return r(404, { message: 'non trovato' });
  };
  const A = require('./lib/azioni-esterne').adattatore('fattura_elettronica'); const anno = new Date().getFullYear();
  let id1, res1;
  await test('il riepilogo dice cosa parte, con numero, importi e l\'avviso che non si ritira', () => {
    id1 = prov(); const r = A.riepilogo({ slug: 'provvigioni', dati: dati(id1), config: CONFIG });
    ok(new RegExp('Fattura n. 1/' + anno).test(r) && /Mario Rossi/.test(r) && /4\.560,00/.test(r) && /1\.003,20/.test(r) && /5\.563,20/.test(r) && /nota di credito/.test(r), r);
  });
  await test('il riepilogo dice cosa manca invece di mostrare una fattura incompleta', () => {
    const senza = db.prepare("INSERT INTO records (module_slug, user_id, data) VALUES ('clienti', 1, ?)").run(JSON.stringify({ nome: 'Luca Neri' })).lastInsertRowid;
    const r = A.riepilogo({ slug: 'provvigioni', dati: { ...dati(prov()), cliente: senza }, config: CONFIG }); ok(/non può partire: manca/.test(r) && /codice fiscale del cliente/.test(r), r);
  });
  await test('la prima pressione manda l\'XML (Content-Type XML), crea la configurazione se serve, e numera 1/anno', async () => {
    res1 = await A.esegui({ dati: dati(id1), config: CONFIG, slug: 'provvigioni', id: id1 });
    const post = chiamate.filter((c) => c.metodo === 'POST' && /IT-invoices$/.test(c.url));
    ok(post.length === 2 && post[0].tipo === 'application/xml' && /test\.invoice\.openapi\.com/.test(post[0].url), 'tentativi: ' + post.length);
    ok(chiamate.some((c) => /IT-configurations$/.test(c.url)), 'configurazione non creata');
    ok(/<Numero>1\/\d{4}<\/Numero>/.test(post[1].corpo) && /<ImportoTotaleDocumento>5563.20/.test(post[1].corpo), post[1].corpo.slice(0, 200));
    ok(res1.patch.fattura_elettronica.numero === '1/' + anno && /Fattura n\. 1/.test(res1.patch.fattura_esito) && A.servizio === 'sdi_fattura', JSON.stringify(res1.patch));
  });
  await test('una seconda fattura prende il numero 2; una già inviata non si rifà', async () => {
    const id2 = prov(); const r2 = await A.esegui({ dati: dati(id2), config: CONFIG, slug: 'provvigioni', id: id2 }); ok(r2.patch.fattura_elettronica.numero === '2/' + anno, JSON.stringify(r2.patch));
    const finita = { ...dati(id1), fattura_elettronica: { ...res1.patch.fattura_elettronica, stato: 'DONE', sdi: 'ACCEPTED' } };
    let e; try { await A.esegui({ dati: finita, config: CONFIG, slug: 'provvigioni', id: id1 }); } catch (x) { e = x; } ok(e && e.status === 409 && /già stata fatturata/.test(e.message), e && e.message);
  });
  await test('finché lo SDI non risponde, il clic ricontrolla senza spesa', async () => {
    const d = { ...dati(id1), fattura_elettronica: res1.patch.fattura_elettronica }; ok(A.senzaCosto({ dati: d, config: CONFIG }) === true, 'deve essere gratis');
    const out = await A.esegui({ dati: d, config: CONFIG, slug: 'provvigioni', id: id1 }); ok(out.risposta.consegnata === false && /in attesa dello SDI/.test(out.patch.fattura_esito), out.patch.fattura_esito);
  });
  await test('consegnata: lo dice; scartata: dice il motivo dello SDI e si rimanda con lo STESSO numero', async () => {
    const d = { ...dati(id1), fattura_elettronica: res1.patch.fattura_elettronica };
    sdi = 'ACCEPTED'; statoFattura = 'DONE'; const ok1 = await A.esegui({ dati: d, config: CONFIG, slug: 'provvigioni', id: id1 }); ok(ok1.risposta.consegnata === true && /consegnata/.test(ok1.patch.fattura_esito), ok1.patch.fattura_esito);
    sdi = 'REJECTED'; statoFattura = 'ERROR'; const ko = await A.esegui({ dati: d, config: CONFIG, slug: 'provvigioni', id: id1 }); ok(/scartata/.test(ko.patch.fattura_esito) && /00311/.test(ko.patch.fattura_esito), ko.patch.fattura_esito);
    const rimandata = await A.esegui({ dati: { ...d, fattura_elettronica: ko.patch.fattura_elettronica }, config: CONFIG, slug: 'provvigioni', id: id1 });
    ok(rimandata.patch.fattura_elettronica.numero === '1/' + anno, 'numero cambiato: ' + rimandata.patch.fattura_elettronica.numero);
    ok(db.prepare('SELECT ultimo FROM fatture_numerazione WHERE anno = ?').get(anno).ultimo === 2, 'il contatore non doveva avanzare');
  });
  console.log(`\n${passati} passati, ${falliti} falliti`); process.exit(falliti ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
