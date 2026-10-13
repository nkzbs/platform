'use strict';
// Proposte di moduli dai tenant alla Libreria (routes/registry.js): coda, approvazione (nuova versione), rifiuto con motivo.
// Eseguire con: node src/registry-proposals.test.js (porta 34856 libera).
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const TEST_PORT = 34856, BASE = 'http://localhost:' + TEST_PORT;
process.env.DB_PATH = path.join(os.tmpdir(), 'verticali-test-' + crypto.randomBytes(6).toString('hex') + '.db');
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
  const lista = async () => (await fetch(BASE + '/api/registry/public/verticals', { headers: HI })).json();
  const V = require('./lib/verticali');

  await test('solo con il secret interno', async () => {
    eq((await fetch(BASE + '/api/registry/public/verticals')).status, 401);
    eq((await fetch(BASE + '/api/registry/public/verticals', { headers: H })).status, 401, 'il token di Super Admin non basta');
  });
  await test('Libreria vuota: nessun verticale (meno di due moduli non si propone)', async () => {
    db.prepare('DELETE FROM registry_modules').run(); eq(await lista(), []);
  });
  await test('con i moduli generici importati: ogni verticale ha id veri e nomi, e la seed non cita slug che non esistono', async () => {
    require('./lib/moduli-generici').importa();
    const l = await lista(); eq(l.length, V.SEED.length);
    for (const v of l) { if (!v.name || !v.icon || v.moduli.length < 2) throw new Error('verticale incompleto: ' + v.name); if (!v.moduli.every((m) => m.id && m.slug && m.name)) throw new Error('modulo senza dati in ' + v.name); }
    const tot = V.SEED.reduce((n, v) => n + v.moduli.length, 0), ris = l.reduce((n, v) => n + v.moduli.length, 0); eq(ris, tot, 'ogni slug della seed esiste nella Libreria');
    ok(!JSON.stringify(l).includes('schema_json'), 'mai gli schemi');
  });
  await test('un modulo tolto dalla Libreria si salta; sotto i due moduli il verticale sparisce', async () => {
    const prima = (await lista()).find((v) => v.name === 'Marketing');
    db.prepare("DELETE FROM registry_modules WHERE slug IN ('promozioni_generico','newsletter_iscritti_generico','recensioni_generico','comunicazioni_generico')").run();
    const dopo = (await lista()).find((v) => v.name === 'Marketing'); eq([prima.moduli.length, dopo], [5, undefined], 'resta solo clienti: non si propone');
  });
  console.log(`\n${passed} passati, ${failed} falliti`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
