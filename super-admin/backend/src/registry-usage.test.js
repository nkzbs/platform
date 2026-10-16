'use strict';
// Proposte di moduli dai tenant alla Libreria (routes/registry.js): coda, approvazione (nuova versione), rifiuto con motivo.
// Eseguire con: node src/registry-proposals.test.js (porta 34860 libera).
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const TEST_PORT = 34860, BASE = 'http://localhost:' + TEST_PORT;
process.env.DB_PATH = path.join(os.tmpdir(), 'usage-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'pr_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'pr_internal_' + crypto.randomBytes(8).toString('hex');
process.env.ENCRYPTION_KEY = 'pr_enc_' + crypto.randomBytes(8).toString('hex');
const SECRET = process.env.INTERNAL_API_SECRET;
let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); console.log('  ✓ ' + name); passed++; } catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; } }
const eq = (a, e, m) => { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${m || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m || 'atteso true'); };

async function main() {
  require('./index.js');
  for (let i = 0; i < 100; i++) { try { const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); if (r.status) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const db = require('./db'); const bcrypt = require('bcryptjs');
  db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('pr_user', ?, 'admin')").run(bcrypt.hashSync('pr_pw_123456', 10));
  db.prepare("INSERT INTO tenants (name, slug, port, db_path, status) VALUES ('Officina', 'officina', 47310, '/tmp/x.db', 'active')").run();
  const login = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'pr_user', password: 'pr_pw_123456' }) });
  const H = { Authorization: 'Bearer ' + (await login.json()).token, 'Content-Type': 'application/json' };
  const HI = { 'x-internal-secret': SECRET, 'Content-Type': 'application/json' };
  const Database = require('better-sqlite3'), fs = require('fs');
  const mk = (slug, righe) => {
    const f = path.join(os.tmpdir(), 'usage-tenant-' + slug + '-' + crypto.randomBytes(4).toString('hex') + '.db');
    const t = new Database(f); t.exec('CREATE TABLE modules (slug TEXT, installed INTEGER, registry_slug TEXT, registry_source_tenant_slug TEXT, registry_version INTEGER)');
    for (const r of righe) t.prepare('INSERT INTO modules VALUES (?, ?, ?, ?, ?)').run(...r); t.close();
    db.prepare("INSERT INTO tenants (name, slug, port, db_path, status) VALUES (?, ?, ?, ?, 'active')").run(slug.toUpperCase(), slug, 47400 + Math.floor(Math.random() * 500), f); return f;
  };
  const rm = (slug, ver, schema = '{}', origine = 'generici') => db.prepare("INSERT INTO registry_modules (name, slug, schema_json, version, source_tenant_slug) VALUES (?, ?, ?, ?, ?)").run(slug.toUpperCase(), slug, schema, ver, origine).lastInsertRowid;
  rm('clienti', 1); const clienti2 = rm('clienti', 2);
  rm('ordini', 1, JSON.stringify({ relations: [{ key: 'c', label: 'C', type: 'many_to_one', target_module: 'clienti' }] }));
  mk('alfa', [['clienti', 1, 'clienti', 'generici', 1]]);          // vecchia versione: aggiornabile
  mk('beta', [['clienti', 1, 'clienti', 'generici', 2]]);          // aggiornata
  mk('gamma', [['clienti', 0, 'clienti', 'generici', 1]]);         // tolta: non conta
  mk('delta', [['altro', 1, null, null, null]]);                   // mai installato dalla Libreria
  db.prepare("INSERT INTO tenants (name, slug, port, db_path, status) VALUES ('Rotto', 'rotto', 47999, '/non/esiste.db', 'active')").run();
  const usage = async (id) => (await fetch(BASE + '/api/registry/modules/' + id + '/usage', { headers: H }));

  await test('serve il login; modulo inesistente 404', async () => {
    eq((await fetch(BASE + '/api/registry/modules/' + clienti2 + '/usage')).status, 401); eq((await usage(99999)).status, 404);
  });
  await test('i tenant che lo usano, con la versione e chi può aggiornare; chi lo ha tolto o non lo ha non compare; un tenant illeggibile non rompe nulla', async () => {
    const u = await (await usage(clienti2)).json();
    eq(u.versione_ultima, 2); eq(u.tenants.map((t) => [t.slug, t.version, t.aggiornabile]), [['alfa', 1, true], ['beta', 2, false]]);
  });
  await test('i moduli della Libreria che si collegano a lui', async () => {
    const u = await (await usage(clienti2)).json(); eq(u.usato_da.map((x) => x.name), ['ORDINI']);
  });
  console.log(`\n${passed} passati, ${failed} falliti`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
