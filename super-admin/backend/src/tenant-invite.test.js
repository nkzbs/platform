'use strict';
// Inviti lato Super Admin (routes/tenant-invite.js, POST /tenants/:slug/invite, notifier.sendInviteMail): la mail per conto di un tenant solo con il token firmato col SUO segreto, link solo verso
// il suo dominio, testo fisso e ripulito, tetto giornaliero; e l'invito per il primo admin. Posta e tenant simulati. Eseguire con: node src/tenant-invite.test.js (porta 34864 libera).
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const TEST_PORT = 34864, BASE = 'http://localhost:' + TEST_PORT;
process.env.DB_PATH = path.join(os.tmpdir(), 'tinvite-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'ti_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'ti_internal_' + crypto.randomBytes(8).toString('hex');
process.env.ENCRYPTION_KEY = 'ti_enc_' + crypto.randomBytes(8).toString('hex');
let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); console.log('  ✓ ' + name); passed++; } catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; } }
const eq = (a, e, m) => { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${m || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m || 'atteso true'); };

async function main() {
  require('./index.js');
  for (let i = 0; i < 100; i++) { try { const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); if (r.status) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const db = require('./db'); const jwt = require('jsonwebtoken'); const bcrypt = require('bcryptjs'); const notifier = require('./notifier'); const client = require('./lib/tenant-api-client');
  db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('ti_user', ?, 'admin')").run(bcrypt.hashSync('ti_pw_123456', 10));
  const mk = (slug, domain) => { db.prepare("INSERT INTO tenants (name, slug, port, db_path, status, domain, jwt_secret) VALUES (?, ?, ?, '/tmp/x.db', 'active', ?, ?)").run('Officina <Rossi>', slug, 47300 + Math.floor(Math.random() * 600), domain, 'SEC_' + slug); return db.prepare('SELECT * FROM tenants WHERE slug = ?').get(slug); };
  const officina = mk('officina', 'officina.example.com'), altro = mk('altro', 'altro.example.com'); mk('senzadominio', null);
  const login = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'ti_user', password: 'ti_pw_123456' }) });
  const HA = { Authorization: 'Bearer ' + (await login.json()).token, 'Content-Type': 'application/json' };
  let inviate = [];
  const originale = notifier.sendInviteMail;
  notifier.sendInviteMail = async (m) => { inviate.push(m); return { sent: true }; };
  const TOK = 'A'.repeat(43);
  const firma = (t, extra = {}, secret) => jwt.sign({ slug: t.slug, purpose: 'invite-mail', ...extra }, secret || t.jwt_secret, { expiresIn: 120 });
  const mail = (slug, token, body) => fetch(BASE + '/api/tenant-invite/' + slug + '/mail', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
  const ok1 = { to: 'paola@example.com', nome: 'Paola', link: 'https://officina.example.com/invito/' + TOK, ore: 72 };

  await test('senza token, col segreto condiviso, col token di un altro tenant o con scopo diverso: 401, e non parte nessuna mail', async () => {
    eq((await mail('officina', null, ok1)).status, 401); eq((await mail('officina', process.env.INTERNAL_API_SECRET, ok1)).status, 401);
    eq((await mail('officina', firma(altro), ok1)).status, 401); eq((await mail('officina', firma(officina, { purpose: 'export' }), ok1)).status, 401); eq(inviate.length, 0);
  });
  await test('con il token giusto parte, con nome e nome del progetto ripuliti dal codice del messaggio (il testo è fisso)', async () => {
    const r = await mail('officina', firma(officina), ok1); eq(r.status, 200); eq((await r.json()).sent, true);
    eq([inviate[0].to, inviate[0].link, inviate[0].tenantName, inviate[0].ore], ['paola@example.com', ok1.link, 'Officina <Rossi>', 72]);
    ok(Object.keys(inviate[0]).sort().join() === 'link,nome,ore,tenantName,to', 'solo i campi previsti: nessun testo libero');
  });
  await test('il link deve essere https verso il dominio di QUEL tenant, forma /invito/<token>, senza altro', async () => {
    inviate = [];
    for (const link of ['https://evil.example.com/invito/' + TOK, 'https://altro.example.com/invito/' + TOK, 'http://officina.example.com/invito/' + TOK, 'https://officina.example.com/altro/' + TOK, 'https://officina.example.com/invito/' + TOK + '?x=1', 'https://officina.example.com/invito/corto', 'https://utente:pw@officina.example.com/invito/' + TOK, 'https://officina.example.com.evil.com/invito/' + TOK, 'javascript:alert(1)', 'non un url'])
      eq((await mail('officina', firma(officina), { ...ok1, link })).status, 400, link);
    eq((await mail('senzadominio', firma(db.prepare("SELECT * FROM tenants WHERE slug = 'senzadominio'").get()), ok1)).status, 400, 'tenant senza dominio'); eq(inviate.length, 0);
  });
  await test('indirizzo email controllato; tetto di 30 al giorno per tenant (il resto non parte)', async () => {
    for (const to of ['', 'x', 'a@b', 'due@example.com,tre@example.com', 'a b@example.com']) eq((await mail('officina', firma(officina), { ...ok1, to })).status, 400, to);
    inviate = []; let ultimo = 200; for (let i = 0; i < 40; i++) { ultimo = (await mail('altro', firma(altro), { ...ok1, link: 'https://altro.example.com/invito/' + TOK })).status; if (ultimo === 429) break; }
    eq([ultimo, inviate.length], [429, 30]);
  });
  await test('il primo admin: Super Admin crea l\'invito nel tenant (rotta interna) e, se c\'è il dominio, spedisce la mail; senza login no', async () => {
    let chiamate = []; client.callTenantAPI = async (slug, method, p, body) => { chiamate.push({ slug, method, p, body }); return { id: 1, token: TOK, scade: '2030-01-01', ore: 72 }; };
    const post = (slug, body, H = HA) => fetch(BASE + '/api/tenants/' + slug + '/invite', { method: 'POST', headers: H, body: JSON.stringify(body) });
    eq((await post('officina', {}, { 'Content-Type': 'application/json' })).status, 401); eq((await post('inesistente', {})).status, 404);
    inviate = []; let r = await post('officina', { nome: 'Cliente', email: 'cliente@example.com', invia_email: true }); eq(r.status, 200); let d = await r.json();
    eq(d.link, 'https://officina.example.com/invito/' + TOK); eq(d.mail, { sent: true }); eq([chiamate[0].slug, chiamate[0].p, chiamate[0].body.role], ['officina', '/api/internal-invite', 'admin']); eq(inviate[0].link, d.link);
    r = await post('senzadominio', { nome: 'X', email: 'x@example.com', invia_email: true }); d = await r.json(); eq(d.link, null); eq(d.mail.sent, false); ok(/dominio/.test(d.mail.reason)); ok(d.token, 'il link-token c\'è comunque, per WhatsApp/Telegram');
    r = await post('officina', { nome: 'X', invia_email: true }); eq((await r.json()).mail.sent, false, 'senza indirizzo');
    client.callTenantAPI = async () => { throw Object.assign(new Error('giù'), { status: 502 }); }; eq((await post('officina', { nome: 'X' })).status, 502);
    const audit = JSON.stringify(db.prepare('SELECT * FROM audit_log').all()); ok(!audit.includes(TOK), 'il token non finisce nell\'audit');
  });

  await test('il messaggio vero: testo fisso, nome e progetto resi innocui (niente HTML), senza posta configurata lo dice', async () => {
    eq((await originale({ to: 'a@example.com', nome: 'x', tenantName: 'T', link: 'https://t.example.com/invito/' + TOK, ore: 72 })).sent, false, 'SMTP spento di partenza');
    const nm = require('nodemailer'); let spedita = null; process.env.SMTP_HOST = 'smtp.test'; process.env.SMTP_FROM = 'noreply@test';
    nm.createTransport = () => ({ sendMail: async (m) => { spedita = m; } });
    const r = await originale({ to: 'a@example.com', nome: '<script>alert(1)</script>', tenantName: 'Officina <b>Rossi</b>', link: 'https://officina.example.com/invito/' + TOK, ore: 72 });
    eq(r.sent, true); ok(!/<script>|<b>Rossi/.test(spedita.html), 'HTML non ripulito: ' + spedita.html.slice(0, 300)); ok(spedita.html.includes('&lt;script&gt;'), 'deve essere escapato');
    ok(spedita.text.includes('https://officina.example.com/invito/' + TOK) && /una volta sola/.test(spedita.text) && /ignora questa mail/.test(spedita.text), 'testo fisso con link'); eq(spedita.to, 'a@example.com');
  });

  console.log(`\n${passed} passati, ${failed} falliti`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
