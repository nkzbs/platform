'use strict';
// Il carattere dell'app scelto in Aspetto (lib/caratteri.js, /api/fonts, font_app in impostazioni e in tenant-info, PDF). Server vero, DB temporaneo. Eseguire con: node src/caratteri.test.js (porta 34838).
const path = require('path'); const os = require('os'); const fs = require('fs'); const crypto = require('crypto');
const TEST_PORT = 34838, BASE = 'http://localhost:' + TEST_PORT;
process.env.DB_PATH = path.join(os.tmpdir(), 'car-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'car_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'car_internal_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'car_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'car-uploads-'));
let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); console.log('  ✓ ' + name); passed++; } catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; } }
const eq = (a, e, m) => { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${m || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m || 'atteso true'); };

async function main() {
  require('./index.js');
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const car = require('./lib/caratteri');
  const login = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: process.env.INITIAL_ADMIN_PASSWORD }) })).json();
  const H = { Authorization: 'Bearer ' + login.token, 'Content-Type': 'application/json' };

  await test('i quattro file della famiglia ci sono, sono font OpenType veri, e la licenza è accanto', () => {
    const f = car.FAMIGLIE.zucca_banner;
    for (const nome of Object.values(f.file)) { const p = car.percorso('zucca-banner', nome); ok(p && fs.existsSync(p), 'manca ' + nome); eq(fs.readFileSync(p).subarray(0, 4).toString('latin1'), 'OTTO', nome + ': non è un OpenType CFF'); }
    ok(fs.existsSync(path.join(__dirname, '..', 'assets', 'fonts', 'zucca-banner', 'OFL_Licenza_GFS_Didot.txt')), 'licenza OFL accanto ai file');
  });
  await test('/api/fonts: pubblico, serve solo i nomi dell\'elenco, nessun percorso scritto da fuori', async () => {
    const r = await fetch(BASE + '/api/fonts/zucca-banner/Zucca_Banner_Regular.otf'); eq(r.status, 200); ok(/font|octet/i.test(r.headers.get('content-type') || ''), 'tipo: ' + r.headers.get('content-type')); ok((await r.arrayBuffer()).byteLength > 100000, 'file intero');
    eq((await fetch(BASE + '/api/fonts/zucca-banner/OFL_Licenza_GFS_Didot.txt')).status, 404, 'la licenza non è un font da servire');
    eq((await fetch(BASE + '/api/fonts/zucca-banner/..%2F..%2Fsrc%2Findex.js')).status, 404); eq((await fetch(BASE + '/api/fonts/altro/Zucca_Banner_Regular.otf')).status, 404);
  });
  await test('Aspetto: si sceglie, si legge in tenant-info (anche senza accesso), un carattere sconosciuto è rifiutato, si torna al predefinito', async () => {
    const base = (await (await fetch(BASE + '/api/settings/azienda', { headers: H })).json());
    eq(base.font_app, null, 'di partenza nessun carattere');
    const put = (font_app) => fetch(BASE + '/api/settings/azienda', { method: 'PUT', headers: H, body: JSON.stringify({ ...base, font_app }) });
    eq((await put('zucca_banner')).status, 200); eq((await (await fetch(BASE + '/api/tenant-info')).json()).font_app, 'zucca_banner');
    eq((await put('comic_sans')).status, 400); eq((await (await fetch(BASE + '/api/tenant-info')).json()).font_app, 'zucca_banner', 'invariato dopo il rifiuto');
    eq((await put(null)).status, 200); eq((await (await fetch(BASE + '/api/tenant-info')).json()).font_app, null);
  });
  await test('salvare altre impostazioni senza font_app non azzera il carattere scelto', async () => {
    const base = (await (await fetch(BASE + '/api/settings/azienda', { headers: H })).json());
    await fetch(BASE + '/api/settings/azienda', { method: 'PUT', headers: H, body: JSON.stringify({ ...base, font_app: 'zucca_banner' }) });
    const { font_app, ...senza } = base; await fetch(BASE + '/api/settings/azienda', { method: 'PUT', headers: H, body: JSON.stringify({ ...senza, ragione_sociale: 'Agenzia Prova' }) });
    eq((await (await fetch(BASE + '/api/settings/azienda', { headers: H })).json()).font_app, 'zucca_banner');
  });
  await test('PDF: con il carattere scelto i titoli lo incorporano; senza, restano Times', async () => {
    const PDFDocument = require('pdfkit'); const ip = require('./lib/identita-pdf');
    const genera = async (carattere) => {
      const doc = new PDFDocument({ size: 'A4', bufferPages: true }); const pezzi = []; doc.on('data', (c) => pezzi.push(c));
      const fine = new Promise((r) => doc.on('end', r));
      const azienda = { nome: 'Agenzia Prova', colore: '#1f4e79', carattere };
      const colore = ip.intestazione(doc, { azienda, etichetta: 'PROVA', data: '8/11/2026' }); doc.y = 120; ip.titoloSezione(doc, 'Titolo di sezione', colore); ip.pieDiPagina(doc, { azienda, colore });
      doc.end(); await fine; return Buffer.concat(pezzi);
    };
    const con = await genera('zucca_banner'), senza = await genera(null);
    const t = con.toString('latin1'); ok(/\+ZuccaBanner-Bold/.test(t) && /\+ZuccaBanner-Italic/.test(t), 'grassetto (titoli) e corsivo (piè di pagina) incorporati nel PDF');
    ok(/Times-Bold/.test(senza.toString('latin1')) && !/Zucc/i.test(senza.toString('latin1')), 'senza carattere resta Times');
  });

  console.log(`\n${'='.repeat(60)}\n${passed} passati, ${failed} falliti su ${passed + failed} test.`);
  try { fs.unlinkSync(process.env.DB_PATH); } catch (e) {}
  process.exit(failed > 0 ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
