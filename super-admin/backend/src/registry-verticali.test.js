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
  await test('la guida di un verticale: da dove cominciare (prima ciò a cui gli altri si collegano), campi e stati dai moduli', async () => {
    db.prepare('DELETE FROM registry_modules').run(); require('./lib/moduli-generici').importa();
    const v = (await lista()).find((x) => x.name === 'Vendite e fatturazione'); const g = v.guida;
    eq(g.moduli.length, v.moduli.length); eq(g.ordine.length, v.moduli.length);
    ok(g.ordine.indexOf('Clienti') < g.ordine.indexOf('Ordini'), 'i clienti prima degli ordini');
    ok(g.ordine.indexOf('Ordini') < g.ordine.indexOf('Righe Ordine'), 'gli ordini prima delle loro righe');
    ok(g.moduli.every((m) => m.nome && Array.isArray(m.campi)) && g.moduli.some((m) => m.campi.length > 0), 'campi presenti');
    ok(!JSON.stringify(v).includes('schema_json') && !JSON.stringify(v).includes('collegamentiSlug'), 'né schemi né dettagli interni');
  });
  const call = (m, u, b) => fetch(BASE + '/api/registry' + u, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined });
  await test('gestione: serve il login, nome e almeno un modulo; slug doppi tolti; i mancanti segnalati', async () => {
    eq((await fetch(BASE + '/api/registry/verticals')).status, 401);
    eq((await call('POST', '/verticals', { name: '', module_slugs: ['x'] })).status, 400); eq((await call('POST', '/verticals', { name: 'A', module_slugs: [] })).status, 400);
    const v = await (await call('POST', '/verticals', { name: 'Mio', icon: 'tool', description: 'd', module_slugs: ['clienti_generico', 'ordini_generico', 'clienti_generico', 'sparito'] })).json();
    eq(v.module_slugs, ['clienti_generico', 'ordini_generico', 'sparito']); eq(v.mancanti, 1);
    const per = (await (await fetch(BASE + '/api/registry/public/verticals', { headers: HI })).json()).find((x) => x.name === 'Mio'); eq(per.moduli.map((m) => m.slug), ['clienti_generico', 'ordini_generico']);
  });
  await test('gestione: modifica (anche solo il nome), elimina, 404', async () => {
    const mio = (await (await call('GET', '/verticals')).json()).find((x) => x.name === 'Mio');
    const u = await (await call('PATCH', '/verticals/' + mio.id, { name: 'Mio 2' })).json(); eq([u.name, u.module_slugs.length], ['Mio 2', 3], 'i moduli restano se non li tocchi');
    eq((await call('PATCH', '/verticals/' + mio.id, { module_slugs: [] })).status, 400);
    eq((await call('PATCH', '/verticals/99999', { name: 'x' })).status, 404);
    eq((await call('DELETE', '/verticals/' + mio.id)).status, 200); eq((await call('DELETE', '/verticals/' + mio.id)).status, 404);
  });
  await test('ripristina: rimette solo i predefiniti mancanti, senza toccare quelli modificati', async () => {
    const l = await (await call('GET', '/verticals')).json(); const mk = l.find((x) => x.name === 'Marketing');
    await call('PATCH', '/verticals/' + mk.id, { description: 'MODIFICATA' }); await call('DELETE', '/verticals/' + l.find((x) => x.name === 'Personale e presenze').id);
    const r = await (await call('POST', '/verticals-ripristina')).json(); eq(r.aggiunti, 1);
    eq(r.verticali.find((x) => x.name === 'Marketing').description, 'MODIFICATA'); eq(r.verticali.length, V.SEED.length);
  });
  console.log(`\n${passed} passati, ${failed} falliti`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
