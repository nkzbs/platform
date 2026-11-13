'use strict';
process.env.PLATFORM_PLUGINS = '*'; // il plugin immobiliare è attivo in questa prova
// Adattatore «firma_elettronica» (eSignature di OpenAPI.it): manda un PDF allegato ai firmatari, ricontrolla, e a firma completata salva il documento firmato tra gli allegati.
// OpenAPI.it è finto (nessuna rete). Eseguire con: node src/firma-elettronica.test.js
const path = require('path'); const os = require('os'); const fs = require('fs'); const crypto = require('crypto');
process.env.DB_PATH = path.join(os.tmpdir(), 'firma-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.JWT_SECRET = 'jwt_' + crypto.randomBytes(8).toString('hex');
process.env.ENCRYPTION_KEY = 'firma_test_encryption_key_0000';
process.env.INTERNAL_API_SECRET = 'int_' + crypto.randomBytes(8).toString('hex');
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'firma-up-'));
let passati = 0, falliti = 0;
async function test(nome, fn) { try { await fn(); console.log('  ✓ ' + nome); passati++; } catch (e) { console.error('  ✗ ' + nome + '\n    ' + e.message); falliti++; } }
const ok = (c, m) => { if (!c) throw new Error(m || 'atteso true'); };
const db = require('./db'); const sigillo = require('./secrets-at-rest');
db.prepare('DELETE FROM modules').run();
const F = (key, extra = {}) => ({ id: 'f_' + key, block_type: 'field', key, label: key, type: 'text', ...extra });
db.prepare('INSERT INTO modules (name, slug, installed, schema_json) VALUES (?, ?, 1, ?)').run('Persone', 'persone', JSON.stringify({ version: 3, steps: [F('nome'), F('email', { type: 'email' }), F('telefono')] }));
db.prepare('INSERT INTO modules (name, slug, installed, schema_json) VALUES (?, ?, 1, ?)').run('Pratiche', 'pratiche', JSON.stringify({ version: 3, steps: [F('titolo'), { id: 'r1', block_type: 'relation', key: 'venditore', label: 'Venditore', type: 'many_to_one', target_module: 'persone', display_field: 'nome' }, { id: 'r2', block_type: 'relation', key: 'acquirente', label: 'Acquirente', type: 'many_to_one', target_module: 'persone', display_field: 'nome' }] }));
db.prepare("INSERT INTO connections (integration_id, connected, credentials) VALUES ('openapi_it', 1, ?)").run(sigillo.seal({ email: 'a@b.it', api_key: 'CHIAVE', ambiente: 'sandbox' }));
const persona = (d) => db.prepare("INSERT INTO records (module_slug, user_id, data) VALUES ('persone', 1, ?)").run(JSON.stringify(d)).lastInsertRowid;
const mario = persona({ nome: 'Mario Rossi', email: 'mario@example.com', telefono: '333 111 2222' }), giulia = persona({ nome: 'Giulia Bianchi', email: 'giulia@example.com' });
const pratica = (extra = {}) => db.prepare("INSERT INTO records (module_slug, user_id, data) VALUES ('pratiche', 1, ?)").run(JSON.stringify({ titolo: 'Preliminare Via Verdi', venditore: mario, acquirente: giulia, ...extra })).lastInsertRowid;
const CONFIG = { key: 'firma', label: 'Firma elettronica', adapter: 'firma_elettronica', allegato_da_firmare: 'Bozza preliminare', allegato_firmato: 'Contratto preliminare', firmatari: [{ relazione: 'venditore', ruolo: 'Venditore' }, { relazione: 'acquirente', ruolo: 'Acquirente' }], risultato_in: 'firma', esito: { esito: 'firma_esito', data: 'firma_data' } };

const chiamate = []; let stato = 'WAIT_SIGN'; const veroFetch = global.fetch;
global.fetch = async (url, opts = {}) => {
  const u = String(url); if (!/openapi\.(com|it)/.test(u)) return veroFetch(url, opts);
  chiamate.push({ metodo: opts.method || 'GET', url: u, corpo: opts.body });
  const r = (s, corpo) => ({ ok: s < 300, status: s, headers: { get: () => 'application/json' }, json: async () => corpo, arrayBuffer: async () => Buffer.from('%PDF-1.4 firmato '.padEnd(200, 'x')) });
  if (u.endsWith('/tokens')) return r(200, { data: { token: 'tok' } });
  if (u.endsWith('/EU-SES')) return r(200, { data: { id: 'sig-1', state: 'WAIT_SIGN' } });
  if (u.endsWith('/detail')) return r(200, { data: { state: stato, signers: [{ email: 'mario@example.com', state: stato === 'DONE' ? 'DONE' : 'WAIT_OTP' }, { email: 'giulia@example.com', state: stato === 'DONE' ? 'DONE' : 'DONE' }] } });
  if (u.endsWith('/signedDocument')) return { ok: true, status: 200, headers: { get: () => 'application/pdf' }, arrayBuffer: async () => Buffer.from('%PDF-1.4 firmato '.padEnd(200, 'x')) };
  return r(404, { message: 'non trovato' });
};
(async () => {
  const al = require('./lib/azioni-esterne/allegati'); const A = require('./lib/azioni-esterne').adattatore('firma_elettronica');
  const dati = (id) => JSON.parse(db.prepare('SELECT data FROM records WHERE id = ?').get(id).data);
  let id;
  await test('senza il documento allegato dice cosa manca, senza chiamare nessuno', async () => {
    id = pratica(); let e; try { await A.esegui({ dati: dati(id), config: CONFIG, id, slug: 'pratiche' }); } catch (x) { e = x; }
    ok(e && /Bozza preliminare/.test(e.message) && chiamate.length === 0, e && e.message);
  });
  await test('un allegato che non è un PDF viene rifiutato', async () => {
    await al.salva({ slug: 'pratiche', id, buffer: Buffer.from('testo'), nome: 'bozza.txt', mime: 'text/plain', tipo: 'Bozza preliminare' });
    let e; try { await A.esegui({ dati: dati(id), config: CONFIG, id, slug: 'pratiche' }); } catch (x) { e = x; }
    ok(e && /PDF/.test(e.message), e && e.message);
  });
  await test('senza email di un firmatario si ferma prima di chiamare il servizio', async () => {
    const id2 = pratica({ acquirente: persona({ nome: 'Luca Neri' }) }); await al.salva({ slug: 'pratiche', id: id2, buffer: Buffer.from('%PDF-1.4 x'), nome: 'bozza.pdf', mime: 'application/pdf', tipo: 'Bozza preliminare' });
    let e; try { await A.esegui({ dati: dati(id2), config: CONFIG, id: id2, slug: 'pratiche' }); } catch (x) { e = x; }
    ok(e && /Acquirente.*Luca Neri.*email/.test(e.message) && !chiamate.some((c) => /EU-SES/.test(c.url)), e && e.message);
  });
  let id3;
  await test('la prima pressione manda il PDF in base64 ai due firmatari, con nome, cognome e codice via email', async () => {
    id3 = pratica(); await al.salva({ slug: 'pratiche', id: id3, buffer: Buffer.from('%PDF-1.4 contratto'), nome: 'bozza.pdf', mime: 'application/pdf', tipo: 'Bozza preliminare' });
    const out = await A.esegui({ dati: dati(id3), config: CONFIG, id: id3, slug: 'pratiche' });
    const post = chiamate.find((c) => /EU-SES/.test(c.url)); const b = JSON.parse(post.corpo);
    ok(/test\.esignature\.openapi\.com/.test(post.url) && post.metodo === 'POST', post.url);
    ok(b.signers.length === 2 && b.signers[0].name === 'Mario' && b.signers[0].surname === 'Rossi' && b.signers[0].email === 'mario@example.com' && JSON.stringify(b.signers[0].authentication) === '["email"]', JSON.stringify(b.signers[0]));
    ok(b.inputDocuments[0].sourceType === 'base64' && Buffer.from(b.inputDocuments[0].payload, 'base64').toString() === '%PDF-1.4 contratto', 'documento');
    ok(out.patch.firma.id === 'sig-1' && /Mario Rossi e Giulia Bianchi.*email/.test(out.patch.firma_esito), JSON.stringify(out.patch));
    ok(A.servizio === 'esignature_ses', 'servizio per la spesa');
  });
  await test('finché non hanno firmato tutti, il clic ricontrolla senza spesa e dice chi manca', async () => {
    const d = { ...dati(id3), firma: { id: 'sig-1', stato: 'WAIT_SIGN', data: '2026-11-09' } };
    ok(A.senzaCosto({ dati: d, config: CONFIG }) === true, 'deve essere gratis');
    const out = await A.esegui({ dati: d, config: CONFIG, id: id3, slug: 'pratiche' });
    ok(out.risposta.firmato === false && /mario@example\.com/.test(out.patch.firma_esito) && !/giulia@/.test(out.patch.firma_esito), out.patch.firma_esito);
  });
  await test('a firma completata scarica il firmato e lo allega con il tipo del contratto', async () => {
    stato = 'DONE';
    const d = { ...dati(id3), firma: { id: 'sig-1', stato: 'WAIT_SIGN', data: '2026-11-09' } };
    const out = await A.esegui({ dati: d, config: CONFIG, id: id3, slug: 'pratiche' });
    ok(out.risposta.firmato === true && out.patch.firma.stato === 'DONE', JSON.stringify(out.patch));
    const f = await al.leggi('pratiche', id3, 'Contratto preliminare'); ok(f && f.buffer.toString().startsWith('%PDF-1.4 firmato'), 'allegato firmato non salvato');
    ok(A.senzaCosto({ dati: { ...d, ...out.patch }, config: CONFIG }) === false, 'una nuova richiesta costerebbe di nuovo');
  });
  await test('senza il servizio abilitato la funzione resta «da attivare» e non costa nulla', async () => {
    // un ambiente diverso (produzione) non ha token né stato in memoria: si vede il rifiuto vero del servizio
    db.prepare("UPDATE connections SET credentials = ? WHERE integration_id = 'openapi_it'").run(sigillo.seal({ email: 'a@b.it', api_key: 'CHIAVE', ambiente: 'produzione' }));
    const f = global.fetch; global.fetch = async (url, opts) => /\/tokens$/.test(String(url)) ? { ok: false, status: 403, json: async () => ({ message: 'Scope non consentito' }) } : f(url, opts);
    try { const prima = chiamate.filter((c) => /EU-SES/.test(c.url)).length; const d = await A.disponibile(); ok(!d.ok && /eSignature/.test(d.motivo), JSON.stringify(d)); ok(chiamate.filter((c) => /EU-SES/.test(c.url)).length === prima, 'nessuna richiesta di firma'); } finally { global.fetch = f; }
  });
  console.log(`\n${passati} passati, ${falliti} falliti`); process.exit(falliti ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
