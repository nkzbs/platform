'use strict';
// Segreti a riposo (secrets-at-rest.js): credenziali dei collegamenti e segreti del 2FA stanno CIFRATI nel database; il vecchio formato in chiaro si legge ancora e si migra. Server reale, DB temporaneo.
// Server reale, DB temporaneo. Eseguire con: node src/secrets-at-rest.test.js (porta 34820).

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const TEST_PORT = 34820;
const BASE = 'http://localhost:' + TEST_PORT;
const dbPath = path.join(os.tmpdir(), 'segreti-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.DB_PATH = dbPath;
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'segreti_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'segreti_internal_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'segreti_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'segreti-uploads-'));
process.env.SUPER_ADMIN_URL = 'http://localhost:1';
process.env.TENANT_SLUG = 'segreti';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; }
}
const eq = (a, e, msg) => { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${msg || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); };
const ok = (c, msg) => { if (!c) throw new Error(msg || 'atteso true'); };
const realFetch = global.fetch;
global.fetch = async (url, opt) => {
  if (String(url).startsWith('https://api.telegram.org/bot')) { const m = String(url).split('/').pop(); return { status: 200, json: async () => ({ ok: true, result: m === 'getMe' ? { username: 'finance_test_bot' } : true }) }; }
  return realFetch(url, opt);
};

async function main() {
  require('./index.js');
  for (let i = 0; i < 100; i++) { try { if ((await realFetch(BASE + '/health')).ok) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const db = require('./db'); const sar = require('./secrets-at-rest'); const { authenticator } = require('otplib'); const bcrypt = require('bcryptjs');
  const login = await (await realFetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: process.env.INITIAL_ADMIN_PASSWORD }) })).json();
  const H = { Authorization: 'Bearer ' + login.token, 'Content-Type': 'application/json' };
  const raw = (id) => (db.prepare('SELECT credentials FROM connections WHERE integration_id = ?').get(id) || {}).credentials;

  console.log('\n--- cifrare e leggere ---');
  await test('un oggetto si cifra e si rilegge identico; il testo cifrato non contiene i valori', () => {
    const o = { client_secret: 'GOCSPX-segretissimo', refresh_token: '1//rt-token', n: 3 }; const s = sar.seal(o);
    ok(s.startsWith('enc:') && !s.includes('GOCSPX') && !s.includes('rt-token'), s); eq(sar.unseal(s), o);
  });
  await test('il vecchio formato in chiaro si legge ancora; testo rovinato, vuoto o non JSON: nessun segreto, mai un errore usato come valore', () => {
    eq(sar.unseal('{"api_key":"abc"}'), { api_key: 'abc' }); eq(sar.unseal(null), null); eq(sar.unseal(''), null); eq(sar.unseal('non json'), null); eq(sar.unseal('[1,2]'), null);
    const s = sar.seal({ a: 1 }); const rovinato = s.slice(0, -3) + (s.endsWith('aaa') ? 'bbb' : 'aaa'); eq(sar.unseal(rovinato), null, 'manomesso → assente');
    eq(sar.unsealText('JBSWY3DP'), 'JBSWY3DP'); eq(sar.unsealText(sar.sealText('JBSWY3DP')), 'JBSWY3DP'); eq(sar.unsealText(sar.sealText('X').slice(0, -2) + 'zz'), null);
  });

  console.log('\n--- la migrazione di un database vecchio ---');
  await test('cifra le credenziali e i segreti 2FA ancora in chiaro, senza cambiarne il contenuto; la seconda volta non fa niente', () => {
    db.prepare("INSERT OR REPLACE INTO connections (integration_id, connected, credentials) VALUES ('google', 1, ?), ('whatsapp_callmebot', 1, ?)").run(JSON.stringify({ client_secret: 'S3', access_token: 'AT', refresh_token: 'RT' }), JSON.stringify({ api_key: 'WA-KEY-123' }));
    db.prepare("INSERT OR REPLACE INTO connections (integration_id, connected, credentials) VALUES ('rotto', 0, 'questo non è JSON')").run();
    db.prepare("INSERT INTO users (id, username, password_hash, role, totp_secret, totp_enabled) VALUES (50, 'vecchio2fa', 'x', 'user', 'JBSWY3DPEHPK3PXP', 1)").run();
    const m = sar.migrate(); eq([m.connessioni, m.totp, m.falliti], [2, 1, 1], JSON.stringify(m));
    ok(raw('google').startsWith('enc:') && !raw('google').includes('RT') && raw('whatsapp_callmebot').startsWith('enc:'));
    eq(sar.unseal(raw('google')), { client_secret: 'S3', access_token: 'AT', refresh_token: 'RT' }); eq(sar.unseal(raw('whatsapp_callmebot')).api_key, 'WA-KEY-123');
    eq(raw('rotto'), 'questo non è JSON', 'una riga illeggibile non si tocca');
    const t = db.prepare('SELECT totp_secret FROM users WHERE id = 50').get().totp_secret; ok(t.startsWith('enc:') && !t.includes('JBSWY3DP')); eq(sar.unsealText(t), 'JBSWY3DPEHPK3PXP');
    const m2 = sar.migrate(); eq([m2.connessioni, m2.totp], [0, 0], 'idempotente');
  });

  console.log('\n--- i punti dell\'app che usano i segreti ---');
  await test('salvare le credenziali di WhatsApp le cifra; la lista le maschera; il messaggio di prova le legge ancora', async () => {
    eq((await realFetch(BASE + '/api/connections/whatsapp_callmebot/credentials', { method: 'PUT', headers: H, body: JSON.stringify({ api_key: 'CHIAVE-NUOVA-777' }) })).status, 200);
    ok(raw('whatsapp_callmebot').startsWith('enc:') && !raw('whatsapp_callmebot').includes('CHIAVE-NUOVA'), 'cifrata nel database');
    const lista = await (await realFetch(BASE + '/api/connections', { headers: H })).json(); const wa = lista.find((c) => c.id === 'whatsapp_callmebot');
    ok(wa && wa.credentials_set === true && JSON.stringify(wa).indexOf('CHIAVE-NUOVA') < 0, JSON.stringify(wa));
    const t = await realFetch(BASE + '/api/connections/whatsapp_callmebot/test', { method: 'POST', headers: H, body: '{}' }); const j = await t.json();
    ok(!/Collega prima WhatsApp/.test(j.error || ''), 'la chiave si legge: ' + JSON.stringify(j));
  });
  await test('Google: client id e segreto salvati cifrati; una seconda modifica li rilegge e li fonde', async () => {
    db.prepare("DELETE FROM connections WHERE integration_id = 'google'").run(); db.prepare("INSERT INTO connections (integration_id, connected, credentials) VALUES ('google', 0, ?)").run(sar.seal({}));
    await realFetch(BASE + '/api/integrazioni/google/config', { method: 'PUT', headers: H, body: JSON.stringify({ client_id: 'ID-1', client_secret: 'SEG-1' }) });
    await realFetch(BASE + '/api/integrazioni/google/drive', { method: 'PUT', headers: H, body: JSON.stringify({ enabled: true }) });
    ok(raw('google').startsWith('enc:') && !raw('google').includes('SEG-1'), 'cifrato'); eq(sar.unseal(raw('google')), { client_id: 'ID-1', client_secret: 'SEG-1', drive_enabled: true });
    await realFetch(BASE + '/api/integrazioni/google/disconnect', { method: 'POST', headers: H, body: '{}' });
    const dopo = sar.unseal(raw('google')); eq([dopo.client_id, dopo.client_secret, dopo.drive_enabled, dopo.access_token], ['ID-1', 'SEG-1', true, undefined], 'scollegare toglie i token e tiene le scelte');
  });
  await test('Telegram: il bot si collega e tutto il suo JSON (token e segreto del webhook) sta cifrato', async () => {
    const tg = require('./telegram'); await tg.connect('123456789:' + 'A'.repeat(35), 'https://finance.example.it');
    const r = raw('telegram'); ok(r.startsWith('enc:') && !r.includes('AAAAAAAAAA') && !r.includes('secret'), r); eq(tg.status().bot_username, 'finance_test_bot');
    const sec = sar.unseal(r).secret; ok(tg.secretMatches(sec) && !tg.secretMatches('altro'));
  });

  console.log('\n--- il 2FA ---');
  await test('attivare il 2FA salva il segreto cifrato; il codice dell\'app continua a funzionare, al login e alla conferma', async () => {
    const hash = bcrypt.hashSync('pw_di_prova_123', 4); db.prepare("INSERT INTO users (id, username, password_hash, role) VALUES (60, 'dueefa', ?, 'user')").run(hash);
    const tok = (await (await realFetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'dueefa', password: 'pw_di_prova_123' }) })).json()).token;
    const HU = { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' };
    const setup = await (await realFetch(BASE + '/api/auth/2fa/setup', { method: 'POST', headers: HU, body: '{}' })).json();
    const nel = db.prepare('SELECT totp_secret FROM users WHERE id = 60').get().totp_secret; ok(nel.startsWith('enc:') && !nel.includes(setup.secret), 'cifrato nel database');
    eq((await realFetch(BASE + '/api/auth/2fa/confirm', { method: 'POST', headers: HU, body: JSON.stringify({ code: '000000' }) })).status, 400, 'codice sbagliato');
    eq((await realFetch(BASE + '/api/auth/2fa/confirm', { method: 'POST', headers: HU, body: JSON.stringify({ code: authenticator.generate(setup.secret) }) })).status, 200);
    const l = await (await realFetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'dueefa', password: 'pw_di_prova_123' }) })).json(); ok(l.needs_2fa, 'chiede il codice');
    const v = await realFetch(BASE + '/api/auth/login/2fa-verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pending_token: l.pending_token, code: authenticator.generate(setup.secret) }) }); eq(v.status, 200);
    const sbagliato = await realFetch(BASE + '/api/auth/login/2fa-verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pending_token: l.pending_token, code: '123456' }) }); eq(sbagliato.status, 401);
  });
  await test('con il 2FA già attivo non si può rifare «setup» (cambierebbe il segreto in uso e chiuderebbe fuori l\'utente)', async () => {
    const tok = (await (await realFetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: process.env.INITIAL_ADMIN_PASSWORD }) })).json()).token;
    db.prepare("UPDATE users SET totp_enabled = 1 WHERE username = 'admin'").run();
    eq((await realFetch(BASE + '/api/auth/2fa/setup', { method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: '{}' })).status, 409);
    db.prepare("UPDATE users SET totp_enabled = 0 WHERE username = 'admin'").run();
  });
  await test('un utente con il segreto ancora IN CHIARO (database vecchio) entra lo stesso, prima e dopo la migrazione', async () => {
    const hash = bcrypt.hashSync('pw_di_prova_123', 4); const secret = authenticator.generateSecret();
    db.prepare("INSERT INTO users (id, username, password_hash, role, totp_secret, totp_enabled, totp_backup_codes) VALUES (61, 'legacy', ?, 'user', ?, 1, '[]')").run(hash, secret);
    const entra = async () => { const l = await (await realFetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'legacy', password: 'pw_di_prova_123' }) })).json();
      return (await realFetch(BASE + '/api/auth/login/2fa-verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pending_token: l.pending_token, code: authenticator.generate(secret) }) })).status; };
    eq(await entra(), 200, 'in chiaro'); sar.migrate(); ok(db.prepare('SELECT totp_secret FROM users WHERE id = 61').get().totp_secret.startsWith('enc:')); eq(await entra(), 200, 'dopo la migrazione');
  });

  console.log(`\n${'='.repeat(60)}`);
  console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
  try { fs.unlinkSync(dbPath); } catch (e) {}
  process.exit(failed > 0 ? 1 : 0);
}
main().catch((e) => { console.error('Suite secrets-at-rest fallita ad avviarsi:', e); process.exit(1); });
