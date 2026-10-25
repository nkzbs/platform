'use strict';
// Rotte di routes/drive-poller.js (/status, /sync) — il pulsante "Sincronizza Drive"
// in Documenti (richiesto dall'utente il 25/10/2026: "un tasto aggiorna nei documenti
// per forzare il sync"). Server reale, login reale; senza Google collegato (stato di
// base di un DB vuoto) pollDrive si ferma subito da solo, nessuna vera chiamata a Drive.
// Eseguire con: node src/drive-poller-route.test.js (porta 34823)

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const TEST_PORT = 34823;
const BASE = 'http://localhost:' + TEST_PORT;
const dbPath = path.join(os.tmpdir(), 'dp-route-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.DB_PATH = dbPath;
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'dp_route_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'dp_route_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-route-uploads-'));

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; }
}
function assertEq(a, e, msg) { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${msg || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); }

async function main() {
  require('./index.js');
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const login = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: process.env.INITIAL_ADMIN_PASSWORD }) })).json();
  const H = { Authorization: 'Bearer ' + login.token, 'Content-Type': 'application/json' };

  await test('senza login -> 401 su entrambe', async () => {
    assertEq((await fetch(BASE + '/api/drive-poller/status')).status, 401);
    assertEq((await fetch(BASE + '/api/drive-poller/sync', { method: 'POST' })).status, 401);
  });

  await test('senza Google collegato: non disponibile, nessun errore', async () => {
    const s = await (await fetch(BASE + '/api/drive-poller/status', { headers: H })).json();
    assertEq(s, { disponibile: false, modulo: null });
  });

  await test('/sync senza Google collegato: si ferma da solo, torna disponibile:false (pollDrive non prova nemmeno a chiamare Drive)', async () => {
    const r = await fetch(BASE + '/api/drive-poller/sync', { method: 'POST', headers: H });
    const body = await r.json();
    assertEq(r.status, 200);
    assertEq(body, { disponibile: false });
  });

  console.log(`\n${'='.repeat(60)}`);
  console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
  try { fs.unlinkSync(dbPath); } catch (e) {}
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error('ERRORE FATALE', e); process.exit(1); });
