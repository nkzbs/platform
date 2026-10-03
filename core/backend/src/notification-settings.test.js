'use strict';
// Destinatari WhatsApp e regole Gmail come impostazioni del sistema (notification-settings.js,
// routes/notification-settings.js): CRUD con controlli, migrazione dai vecchi moduli senza perdere
// righe, backup. Eseguire con: node src/notification-settings.test.js (porta 34799 libera).

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const TEST_PORT = 34799;
const BASE = 'http://localhost:' + TEST_PORT;
const dbPath = path.join(os.tmpdir(), 'notifset-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.DB_PATH = dbPath;
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'notifset_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'notifset_internal_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'notifset_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'notifset-uploads-'));
process.env.SUPER_ADMIN_URL = 'http://localhost:1';
process.env.TENANT_SLUG = 'finance';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; }
}
function assertEq(a, e, msg) { if (a !== e) throw new Error(`${msg || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); }
function assertTrue(c, msg) { if (!c) throw new Error(msg || 'atteso true'); }

async function main() {
  require('./index.js');
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const db = require('./db');
  const ns = require('./notification-settings');
  const login = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: process.env.INITIAL_ADMIN_PASSWORD }) })).json();
  const H = { Authorization: 'Bearer ' + login.token, 'Content-Type': 'application/json' };
  const call = (m, p, body, h = H) => fetch(BASE + '/api' + p, { method: m, headers: h, body: body ? JSON.stringify(body) : undefined });

  console.log('\n--- destinatari WhatsApp ---');

  await test('senza login -> 401', async () => { assertEq((await call('GET', '/whatsapp-recipients', null, {})).status, 401); });

  await test('si crea, si legge, si modifica e si elimina un destinatario', async () => {
    const res = await call('POST', '/whatsapp-recipients', { nome: ' Nima ', numero: '+39 333 111 1111', triggers: ['scadenza', 'scadenza', 'report'], attivo: true });
    const r = await res.json();
    assertEq(res.status, 200);
    assertEq(r.nome, 'Nima', 'spazi tolti');
    assertEq(r.triggers.length, 2, 'doppioni tolti');
    assertEq((await (await call('GET', '/whatsapp-recipients')).json()).length, 1);
    const up = await (await call('PUT', '/whatsapp-recipients/' + r.id, { ...r, triggers: ['bolletta'], attivo: false })).json();
    assertEq(up.attivo, false);
    assertEq(up.triggers[0], 'bolletta');
    assertEq((await call('DELETE', '/whatsapp-recipients/' + r.id)).status, 200);
    assertEq((await call('DELETE', '/whatsapp-recipients/' + r.id)).status, 404);
    assertEq((await call('PUT', '/whatsapp-recipients/999', { nome: 'x', numero: '+39 333 111 1111' })).status, 404);
  });

  await test('nome vuoto o numero non valido -> 400', async () => {
    assertEq((await call('POST', '/whatsapp-recipients', { nome: '', numero: '+39 333 111 1111' })).status, 400);
    assertEq((await call('POST', '/whatsapp-recipients', { nome: 'X', numero: 'abc' })).status, 400);
  });

  await test('recipientsForTag: solo attivi e iscritti al tag (senza tag: tutti gli attivi)', () => {
    db.exec('DELETE FROM whatsapp_recipients');
    ns.createRecipient({ nome: 'A', numero: '+39 333 000 0001', triggers: ['scadenza'], attivo: true });
    ns.createRecipient({ nome: 'B', numero: '+39 333 000 0002', triggers: ['report'], attivo: true });
    ns.createRecipient({ nome: 'C', numero: '+39 333 000 0003', triggers: ['scadenza'], attivo: false });
    assertEq(ns.recipientsForTag('scadenza').map((r) => r.nome).join(), 'A');
    assertEq(ns.recipientsForTag(null).map((r) => r.nome).join(), 'A,B');
  });

  console.log('\n--- regole Gmail ---');

  await test('si crea una regola: mittente in minuscolo, gruppo valido', async () => {
    const res = await call('POST', '/gmail-rules', { mittente: ' Bollette@A2A.it ', descrizione: 'A2A', gruppo: 'Boh', categoria: 'Elettricità', attiva: true });
    const r = await res.json();
    assertEq(r.mittente, 'bollette@a2a.it');
    assertEq(r.gruppo, 'Casa', 'un gruppo sconosciuto diventa Casa');
    assertEq(ns.activeRules().length, 1);
  });

  await test('mittente che non è una email -> 400; regola disattivata non è attiva', async () => {
    assertEq((await call('POST', '/gmail-rules', { mittente: 'a2a' })).status, 400);
    const r = ns.listRules()[0];
    assertEq((await call('PUT', '/gmail-rules/' + r.id, { ...r, attiva: false })).status, 200);
    assertEq(ns.activeRules().length, 0);
    assertEq((await call('DELETE', '/gmail-rules/' + r.id)).status, 200);
  });

  console.log('\n--- migrazione dai vecchi moduli ---');

  const legacy = (slug, d) => db.prepare("INSERT INTO records (module_slug, user_id, data) VALUES (?, NULL, ?)").run(slug, JSON.stringify(d));
  const addModule = (slug) => { db.prepare('DELETE FROM modules WHERE slug = ?').run(slug); db.prepare("INSERT INTO modules (name, slug, icon, color, installed, sort_order, schema_json) VALUES (?, ?, 'box', '#000', 1, 50, '{}')").run(slug, slug); };

  await test('le righe vecchie passano nelle tabelle nuove; righe, moduli e permessi vecchi spariscono', () => {
    db.exec('DELETE FROM whatsapp_recipients; DELETE FROM gmail_rules;');
    addModule('whatsapp_destinatari'); addModule('gmail_regole');
    db.prepare("INSERT OR REPLACE INTO user_modules (user_id, module_slug) VALUES (1, 'gmail_regole')").run();
    legacy('whatsapp_destinatari', { nome: 'Nima', numero: '+39 333 111 1111', triggers: ['scadenza', 'report'], attivo: true });
    legacy('whatsapp_destinatari', { nome: 'Spento', numero: '+39 333 222 2222', triggers: [], attivo: false });
    legacy('gmail_regole', { mittente: 'a@b.it', descrizione: 'A', gruppo: 'Personale', categoria: 'Rata', attiva: true });
    const out = ns.migrateLegacy();
    assertEq(out.recipients, 2); assertEq(out.rules, 1); assertEq(out.left, 0);
    const wa = ns.listRecipients();
    assertEq(wa[0].nome, 'Nima'); assertEq(wa[0].triggers.join(), 'scadenza,report'); assertEq(wa[1].attivo, false);
    const g = ns.listRules()[0];
    assertEq(g.gruppo, 'Personale'); assertEq(g.attiva, true);
    assertEq(db.prepare("SELECT COUNT(*) c FROM records WHERE module_slug IN ('whatsapp_destinatari','gmail_regole')").get().c, 0);
    assertEq(db.prepare("SELECT COUNT(*) c FROM modules WHERE slug IN ('whatsapp_destinatari','gmail_regole')").get().c, 0);
    assertEq(db.prepare("SELECT COUNT(*) c FROM user_modules WHERE module_slug = 'gmail_regole'").get().c, 0);
  });

  await test('è idempotente: rilanciarla non duplica niente', () => {
    const out = ns.migrateLegacy();
    assertEq(out.recipients + out.rules, 0);
    assertEq(ns.listRecipients().length, 2);
  });

  await test('una riga incompleta NON viene persa: resta dov\'è, e il modulo non viene tolto', () => {
    addModule('whatsapp_destinatari');
    legacy('whatsapp_destinatari', { nome: 'Senza numero' });
    legacy('whatsapp_destinatari', { nome: 'Ok', numero: '+39 333 333 3333', triggers: [], attivo: true });
    const out = ns.migrateLegacy();
    assertEq(out.left, 1);
    assertEq(db.prepare("SELECT COUNT(*) c FROM records WHERE module_slug = 'whatsapp_destinatari'").get().c, 1, 'la riga incompleta è ancora lì');
    assertEq(db.prepare("SELECT COUNT(*) c FROM modules WHERE slug = 'whatsapp_destinatari'").get().c, 1, 'il modulo resta finché c\'è qualcosa da salvare');
    db.prepare("DELETE FROM records WHERE module_slug = 'whatsapp_destinatari'").run();
    ns.migrateLegacy();
    assertEq(db.prepare("SELECT COUNT(*) c FROM modules WHERE slug = 'whatsapp_destinatari'").get().c, 0);
  });

  console.log('\n--- backup ---');

  await test('l\'export JSON include destinatari e regole', async () => {
    const dump = await (await call('GET', '/backup/export-json')).json();
    assertTrue(Array.isArray(dump.whatsapp_recipients) && dump.whatsapp_recipients.length >= 2, 'destinatari');
    assertTrue(Array.isArray(dump.gmail_rules) && dump.gmail_rules.length === 1, 'regole');
  });

  await test('importare un backup VECCHIO (con i due moduli come righe) li porta nelle tabelle nuove', async () => {
    db.exec('DELETE FROM whatsapp_recipients; DELETE FROM gmail_rules;');
    const old = { modules: [{ name: 'Regole Gmail', slug: 'gmail_regole', schema_json: '{}' }], records: [
      { id: 90001, module_slug: 'gmail_regole', user_id: null, data: { mittente: 'x@y.it', gruppo: 'Casa', categoria: 'Gas', attiva: true }, created_at: '2026-01-01', updated_at: '2026-01-01' },
      { id: 90002, module_slug: 'whatsapp_destinatari', user_id: null, data: { nome: 'Vecchio', numero: '+39 333 444 4444', triggers: ['report'], attivo: true }, created_at: '2026-01-01', updated_at: '2026-01-01' },
    ] };
    const res = await call('POST', '/backup/import-json', old);
    assertEq(res.status, 200);
    assertEq(ns.listRules()[0].mittente, 'x@y.it');
    assertEq(ns.listRecipients()[0].nome, 'Vecchio');
    assertEq(db.prepare("SELECT COUNT(*) c FROM records WHERE module_slug IN ('gmail_regole','whatsapp_destinatari')").get().c, 0);
  });

  await test('importare un backup NUOVO sostituisce le due tabelle', async () => {
    const dump = { modules: [], records: [], whatsapp_recipients: [{ nome: 'Nuovo', numero: '+39 333 555 5555', triggers: '["scadenza"]', attivo: 1 }], gmail_rules: [] };
    assertEq((await call('POST', '/backup/import-json', dump)).status, 200);
    assertEq(ns.listRecipients().map((r) => r.nome).join(), 'Nuovo');
    assertEq(ns.listRules().length, 0);
  });

  console.log(`\n${'='.repeat(60)}`);
  console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
  try { fs.unlinkSync(dbPath); } catch (e) {}
  process.exit(failed > 0 ? 1 : 0);
}
main().catch((e) => { console.error('Suite notification-settings fallita ad avviarsi:', e); process.exit(1); });
