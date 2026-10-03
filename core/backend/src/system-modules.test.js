'use strict';
// Regole Gmail e Destinatari WhatsApp sono funzioni di sistema: spariscono da menu, elenco moduli
// e Libreria, ma le loro righe restano leggibili e modificabili (dalle Impostazioni) e il motore
// continua a trovarle. Eseguire con: node src/system-modules.test.js (porta 34799 libera).

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const TEST_PORT = 34799;
const BASE = 'http://localhost:' + TEST_PORT;
const dbPath = path.join(os.tmpdir(), 'sysmod-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.DB_PATH = dbPath;
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'sysmod_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'sysmod_internal_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'sysmod_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sysmod-uploads-'));
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
  const sw = JSON.stringify({ version: 3, steps: [{ id: 'f1', block_type: 'field', key: 'nome', label: 'Nome', type: 'text' }, { id: 'f2', block_type: 'field', key: 'numero', label: 'Numero', type: 'phone' }, { id: 'f3', block_type: 'field', key: 'triggers', label: 'T', type: 'multiselect', options: ['scadenza', 'report'] }, { id: 'f4', block_type: 'field', key: 'attivo', label: 'A', type: 'checkbox' }] });
  for (const [slug, name] of [['gmail_regole', 'Regole Gmail'], ['whatsapp_destinatari', 'Destinatari WhatsApp'], ['spese_casa', 'Spese casa']]) {
    db.prepare('DELETE FROM modules WHERE slug = ?').run(slug);
    db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES (?, ?, 'box', '#2563EB', 1, 1, 50, ?)").run(name, slug, sw);
  }
  const login = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: process.env.INITIAL_ADMIN_PASSWORD }) })).json();
  const H = { Authorization: 'Bearer ' + login.token, 'Content-Type': 'application/json' };
  const get = (p) => fetch(BASE + '/api' + p, { headers: H }).then((r) => r.json());

  console.log('\n--- fuori dal menu, dalla Libreria e dal Builder ---');

  await test('non compaiono nel menu (/modules/installed), ma gli altri moduli sì', async () => {
    const slugs = (await get('/modules/installed')).map((m) => m.slug);
    assertTrue(!slugs.includes('gmail_regole') && !slugs.includes('whatsapp_destinatari'), slugs.join(','));
    assertTrue(slugs.includes('spese_casa'));
  });

  await test('non compaiono nell\'elenco moduli (Libreria, Builder, permessi)', async () => {
    const slugs = (await get('/modules')).map((m) => m.slug);
    assertTrue(!slugs.includes('gmail_regole') && !slugs.includes('whatsapp_destinatari'), slugs.join(','));
    assertTrue(slugs.includes('spese_casa'));
  });

  console.log('\n--- i dati restano gestibili dalle Impostazioni ---');

  await test('si crea, si legge, si modifica e si elimina un destinatario', async () => {
    const created = await (await fetch(BASE + '/api/records/whatsapp_destinatari', { method: 'POST', headers: H, body: JSON.stringify({ nome: 'Nima', numero: '+39 333 111 1111', triggers: ['scadenza'], attivo: true }) })).json();
    assertTrue(created.id, 'creato');
    assertEq((await get('/records/whatsapp_destinatari')).length, 1);
    const up = await fetch(BASE + '/api/records/whatsapp_destinatari/' + created.id, { method: 'PUT', headers: H, body: JSON.stringify({ nome: 'Nima', numero: '+39 333 111 1111', triggers: ['scadenza', 'report'], attivo: true }) });
    assertEq(up.status, 200);
    assertEq((await get('/records/whatsapp_destinatari'))[0].data.triggers.length, 2);
    assertEq((await fetch(BASE + '/api/records/whatsapp_destinatari/' + created.id, { method: 'DELETE', headers: H })).status, 200);
    assertEq((await get('/records/whatsapp_destinatari')).length, 0);
  });

  await test('il motore trova ancora i destinatari (stessa tabella di prima)', async () => {
    db.prepare("INSERT INTO records (module_slug, user_id, data) VALUES ('whatsapp_destinatari', NULL, ?)").run(JSON.stringify({ nome: 'X', numero: '+39 333 000 0000', triggers: ['report'], attivo: true }));
    const righe = db.prepare("SELECT data FROM records WHERE module_slug = 'whatsapp_destinatari'").all().map((r) => JSON.parse(r.data));
    assertEq(righe.filter((d) => d.triggers.includes('report')).length, 1);
  });

  console.log(`\n${'='.repeat(60)}`);
  console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
  try { fs.unlinkSync(dbPath); } catch (e) {}
  process.exit(failed > 0 ? 1 : 0);
}
main().catch((e) => { console.error('Suite system-modules fallita ad avviarsi:', e); process.exit(1); });
