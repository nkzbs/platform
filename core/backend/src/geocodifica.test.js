'use strict';
// Geocodifica (lib/geocodifica.js): cache, una richiesta alla volta, errori non messi in cache, indirizzo non trovato ricordato per un giorno. Nessuna rete: fetch finto.
const path = require('path'); const os = require('os'); const fs = require('fs'); const crypto = require('crypto');
process.env.DB_PATH = path.join(os.tmpdir(), 'geo-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.JWT_SECRET = 'geo_secret_' + crypto.randomBytes(8).toString('hex');
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-uploads-'));
let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); console.log('  ✓ ' + name); passed++; } catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; } }
const eq = (a, e, m) => { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${m || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m || 'atteso true'); };
const geo = require('./lib/geocodifica'); geo._pausa = 5;

async function main() {
  const urls = []; let modo = 'ok', inCorso = 0, maxContemporanee = 0;
  geo._fetch = async (url, opts) => {
    urls.push(url); inCorso++; maxContemporanee = Math.max(maxContemporanee, inCorso); await new Promise((r) => setTimeout(r, 15)); inCorso--;
    ok(/Platform/.test(opts.headers['User-Agent']), 'serve uno User-Agent che dice cos\'è');
    if (modo === 'errore') return { ok: false, status: 503, json: async () => ({}) };
    if (modo === 'vuoto') return { ok: true, json: async () => [] };
    return { ok: true, json: async () => [{ lat: '45.4642', lon: '9.1900', display_name: 'Milano, Lombardia, Italia' }] };
  };
  await test('trova l\'indirizzo, lo tiene in cache (stesso indirizzo scritto in modo diverso = una sola richiesta) e manda il paese', async () => {
    const a = await geo.cerca('Via Roma 3,  Milano', { paese: 'it' }); eq([a.lat, a.lon], [45.4642, 9.19]); ok(/countrycodes=it/.test(urls[0]), 'paese nella richiesta');
    const b = await geo.cerca('via roma 3, milano', { paese: 'it' }); eq(b.nome, 'Milano, Lombardia, Italia'); eq(urls.length, 1, 'la seconda è dalla cache');
  });
  await test('indirizzo troppo corto: nessuna richiesta', async () => { eq(await geo.cerca('ab'), null); eq(await geo.cerca(''), null); eq(urls.length, 1); });
  await test('servizio che non risponde: null, e NON si mette in cache (si riprova dopo)', async () => {
    modo = 'errore'; eq(await geo.cerca('Via Verdi 9 Bergamo'), null); modo = 'ok'; const r = await geo.cerca('Via Verdi 9 Bergamo'); ok(r && r.lat === 45.4642, 'al secondo tentativo funziona'); eq(urls.length, 3);
  });
  await test('indirizzo non trovato: null e ricordato per un giorno; dopo un giorno si richiede', async () => {
    modo = 'vuoto'; const n = urls.length; eq(await geo.cerca('Via Inesistente 1 Nowhere'), null); eq(await geo.cerca('Via Inesistente 1 Nowhere'), null); eq(urls.length, n + 1, 'una sola richiesta');
    modo = 'ok'; const r = await geo.cerca('Via Inesistente 1 Nowhere', { adesso: Date.now() + 2 * 86400000 }); ok(r, 'dopo due giorni riprova'); eq(urls.length, n + 2);
  });
  await test('più ricerche insieme partono una alla volta', async () => {
    modo = 'ok'; await Promise.all(['Via A 1 Roma', 'Via B 2 Roma', 'Via C 3 Roma', 'Via D 4 Roma'].map((q) => geo.cerca(q))); eq(maxContemporanee, 1, 'mai due richieste insieme');
  });
  console.log(`\n${'='.repeat(60)}\n${passed} passati, ${failed} falliti su ${passed + failed} test.`);
  try { fs.unlinkSync(process.env.DB_PATH); } catch (e) {}
  process.exit(failed > 0 ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
