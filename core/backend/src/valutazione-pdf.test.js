'use strict';
process.env.PLATFORM_PLUGINS = 'immobiliare'; // il plugin immobiliare è attivo in questa prova
// PDF del report di valutazione: testo ricavato dal report salvato e rotta che lo scarica senza richiamare OpenAPI.it.
// Server reale, DB temporaneo. Eseguire con: node src/valutazione-pdf.test.js (porta 34837).

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const TEST_PORT = 34837;
const BASE = 'http://localhost:' + TEST_PORT;
process.env.DB_PATH = path.join(os.tmpdir(), 'valpdf-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'valpdf_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'valpdf_internal_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'valpdf_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'valpdf-uploads-'));
process.env.SUPER_ADMIN_URL = 'http://localhost:1';
process.env.TENANT_SLUG = 'valpdf';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; }
}
function assertTrue(c, msg) { if (!c) throw new Error(msg || 'atteso true'); }
function assertEq(a, e, msg) { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${msg || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); }

const REPORT = {
  dettaglio: { citta: 'Roma', formatted: 'Via X 1, Roma', quotazione: { min: 2000, med: 2500, max: 3000 }, demografico: { rischio_sismico: 'medio', stock: { prc_abitazioni_di_proprieta: '73.000' } }, tempistiche: [[{ label: '50 85 Mq', media_giorni: 178 }]] },
  comparabili: [], omi: null, fotovoltaico: { kwh_per_kwp_anno: 1277 }, zonaSismicaUfficiale: { zona: 3 }, considerazioni: 'Testo di prova.',
};

async function main() {
  const { creaPdfReport } = require('./plugins/immobiliare/report-valutazione-pdf');
  const { caricaLogo } = require('./lib/identita-pdf');
  const { spawnSync } = require('child_process');
  // Il testo si legge con pdftotext (poppler); se non c'è sul computer le prove sul contenuto si saltano.
  const testoDi = (buf) => { const f = path.join(os.tmpdir(), 'valpdf-' + crypto.randomBytes(4).toString('hex') + '.pdf'); fs.writeFileSync(f, buf); const o = spawnSync('pdftotext', ['-layout', f, '-']); fs.unlinkSync(f); return o.error ? null : String(o.stdout); };
  const png1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

  console.log('\n--- contenuto del PDF ---');
  await test('valore stimato = media × superficie, con separatore delle migliaia, e dati dell\'azienda', async () => {
    const buf = await creaPdfReport({ record: { data: { titolo: 'Casa', comune: 'Roma', superficie_mq: 100, stima_data: '2026-11-01' } }, report: REPORT, azienda: { nome: 'Agenzia Prova', piva: '123' }, logo: png1x1 });
    assertEq(buf.slice(0, 5).toString(), '%PDF-');
    const t = testoDi(buf);
    if (t == null) return console.log('    (pdftotext non disponibile: contenuto non controllato)');
    assertTrue(t.includes('250.000 €') && t.includes('200.000 € – 300.000 €'), 'valore stimato');
    assertTrue(t.includes('73%') && t.includes('50-85 mq') && t.includes('Nessun annuncio comparabile'), 'percentuale, tempi, comparabili');
    assertTrue(t.includes('Agenzia Prova') && t.includes('P.IVA 123'), 'dati azienda');
    assertTrue(!t.includes('Attenzione:'), 'nessun avviso se il comune coincide');
  });
  await test('senza superficie dice perché il valore non c\'è; comune diverso dal report → avviso; senza logo né azienda funziona', async () => {
    const t = testoDi(await creaPdfReport({ record: { data: { titolo: 'Casa', comune: 'Milano' } }, report: REPORT }));
    if (t == null) return;
    assertTrue(t.includes('manca la superficie'), 'manca la superficie');
    assertTrue(t.includes('Attenzione:') && t.includes('Milano'), 'avviso comune diverso');
  });
  await test('caricaLogo: accetta immagine incorporata, rifiuta il resto senza errori', async () => {
    assertTrue(Buffer.isBuffer(await caricaLogo('data:image/png;base64,' + png1x1.toString('base64'))));
    assertEq(await caricaLogo('data:text/html;base64,AAAA'), null);
    assertEq(await caricaLogo('http://non-sicuro.example/logo.png'), null);
    assertEq(await caricaLogo(null), null);
  });

  require('./index.js');
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const db = require('./db');
  db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES ('Immobili', 'immobili', 'box', '#000', 1, 1, 70, ?)").run(JSON.stringify({ version: 3, steps: [{ id: 'f1', block_type: 'field', key: 'titolo', label: 'Titolo', type: 'text' }, { id: 'ea1', block_type: 'external_action', key: 'valutazione', label: 'Valutazione di mercato', adapter: 'valutazione_immobiliare', risultato_in: 'report_valutazione', campi: { comune: 'comune', superficie: 'superficie_mq' } }] }));
  const rec = (data) => db.prepare("INSERT INTO records (module_slug, data) VALUES ('immobili', ?)").run(JSON.stringify(data)).lastInsertRowid;
  const login = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: process.env.INITIAL_ADMIN_PASSWORD }) })).json();
  const H = { Authorization: 'Bearer ' + login.token };

  console.log('\n--- rotta ---');
  await test('scarica un PDF vero dal report salvato', async () => {
    const id = rec({ titolo: 'Casa', comune: 'Roma', superficie_mq: 100, stima_data: '2026-11-01', report_valutazione: REPORT });
    const r = await fetch(BASE + '/api/records/immobili/' + id + '/azione/valutazione/pdf', { method: 'POST', headers: H });
    assertEq(r.status, 200);
    assertEq(r.headers.get('content-type'), 'application/pdf');
    assertEq(Buffer.from(await r.arrayBuffer()).slice(0, 5).toString(), '%PDF-');
  });
  await test('immobile mai valutato: 400 con spiegazione; inesistente: 404; senza accesso: 401', async () => {
    const id = rec({ titolo: 'Senza valutazione' });
    const r = await fetch(BASE + '/api/records/immobili/' + id + '/azione/valutazione/pdf', { method: 'POST', headers: H });
    assertEq(r.status, 400);
    assertTrue(/valutazione/i.test((await r.json()).error));
    assertEq((await fetch(BASE + '/api/records/immobili/99999/azione/valutazione/pdf', { method: 'POST', headers: H })).status, 404);
    assertEq((await fetch(BASE + '/api/records/immobili/' + id + '/azione/inesistente/pdf', { method: 'POST', headers: H })).status, 404, 'azione che il modulo non dichiara');
    assertEq((await fetch(BASE + '/api/records/immobili/' + id + '/azione/valutazione/pdf', { method: 'POST' })).status, 401);
  });

  console.log('\n--- logo e dati azienda ---');
  await test('il logo si salva solo se è un\'immagine incorporata piccola o un indirizzo https', async () => {
    const put = (logo_url) => fetch(BASE + '/api/settings/azienda', { method: 'PUT', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ ragione_sociale: 'Agenzia Prova', logo_url }) });
    assertEq((await put('data:image/png;base64,' + png1x1.toString('base64'))).status, 200);
    assertEq((await put('https://esempio.it/logo.png')).status, 200);
    assertEq((await put('javascript:alert(1)')).status, 400);
    assertEq((await put('data:image/svg+xml;base64,AAAA')).status, 400);
    assertEq((await put('data:image/png;base64,' + 'A'.repeat(1000000))).status, 400);
  });
  await test('il PDF scaricato dalla rotta usa i dati azienda salvati', async () => {
    await fetch(BASE + '/api/settings/azienda', { method: 'PUT', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ ragione_sociale: 'Agenzia Prova', piva: '999', logo_url: 'data:image/png;base64,' + png1x1.toString('base64'), accent_color: '#16355B' }) });
    const id = rec({ titolo: 'Casa', comune: 'Roma', superficie_mq: 100, report_valutazione: REPORT });
    const r = await fetch(BASE + '/api/records/immobili/' + id + '/azione/valutazione/pdf', { method: 'POST', headers: H });
    assertEq(r.status, 200);
    const t = testoDi(Buffer.from(await r.arrayBuffer()));
    if (t != null) assertTrue(t.includes('Agenzia Prova') && t.includes('P.IVA 999'), 'intestazione');
  });

  console.log(`\n${passed} passati, ${failed} falliti`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
