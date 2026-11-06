'use strict';
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
  const { testoReport } = require('./lib/report-valutazione');

  console.log('\n--- testo del report ---');
  await test('valore stimato = media × superficie, con separatore delle migliaia e percentuali pulite', async () => {
    const { corpo } = testoReport({ record: { data: { titolo: 'Casa', comune: 'Roma', superficie_mq: 100, stima_data: '2026-11-01' } }, report: REPORT });
    assertTrue(corpo.includes('250.000 €') && corpo.includes('intervallo 200.000 € – 300.000 €'), 'valore stimato');
    assertTrue(corpo.includes('Abitazioni di proprietà: 73%'), 'percentuale');
    assertTrue(corpo.includes('50-85 Mq: 178 giorni') && corpo.includes('Nessun annuncio comparabile'), 'tempi e comparabili');
    assertTrue(!corpo.includes('ATTENZIONE'), 'nessun avviso se il comune coincide');
  });
  await test('senza superficie dice perché il valore non c\'è; comune diverso dal report → avviso', async () => {
    const { corpo } = testoReport({ record: { data: { titolo: 'Casa', comune: 'Milano' } }, report: REPORT });
    assertTrue(corpo.includes('manca la superficie'), 'manca la superficie');
    assertTrue(corpo.includes('ATTENZIONE') && corpo.includes('Milano'), 'avviso comune diverso');
  });

  require('./index.js');
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const db = require('./db');
  db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES ('Immobili', 'immobili', 'box', '#000', 1, 1, 70, ?)").run(JSON.stringify({ version: 3, steps: [{ id: 'f1', block_type: 'field', key: 'titolo', label: 'Titolo', type: 'text' }] }));
  const rec = (data) => db.prepare("INSERT INTO records (module_slug, data) VALUES ('immobili', ?)").run(JSON.stringify(data)).lastInsertRowid;
  const login = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: process.env.INITIAL_ADMIN_PASSWORD }) })).json();
  const H = { Authorization: 'Bearer ' + login.token };

  console.log('\n--- rotta ---');
  await test('scarica un PDF vero dal report salvato', async () => {
    const id = rec({ titolo: 'Casa', comune: 'Roma', superficie_mq: 100, stima_data: '2026-11-01', report_valutazione: REPORT });
    const r = await fetch(BASE + '/api/records/immobili/' + id + '/valutazione/pdf', { method: 'POST', headers: H });
    assertEq(r.status, 200);
    assertEq(r.headers.get('content-type'), 'application/pdf');
    assertEq(Buffer.from(await r.arrayBuffer()).slice(0, 5).toString(), '%PDF-');
  });
  await test('immobile mai valutato: 400 con spiegazione; inesistente: 404; senza accesso: 401', async () => {
    const id = rec({ titolo: 'Senza valutazione' });
    const r = await fetch(BASE + '/api/records/immobili/' + id + '/valutazione/pdf', { method: 'POST', headers: H });
    assertEq(r.status, 400);
    assertTrue(/valutazione/i.test((await r.json()).error));
    assertEq((await fetch(BASE + '/api/records/immobili/99999/valutazione/pdf', { method: 'POST', headers: H })).status, 404);
    assertEq((await fetch(BASE + '/api/records/immobili/' + id + '/valutazione/pdf', { method: 'POST' })).status, 401);
  });

  console.log(`\n${passed} passati, ${failed} falliti`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
