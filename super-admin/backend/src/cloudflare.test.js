'use strict';
// Sottodominio Cloudflare di un tenant (cloudflare.js) e chiamata di creazione in
// routes/tenants.js. Cloudflare è simulato: nessuna chiamata di rete vera.
//
// Regressione: createTenant() chiamava upsertSubdomain(autoDomainLabel), una variabile
// mai definita -> l'errore veniva solo scritto nel registro attività e il sottodominio
// del tenant nuovo non nasceva mai (il browser: "non trova il server").
//
// Eseguire con: node src/cloudflare.test.js

const fs = require('fs');
const path = require('path');

process.env.CLOUDFLARE_API_TOKEN = 'token-finto';
process.env.CLOUDFLARE_ZONE_ID = 'zona-finta';
process.env.CLOUDFLARE_ORIGIN_IP = '203.0.113.7';
process.env.CLOUDFLARE_ZONE_NAME = 'esempio.test';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; }
}
function assertEq(a, e, msg) { if (a !== e) throw new Error(`${msg || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); }
function assertTrue(c, msg) { if (!c) throw new Error(msg || 'atteso true'); }

// Cloudflare finto: tiene i record in memoria e registra le chiamate.
const records = [];
const calls = [];
let failNext = null;
global.fetch = async (url, opts = {}) => {
  const u = new URL(url);
  const method = (opts.method || 'GET').toUpperCase();
  calls.push({ method, path: u.pathname + u.search, body: opts.body ? JSON.parse(opts.body) : null });
  const ok = (result) => ({ json: async () => ({ success: true, result }), statusText: 'OK' });
  if (failNext) { const msg = failNext; failNext = null; return { json: async () => ({ success: false, errors: [{ message: msg }] }), statusText: 'Forbidden' }; }
  if (method === 'GET') return ok(records.filter((r) => r.name === u.searchParams.get('name')));
  if (method === 'POST') { const r = { id: 'r' + records.length, ...JSON.parse(opts.body) }; records.push(r); return ok(r); }
  if (method === 'PATCH') { const r = records.find((x) => u.pathname.endsWith(x.id)); Object.assign(r, JSON.parse(opts.body)); return ok(r); }
  if (method === 'DELETE') { records.splice(records.findIndex((x) => u.pathname.endsWith(x.id)), 1); return ok({}); }
  throw new Error('chiamata inattesa: ' + method + ' ' + url);
};

const cloudflare = require('./cloudflare');

(async () => {
  console.log('\n--- sottodominio del tenant ---');

  await test('upsertSubdomain("prova") crea il record A prova.<zona> verso l\'IP del NAS, proxato', async () => {
    const r = await cloudflare.upsertSubdomain('prova');
    assertEq(r.created, true);
    assertEq(r.name, 'prova.esempio.test');
    const post = calls.find((c) => c.method === 'POST');
    assertEq(post.body.type, 'A');
    assertEq(post.body.name, 'prova.esempio.test');
    assertEq(post.body.content, '203.0.113.7');
    assertEq(post.body.proxied, true);
  });

  await test('seconda chiamata: il record c\'è già e non cambia -> nessuna scrittura', async () => {
    const before = calls.filter((c) => c.method !== 'GET').length;
    const r = await cloudflare.upsertSubdomain('prova');
    assertEq(r.unchanged, true);
    assertEq(calls.filter((c) => c.method !== 'GET').length, before);
  });

  await test('se il record punta a un IP diverso viene aggiornato', async () => {
    records.find((r) => r.name === 'prova.esempio.test').content = '198.51.100.9';
    const r = await cloudflare.upsertSubdomain('prova');
    assertEq(r.updated, true);
    assertEq(records.find((r) => r.name === 'prova.esempio.test').content, '203.0.113.7');
  });

  await test('un errore di Cloudflare diventa un\'eccezione col messaggio vero (non si perde)', async () => {
    failNext = 'Authentication error';
    let msg = '';
    try { await cloudflare.upsertSubdomain('altro'); } catch (e) { msg = e.message; }
    assertTrue(/Authentication error/.test(msg), 'messaggio: ' + msg);
  });

  await test('deleteSubdomain toglie il record', async () => {
    const r = await cloudflare.deleteSubdomain('prova');
    assertEq(r.deleted, true);
    assertEq(records.length, 0);
  });

  console.log('\n--- chiamate in routes/tenants.js ---');

  await test('ogni upsertSubdomain() in tenants.js riceve una variabile che esiste (slug o label)', () => {
    const src = fs.readFileSync(path.join(__dirname, 'routes', 'tenants.js'), 'utf8');
    const args = [...src.matchAll(/upsertSubdomain\(([^)]*)\)/g)].map((m) => m[1].trim());
    assertTrue(args.length >= 2, 'attese almeno 2 chiamate, trovate ' + args.length);
    for (const a of args) assertTrue(['slug', 'label'].includes(a), 'argomento sospetto: "' + a + '"');
  });

  console.log(`\n${'='.repeat(60)}`);
  console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
  process.exit(failed > 0 ? 1 : 0);
})();
