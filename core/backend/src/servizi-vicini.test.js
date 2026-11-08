'use strict';
// Servizi vicini (lib/servizi-vicini.js): categorie, il più vicino per ognuna, tempo a piedi stimato, cache, errori non messi in cache, una richiesta alla volta. Nessuna rete: fetch finto.
const path = require('path'); const os = require('os'); const fs = require('fs'); const crypto = require('crypto');
process.env.DB_PATH = path.join(os.tmpdir(), 'srv-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.JWT_SECRET = 'srv_secret_' + crypto.randomBytes(8).toString('hex');
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'srv-uploads-'));
let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); console.log('  ✓ ' + name); passed++; } catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; } }
const eq = (a, e, m) => { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${m || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m || 'atteso true'); };
const srv = require('./lib/servizi-vicini'); srv._pausa = 5;

async function main() {
  const LAT = 45.4642, LON = 9.19; // 0.001° di latitudine ≈ 111 m
  const ELEMENTI = [
    { type: 'node', lat: LAT + 0.002, lon: LON, tags: { shop: 'supermarket', name: 'Super Lontano' } },
    { type: 'node', lat: LAT + 0.001, lon: LON, tags: { shop: 'convenience', name: 'Alimentari Vicino' } },
    { type: 'way', center: { lat: LAT, lon: LON + 0.003 }, tags: { amenity: 'school' } },
    { type: 'node', lat: LAT - 0.004, lon: LON, tags: { amenity: 'pharmacy', name: 'Farmacia Centrale' } },
    { type: 'node', lat: LAT, lon: LON + 0.0005, tags: { highway: 'bus_stop', name: 'Fermata 14' } },
    { type: 'node', lat: LAT, lon: LON, tags: { shop: 'florist' } }, // non è una categoria: si ignora
  ];
  const urls = []; let modo = 'ok', inCorso = 0, maxContemporanee = 0;
  srv._fetch = async (url, opts) => {
    urls.push(url); inCorso++; maxContemporanee = Math.max(maxContemporanee, inCorso); await new Promise((r) => setTimeout(r, 15)); inCorso--;
    ok(/Platform/.test(opts.headers['User-Agent']), 'serve uno User-Agent che dice cos\'è');
    if (modo === 'errore') return { ok: false, status: 504, json: async () => ({}) };
    return { ok: true, json: async () => ({ elements: ELEMENTI }) };
  };
  await test('il più vicino per categoria, quanti ce ne sono, minuti a piedi stimati; categorie senza risultati restano con zero', async () => {
    const r = await srv.cerca(LAT, LON); const per = Object.fromEntries(r.categorie.map((c) => [c.chiave, c]));
    eq(r.raggio, 1000); eq(r.categorie.length, 6);
    eq(per.spesa.quanti, 2); eq(per.spesa.piu_vicino.nome, 'Alimentari Vicino'); ok(Math.abs(per.spesa.piu_vicino.metri - 111) <= 2, 'distanza ≈ 111 m: ' + per.spesa.piu_vicino.metri);
    eq(per.spesa.piu_vicino.minuti, 2); // 111 m × 1,25 / 80 = 1,7 → 2
    eq(per.scuola.quanti, 1); eq(per.scuola.piu_vicino.nome, ''); eq(per.farmacia.piu_vicino.nome, 'Farmacia Centrale'); eq(per.trasporti.piu_vicino.nome, 'Fermata 14');
    eq(per.sanita.quanti, 0); eq(per.sanita.piu_vicino, null); eq(per.verde.piu_vicino, null);
  });
  await test('stessa zona (celle di ~100 m): una sola richiesta; la richiesta contiene solo le coordinate', async () => {
    const n = urls.length; await srv.cerca(LAT + 0.0001, LON); eq(urls.length, n, 'dalla cache');
    const q = decodeURIComponent(urls[0].split('?data=')[1]); ok(q.includes('around:1000,' + LAT + ',' + LON), 'coordinate nella richiesta'); ok(!/via|indirizzo/i.test(q), 'nessun indirizzo');
  });
  await test('coordinate non valide: null e nessuna richiesta', async () => {
    const n = urls.length; eq(await srv.cerca('abc', 9), null); eq(await srv.cerca(95, 9), null); eq(await srv.cerca(45, 200), null); eq(urls.length, n);
  });
  await test('servizio che non risponde: null, NON in cache; riprova e funziona', async () => {
    modo = 'errore'; eq(await srv.cerca(41.9, 12.5), null); modo = 'ok'; const r = await srv.cerca(41.9, 12.5); ok(r && r.categorie.length === 6, 'al secondo tentativo funziona');
  });
  await test('dopo 7 giorni si richiede', async () => {
    const n = urls.length; await srv.cerca(LAT, LON, { adesso: Date.now() + 8 * 86400000 }); eq(urls.length, n + 1);
  });
  await test('più ricerche insieme partono una alla volta', async () => {
    await Promise.all([[40, 10], [41, 11], [42, 12], [43, 13]].map(([a, b]) => srv.cerca(a, b))); eq(maxContemporanee, 1);
  });
  await test('stato: la prima volta avvia la ricerca e risponde «in corso», poi dalla cache; un guasto non si ripete subito', async () => {
    const n = urls.length;
    const a = srv.stato(10.1, 20.2); eq([a.valido, a.in_corso], [true, true]); const b = srv.stato(10.1, 20.2); eq(b.in_corso, true); await srv._attese(); eq(urls.length, n + 1, 'una sola richiesta per due domande');
    const c = srv.stato(10.1, 20.2); eq(c.pronto, true); eq(c.categorie.length, 6);
    modo = 'errore'; srv.stato(11.1, 21.2); await srv._attese(); const d = srv.stato(11.1, 21.2); eq([d.in_corso, d.errore], [false, true]); eq(urls.length, n + 2, 'nessuna nuova richiesta subito dopo il guasto'); modo = 'ok';
    eq(srv.stato('x', 1).valido, false);
  });
  await test('minuti a piedi: almeno 1, 80 m al minuto con percorso ≈ 1,25 volte la linea d\'aria', () => { eq(srv.minutiAPiedi(10), 1); eq(srv.minutiAPiedi(640), 10); eq(srv.minutiAPiedi(1000), 16); });
  console.log(`\n${'='.repeat(60)}\n${passed} passati, ${failed} falliti su ${passed + failed} test.`);
  try { fs.unlinkSync(process.env.DB_PATH); } catch (e) {}
  process.exit(failed > 0 ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
