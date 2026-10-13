'use strict';
// Chiave Mistral per tenant (lib/ai-key.js, routes/tenant-ai.js /key) e tetto di spesa per tenant.
// Mistral è simulato. Eseguire con: node src/ai-key.test.js (richiede la porta 34798 libera).

const path = require('path');
const os = require('os');
const crypto = require('crypto');

const TEST_PORT = 34798;
const BASE = 'http://localhost:' + TEST_PORT;
const SECRET = 'ai_key_internal_' + crypto.randomBytes(8).toString('hex');
process.env.DB_PATH = path.join(os.tmpdir(), 'ai-key-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'ai_key_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = SECRET;
process.env.ENCRYPTION_KEY = 'ai_key_enc_' + crypto.randomBytes(8).toString('hex');
process.env.AI_MONTHLY_BUDGET_EUR = '1';
delete process.env.MISTRAL_API_KEY; // di partenza nessuna chiave generale

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; }
}
function assertEq(a, e, msg) { if (a !== e) throw new Error(`${msg || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); }
function assertTrue(c, msg) { if (!c) throw new Error(msg || 'atteso true'); }

const GOOD = 'chiave-buona-finance-123456';
const OTHER = 'chiave-buona-timbrature-98765';
const realFetch = global.fetch;
let mistralChat = []; // { key, body }
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  const key = ((opts.headers || {}).Authorization || '').replace('Bearer ', '');
  if (u === 'https://api.mistral.ai/v1/models') return { ok: key === GOOD || key === OTHER || key === 'chiave-generale-super-admin', status: key === 'SOLO-401-' + 'x' ? 401 : (key === GOOD || key === OTHER || key === 'chiave-generale-super-admin') ? 200 : 401, json: async () => ({}) };
  if (u === 'https://api.mistral.ai/v1/chat/completions') {
    mistralChat.push({ key, body: JSON.parse(opts.body) });
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"modulo":"spese_casa","categoria":"Gas","fornitore":"X","importo":10,"scadenza":null,"confidenza":"alta"}' } }], usage: { prompt_tokens: 1000000, completion_tokens: 1000000 } }) };
  }
  return realFetch(url, opts);
};

const MODULI = { spese_casa: { categorie: ['Gas', 'Altro'] } };
const bill = (slug) => ({ tenant_slug: slug, data: { mittente: 'X', oggetto: 'Bolletta', testo: 'Importo 10', moduli: MODULI, modulo_attuale: 'spese_casa' } });

async function main() {
  require('./index.js');
  for (let i = 0; i < 100; i++) { try { const r = await realFetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); if (r.status) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const db = require('./db');
  const aiKey = require('./lib/ai-key');
  db.prepare("INSERT INTO tenants (name, slug, port, db_path, status) VALUES ('Finance', 'finance', 47401, '/x/f.db', 'active'), ('Timbrature', 'timbrature', 47402, '/x/t.db', 'active')").run();
  const api = (m, p, body, secret = SECRET) => realFetch(BASE + '/api/tenant-ai' + p, { method: m, headers: { 'Content-Type': 'application/json', 'x-internal-secret': secret }, body: body ? JSON.stringify(body) : undefined });

  console.log('\n--- salvare la chiave ---');

  await test('all\'inizio nessuna chiave: stato "non configurata"', async () => {
    const s = await (await api('GET', '/key?tenant_slug=finance')).json();
    assertEq(s.configured, false);
  });

  await test('senza secret interno -> 401', async () => { assertEq((await api('PUT', '/key', { tenant_slug: 'finance', key: GOOD }, 'no')).status, 401); });

  await test('tenant sconosciuto -> 404; chiave troppo corta o con spazi -> 400', async () => {
    assertEq((await api('PUT', '/key', { tenant_slug: 'nessuno', key: GOOD })).status, 404);
    assertEq((await api('PUT', '/key', { tenant_slug: 'finance', key: 'corta' })).status, 400);
    assertEq((await api('PUT', '/key', { tenant_slug: 'finance', key: 'con spazi dentro la chiave' })).status, 400);
  });

  await test('una chiave che Mistral rifiuta NON viene salvata', async () => {
    const res = await api('PUT', '/key', { tenant_slug: 'finance', key: 'chiave-sbagliata-123456' });
    assertEq(res.status, 400);
    assertEq(aiKey.getTenantKey('finance'), null);
  });

  await test('chiave valida: salvata, e lo stato mostra solo le ultime 4 cifre', async () => {
    const res = await api('PUT', '/key', { tenant_slug: 'finance', key: GOOD });
    const body = await res.json();
    assertEq(res.status, 200);
    assertEq(body.configured, true);
    assertEq(body.source, 'tenant');
    assertEq(body.hint, '…3456');
    assertTrue(!JSON.stringify(body).includes(GOOD), 'la chiave non deve mai tornare indietro');
    const again = JSON.stringify(await (await api('GET', '/key?tenant_slug=finance')).json());
    assertTrue(!again.includes(GOOD));
  });

  await test('nel database la chiave è cifrata, non in chiaro', () => {
    const raw = db.prepare("SELECT mistral_key FROM tenant_ai_keys WHERE tenant_slug = 'finance'").get().mistral_key;
    assertTrue(raw.startsWith('enc:') && !raw.includes(GOOD), raw);
  });

  await test('un altro tenant non vede la chiave di Finance', async () => {
    assertEq((await (await api('GET', '/key?tenant_slug=timbrature')).json()).configured, false);
  });

  console.log('\n--- uso della chiave e tetto per tenant ---');

  await test('le chiamate di Finance partono con la chiave di Finance', async () => {
    mistralChat = [];
    const res = await api('POST', '/classify-bill', bill('finance'));
    assertEq(res.status, 200);
    assertEq(mistralChat[0].key, GOOD);
  });

  await test('un tenant senza chiave (e senza chiave generale) riceve un errore chiaro e Mistral non è contattato', async () => {
    mistralChat = [];
    const res = await api('POST', '/classify-bill', bill('timbrature'));
    const body = await res.json();
    assertEq(res.status, 503);
    assertEq(body.code, 'ai_not_configured');
    assertEq(mistralChat.length, 0);
  });

  await test('Finance ha speso oltre il tetto (1 €): le sue chiamate si fermano', async () => {
    // la chiamata di prima ha già consumato 1M+1M token = 0,64 €; una seconda supera 1 €
    await api('POST', '/classify-bill', bill('finance'));
    mistralChat = [];
    const res = await api('POST', '/classify-bill', bill('finance'));
    assertEq(res.status, 429);
    assertEq(mistralChat.length, 0);
    const b = await (await api('GET', '/budget?tenant_slug=finance')).json();
    assertEq(b.blocked, true);
  });

  await test('...ma il tetto di un altro tenant è a parte: Timbrature, con la sua chiave, non è bloccata', async () => {
    assertEq((await api('PUT', '/key', { tenant_slug: 'timbrature', key: OTHER })).status, 200);
    mistralChat = [];
    assertEq((await api('POST', '/classify-bill', bill('timbrature'))).status, 200);
    assertEq(mistralChat[0].key, OTHER);
    assertEq((await (await api('GET', '/budget?tenant_slug=timbrature')).json()).blocked, false);
  });

  await test('gli avvisi dell\'80% e del 100% sono separati per tenant', async () => {
    const n = (slug) => db.prepare("SELECT COUNT(*) c FROM ai_budget_alerts WHERE month LIKE ?").get('%|' + slug).c;
    assertTrue(n('finance') >= 1, 'Finance ha superato il tetto');
    assertEq(n('timbrature'), 0, 'Timbrature no');
  });

  console.log('\n--- chiave generale e rimozione ---');

  await test('togliendo la chiave di Finance, senza chiave generale non può più chiamare', async () => {
    const res = await api('DELETE', '/key', { tenant_slug: 'finance' });
    assertEq(res.status, 200);
    assertEq((await res.json()).configured, false);
    assertEq(aiKey.getTenantKey('finance'), null);
  });

  await test('con una chiave generale di Super Admin, un tenant senza chiave sua la usa (ripiego)', async () => {
    process.env.MISTRAL_API_KEY = 'chiave-generale-super-admin';
    const s = await (await api('GET', '/key?tenant_slug=finance')).json();
    assertEq(s.source, 'generale');
    assertEq(s.hint, null);
    mistralChat = [];
    db.prepare("DELETE FROM ai_usage_log WHERE tenant_slug = 'finance'").run(); // nuovo mese per il test
    assertEq((await api('POST', '/classify-bill', bill('finance'))).status, 200);
    assertEq(mistralChat[0].key, 'chiave-generale-super-admin');
  });

  await test('CHIAVE SEPARATA di Super Admin: sua e basta, mai usata da un tenant; cifrata; non compare nel quadro', async () => {
    const ADMIN = 'chiave-buona-finance-123456'; // una chiave valida per la prova
    assertEq(aiKey.keyFor(null), 'chiave-generale-super-admin', 'senza chiave sua, Super Admin usa la generale');
    aiKey.setAdminKey(ADMIN);
    assertEq(aiKey.keyFor(null), ADMIN, 'ora Super Admin usa la sua');
    assertEq(aiKey.keyFor('finance'), 'chiave-generale-super-admin', 'il tenant senza chiave sua NON usa quella di Super Admin');
    assertEq(aiKey.keyFor('qualunque-altro'), 'chiave-generale-super-admin');
    const raw = db.prepare('SELECT mistral_key FROM tenant_ai_keys WHERE tenant_slug = ?').get(aiKey.ADMIN_SLUG).mistral_key;
    assertTrue(raw && !raw.includes(ADMIN), 'salvata cifrata');
    const o = aiKey.overview(); assertEq(o.admin.source, 'admin'); assertEq(o.admin.hint, '…3456'); assertTrue(!JSON.stringify(o).includes(ADMIN), 'la chiave non esce');
    assertTrue(!o.tenant_con_chiave_propria.includes(aiKey.ADMIN_SLUG), 'la riga di Super Admin non è un tenant');
    aiKey.clearAdminKey(); assertEq(aiKey.keyFor(null), 'chiave-generale-super-admin');
  });
  await test('RIPIEGO SPENTO: un tenant senza chiave sua non ha AI (errore chiaro, Mistral non contattato); con chiave propria funziona; Super Admin non cambia', async () => {
    aiKey.setFallback(false);
    assertEq(aiKey.keyFor('finance'), null); assertEq(aiKey.keyStatus('finance').configured, false);
    assertEq(aiKey.keyFor(null), 'chiave-generale-super-admin', 'Super Admin continua');
    mistralChat = []; const r = await api('POST', '/classify-bill', bill('finance'));
    assertEq(r.status, 503); assertEq((await r.json()).code, 'ai_not_configured'); assertEq(mistralChat.length, 0);
    aiKey.setTenantKey('finance', GOOD); assertEq(aiKey.keyFor('finance'), GOOD);
    aiKey.clearTenantKey('finance'); aiKey.setFallback(true); assertEq(aiKey.keyFor('finance'), 'chiave-generale-super-admin', 'riacceso: torna il ripiego');
  });
  await test('i consumi sono registrati con il tenant che li ha fatti', () => {
    assertTrue(db.prepare("SELECT COUNT(*) c FROM ai_usage_log WHERE tenant_slug = 'timbrature'").get().c >= 1);
  });

  console.log(`\n${passed} passati, ${failed} falliti`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
