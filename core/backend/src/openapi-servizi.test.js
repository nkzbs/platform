'use strict';
process.env.PLATFORM_PLUGINS = 'immobiliare'; // il plugin immobiliare è attivo in questa prova
// Il controllo dei servizi di OpenAPI.it (lib/openapi-it.js verificaServizi, rotta POST /api/connections/openapi_it/servizi): una lettura gratuita per servizio, mai un
// controllo a pagamento, e la chiave non esce mai nella risposta. Server vero, DB temporaneo; OpenAPI.it è sostituito da un finto (nessuna chiamata di rete).
// Eseguire con: node src/openapi-servizi.test.js (porta 34869 libera).
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const TEST_PORT = 34869, BASE = 'http://localhost:' + TEST_PORT;
process.env.DB_PATH = path.join(os.tmpdir(), 'oa-servizi-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'oa_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'oa_internal_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'oa_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-uploads-'));

let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); console.log('  ✓ ' + name); passed++; } catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; } }
const eq = (a, e, m) => { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${m || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m || 'atteso true'); };

async function main() {
  require('./index.js');
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const db = require('./db'); const sigillo = require('./secrets-at-rest'); const oa = require('./lib/openapi-it');
  const login = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: process.env.INITIAL_ADMIN_PASSWORD }) })).json();
  const H = { Authorization: 'Bearer ' + login.token, 'Content-Type': 'application/json' };
  const post = (headers = H) => fetch(BASE + '/api/connections/openapi_it/servizi', { method: 'POST', headers, body: '{}' });
  const CHIAVE = 'CHIAVE_SEGRETA_DI_PROVA_123';

  // OpenAPI.it finto: i token si danno per tutti tranne Visure; le letture dipendono dal servizio
  const chiamate = [];
  const veroFetch = global.fetch; let rifiutaToken = [];
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (!/openapi\.(com|it)/.test(u)) return veroFetch(url, opts);
    chiamate.push((opts && opts.method || 'GET') + ' ' + u);
    const r = (stato, corpo) => ({ ok: stato >= 200 && stato < 300, status: stato, json: async () => corpo });
    if (u.endsWith('/tokens')) {
      const scopes = JSON.parse(opts.body).scopes;
      if (rifiutaToken.some((x) => scopes[0].includes(x))) return r(403, { message: 'Scope non consentito per questo account' });
      return r(200, { data: { token: 'tok-' + scopes[0] } });
    }
    if (u.includes('catasto')) return r(200, { data: [] });
    if (u.includes('risk') && u.includes('patrimoniale')) return r(403, { message: 'Servizio non attivo' });
    if (u.includes('risk')) return r(404, { message: 'non trovato' });
    return r(500, null);
  };

  await test('senza OpenAPI.it collegato: 503 con la spiegazione; senza accesso 401', async () => {
    const r = await post(); eq(r.status, 503); ok(/non collegato/.test((await r.json()).error)); eq((await post({})).status, 401);
  });
  await test('con la chiave collegata (ambiente di prova) ogni servizio ha il suo esito, con host di prova e solo letture', async () => {
    db.prepare("INSERT INTO connections (integration_id, connected, credentials) VALUES ('openapi_it', 1, ?)").run(sigillo.seal({ email: 'a@b.it', api_key: CHIAVE, ambiente: 'sandbox' }));
    rifiutaToken = ['invoice.openapi'];
    const r = await post(); eq(r.status, 200); const j = await r.json(); eq(j.ambiente, 'prova');
    const per = Object.fromEntries(j.servizi.map((s) => [s.id, s.stato]));
    eq(per, { real_estate: 'token_ok', catasto: 'attivo', risk_patrimoniale: 'non_abilitato', risk_report: 'incerto', esignature: 'incerto', sdi_fatture: 'non_abilitato', sms: 'incerto' });
    ok(/Scope non consentito/.test(j.servizi.find((s) => s.id === 'sdi_fatture').dettaglio), 'il motivo di OpenAPI.it arriva all\'utente');
    ok(chiamate.every((c) => c.startsWith('POST ') ? /\/tokens$/.test(c) : c.startsWith('GET ')), 'solo token e letture: ' + chiamate.join(' | '));
    ok(chiamate.some((c) => /GET https:\/\/test\.catasto\.openapi\.it\/territorio/.test(c)) && chiamate.some((c) => /test\.risk\.openapi\.com\/IT-patrimoniale-persona\//.test(c)) && chiamate.some((c) => /test\.oauth\.openapi\.com\/tokens/.test(c)), 'host di prova');
  });
  await test('la chiave non compare mai nella risposta; in produzione gli host non hanno il prefisso di prova', async () => {
    const testo = await (await post()).text(); ok(!testo.includes(CHIAVE) && !testo.includes('a@b.it'), 'la risposta contiene le credenziali');
    db.prepare("UPDATE connections SET credentials = ? WHERE integration_id = 'openapi_it'").run(sigillo.seal({ email: 'a@b.it', api_key: CHIAVE, ambiente: 'produzione' }));
    chiamate.length = 0; rifiutaToken = []; const j = await (await post()).json(); eq(j.ambiente, 'produzione');
    ok(chiamate.every((c) => !/https:\/\/test\./.test(c)), 'nessun host di prova in produzione: ' + chiamate.join(' | '));
  });
  await test('l\'elenco dei servizi è un dato: ogni voce ha nome, dominio e rotta; i domini sono quelli del catalogo', () => {
    for (const s of oa.SERVIZI) ok(s.id && s.nome && s.dominio && s.rotta, s.id);
    ok(!oa.SERVIZI.some((s) => s.id === 'pec_massiva' || s.id === 'visure_camerali'), 'PEC Massiva e Visure camerali non sono nell\'elenco finché nessuna funzione le richiede');
    eq(oa.SERVIZI.find((s) => s.id === 'risk_report').dominio, 'risk.openapi.com');
  });

  global.fetch = veroFetch;
  await test('i servizi si controllano tutti insieme (non uno dopo l\'altro): con 500 ms a chiamata il controllo resta sotto i quattro secondi e mezzo (uno dopo l\'altro ne servirebbero più di dieci)', async () => {
    const f = global.fetch; global.fetch = async (url, opts) => { if (/openapi\.(com|it)/.test(String(url))) await new Promise((r) => setTimeout(r, 500)); return f(url, opts); };
    try { const t0 = Date.now(); const r = await (await post()).json(); const ms = Date.now() - t0; ok(r.ok && r.servizi.length === oa.SERVIZI.length, JSON.stringify(r).slice(0, 200)); ok(ms < 4500, 'ha impiegato ' + ms + ' ms: i servizi vanno controllati in parallelo'); } finally { global.fetch = f; }
  });
  await test('un servizio usato solo da un\'azione esterna compare in Connessioni anche se non è ancora collegato', async () => {
    db.prepare('DELETE FROM connections WHERE integration_id = ?').run('openapi_it');
    const nome = async () => (await (await fetch(BASE + '/api/connections', { headers: H })).json()).map((c) => c.id);
    ok(!(await nome()).includes('openapi_it'), 'non dovrebbe comparire senza moduli che lo usano');
    db.prepare("INSERT INTO modules (name, slug, installed, schema_json) VALUES ('Prova', 'prova_ea', 1, ?)").run(JSON.stringify({ version: 3, steps: [{ id: 'a', block_type: 'external_action', key: 'x', label: 'X', adapter: 'valutazione_immobiliare', connection: 'openapi_it' }] }));
    ok((await nome()).includes('openapi_it'), 'doveva comparire: ' + (await nome()).join());
  });

  console.log(`\n${passed} passati, ${failed} falliti`);
  try { fs.unlinkSync(process.env.DB_PATH); } catch (e) {}
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
