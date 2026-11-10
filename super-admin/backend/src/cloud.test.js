'use strict';
// Impostazioni → Server (Linode): token sigillato, controllo a sole letture, nessuna scrittura su Linode. Linode è simulato.
// Eseguire con: node src/cloud.test.js (porta 34861 libera).
const path = require('path'), os = require('os'), crypto = require('crypto');
const TEST_PORT = 34861, BASE = 'http://localhost:' + TEST_PORT;
process.env.DB_PATH = path.join(os.tmpdir(), 'cloud-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'cl_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'cl_internal_' + crypto.randomBytes(8).toString('hex');
process.env.ENCRYPTION_KEY = 'cl_enc_' + crypto.randomBytes(8).toString('hex');

let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); console.log('  ✓ ' + name); passed++; } catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; } }
const eq = (a, e, m) => { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${m || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m || 'atteso true'); };

const BUONO = 'token-linode-buono-1234567890', SENZA_ACCOUNT = 'token-linode-senza-account-123456', SBAGLIATO = 'token-linode-sbagliato-1234567';
const CF_BUONO = 'cf-token-buono-1234567890abcd', CF_SENZA_DNS = 'cf-token-senza-dns-1234567890', CF_SBAGLIATO = 'cf-token-sbagliato-12345678901', ZONA = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const realFetch = global.fetch; const chiamate = [];
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.startsWith('https://api.cloudflare.com/client/v4')) {
    const tok = ((opts.headers || {}).Authorization || '').replace('Bearer ', ''); const p = u.replace('https://api.cloudflare.com/client/v4', '');
    chiamate.push({ metodo: opts.method || 'GET', p, tok });
    const r = (status, body) => ({ ok: status < 400, status, json: async () => body });
    if (p === '/user/tokens/verify') return tok === CF_SBAGLIATO ? r(401, { success: false, errors: [{ message: 'Invalid API Token' }] }) : r(200, { success: true, result: { status: 'active' } });
    if (p === '/zones/' + ZONA) return r(200, { success: true, result: { name: 'platform-core.it', status: 'active' } });
    if (p.startsWith('/zones/' + ZONA + '/dns_records')) return tok === CF_SENZA_DNS ? r(403, { success: false, errors: [{ message: 'forbidden' }] }) : r(200, { success: true, result: [{ name: 'finance.platform-core.it', type: 'A', content: '1.2.3.4', proxied: true }], result_info: { total_count: 1 } });
    if (p === '/zones/' + ZONA + '/settings/ssl') return tok === CF_BUONO ? r(200, { success: true, result: { value: 'strict' } }) : r(403, { success: false, errors: [{ message: 'forbidden' }] });
    return r(404, { success: false, errors: [{ message: 'non trovato' }] });
  }
  if (!u.startsWith('https://api.linode.com/v4')) return realFetch(url, opts);
  const tok = ((opts.headers || {}).Authorization || '').replace('Bearer ', ''); const p = u.replace('https://api.linode.com/v4', '');
  chiamate.push({ metodo: opts.method || 'GET', p, tok });
  const r = (status, body) => ({ ok: status < 400, status, json: async () => body });
  if (p.startsWith('/regions/')) return r(p === '/regions/it-mil' ? 200 : 404, { label: 'Milan, IT', country: 'it' });
  if (p.startsWith('/linode/types/')) return r(200, { label: 'Nanode 1GB', memory: 1024, disk: 25600, price: { monthly: 5 }, addons: { backups: { price: { monthly: 2 } } } });
  if (tok === SBAGLIATO) return r(401, { errors: [{ reason: 'Invalid Token' }] });
  if (p.startsWith('/linode/instances')) return r(200, { data: [{ id: 7, label: 'plt-test', status: 'running', region: 'it-mil', type: 'g6-nanode-1', ipv4: ['172.232.204.88'], backups: { enabled: false } }] });
  if (p === '/account') return tok === SENZA_ACCOUNT ? r(403, { errors: [{ reason: 'Unauthorized' }] }) : r(200, { balance: 0, balance_uninvoiced: 1.5 });
  return r(404, {});
};

async function main() {
  require('./index.js');
  for (let i = 0; i < 100; i++) { try { const r = await realFetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); if (r.status) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const db = require('./db'); const bcrypt = require('bcryptjs');
  db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('cl_user', ?, 'admin')").run(bcrypt.hashSync('cl_pw_123456', 10));
  const login = await realFetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'cl_user', password: 'cl_pw_123456' }) });
  const H = { Authorization: 'Bearer ' + (await login.json()).token, 'Content-Type': 'application/json' };
  const api = (m, p, b, h = H) => realFetch(BASE + '/api/cloud' + p, { method: m, headers: h, body: b ? JSON.stringify(b) : undefined });

  await test('senza accesso: 401; all\'inizio nessun token e valori di partenza Milano + Nanode', async () => {
    eq((await api('GET', '', null, {})).status, 401);
    eq(await (await api('GET', '')).json(), { configurato: false, hint: null, regione: 'it-mil', tipo: 'g6-nanode-1' });
  });
  await test('un token che Linode rifiuta, o troppo corto, NON viene salvato', async () => {
    eq((await api('PUT', '/token', { token: SBAGLIATO })).status, 400);
    eq((await api('PUT', '/token', { token: 'corto' })).status, 400);
    eq((await (await api('GET', '')).json()).configurato, false);
  });
  await test('token valido: salvato cifrato, si vedono solo le ultime 4 cifre', async () => {
    const res = await api('PUT', '/token', { token: BUONO }); eq(res.status, 200);
    const j = await res.json(); eq(j.configurato, true); eq(j.hint, '…7890'); ok(!JSON.stringify(j).includes(BUONO), 'il token non deve comparire');
    const grezzo = db.prepare("SELECT value FROM cloud_settings WHERE key = 'linode_token'").get().value; ok(!grezzo.includes(BUONO), 'nel database deve essere cifrato');
  });
  await test('controlla: server, saldo, regione e tipo con prezzi; solo richieste GET', async () => {
    chiamate.length = 0;
    const c = await (await api('POST', '/controlla')).json();
    eq(c.ok, true); eq(c.server[0].nome, 'plt-test'); eq(c.server[0].ip, '172.232.204.88'); eq(c.saldo.uninvoiced, 1.5);
    eq(c.regione.nome, 'Milan, IT'); eq(c.tipo.prezzo_mese, 5); eq(c.tipo.backup_mese, 2);
    ok(chiamate.length >= 3 && chiamate.every((x) => x.metodo === 'GET'), 'solo letture: ' + JSON.stringify(chiamate));
    ok(!JSON.stringify(c).includes(BUONO), 'il token non esce');
  });
  await test('senza il permesso «Account» il controllo riesce lo stesso e lo dice', async () => {
    await api('PUT', '/token', { token: SENZA_ACCOUNT });
    const c = await (await api('POST', '/controlla')).json();
    eq(c.ok, true); eq(c.saldo, null); ok(c.avvisi.some((a) => /Account/.test(a)), JSON.stringify(c.avvisi));
  });
  await test('regione e tipo: si cambiano, valori strani rifiutati', async () => {
    eq((await api('PUT', '/impostazioni', { regione: 'de-fra' })).status, 200);
    eq((await (await api('GET', '')).json()).regione, 'de-fra');
    eq((await api('PUT', '/impostazioni', { regione: 'x; rm -rf' })).status, 400);
    const c = await (await api('POST', '/controlla')).json(); ok(c.regione.avviso, 'regione non trovata nel catalogo');
  });
  await test('togliere il token: il controllo dice di incollarlo', async () => {
    eq((await (await api('DELETE', '/token')).json()).configurato, false);
    const c = await (await api('POST', '/controlla')).json(); eq(c.ok, false); ok(/token/i.test(c.motivo));
  });
  await test('Cloudflare: token sbagliato rifiutato, buono salvato cifrato; la zona manca finché non la scrivi', async () => {
    const cfApi = (m, p, b) => api(m, '/cloudflare' + p, b);
    eq((await cfApi('PUT', '/token', { token: CF_SBAGLIATO })).status, 400);
    const j = await (await cfApi('PUT', '/token', { token: CF_BUONO })).json(); eq(j.configurato, true); eq(j.hint, '…abcd'); ok(!JSON.stringify(j).includes(CF_BUONO));
    ok(!db.prepare("SELECT value FROM cloud_settings WHERE key = 'cloudflare_token'").get().value.includes(CF_BUONO), 'cifrato');
    const c0 = await (await cfApi('POST', '/controlla')).json(); eq(c0.token.ok, true); ok(c0.avvisi.some((a) => /ID della zona/.test(a)), JSON.stringify(c0));
    eq((await cfApi('PUT', '/impostazioni', { zona: 'non-valida' })).status, 400);
    eq((await cfApi('PUT', '/impostazioni', { zona: ZONA })).status, 200);
  });
  await test('Cloudflare: controllo completo a sole letture (zona, record, SSL strict)', async () => {
    chiamate.length = 0;
    const c = await (await api('POST', '/cloudflare/controlla')).json();
    eq(c.ok, true); eq(c.zona.nome, 'platform-core.it'); eq(c.record.totale, 1); eq(c.record.nomi[0].proxy, true); eq(c.ssl, 'strict'); eq(c.avvisi, []);
    ok(chiamate.length >= 4 && chiamate.every((x) => x.metodo === 'GET'), JSON.stringify(chiamate));
  });
  await test('Cloudflare: senza permesso DNS o SSL il controllo riesce e lo dice; token tolto: messaggio', async () => {
    await api('PUT', '/cloudflare/token', { token: CF_SENZA_DNS });
    const c = await (await api('POST', '/cloudflare/controlla')).json();
    eq(c.ok, true); eq(c.record, null); ok(c.avvisi.some((a) => /DNS/.test(a)) && c.avvisi.some((a) => /SSL/.test(a)), JSON.stringify(c.avvisi));
    await api('DELETE', '/cloudflare/token');
    const d = await (await api('POST', '/cloudflare/controlla')).json(); eq(d.ok, false); ok(/token/i.test(d.motivo));
  });
  console.log(`\n${passed} passati, ${failed} falliti`); process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
