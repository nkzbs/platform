'use strict';
// Proposte di moduli dai tenant alla Libreria (routes/registry.js): coda, approvazione (nuova versione), rifiuto con motivo.
// Eseguire con: node src/registry-proposals.test.js (porta 34855 libera).
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const TEST_PORT = 34855, BASE = 'http://localhost:' + TEST_PORT;
process.env.DB_PATH = path.join(os.tmpdir(), 'proposals-test-' + crypto.randomBytes(6).toString('hex') + '.db');
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
  const schema = (n = 2) => JSON.stringify({ version: 3, steps: [{ id: 'f1', block_type: 'field', key: 'titolo', label: 'Titolo', type: 'text' }, ...(n > 1 ? [{ id: 'f2', block_type: 'field', key: 'stato_x', label: 'Altro', type: 'text' }] : []), { id: 'w1', block_type: 'workflow_state', key: 'aperto', label: 'Aperto', initial: true }] });
  const propose = (over = {}) => fetch(BASE + '/api/registry/public/proposals', { method: 'POST', headers: HI, body: JSON.stringify({ tenant_slug: 'officina', module: { slug: 'lavori', name: 'Lavori', icon: 'tool', color: '#123456', group_name: 'Officina', schema_json: schema() }, description: 'Lavori di officina', note: 'Usato ogni giorno', ...over }) });
  const lista = async () => (await (await fetch(BASE + '/api/registry/proposals', { headers: H })).json());

  await test('solo con il secret interno; tenant e modulo devono essere validi', async () => {
    eq((await fetch(BASE + '/api/registry/public/proposals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
    eq((await propose({ tenant_slug: 'inesistente' })).status, 404);
    eq((await propose({ module: { slug: 'ha spazi', name: 'X', schema_json: schema() } })).status, 400);
    eq((await propose({ module: { slug: 'ok', name: 'X', schema_json: 'non json' } })).status, 400);
    eq((await propose({ module: { slug: 'ok', name: 'X', schema_json: JSON.stringify({ version: 3, steps: [] }) } })).status, 400, 'senza campi');
    eq((await propose({ module: { slug: 'ok', name: 'X', schema_json: 'x'.repeat(95 * 1024) } })).status, 400, 'troppo grande');
    eq((await fetch(BASE + '/api/registry/proposals')).status, 401);
  });
  let id;
  await test('una proposta valida va in coda; una nuova per lo stesso modulo SOSTITUISCE quella in attesa', async () => {
    const r = await (await propose()).json(); id = r.id; eq([r.status, r.sostituita], ['pending', false]);
    const r2 = await (await propose({ note: 'Aggiornata' })).json(); eq([r2.id, r2.sostituita], [id, true]);
    const l = await lista(); eq(l.length, 1); eq(l[0].note, 'Aggiornata'); eq(l[0].campi.length, 2); eq(l[0].stati, ['Aperto']); eq(l[0].versione_prossima, 1); ok(!('schema_json' in l[0]), 'lo schema non esce nell\'elenco');
    eq((await (await fetch(BASE + '/api/registry/public/proposals?tenant_slug=officina', { headers: HI })).json())[0].status, 'pending');
    eq((await (await fetch(BASE + '/api/registry/public/proposals?tenant_slug=altro', { headers: HI })).json()), [], 'un tenant vede solo le sue');
  });
  await test('approvata: diventa una versione della Libreria con l\'origine del tenant; non si decide due volte', async () => {
    const r = await fetch(BASE + '/api/registry/proposals/' + id + '/approve', { method: 'POST', headers: H, body: JSON.stringify({ group_name: 'Generico' }) }); eq(r.status, 200);
    const m = db.prepare("SELECT * FROM registry_modules WHERE slug = 'lavori' AND source_tenant_slug = 'officina'").get();
    eq([m.version, m.name, m.group_name, m.description, m.release_notes, m.icon], [1, 'Lavori', 'Generico', 'Lavori di officina', 'Aggiornata', 'tool']);
    eq((await fetch(BASE + '/api/registry/proposals/' + id + '/approve', { method: 'POST', headers: H, body: '{}' })).status, 400);
    eq((await fetch(BASE + '/api/registry/proposals/' + id + '/reject', { method: 'POST', headers: H, body: JSON.stringify({ reason: 'x' }) })).status, 400);
    eq((await (await fetch(BASE + '/api/registry/public/proposals?tenant_slug=officina', { headers: HI })).json())[0].status, 'approved');
  });
  await test('una nuova proposta dello stesso modulo, approvata, è la versione 2; il rifiuto vuole un motivo e il tenant lo vede', async () => {
    const a = await (await propose()).json(); ok(a.id !== id); eq((await lista()).find((p) => p.id === a.id).versione_prossima, 2);
    eq((await fetch(BASE + '/api/registry/proposals/' + a.id + '/reject', { method: 'POST', headers: H, body: '{}' })).status, 400, 'motivo obbligatorio');
    eq((await fetch(BASE + '/api/registry/proposals/' + a.id + '/reject', { method: 'POST', headers: H, body: JSON.stringify({ reason: 'Troppo specifico per un\'officina' }) })).status, 200);
    const mia = (await (await fetch(BASE + '/api/registry/public/proposals?tenant_slug=officina', { headers: HI })).json()).find((p) => p.id === a.id); eq([mia.status, mia.reason], ['rejected', 'Troppo specifico per un\'officina']);
    const b = await (await propose({ note: 'Riprovo' })).json(); eq((await fetch(BASE + '/api/registry/proposals/' + b.id + '/approve', { method: 'POST', headers: H, body: '{}' })).status, 200);
    eq(db.prepare("SELECT MAX(version) v FROM registry_modules WHERE slug = 'lavori' AND source_tenant_slug = 'officina'").get().v, 2);
    eq((await fetch(BASE + '/api/registry/proposals/99999/approve', { method: 'POST', headers: H, body: '{}' })).status, 404);
  });
  console.log(`\n${passed} passati, ${failed} falliti`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
