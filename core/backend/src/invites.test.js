'use strict';
// Inviti (invites.js, routes/invites.js): link monouso a 72 ore, solo l'impronta nel database, ruolo che esiste, password minima, uso atomico, revoca, dal Super Admin col secret interno,
// mail tramite Super Admin con token firmato dal tenant. Server vero, Super Admin simulato. Eseguire con: node src/invites.test.js (porta 34863 libera).
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const TEST_PORT = 34863, BASE = 'http://localhost:' + TEST_PORT;
process.env.DB_PATH = path.join(os.tmpdir(), 'invites-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'iv_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'iv_internal_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'iv_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-uploads-'));
process.env.SUPER_ADMIN_URL = 'http://sa.test';
process.env.TENANT_SLUG = 'officina';
let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); console.log('  ✓ ' + name); passed++; } catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; } }
const eq = (a, e, m) => { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${m || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m || 'atteso true'); };

const realFetch = global.fetch; let richieste = []; let risposta = { status: 200, body: { sent: true } }; let giu = false;
global.fetch = async (url, opt) => {
  if (!String(url).startsWith('http://sa.test')) return realFetch(url, opt);
  if (giu) throw new Error('rete giù');
  richieste.push({ url: String(url), headers: opt.headers, body: opt.body ? JSON.parse(opt.body) : null });
  return { ok: risposta.status < 400, status: risposta.status, json: async () => risposta.body };
};

async function main() {
  require('./index.js');
  for (let i = 0; i < 100; i++) { try { if ((await realFetch(BASE + '/health')).ok) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const db = require('./db'); const jwt = require('jsonwebtoken'); const bcrypt = require('bcryptjs');
  const login = async (u, p) => (await (await realFetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) })).json()).token;
  db.prepare("INSERT INTO users (username, password_hash, display_name, role) VALUES ('utente', ?, 'utente', 'user')").run(bcrypt.hashSync('utente_pw_1', 10));
  db.prepare("INSERT INTO roles (name, label, color) VALUES ('contabile', 'Contabile', '#111')").run();
  const HA = { Authorization: 'Bearer ' + await login('admin', 'iv_admin_pw'), 'Content-Type': 'application/json' };
  const HU = { Authorization: 'Bearer ' + await login('utente', 'utente_pw_1'), 'Content-Type': 'application/json' };
  const J = { 'Content-Type': 'application/json' };
  const crea = async (b = {}, H = HA) => realFetch(BASE + '/api/invites', { method: 'POST', headers: H, body: JSON.stringify({ nome: 'Mario Rossi', role: 'user', ...b }) });
  const usa = (t, b) => realFetch(BASE + '/api/public-invite/' + t, { method: 'POST', headers: J, body: JSON.stringify(b) });
  const stato = (t) => realFetch(BASE + '/api/public-invite/' + t);

  await test('solo un admin crea inviti; ruolo e email controllati', async () => {
    eq((await crea({}, { 'Content-Type': 'application/json' })).status, 401); eq((await crea({}, HU)).status, 403);
    eq((await crea({ role: 'superuser' })).status, 400); eq((await crea({ email: 'non-una-mail' })).status, 400);
    eq((await crea({ role: 'contabile' })).status, 200, 'un ruolo personalizzato esiste');
  });
  await test('nel database resta solo l\'impronta del token, mai il token; il token è lungo e diverso ogni volta', async () => {
    const a = await (await crea()).json(), b = await (await crea()).json();
    ok(a.token.length >= 40 && a.token !== b.token, 'token debole');
    const tutto = JSON.stringify(db.prepare('SELECT * FROM invites').all()) + JSON.stringify(db.prepare('SELECT * FROM audit_log').all());
    ok(!tutto.includes(a.token) && !tutto.includes(b.token), 'il token è finito nel database o nell\'audit');
    ok(Math.abs(new Date(a.scade).getTime() - (Date.now() + 72 * 3600 * 1000)) < 60000, 'scade in 72 ore');
  });
  await test('la pagina pubblica dice solo se è valido e a chi; un token inventato non rivela niente', async () => {
    const i = await (await crea({ nome: 'Anna' })).json(); const s = await (await stato(i.token)).json(); eq([s.valido, s.nome, s.ruolo], [true, 'Anna', 'user']);
    const r = await stato('inventato-' + crypto.randomBytes(8).toString('hex')); eq(r.status, 410); ok(!(await r.json()).valido);
  });
  await test('uso: nome utente e password controllati; l\'utente nasce col ruolo dell\'invito e può accedere', async () => {
    const i = await (await crea({ nome: 'Luca', role: 'contabile' })).json();
    eq((await usa(i.token, { username: 'lu', password: 'passwordlunga1' })).status, 400, 'nome troppo corto');
    eq((await usa(i.token, { username: 'luca', password: 'corta' })).status, 400, 'password corta');
    eq((await usa(i.token, { username: 'luca', password: 'luca' })).status, 400);
    eq((await usa(i.token, { username: 'admin', password: 'passwordlunga1' })).status, 409, 'nome già preso (anche con maiuscole diverse)');
    eq((await usa(i.token, { username: 'ADMIN', password: 'passwordlunga1' })).status, 409);
    eq((await stato(i.token)).status, 200, 'i tentativi falliti non consumano l\'invito');
    eq((await usa(i.token, { username: 'luca', password: 'passwordlunga1' })).status, 200);
    const u = db.prepare("SELECT role, display_name FROM users WHERE username = 'luca'").get(); eq([u.role, u.display_name], ['contabile', 'Luca']);
    ok(await login('luca', 'passwordlunga1'), 'deve poter entrare');
  });
  await test('monouso: dopo l\'uso il link non vale più, né per vedere né per usare', async () => {
    const i = await (await crea()).json(); await usa(i.token, { username: 'primo', password: 'passwordlunga1' });
    const r = await usa(i.token, { username: 'secondo', password: 'passwordlunga1' }); eq(r.status, 410); ok(/già stato usato/.test((await r.json()).error));
    eq((await stato(i.token)).status, 410); eq(db.prepare("SELECT COUNT(*) c FROM users WHERE username IN ('primo','secondo')").get().c, 1);
  });
  await test('due persone con lo stesso link nello stesso momento: ne passa una sola', async () => {
    const i = await (await crea()).json();
    const rs = await Promise.all([usa(i.token, { username: 'gara_a', password: 'passwordlunga1' }), usa(i.token, { username: 'gara_b', password: 'passwordlunga1' })]);
    eq(rs.map((r) => r.status).sort(), [200, 410]); eq(db.prepare("SELECT COUNT(*) c FROM users WHERE username LIKE 'gara_%'").get().c, 1);
  });
  await test('scaduto e annullato non si usano; l\'elenco mostra lo stato', async () => {
    const e = await (await crea({ nome: 'Scaduto' })).json(); db.prepare("UPDATE invites SET expires_at = datetime('now', '-1 hour') WHERE id = ?").run(e.id);
    eq((await usa(e.token, { username: 'scaduto', password: 'passwordlunga1' })).status, 410); ok(/scaduto/.test((await (await stato(e.token)).json()).motivo));
    const a = await (await crea({ nome: 'Annullato' })).json();
    eq((await realFetch(BASE + '/api/invites/' + a.id, { method: 'DELETE', headers: HU })).status, 403); eq((await realFetch(BASE + '/api/invites/' + a.id, { method: 'DELETE', headers: HA })).status, 200);
    eq((await usa(a.token, { username: 'annullato', password: 'passwordlunga1' })).status, 410); eq((await realFetch(BASE + '/api/invites/' + a.id, { method: 'DELETE', headers: HA })).status, 404, 'già annullato');
    const el = await (await realFetch(BASE + '/api/invites', { headers: HA })).json(); eq(el.find((x) => x.id === e.id).stato, 'scaduto'); eq(el.find((x) => x.id === a.id).stato, 'annullato'); ok(!JSON.stringify(el).includes('token'), 'l\'elenco non contiene token');
    eq((await realFetch(BASE + '/api/invites', { headers: HU })).status, 403);
  });
  await test('da Super Admin col secret interno: crea un invito per il primo admin; senza secret no', async () => {
    eq((await realFetch(BASE + '/api/internal-invite', { method: 'POST', headers: J, body: '{}' })).status, 401);
    eq((await realFetch(BASE + '/api/internal-invite', { method: 'POST', headers: { ...J, 'x-internal-secret': 'sbagliato' }, body: '{}' })).status, 401);
    const r = await realFetch(BASE + '/api/internal-invite', { method: 'POST', headers: { ...J, 'x-internal-secret': process.env.INTERNAL_API_SECRET }, body: JSON.stringify({ nome: 'Cliente' }) }); eq(r.status, 200);
    const d = await r.json(); eq((await (await stato(d.token)).json()).ruolo, 'admin', 'di partenza admin');
  });
  await test('mail: parte da Super Admin con il token firmato dal tenant, messaggio con il link giusto; se non può, lo dice e l\'invito resta valido', async () => {
    richieste = []; risposta = { status: 200, body: { sent: true } };
    const r = await (await crea({ nome: 'Paola', email: 'paola@example.com', invia_email: true, link_base: 'https://officina.example.com/' })).json();
    eq(r.email, { sent: true, reason: null }); const q = richieste[0];
    eq(q.url, 'http://sa.test/api/tenant-invite/officina/mail'); eq([q.body.to, q.body.nome], ['paola@example.com', 'Paola']); eq(q.body.link, 'https://officina.example.com/invito/' + r.token);
    const t = jwt.verify(q.headers.Authorization.replace('Bearer ', ''), process.env.JWT_SECRET); eq([t.slug, t.purpose], ['officina', 'invite-mail']);
    ok(!JSON.stringify(q.headers).includes(process.env.INTERNAL_API_SECRET), 'il segreto condiviso non serve');
    risposta = { status: 502, body: { error: 'SMTP non configurato' } }; let x = await (await crea({ email: 'a@example.com', invia_email: true, link_base: 'https://x.example.com' })).json(); eq(x.email.sent, false); ok(/SMTP/.test(x.email.reason)); ok(x.token);
    giu = true; x = await (await crea({ email: 'a@example.com', invia_email: true, link_base: 'https://x.example.com' })).json(); eq(x.email.sent, false); ok(/non è raggiungibile/.test(x.email.reason)); giu = false;
    eq((await (await crea({ invia_email: true, link_base: 'https://x.example.com' })).json()).email.sent, false, 'senza indirizzo non parte');
    eq((await (await crea({ email: 'a@example.com', invia_email: true, link_base: 'javascript:alert(1)' })).json()).email.sent, false, 'indirizzo del progetto non valido');
  });

  console.log(`\n${passed} passati, ${failed} falliti`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
