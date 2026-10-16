'use strict';
// Pulizia dei vecchi report dentro i moduli (routes/reports.js → /legacy): toglie solo il report periodico e l'avviso «scadenza» pianificato. Server reale, DB temporaneo.
// Server reale, DB temporaneo. Eseguire con: node src/reports-legacy.test.js (porta 34817).

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const TEST_PORT = 34817;
const BASE = 'http://localhost:' + TEST_PORT;
const dbPath = path.join(os.tmpdir(), 'reportleg-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.DB_PATH = dbPath;
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'reportleg_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'reportleg_internal_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'reportleg_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'reportleg-uploads-'));
process.env.SUPER_ADMIN_URL = 'http://localhost:1';
process.env.TENANT_SLUG = 'reportleg';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; }
}
function assertEq(a, e, msg) { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${msg || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); }
function assertTrue(c, msg) { if (!c) throw new Error(msg || 'atteso true'); }
const auto = (id, label, trigger, azione, config) => ({ id, block_type: 'automation', label, trigger, azioni: [{ target: '__interno__', azione, config }] });

async function main() {
  require('./index.js');
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const db = require('./db');
  const mk = (slug, steps, draft) => db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json, schema_json_draft) VALUES (?, ?, 'box', '#000', 1, 1, 70, ?, ?)").run(slug, slug, JSON.stringify({ version: 3, steps }), draft ? JSON.stringify({ version: 3, steps: draft }) : null);
  const settimanale = auto('a1', 'Report settimanale', { evento: 'schedulato', schedulazione: { tipo: 'ogni_N_giorni', giorni: 7, ora: 8 } }, 'invia_report_periodico', { trigger_tag: 'report' });
  const scadenzaOggi = auto('a2', 'Scadenza oggi', { evento: 'schedulato', schedulazione: { tipo: 'giornaliero', ora: 8 } }, 'invia_notifica', { trigger_tag: 'scadenza', messaggio: 'x' });
  const registra = auto('a3', 'Registra data pagamento', { evento: 'cambio_stato', stato: 'pagato' }, 'aggiorna_record', {});
  const bollettaGmail = auto('a4', 'Avviso su nuovo record', { evento: 'nuovo_record' }, 'invia_notifica', { trigger_tag: 'scadenza', messaggio: 'x' }); // non è pianificato: resta
  const campo = { id: 'f1', block_type: 'field', key: 'x', label: 'X', type: 'text' };
  mk('spese_a', [campo, settimanale, scadenzaOggi, registra, bollettaGmail], [campo, settimanale, registra]);
  mk('spese_b', [campo, settimanale]);
  mk('pulito', [campo, registra]);
  for (const k of require('./features').KEYS) require('./features').set(k, true);
  const login = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: process.env.INITIAL_ADMIN_PASSWORD }) })).json();
  const H = { Authorization: 'Bearer ' + login.token, 'Content-Type': 'application/json' };
  const steps = (slug, col = 'schema_json') => { const r = db.prepare('SELECT ' + col + ' s FROM modules WHERE slug = ?').get(slug); return r.s ? JSON.parse(r.s).steps.map((b) => b.id) : null; };

  await test('elenca solo le automazioni vecchie (report periodico e avviso «scadenza» pianificato), con modulo e nome', async () => {
    const j = await (await fetch(BASE + '/api/reports/legacy', { headers: H })).json();
    assertEq(j.automazioni.map((a) => a.modulo + ':' + a.id).sort(), ['spese_a:a1', 'spese_a:a2', 'spese_b:a1']);
    assertTrue(j.automazioni.every((a) => a.nome), 'ogni voce ha un nome');
  });
  await test('senza accesso 401; la lista non scrive niente', async () => {
    assertEq((await fetch(BASE + '/api/reports/legacy')).status, 401);
    assertEq(steps('spese_a'), ['f1', 'a1', 'a2', 'a3', 'a4']);
  });
  await test('la pulizia toglie quelle e solo quelle, dallo schema pubblicato e dalla bozza, con cronologia e versione nuova', async () => {
    const prima = db.prepare("SELECT id, schema_version v FROM modules WHERE slug = 'spese_a'").get();
    const r = await fetch(BASE + '/api/reports/legacy/remove', { method: 'POST', headers: H, body: '{}' }); assertEq(r.status, 200); assertEq((await r.json()).rimosse, 3);
    assertEq(steps('spese_a'), ['f1', 'a3', 'a4'], 'restano il campo, la registrazione e l\'avviso su record nuovo');
    assertEq(steps('spese_a', 'schema_json_draft'), ['f1', 'a3'], 'anche la bozza');
    assertEq(steps('spese_b'), ['f1']); assertEq(steps('pulito'), ['f1', 'a3'], 'un modulo senza vecchi report non si tocca');
    assertEq(db.prepare('SELECT COUNT(*) c FROM modules_schema_history WHERE module_id = ?').get(prima.id).c, 1, 'cronologia');
    assertEq(db.prepare("SELECT schema_version v FROM modules WHERE slug = 'spese_a'").get().v, prima.v + 1);
    assertEq(db.prepare("SELECT COUNT(*) c FROM modules_schema_history WHERE module_id = (SELECT id FROM modules WHERE slug = 'pulito')").get().c, 0, 'niente cronologia per un modulo non toccato');
  });
  await test('ripetere la pulizia non fa niente', async () => {
    const j = await (await fetch(BASE + '/api/reports/legacy/remove', { method: 'POST', headers: H, body: '{}' })).json(); assertEq(j.rimosse, 0);
  });
  await test('con la funzione spenta le rotte rispondono 403', async () => {
    require('./features').set('riepilogo_mattino', false);
    assertEq((await fetch(BASE + '/api/reports/legacy', { headers: H })).status, 403); require('./features').set('riepilogo_mattino', true);
  });

  console.log(`\n${'='.repeat(60)}`);
  console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
  try { fs.unlinkSync(dbPath); } catch (e) {}
  process.exit(failed > 0 ? 1 : 0);
}
main().catch((e) => { console.error('Suite reports-legacy fallita ad avviarsi:', e); process.exit(1); });
