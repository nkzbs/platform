'use strict';
// Sources scriptabili end-to-end: ricerca, importazione, validazione in pubblicazione,
// test live dal Builder (routes/records.js + routes/builder.js + source-engine.js).
// Server reale, DB temporaneo, più un piccolo server HTTP locale che fa da "API esterna"
// — nessuna dipendenza da internet. Eseguire con: node src/sources.test.js (porta 34818).

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');

const TEST_PORT = 34818;
const BASE = 'http://localhost:' + TEST_PORT;
const dbPath = path.join(os.tmpdir(), 'sources-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.DB_PATH = dbPath;
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'sources_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'sources_internal_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'sources_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sources-uploads-'));
process.env.SUPER_ADMIN_URL = 'http://localhost:1';
process.env.TENANT_SLUG = 'sources';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; }
}
function assertEq(a, e, msg) { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${msg || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); }
function assertTrue(c, msg) { if (!c) throw new Error(msg || 'atteso true'); }
const F = (key, label, type, extra = {}) => ({ id: 'f_' + key, block_type: 'field', key, label, type, ...extra });

async function main() {
  // API esterna finta — un titolo per "isbn", niente per gli altri.
  const api = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (url.pathname === '/libri') {
      const q = url.searchParams.get('q') || '';
      res.end(JSON.stringify({ risultati: q === 'esiste' ? [{ titolo: 'Il libro trovato', isbn: '978-1' }] : [] }));
      return;
    }
    if (url.pathname === '/libro') {
      res.end(JSON.stringify({ titolo: 'Il libro trovato', autore: 'Un autore', isbn: url.searchParams.get('isbn') }));
      return;
    }
    res.end('{}');
  });
  await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve));
  const apiBase = 'http://127.0.0.1:' + api.address().port;

  require('./index.js');
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const db = require('./db');

  const SEARCH_SCRIPT = `
    let res = await app.request('${apiBase}/libri?q=' + encodeURIComponent(app.query.value)).send();
    let data = res.json();
    app.result((data.risultati || []).map((r) => ({ title: r.titolo, subtitle: r.isbn, params: { isbn: r.isbn } })));
  `;
  const DOCUMENT_SCRIPT = `
    let res = await app.request('${apiBase}/libro?isbn=' + encodeURIComponent(app.params.isbn)).send();
    let data = res.json();
    app.result({ titolo: data.titolo, autore: data.autore, interno: 'non dichiarato nello schema' });
  `;

  const mk = (slug, steps) => db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES (?, ?, 'box', '#000', 1, 1, 70, ?)").run(slug, slug, JSON.stringify({ version: 3, steps }));
  mk('libri_test', [
    F('titolo', 'Titolo', 'text'), F('autore', 'Autore', 'text'),
    { id: 'src1', block_type: 'api_source', key: 'libri', label: 'Catalogo libri', enabled: true, input_text_enabled: true, input_barcode_enabled: false, search_script: SEARCH_SCRIPT, document_script: DOCUMENT_SCRIPT },
    { id: 'src2', block_type: 'api_source', key: 'spenta', label: 'Fonte spenta', enabled: false, input_text_enabled: true, input_barcode_enabled: false, search_script: 'app.result([])', document_script: 'app.result({})' },
  ]);

  const login = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: process.env.INITIAL_ADMIN_PASSWORD }) })).json();
  const H = { Authorization: 'Bearer ' + login.token, 'Content-Type': 'application/json' };
  const post = (p, body) => fetch(BASE + '/api' + p, { method: 'POST', headers: H, body: JSON.stringify(body) });

  console.log('\n--- ricerca ---');
  await test('ricerca con risultati veri (via rete, API esterna locale)', async () => {
    const r = await post('/records/libri_test/sources/libri/search', { query: 'esiste', type: 'text' });
    assertEq(r.status, 200); const j = await r.json();
    assertEq(j.results, [{ title: 'Il libro trovato', subtitle: '978-1', params: { isbn: '978-1' } }]);
  });
  await test('ricerca senza risultati -> array vuoto, non un errore', async () => {
    const r = await post('/records/libri_test/sources/libri/search', { query: 'nonesiste', type: 'text' });
    assertEq(r.status, 200); assertEq((await r.json()).results, []);
  });
  await test('fonte disattivata -> 400', async () => {
    assertEq((await post('/records/libri_test/sources/spenta/search', { query: 'x', type: 'text' })).status, 400);
  });
  await test('fonte inesistente -> 404', async () => {
    assertEq((await post('/records/libri_test/sources/boh/search', { query: 'x', type: 'text' })).status, 404);
  });
  await test('ricerca per barcode su una fonte che non lo accetta -> 400', async () => {
    assertEq((await post('/records/libri_test/sources/libri/search', { query: 'x', type: 'barcode' })).status, 400);
  });

  console.log('\n--- importazione ---');
  await test('importa un record vero: solo i campi dichiarati nello schema, il resto scartato in silenzio', async () => {
    const r = await post('/records/libri_test/sources/libri/import', { params: { isbn: '978-1' } });
    assertEq(r.status, 200); const rec = await r.json();
    assertEq(rec.data.titolo, 'Il libro trovato'); assertEq(rec.data.autore, 'Un autore');
    assertEq(rec.data.interno, undefined, 'un campo non dichiarato nello schema non deve entrare nel record');
    const fromDb = db.prepare('SELECT COUNT(*) c FROM records WHERE module_slug = ?').get('libri_test').c;
    assertEq(fromDb, 1);
  });
  await test('un record importato finisce nello storico come una creazione normale', async () => {
    const h = db.prepare("SELECT action FROM record_history WHERE module_slug = 'libri_test' ORDER BY id DESC LIMIT 1").get();
    assertEq(h.action, 'create');
  });

  console.log('\n--- test dal Builder (bozza non salvata, mai una scrittura) ---');
  await test('/builder/sources/test, mode search, codice passato a mano (non quello salvato)', async () => {
    const r = await post('/builder/sources/test', { mode: 'search', code: 'app.result([{ title: app.query.value }])', query: 'ciao', query_type: 'text' });
    assertEq(r.status, 200); const j = await r.json();
    assertEq(j.ok, true); assertEq(j.result, [{ title: 'ciao' }]);
  });
  await test('/builder/sources/test, mode document', async () => {
    const r = await post('/builder/sources/test', { mode: 'document', code: 'app.result({ x: app.params.y })', params: { y: 'z' } });
    const j = await r.json(); assertEq(j.result, { x: 'z' });
  });
  await test('/builder/sources/test con uno script rotto -> ok:false, mai un 500', async () => {
    const r = await post('/builder/sources/test', { mode: 'search', code: 'questo( non è js', query: 'x' });
    assertEq(r.status, 200); assertEq((await r.json()).ok, false);
  });
  await test('un test non scrive mai un record', async () => {
    await post('/builder/sources/test', { mode: 'document', code: "app.result({ titolo: 'x' })", params: {} });
    const fromDb = db.prepare('SELECT COUNT(*) c FROM records WHERE module_slug = ?').get('libri_test').c;
    assertEq(fromDb, 1, 'deve restare 1 (solo l\'import vero di prima)');
  });

  console.log('\n--- validazione alla pubblicazione (solo sintassi, mai esecuzione) ---');
  await test('script con errore di sintassi blocca la pubblicazione', async () => {
    mk('rotto_test', [F('x', 'X', 'text'), { id: 's', block_type: 'api_source', key: 'k', label: 'K', input_text_enabled: true, search_script: 'questo( non è js', document_script: 'app.result({})' }]);
    const r = await post('/builder/rotto_test/publish', {});
    assertEq(r.status, 400); const j = await r.json();
    assertTrue(j.details.some((d) => /sintassi/.test(JSON.stringify(d))));
  });
  await test('nessun tipo di ricerca accettato blocca la pubblicazione', async () => {
    mk('senza_tipo_test', [F('x', 'X', 'text'), { id: 's', block_type: 'api_source', key: 'k', label: 'K', input_text_enabled: false, input_barcode_enabled: false, search_script: 'app.result([])', document_script: 'app.result({})' }]);
    const r = await post('/builder/senza_tipo_test/publish', {});
    assertEq(r.status, 400); const j = await r.json();
    assertTrue(j.details.some((d) => /tipo di ricerca/.test(JSON.stringify(d))));
  });
  await test('uno script sintatticamente valido NON blocca la pubblicazione (nessuna chiamata di rete fatta qui)', async () => {
    mk('ok_test', [F('x', 'X', 'text'), { id: 's', block_type: 'api_source', key: 'k', label: 'K', input_text_enabled: true, search_script: SEARCH_SCRIPT, document_script: DOCUMENT_SCRIPT }]);
    const r = await post('/builder/ok_test/publish', {});
    assertEq(r.status, 200);
  });

  api.close();
  console.log(`\n${'='.repeat(60)}`);
  console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
  try { fs.unlinkSync(dbPath); } catch (e) {}
  process.exit(failed > 0 ? 1 : 0);
}
main().catch((e) => { console.error('Suite sources fallita ad avviarsi:', e); process.exit(1); });
