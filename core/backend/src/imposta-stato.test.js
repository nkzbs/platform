'use strict';
// scripts/imposta-stato.js: prova a secco, copia e scrittura con verifica, contro un backend vero (DB temporaneo).
// Eseguire con: node src/imposta-stato.test.js (porta 34813).
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
// asincrono di proposito: il server gira in questo stesso processo, con spawnSync non risponderebbe mai allo script
const esegui = (args, env) => new Promise((resolve) => { const p = spawn(process.execPath, args, { env }); let stdout = '', stderr = ''; p.stdout.on('data', (d) => { stdout += d; }); p.stderr.on('data', (d) => { stderr += d; }); p.on('close', (status) => resolve({ status, stdout, stderr })); });

const TEST_PORT = 34813;
const BASE = 'http://localhost:' + TEST_PORT;
const dbPath = path.join(os.tmpdir(), 'imposta-stato-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.DB_PATH = dbPath;
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'is_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'is_internal_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'is_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'is-uploads-'));
process.env.SUPER_ADMIN_URL = 'http://localhost:1';
process.env.TENANT_SLUG = 'is';

let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); console.log('  ✓ ' + name); passed++; } catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; } }
function assertEq(a, e, msg) { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${msg || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); }
function assertTrue(c, msg) { if (!c) throw new Error(msg || 'atteso true'); }

const F = (key, label, type) => ({ id: 'f_' + key, block_type: 'field', key, label, type });
const SCHEMA = { version: 3, steps: [F('descrizione', 'Descrizione', 'text'), F('importo', 'Importo', 'currency'), F('data', 'Data', 'date'),
  { id: 'w1', block_type: 'workflow_state', key: 'da_pagare', label: 'Da pagare', initial: true }, { id: 'w2', block_type: 'workflow_state', key: 'pagato', label: 'Pagato' },
  { id: 't1', block_type: 'workflow_transition', from: 'da_pagare', to: 'pagato', label: 'Segna pagato' }] };

async function main() {
  require('./index.js');
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const db = require('./db');
  db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES ('rate', 'rate', 'box', '#000', 1, 1, 70, ?)").run(JSON.stringify(SCHEMA));
  const riga = (d) => db.prepare('INSERT INTO records (module_slug, user_id, data) VALUES (?, NULL, ?)').run('rate', JSON.stringify(d)).lastInsertRowid;
  const a = riga({ descrizione: 'RATA 6/11 X', importo: 100, data: '2026-12-27' });            // stato vuoto
  const b = riga({ descrizione: 'RATA 7/11 X', importo: 100, data: '2027-01-27' });            // stato vuoto
  const c = riga({ descrizione: 'RATA 8/11 X', importo: 100, data: '2027-02-27', _stato: 'pagato' }); // già pagata: non si tocca
  const stato = (id) => JSON.parse(db.prepare('SELECT data FROM records WHERE id = ?').get(id).data)._stato;
  const login = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: process.env.INITIAL_ADMIN_PASSWORD }) })).json();
  const cartella = fs.mkdtempSync(path.join(os.tmpdir(), 'is-copie-'));
  const script = path.join(__dirname, '..', '..', '..', 'scripts', 'imposta-stato.js');
  const lancia = (extra) => esegui([script, '--modulo', 'rate', '--stato', 'da_pagare', '--descrizione', 'RATA 6/11 X', '--descrizione', 'RATA 7/11 X', '--descrizione', 'RATA 8/11 X', '--descrizione', 'NON ESISTE', '--solo-stato-vuoto', '--cartella-copie', cartella, ...extra],
    { ...process.env, PLATFORM_URL: BASE, PLATFORM_API_TOKEN: login.token });

  await test('la prova a secco elenca le righe giuste e non scrive niente', async () => {
    const r = await lancia([]);
    assertEq(r.status, 0, r.stderr);
    assertTrue(/PROVA A SECCO/.test(r.stdout) && r.stdout.includes('RATA 6/11 X') && r.stdout.includes('RATA 7/11 X'), r.stdout);
    assertTrue(!r.stdout.includes('RATA 8/11 X  data'), 'la già pagata non è tra quelle da cambiare');
    assertTrue(/nessuna riga con descrizione «NON ESISTE»/.test(r.stdout), 'avvisa se una descrizione non esiste');
    assertEq([stato(a), stato(b), stato(c)], [undefined, undefined, 'pagato']);
    assertEq(fs.readdirSync(cartella).length, 0, 'nessuna copia in prova a secco');
  });
  await test('con --applica salva la copia, scrive solo le righe a stato vuoto e le rilegge', async () => {
    const r = await lancia(['--applica']);
    assertEq(r.status, 0, r.stdout + r.stderr);
    assertEq([stato(a), stato(b), stato(c)], ['da_pagare', 'da_pagare', 'pagato']);
    const copie = fs.readdirSync(cartella); assertEq(copie.length, 1);
    const salvate = JSON.parse(fs.readFileSync(path.join(cartella, copie[0]), 'utf8'));
    assertEq(salvate.map((x) => x.id).sort(), [a, b].sort(), 'la copia ha le righe com\'erano prima');
    assertTrue(salvate.every((x) => !x.data._stato), 'la copia ha lo stato di prima (vuoto)');
    assertTrue(/OK, ora «da_pagare»/.test(r.stdout));
  });
  await test('rilanciato dopo, non c\'è più niente da cambiare', async () => {
    const r = await lancia(['--applica']); assertEq(r.status, 0);
    assertTrue(/Nessuna riga da cambiare/.test(r.stdout), r.stdout);
  });
  await test('senza token o senza opzioni si ferma con un errore chiaro', async () => {
    const r1 = await esegui([script, '--modulo', 'rate', '--stato', 'x', '--descrizione', 'a'], { PATH: process.env.PATH });
    assertEq(r1.status, 1); assertTrue(/PLATFORM_API_TOKEN/.test(r1.stderr), r1.stderr);
    const r2 = await esegui([script], { ...process.env }); assertEq(r2.status, 1);
  });

  console.log(`\n${'='.repeat(60)}`);
  console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
  try { fs.unlinkSync(dbPath); } catch (e) {}
  process.exit(failed > 0 ? 1 : 0);
}
main().catch((e) => { console.error('Suite imposta-stato fallita ad avviarsi:', e); process.exit(1); });
