'use strict';
// La mappa di OpenStreetMap nel report di valutazione (lib/mappa-pdf.js, sezione nel PDF) e la pillola dell'intestazione che si adatta al testo. Nessuna rete: fetch finto.
// Eseguire con: node src/mappa-pdf.test.js
const path = require('path'); const os = require('os'); const fs = require('fs'); const crypto = require('crypto');
process.env.DB_PATH = path.join(os.tmpdir(), 'mpdf-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.JWT_SECRET = 'mpdf_secret_' + crypto.randomBytes(8).toString('hex');
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mpdf-uploads-'));
let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); console.log('  ✓ ' + name); passed++; } catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; } }
const eq = (a, e, m) => { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${m || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m || 'atteso true'); };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

async function main() {
  const db = require('./db'); const mp = require('./lib/mappa-pdf'); const PDFDocument = require('pdfkit'); const ip = require('./lib/identita-pdf');
  require('./lib/servizi-vicini'); // crea la tabella della cache dei luoghi
  const { creaPdfReport } = require('./lib/report-valutazione-pdf'); const { spawnSync } = require('child_process');
  const testoDi = (buf) => { const f = path.join(os.tmpdir(), 'mpdf-' + crypto.randomBytes(4).toString('hex') + '.pdf'); fs.writeFileSync(f, buf); const o = spawnSync('pdftotext', ['-layout', f, '-'], { encoding: 'utf8' }); try { fs.unlinkSync(f); } catch (e) {} return o.status === 0 ? o.stdout : null; };
  const urls = []; let modo = 'ok';
  mp._fetch = async (url, opts) => { urls.push(url); ok(/Platform/.test(opts.headers['User-Agent']), 'serve uno User-Agent che dice cos\'è'); if (modo === 'errore') return { ok: false, status: 503 }; return { ok: true, arrayBuffer: async () => PNG }; };

  await test('coordinate → tessera: valori noti (Milano) e scala in metri per punto', () => {
    const t = mp.inTessera(45.4642, 9.19, 14); ok(Math.abs(t.x - 8610.2) < 0.1 && Math.abs(t.y - 5863.7) < 0.5, 'x ' + t.x + ' y ' + t.y);
    const m = mp.metriPerPunto(45.4642); ok(m > 6.5 && m < 7.5, 'a 45° circa 7 m per punto: ' + m);
    const eq0 = mp.inTessera(0, 0, 2); eq([eq0.x, eq0.y], [2, 2], 'equatore e meridiano di Greenwich a metà griglia');
  });
  await test('le tessere che coprono il riquadro: poche (al massimo 16), il punto sta dentro; troppo grande → nessuna mappa', () => {
    const t = mp.tessereDi(45.4642, 9.19, 507, 290); ok(t && t.elenco.length >= 6 && t.elenco.length <= 16, 'tessere: ' + (t && t.elenco.length));
    ok(t.elenco.some((e) => e.xGriglia === Math.floor(t.centro.x) && e.y === Math.floor(t.centro.y)), 'la tessera del punto c\'è');
    eq(mp.tessereDi(45.4642, 9.19, 5000, 5000), null);
  });
  await test('preparaMappa: scarica una volta, poi dalla cache; coordinate non valide → null; una tessera che manca → nessuna mappa', async () => {
    const m = await mp.preparaMappa(45.4642, 9.19); ok(m && m.tessere.length >= 6 && m.tessere.every((t) => t.img.length > 50), 'tessere'); const n = urls.length;
    ok(urls.every((u) => /^https:\/\/tile\.openstreetmap\.org\/14\/\d+\/\d+\.png$/.test(u)), 'solo tessere di OpenStreetMap, nessun dato dell\'immobile nell\'indirizzo');
    await mp.preparaMappa(45.4642, 9.19); eq(urls.length, n, 'la seconda volta è tutto in cache');
    eq(await mp.preparaMappa('x', 9), null); eq(await mp.preparaMappa(95, 9), null);
    modo = 'errore'; eq(await mp.preparaMappa(41.9, 12.5), null, 'servizio giù'); modo = 'ok';
  });
  await test('luoghi numerati: solo le categorie con un più vicino, nell\'ordine, con la posizione se c\'è', () => {
    const n = mp.numera([{ chiave: 'spesa', label: 'Spesa', piu_vicino: { nome: 'A', metri: 100, minuti: 2, lat: 45.1, lon: 9.1 }, quanti: 3 }, { chiave: 'verde', label: 'Verde', piu_vicino: null, quanti: 0 }, { chiave: 'scuola', label: 'Scuole', piu_vicino: { nome: '', metri: 300, minuti: 5 }, quanti: 1 }]);
    eq(n.map((x) => [x.n, x.chiave, !!x.pos]), [[1, 'spesa', true], [2, 'scuola', false]]);
  });

  const CATEGORIE = [
    { chiave: 'spesa', label: 'Supermercati e alimentari', quanti: 31, piu_vicino: { nome: 'Esselunga', metri: 272, minuti: 4, lat: 45.4655, lon: 9.1915 } },
    { chiave: 'farmacia', label: 'Farmacie', quanti: 35, piu_vicino: { nome: 'Farmacia Carlo Erba', metri: 146, minuti: 2, lat: 45.4650, lon: 9.1880 } },
    { chiave: 'scuola', label: 'Scuole e asili', quanti: 15, piu_vicino: { nome: 'Istituto Marangoni', metri: 497, minuti: 8, lat: 45.4600, lon: 9.1950 } },
    { chiave: 'sanita', label: 'Ospedali e medici', quanti: 9, piu_vicino: { nome: 'Santo Agostino Donna', metri: 268, minuti: 4, lat: 45.4670, lon: 9.1870 } },
    { chiave: 'trasporti', label: 'Fermate e stazioni', quanti: 253, piu_vicino: { nome: 'Duomo', metri: 40, minuti: 1, lat: 45.4645, lon: 9.1905 } },
    { chiave: 'verde', label: 'Parchi e giardini', quanti: 21, piu_vicino: { nome: '', metri: 375, minuti: 6, lat: 45.4610, lon: 9.1840 } },
  ];
  const REPORT = { dettaglio: { citta: 'Milano', formatted: 'Piazza del Duomo 1, Milano', coordinate: { lat: 45.4642, lng: 9.19 }, quotazione: { min: 2000, med: 2500, max: 3000 }, demografico: {} }, comparabili: [], omi: null, considerazioni: 'Prova.' };
  const REC = { id: 1, data: { titolo: 'Bilocale Duomo', superficie_mq: 60, comune: 'Milano' } };
  const AZ = { nome: 'Agenzia Prova', colore: '#1f4e79' };
  const immagini = (buf) => (buf.toString('latin1').match(/\/Subtype \/Image/g) || []).length;

  await test('report con mappa e luoghi in cache: sezione, tessere incorporate, legenda numerata, fonte', async () => {
    db.prepare('INSERT INTO servizi_cache (chiave, json, ts) VALUES (?, ?, ?)').run('v2|45.464|9.190', JSON.stringify(CATEGORIE), Date.now());
    const pdf = await creaPdfReport({ record: REC, report: REPORT, azienda: AZ, logo: null });
    ok(immagini(pdf) >= 6, 'tessere incorporate: ' + immagini(pdf));
    const t = (testoDi(pdf) || '').replace(/\s+/g, ' ') || null; // il testo a capo nel PDF si confronta come una riga sola
    if (t) { for (const s of ['Dove si trova e cosa c\'è intorno', 'Esselunga', '272 m · ~4 min · 31 in zona', 'Farmacia Carlo Erba', 'Duomo', 'OpenStreetMap contributors', 'stimati dalla distanza in linea d\'aria']) ok(t.includes(s), 'manca nel PDF: ' + s); }
    else console.log('    (pdftotext non disponibile: salto il contenuto)');
  });
  await test('senza luoghi in cache: la mappa c\'è e il report dice che si stanno cercando; il report non aspetta il servizio', async () => {
    db.prepare('DELETE FROM servizi_cache').run();
    const R2 = { ...REPORT, dettaglio: { ...REPORT.dettaglio, coordinate: { lat: 41.9028, lng: 12.4964 } } };
    const t0 = Date.now(); const pdf = await creaPdfReport({ record: REC, report: R2, azienda: AZ, logo: null }); ok(Date.now() - t0 < 5000, 'non deve aspettare Overpass');
    ok(immagini(pdf) >= 6, 'mappa presente'); const t = testoDi(pdf); if (t) ok(/si stanno cercando/.test(t), 'avviso sui luoghi in corso');
  });
  await test('tessere non raggiungibili: il riquadro lo dice, la legenda dei luoghi resta, il PDF si fa lo stesso', async () => {
    db.prepare('INSERT OR REPLACE INTO servizi_cache (chiave, json, ts) VALUES (?, ?, ?)').run('v2|40.000|10.000', JSON.stringify(CATEGORIE), Date.now());
    const R3 = { ...REPORT, dettaglio: { ...REPORT.dettaglio, coordinate: { lat: 40.0, lng: 10.0 } } };
    modo = 'errore'; const pdf = await creaPdfReport({ record: REC, report: R3, azienda: AZ, logo: null }); modo = 'ok';
    eq(immagini(pdf), 0); const t = testoDi(pdf); if (t) { ok(/Mappa non disponibile/.test(t), 'dice che la mappa non c\'è'); ok(t.includes('Esselunga'), 'la legenda resta'); }
  });
  await test('report senza coordinate: nessuna sezione mappa e nessuna richiesta di rete', async () => {
    const n = urls.length; const R4 = { ...REPORT, dettaglio: { ...REPORT.dettaglio, coordinate: undefined } };
    const pdf = await creaPdfReport({ record: REC, report: R4, azienda: AZ, logo: null }); eq(urls.length, n); const t = testoDi(pdf); if (t) ok(!/Dove si trova/.test(t));
  });
  await test('intestazione: la pillola si allarga al testo («REPORT DI VALUTAZIONE» non va più a capo) e il nome dell\'azienda non finisce sotto', () => {
    const doc = new PDFDocument({ size: 'A4' });
    const lp = ip.larghezzaPillola(doc, 'Report di valutazione'); doc.font('Helvetica').fontSize(9);
    ok(lp >= doc.widthOfString('REPORT DI VALUTAZIONE') + 21 * 0.8 + 20 && lp <= 230, 'larghezza ' + lp);
    eq(ip.larghezzaPillola(doc, 'Doc'), 118, 'una scritta corta resta alla misura di prima');
    eq(ip.larghezzaPillola(doc, 'UNA SCRITTA LUNGHISSIMA CHE NON ENTRA MAI IN UNA PILLOLA'), 230, 'con un tetto');
  });

  console.log(`\n${'='.repeat(60)}\n${passed} passati, ${failed} falliti su ${passed + failed} test.`);
  try { fs.unlinkSync(process.env.DB_PATH); } catch (e) {}
  process.exit(failed > 0 ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
