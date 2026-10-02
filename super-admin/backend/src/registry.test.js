'use strict';
// La Libreria (routes/registry.js): salvare un modulo di un tenant con una versione,
// ripubblicare (+1), elenco con solo l'ultima versione, storico, e il lato tenant
// (/public/*, protetto dal secret interno, mai schema_json nell'elenco).
//
// Eseguire con: node src/registry.test.js (richiede porta 34578 libera).

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const TEST_PORT = 34578;
const BASE = 'http://localhost:' + TEST_PORT;
const dbPath = path.join(os.tmpdir(), 'registry-test-' + crypto.randomBytes(6).toString('hex') + '.db');
const tenantDbPath = path.join(os.tmpdir(), 'registry-test-tenant-' + crypto.randomBytes(6).toString('hex') + '.db');

process.env.DB_PATH = dbPath;
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'reg_test_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'reg_test_internal_' + crypto.randomBytes(8).toString('hex');

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.error('  ✗ ' + name); console.error('    ' + e.message); failed++; failures.push(name); }
}
function assertEq(actual, expected, msg) { if (actual !== expected) throw new Error(`${msg || ''}: atteso ${JSON.stringify(expected)}, ottenuto ${JSON.stringify(actual)}`); }
function assertTrue(cond, msg) { if (!cond) throw new Error(msg || 'atteso true'); }

async function waitForServer(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (res.status) return;
    } catch (e) { /* non ancora in ascolto */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Super Admin non pronto entro ' + timeoutMs + 'ms');
}

async function main() {
  // Un tenant finto: un file SQLite con la sola tabella modules, come la legge /publish.
  const t = new Database(tenantDbPath);
  t.exec('CREATE TABLE modules (id INTEGER PRIMARY KEY, name TEXT, slug TEXT, icon TEXT, color TEXT, schema_json TEXT, group_name TEXT, support_module INTEGER DEFAULT 0)');
  t.prepare("INSERT INTO modules (name, slug, icon, color, schema_json, group_name) VALUES ('Spese', 'spese', 'wallet', '#10B981', ?, 'Soldi')").run(JSON.stringify({ version: 3, steps: [{ id: 'f1', block_type: 'field', key: 'importo' }] }));
  t.close();

  require('./index.js');
  await waitForServer(10000);
  const db = require('./db');
  const bcrypt = require('bcryptjs');
  db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('reg_user', ?, 'admin')").run(bcrypt.hashSync('reg_test_pw', 10));
  db.prepare("INSERT INTO tenants (name, slug, port, db_path, status) VALUES ('Casa', 'casa', 47300, ?, 'active')").run(tenantDbPath);

  const login = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'reg_user', password: 'reg_test_pw' }) });
  const auth = { Authorization: 'Bearer ' + (await login.json()).token, 'Content-Type': 'application/json' };
  const internal = { 'x-internal-secret': process.env.INTERNAL_API_SECRET, 'Content-Type': 'application/json' };
  const post = (p, body, h = auth) => fetch(BASE + '/api/registry' + p, { method: 'POST', headers: h, body: JSON.stringify(body || {}) });
  const get = (p, h = auth) => fetch(BASE + '/api/registry' + p, { headers: h });

  console.log('\n--- salvare nella Libreria ---');

  await test('senza auth -> 401', async () => {
    assertEq((await fetch(BASE + '/api/registry/modules')).status, 401);
  });

  await test('tenant o modulo inesistenti -> 404', async () => {
    assertEq((await post('/publish', { tenant_slug: 'non-esiste', module_slug: 'spese' })).status, 404);
    assertEq((await post('/publish', { tenant_slug: 'casa', module_slug: 'non-esiste' })).status, 404);
  });

  let v1;
  await test('salva "spese" dal tenant casa: nasce la versione 1, subito disponibile', async () => {
    const res = await post('/publish', { tenant_slug: 'casa', module_slug: 'spese', description: 'Spese di casa', release_notes: 'Prima versione' });
    assertEq(res.status, 200);
    v1 = await res.json();
    assertEq(v1.version, 1);
    assertEq(v1.source_tenant_slug, 'casa');
    assertEq(v1.group_name, 'Soldi', 'il gruppo del modulo viaggia con la Libreria');
  });

  let v2;
  await test('ripubblicare lo stesso modulo crea la versione 2, la 1 resta', async () => {
    const res = await post('/publish', { tenant_slug: 'casa', module_slug: 'spese', release_notes: 'Aggiunta la categoria' });
    v2 = await res.json();
    assertEq(v2.version, 2);
    assertEq(db.prepare("SELECT COUNT(*) c FROM registry_modules WHERE slug = 'spese' AND source_tenant_slug = 'casa'").get().c, 2);
  });

  console.log('\n--- elenco, storico, struttura ---');

  await test('GET /modules mostra UNA riga per modulo (l\'ultima versione) e dice quante versioni ci sono', async () => {
    const list = await (await get('/modules')).json();
    const rows = list.filter((m) => m.slug === 'spese');
    assertEq(rows.length, 1);
    assertEq(rows[0].version, 2);
    assertEq(rows[0].versions_count, 2);
  });

  await test('GET /modules/:id/versions elenca le versioni dalla più recente, con le note', async () => {
    const versions = await (await get('/modules/' + v1.id + '/versions')).json();
    assertEq(versions.map((v) => v.version).join(','), '2,1');
    assertEq(versions[1].release_notes, 'Prima versione');
  });

  await test('GET /modules/:id/schema restituisce lo schema di QUELLA versione', async () => {
    const body = await (await get('/modules/' + v1.id + '/schema')).json();
    assertEq(JSON.parse(body.schema_json).steps.length, 1);
  });

  await test('PATCH corregge descrizione e note senza creare una nuova versione', async () => {
    const res = await fetch(BASE + '/api/registry/modules/' + v2.id, { method: 'PATCH', headers: auth, body: JSON.stringify({ description: 'Spese di casa e personali' }) });
    assertEq((await res.json()).description, 'Spese di casa e personali');
    assertEq(db.prepare("SELECT COUNT(*) c FROM registry_modules WHERE slug = 'spese'").get().c, 2);
  });

  console.log('\n--- lato tenant (/public/*) ---');

  await test('senza secret interno -> 401', async () => {
    assertEq((await get('/public/modules', {})).status, 401);
  });

  await test('elenco: solo l\'ultima versione, MAI lo schema', async () => {
    const res = await get('/public/modules', internal);
    const text = await res.text();
    assertEq(res.status, 200);
    assertTrue(!text.includes('schema_json'), 'l\'elenco non deve contenere schema_json');
    const rows = JSON.parse(text).filter((m) => m.slug === 'spese');
    assertEq(rows.length, 1);
    assertEq(rows[0].version, 2);
  });

  await test('install: il tenant riceve lo schema e i riferimenti per tracciare la versione', async () => {
    const res = await post('/public/modules/' + v2.id + '/install', { tenant_slug: 'casa' }, internal);
    const body = await res.json();
    assertEq(res.status, 200);
    assertEq(body.id, v2.id);
    assertEq(body.version, 2);
    assertEq(body.source_tenant_slug, 'casa');
    assertTrue(JSON.parse(body.schema_json).version === 3);
  });

  await test('refresh di una versione vecchia funziona (il tenant sceglie cosa installare)', async () => {
    const res = await post('/public/modules/' + v1.id + '/refresh', { tenant_slug: 'casa' }, internal);
    assertEq((await res.json()).version, 1);
  });

  await test('install senza tenant_slug -> 400', async () => {
    assertEq((await post('/public/modules/' + v2.id + '/install', {}, internal)).status, 400);
  });

  console.log('\n--- moduli di default e rimozione ---');

  await test('un modulo può essere messo tra i default dei nuovi tenant', async () => {
    const res = await fetch(BASE + '/api/registry/default-modules', { method: 'PUT', headers: auth, body: JSON.stringify({ module_ids: [v2.id] }) });
    assertEq((await res.json()).count, 1);
    assertEq((await (await get('/default-modules')).json())[0].id, v2.id);
  });

  await test('togliere una versione la leva anche dai default; l\'altra versione resta', async () => {
    await fetch(BASE + '/api/registry/modules/' + v2.id, { method: 'DELETE', headers: auth });
    assertEq(db.prepare('SELECT COUNT(*) c FROM default_modules').get().c, 0);
    assertEq(db.prepare("SELECT COUNT(*) c FROM registry_modules WHERE slug = 'spese'").get().c, 1);
  });

  console.log(`\n${'='.repeat(60)}`);
  console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
  if (failed > 0) console.log('Falliti: ' + failures.join(', '));
  try { fs.unlinkSync(dbPath); } catch (e) {}
  try { fs.unlinkSync(tenantDbPath); } catch (e) {}
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error('Suite Libreria fallita ad avviarsi:', e); process.exit(1); });
