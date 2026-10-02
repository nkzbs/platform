'use strict';
// Registrazione di un tenant esistente (routes/tenant-import.js): import da un
// vecchio super-admin.db e registrazione manuale. Il punto che conta di più è che
// la chiave di cifratura originale arrivi nel nuovo registro (senza, i campi
// cifrati del tenant non si leggono più) e che NON compaia mai in una risposta.
//
// Eseguire con: node src/tenant-import.test.js (richiede porta 34700 libera).

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const TEST_PORT = 34700;
const BASE = 'http://localhost:' + TEST_PORT;
const dbPath = path.join(os.tmpdir(), 'tenant-import-test-' + crypto.randomBytes(6).toString('hex') + '.db');
const oldDbPath = path.join(os.tmpdir(), 'tenant-import-old-' + crypto.randomBytes(6).toString('hex') + '.db');

process.env.DB_PATH = dbPath;
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'import_test_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'import_test_internal_' + crypto.randomBytes(8).toString('hex');

let passed = 0, failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    console.log('  ✓ ' + name);
    passed++;
  } catch (e) {
    console.error('  ✗ ' + name);
    console.error('    ' + e.message);
    failed++;
    failures.push(name);
  }
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
  throw new Error('Server Super Admin non pronto entro ' + timeoutMs + 'ms');
}

// Un super-admin.db "vecchio stile": colonne commerciali che oggi non esistono più.
function buildOldDb() {
  const old = new Database(oldDbPath);
  old.exec(`
    CREATE TABLE tenants (
      id INTEGER PRIMARY KEY, name TEXT, slug TEXT, port INTEGER, db_path TEXT, status TEXT,
      domain TEXT, encryption_key TEXT, jwt_secret TEXT, license_type TEXT, billing_plan TEXT, partner_id INTEGER,
      backup_offsite_credentials TEXT
    );
  `);
  const ins = old.prepare('INSERT INTO tenants (name, slug, port, db_path, status, domain, encryption_key, jwt_secret, license_type, billing_plan, partner_id, backup_offsite_credentials) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  ins.run('Finance', 'finance', 41001, '/data/finance.db', 'active', 'finance.esempio.it', 'CHIAVE-ORIGINALE-FINANCE-1234', 'jwt-originale-finance', 'lifetime', 'pro', 7, 'enc:cifrata-con-vecchia-chiave');
  ins.run('Casa', 'casa', 41002, '/data/casa.db', 'active', null, null, 'jwt-casa', 'lifetime', null, null, null);
  ins.run('Cancellato', 'gone', 41003, '/data/gone.db', 'deleted', null, 'k', 'j', null, null, null, null);
  old.close();
}

async function main() {
  require('./index.js');
  await waitForServer(10000);

  const db = require('./db');
  const bcrypt = require('bcryptjs');
  db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('import_user', ?, 'admin')").run(bcrypt.hashSync('import_test_pw', 10));
  const login = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'import_user', password: 'import_test_pw' }) });
  const token = (await login.json()).token;
  const auth = { Authorization: 'Bearer ' + token };
  const authJson = { ...auth, 'Content-Type': 'application/json' };

  buildOldDb();
  const uploadOld = async (file) => {
    const form = new FormData();
    form.append('file', new Blob([fs.readFileSync(file)]), 'super-admin.db');
    return fetch(BASE + '/api/tenants/import/preview', { method: 'POST', headers: auth, body: form });
  };

  console.log('\n--- import da un vecchio super-admin.db ---');

  await test('senza auth -> 401', async () => {
    const res = await fetch(BASE + '/api/tenants/import/preview', { method: 'POST' });
    assertEq(res.status, 401);
  });

  await test('file che non è un database SQLite -> 400, mai un crash', async () => {
    const junk = path.join(os.tmpdir(), 'junk-' + Date.now() + '.txt');
    fs.writeFileSync(junk, 'questo non è un database');
    const res = await uploadOld(junk);
    fs.unlinkSync(junk);
    assertEq(res.status, 400);
  });

  let importId;
  await test('anteprima: elenca i tenant non cancellati, senza MAI mostrare chiavi o segreti', async () => {
    const res = await uploadOld(oldDbPath);
    const text = await res.text();
    assertEq(res.status, 200);
    assertTrue(!text.includes('CHIAVE-ORIGINALE-FINANCE-1234'), 'la chiave di cifratura non deve comparire nella risposta');
    assertTrue(!text.includes('jwt-originale-finance'), 'il jwt secret non deve comparire nella risposta');
    const body = JSON.parse(text);
    importId = body.import_id;
    assertEq(body.tenants.length, 2);
    const fin = body.tenants.find((t) => t.slug === 'finance');
    assertEq(fin.has_encryption_key, true);
    assertEq(fin.port, 41001);
    assertEq(body.tenants.find((t) => t.slug === 'casa').has_encryption_key, false);
  });

  await test('importa Finance: riga creata ferma, con la chiave ORIGINALE e senza i campi commerciali', async () => {
    const res = await fetch(BASE + '/api/tenants/import', { method: 'POST', headers: authJson, body: JSON.stringify({ import_id: importId, slugs: ['finance'] }) });
    const body = await res.json();
    assertEq(res.status, 200);
    assertEq(body.results[0].ok, true);
    const row = db.prepare("SELECT * FROM tenants WHERE slug = 'finance'").get();
    assertEq(row.status, 'stopped');
    assertEq(row.encryption_key, 'CHIAVE-ORIGINALE-FINANCE-1234', 'la chiave deve essere identica a quella vecchia');
    assertEq(row.jwt_secret, 'jwt-originale-finance');
    assertEq(row.port, 41001);
    assertEq(row.db_path, '/data/finance.db');
    assertEq(row.domain, 'finance.esempio.it');
    assertEq(row.backup_offsite_credentials, null, 'le credenziali offsite cifrate con la vecchia chiave non si portano dietro');
    assertEq(db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action = 'tenant.import' AND target = 'finance'").get().c, 1);
  });

  await test('il file caricato viene scartato dopo l\'importazione (stesso import_id -> 400)', async () => {
    const res = await fetch(BASE + '/api/tenants/import', { method: 'POST', headers: authJson, body: JSON.stringify({ import_id: importId, slugs: ['casa'] }) });
    assertEq(res.status, 400);
  });

  await test('un tenant senza chiave nel file viene rifiutato con un messaggio chiaro, non importato a metà', async () => {
    const up = await (await uploadOld(oldDbPath)).json();
    const res = await fetch(BASE + '/api/tenants/import', { method: 'POST', headers: authJson, body: JSON.stringify({ import_id: up.import_id, slugs: ['casa', 'finance'] }) });
    const body = await res.json();
    const casa = body.results.find((r) => r.slug === 'casa');
    assertEq(casa.ok, false);
    assertTrue(/chiave/i.test(casa.error), 'il messaggio deve spiegare che manca la chiave');
    assertEq(body.results.find((r) => r.slug === 'finance').error, 'Già registrato');
    assertEq(db.prepare("SELECT COUNT(*) c FROM tenants WHERE slug = 'casa'").get().c, 0);
  });

  console.log('\n--- i segreti del tenant non escono mai dall\'API ---');

  await test('GET /tenants non restituisce encryption_key, jwt_secret né credenziali offsite', async () => {
    const res = await fetch(BASE + '/api/tenants', { headers: authJson });
    const text = await res.text();
    assertEq(res.status, 200);
    assertTrue(text.includes('"slug":"finance"'), 'il tenant importato deve comparire nell\'elenco');
    for (const secret of ['CHIAVE-ORIGINALE-FINANCE-1234', 'jwt-originale-finance', 'encryption_key', 'jwt_secret', 'backup_offsite_credentials']) {
      assertTrue(!text.includes(secret), 'nell\'elenco non deve comparire: ' + secret);
    }
  });

  console.log('\n--- registrazione manuale ---');

  const manual = (body) => fetch(BASE + '/api/tenants/register', { method: 'POST', headers: authJson, body: JSON.stringify(body) });

  await test('senza chiave di cifratura -> 400', async () => {
    const res = await manual({ name: 'Casa', slug: 'casa', port: 41002 });
    assertEq(res.status, 400);
  });

  await test('slug non valido -> 400', async () => {
    const res = await manual({ name: 'Casa', slug: 'Casa Mia', port: 41002, encryption_key: 'una-chiave-lunga' });
    assertEq(res.status, 400);
  });

  await test('porta già usata -> 400 con messaggio comprensibile', async () => {
    const res = await manual({ name: 'Casa', slug: 'casa', port: 41001, encryption_key: 'una-chiave-lunga' });
    const body = await res.json();
    assertEq(res.status, 400);
    assertTrue(/porta/i.test(body.error));
  });

  await test('registrazione valida: tenant fermo, db_path di default /data/<slug>.db, jwt generato se manca', async () => {
    const res = await manual({ name: 'Casa', slug: 'casa', port: 41002, encryption_key: 'una-chiave-lunga' });
    assertEq(res.status, 200);
    const row = db.prepare("SELECT * FROM tenants WHERE slug = 'casa'").get();
    assertEq(row.status, 'stopped');
    assertEq(row.db_path, '/data/casa.db');
    assertEq(row.encryption_key, 'una-chiave-lunga');
    assertTrue(row.jwt_secret && row.jwt_secret.length >= 32, 'jwt_secret generato');
  });

  console.log(`\n${'='.repeat(60)}`);
  console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
  if (failed > 0) console.log('Falliti: ' + failures.join(', '));

  try { fs.unlinkSync(dbPath); } catch (e) {}
  try { fs.unlinkSync(oldDbPath); } catch (e) {}
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Suite registrazione tenant fallita ad avviarsi:', e);
  process.exit(1);
});
