'use strict';
// Funzioni facoltative per tenant (features.js, routes/features.js): spente di default per un tenant nuovo, accese per chi ha già moduli
// di finanza, rotte che rispondono 403 quando spente, scheda di gestione solo admin. Eseguire con: node src/features.test.js (porta 34803).

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const TEST_PORT = 34803;
const BASE = 'http://localhost:' + TEST_PORT;
const dbPath = path.join(os.tmpdir(), 'features-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.DB_PATH = dbPath;
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'feat_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'feat_internal_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'feat_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'feat-uploads-'));
process.env.SUPER_ADMIN_URL = 'http://localhost:1';
process.env.TENANT_SLUG = 'timbrature';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; }
}
function assertEq(a, e, msg) { if (a !== e) throw new Error(`${msg || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); }
function assertTrue(c, msg) { if (!c) throw new Error(msg || 'atteso true'); }

async function main() {
  require('./index.js'); // tenant senza moduli di finanza: parte con tutto spento
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const db = require('./db');
  const features = require('./features');
  const login = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: process.env.INITIAL_ADMIN_PASSWORD }) })).json();
  const H = { Authorization: 'Bearer ' + login.token, 'Content-Type': 'application/json' };
  const call = (m, p, body, h = H) => fetch(BASE + '/api' + p, { method: m, headers: h, body: body ? JSON.stringify(body) : undefined });

  console.log('\n--- un tenant senza finanza ---');

  await test('un tenant nuovo (nessun modulo di spese o entrate) ha tutte le funzioni spente', () => {
    for (const k of features.KEYS) assertEq(features.isEnabled(k), false, k);
  });
  await test('tenant-info (pubblico) dice quali funzioni sono accese: il menu e la dashboard si adattano', async () => {
    const info = await (await fetch(BASE + '/api/tenant-info')).json();
    assertEq(typeof info.features, 'object');
    assertEq(info.features.movimenti, false);
  });
  await test('con la funzione spenta le rotte rispondono 403 "feature_off"; senza login restano 401', async () => {
    for (const p of ['/bank/summary', '/insights', '/ai/overview', '/digest/settings']) {
      assertEq((await call('GET', p, null, {})).status, 401, p + ' senza login');
      const r = await call('GET', p);
      assertEq(r.status, 403, p);
      assertEq((await r.json()).code, 'feature_off', p);
    }
  });
  await test('anche WhatsApp, Gmail e Sito Web sono capacità da accendere: spenti, le loro rotte rispondono 403', async () => {
    for (const p of ['/whatsapp-recipients', '/gmail-rules', '/site-pages/settings']) {
      assertEq((await call('GET', p)).status, 403, p);
    }
    assertEq(require('./gmail-poller').pollGmail.constructor.name, 'AsyncFunction');
  });
  await test('restano per tutti solo le parti del motore e dell\'AI generica (chiave Mistral, spiegazione dei report)', async () => {
    assertTrue((await call('GET', '/ai/settings')).status !== 403, 'impostazioni AI sempre disponibili');
    assertEq((await call('GET', '/modules')).status, 200);
  });
  await test('lo smistamento delle bollette non parte se la funzione è spenta, nemmeno forzato', async () => {
    const out = await require('./ai-suggestions').suggestForRecord({ moduleSlug: 'spese_casa', recordId: 1, force: true });
    assertEq(out.skipped, 'funzione non attiva');
  });
  await test('il riepilogo del mattino non parte se la funzione è spenta', async () => {
    assertEq((await require('./daily-digest').tick()).skipped, 'funzione non attiva');
  });

  console.log('\n--- accenderle e spegnerle ---');

  await test('l\'elenco (solo admin) ha nome, descrizione e stato di ogni funzione', async () => {
    const list = await (await call('GET', '/features')).json();
    assertEq(list.length, features.KEYS.length);
    assertTrue(list.every((f) => f.label && f.description && f.enabled === false));
    assertEq((await call('GET', '/features', null, {})).status, 401);
  });
  await test('accendere WhatsApp, Gmail e Sito Web apre le loro rotte, una alla volta', async () => {
    for (const [k, p] of [['whatsapp', '/whatsapp-recipients'], ['gmail', '/gmail-rules'], ['sito_web', '/site-pages/settings']]) {
      assertEq((await call('GET', p)).status, 403, p + ' spenta');
      await call('PUT', '/features/' + k, { enabled: true });
      assertEq((await call('GET', p)).status, 200, p + ' accesa');
      await call('PUT', '/features/' + k, { enabled: false });
    }
  });
  await test('si accende una funzione: la sua rotta risponde, le altre restano spente; si spegne di nuovo', async () => {
    assertEq((await (await call('PUT', '/features/movimenti', { enabled: true })).json()).enabled, true);
    assertEq((await call('GET', '/bank/summary')).status, 200);
    assertEq((await call('GET', '/insights')).status, 403);
    assertEq((await fetch(BASE + '/api/tenant-info').then((r) => r.json())).features.movimenti, true);
    await call('PUT', '/features/movimenti', { enabled: false });
    assertEq((await call('GET', '/bank/summary')).status, 403);
  });
  await test('una funzione sconosciuta -> 404', async () => { assertEq((await call('PUT', '/features/boh', { enabled: true })).status, 404); });

  console.log('\n--- un tenant che già usa la finanza ---');

  await test('con moduli di spese installati e nessuna scelta salvata, la prima inizializzazione le accende tutte', () => {
    db.exec('DELETE FROM tenant_features');
    db.prepare('DELETE FROM modules WHERE slug = ?').run('spese_personali');
    db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES ('Spese personali', 'spese_personali', 'box', '#000', 1, 1, 50, '{}')").run();
    assertEq(features.seedIfEmpty(), true);
    for (const k of ['movimenti', 'analisi', 'bollette_ai', 'riepilogo_mattino']) assertEq(features.isEnabled(k), true, k);
  });
  await test('WhatsApp, Gmail e Sito Web partono accesi solo se il progetto li usa già (destinatari, regole, sito attivo)', () => {
    db.exec('DELETE FROM tenant_features; DELETE FROM whatsapp_recipients; DELETE FROM gmail_rules;');
    db.prepare("DELETE FROM modules WHERE slug = 'spese_personali'").run();
    features.seedIfEmpty();
    for (const k of ['whatsapp', 'gmail', 'sito_web']) assertEq(features.isEnabled(k), false, k + ' senza dati');
    db.exec('DELETE FROM tenant_features');
    db.prepare("INSERT INTO whatsapp_recipients (nome, numero, triggers, attivo) VALUES ('A', '+39 333 000 0000', '[]', 1)").run();
    db.prepare("INSERT INTO gmail_rules (mittente, gruppo) VALUES ('a@b.it', 'Casa')").run();
    db.prepare('UPDATE tenant_settings SET site_enabled = 1 WHERE id = 1').run();
    features.seedIfEmpty();
    for (const k of ['whatsapp', 'gmail', 'sito_web']) assertEq(features.isEnabled(k), true, k + ' con dati');
    assertEq(features.isEnabled('movimenti'), false, 'la finanza resta spenta senza moduli di spese');
    db.prepare('UPDATE tenant_settings SET site_enabled = 0 WHERE id = 1').run();
  });
  await test('una funzione NUOVA aggiunta dopo (chiave mancante) riceve il suo valore di partenza senza toccare le scelte già fatte', () => {
    features.set('analisi', true);
    db.prepare("DELETE FROM tenant_features WHERE key = 'gmail'").run();
    features.seedIfEmpty();
    assertEq(features.isEnabled('analisi'), true, 'la scelta fatta resta');
    assertEq(db.prepare("SELECT COUNT(*) c FROM tenant_features WHERE key = 'gmail'").get().c, 1, 'la chiave mancante è stata creata');
    features.set('analisi', false);
  });
  await test('rilanciare l\'inizializzazione non cambia le scelte già fatte', () => {
    features.set('analisi', false);
    features.seedIfEmpty();
    assertEq(features.isEnabled('analisi'), false);
  });

  console.log(`\n${'='.repeat(60)}`);
  console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
  try { fs.unlinkSync(dbPath); } catch (e) {}
  process.exit(failed > 0 ? 1 : 0);
}
main().catch((e) => { console.error('Suite features fallita ad avviarsi:', e); process.exit(1); });
