'use strict';
// scripts/numera-rate.js: prova a secco, copia e scrittura con verifica, contro un backend vero (DB temporaneo). Eseguire con: node src/numera-rate.test.js (porta 34814).
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
// asincrono: il server gira in questo stesso processo, con spawnSync non risponderebbe mai allo script
const esegui = (args, env) => new Promise((resolve) => { const p = spawn(process.execPath, args, { env }); let stdout = '', stderr = ''; p.stdout.on('data', (d) => { stdout += d; }); p.stderr.on('data', (d) => { stderr += d; }); p.on('close', (status) => resolve({ status, stdout, stderr })); });

const TEST_PORT = 34814;
const BASE = 'http://localhost:' + TEST_PORT;
const dbPath = path.join(os.tmpdir(), 'numera-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.DB_PATH = dbPath;
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'nr_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'nr_internal_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'nr_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nr-uploads-'));
process.env.SUPER_ADMIN_URL = 'http://localhost:1';
process.env.TENANT_SLUG = 'nr';

let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); console.log('  ✓ ' + name); passed++; } catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; } }
function assertEq(a, e, msg) { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${msg || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); }
function assertTrue(c, msg) { if (!c) throw new Error(msg || 'atteso true'); }

const { calcola, nomeRata } = require('../../../scripts/numera-rate.js');
const F = (key, label, type) => ({ id: 'f_' + key, block_type: 'field', key, label, type });

async function main() {
  console.log('\n--- il calcolo ---');
  await test('«Nome — rata x su y»; una rata sola resta il nome', async () => {
    assertEq(nomeRata('Antonio', 3, 11), 'Antonio — rata 3 su 11'); assertEq(nomeRata('Bollo', 1, 1), 'Bollo');
  });
  await test('numera in ordine di data; salta un piano che non ha tante rate quante dice', async () => {
    const piano = { id: 1, data: { nome: 'P', n_rate: 3 } };
    const r = (id, d, desc) => ({ id, data: { data: d, descrizione: desc } });
    const c = calcola(piano, [r(12, '2026-03-01', 'x'), r(10, '2026-01-01', 'x'), r(11, '2026-02-01', 'P — rata 2 su 3')]);
    assertEq(c.cambi.map((x) => [x.riga.id, x.a]), [[10, 'P — rata 1 su 3'], [12, 'P — rata 3 su 3']], 'quella già a posto non cambia');
    assertTrue(/dice 3 rate ma ne ho trovate 2/.test(calcola(piano, [r(1, '2026-01-01', 'x'), r(2, '2026-02-01', 'x')]).saltato));
  });

  require('./index.js');
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const db = require('./db');
  const add = (slug, steps) => db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES (?, ?, 'box', '#000', 1, 1, 70, ?)").run(slug, slug, JSON.stringify({ version: 3, steps }));
  add('piani', [F('nome', 'Nome', 'text'), F('n_rate', 'Rate', 'number')]);
  add('rate', [F('descrizione', 'Descrizione', 'text'), F('importo', 'Importo', 'currency'), F('data', 'Data', 'date'), F('debito', 'Piano', 'number')]);
  const ins = (slug, d) => db.prepare('INSERT INTO records (module_slug, user_id, data) VALUES (?, NULL, ?)').run(slug, JSON.stringify(d)).lastInsertRowid;
  const p1 = ins('piani', { nome: 'Antonio Romaniello', n_rate: 3 });
  const p2 = ins('piani', { nome: 'Altro', n_rate: 2 });
  const a = ins('rate', { descrizione: 'Antonio Romaniello', importo: 100, data: '2026-08-27', debito: p1 });
  const b = ins('rate', { descrizione: 'RATA 2/3 X', importo: 100, data: '2026-09-27', debito: p1 });
  const c = ins('rate', { descrizione: 'Antonio Romaniello', importo: 100, data: '2026-10-27', debito: p1 });
  const d = ins('rate', { descrizione: 'Altro', importo: 10, data: '2026-10-01', debito: p2 }); // il piano «Altro» ha 2 rate dichiarate, 1 sola trovata
  const desc = (id) => JSON.parse(db.prepare('SELECT data FROM records WHERE id = ?').get(id).data).descrizione;
  const login = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: process.env.INITIAL_ADMIN_PASSWORD }) })).json();
  const cartella = fs.mkdtempSync(path.join(os.tmpdir(), 'nr-copie-'));
  const script = path.join(__dirname, '..', '..', '..', 'scripts', 'numera-rate.js');
  const lancia = (extra) => esegui([script, '--piani', 'piani', '--figli', 'rate', '--relazione', 'debito', '--piano', 'Antonio Romaniello', '--piano', 'Altro', '--piano', 'Non esiste', '--cartella-copie', cartella, ...extra], { ...process.env, PLATFORM_URL: BASE, PLATFORM_API_TOKEN: login.token });

  console.log('\n--- lo script ---');
  await test('la prova a secco mostra i cambi, salta il piano incoerente, avvisa del piano che non c\'è, e non scrive', async () => {
    const r = await lancia([]); assertEq(r.status, 0, r.stderr);
    assertTrue(r.stdout.includes('«Antonio Romaniello» → «Antonio Romaniello — rata 1 su 3»'), r.stdout);
    assertTrue(r.stdout.includes('«RATA 2/3 X» → «Antonio Romaniello — rata 2 su 3»'));
    assertTrue(/SALTATO: il piano dice 2 rate ma ne ho trovate 1/.test(r.stdout) && /«Non esiste»: ATTENZIONE/.test(r.stdout));
    assertEq([desc(a), desc(b), desc(c), desc(d)], ['Antonio Romaniello', 'RATA 2/3 X', 'Antonio Romaniello', 'Altro']);
    assertEq(fs.readdirSync(cartella).length, 0);
  });
  await test('con --applica salva la copia, rinomina solo il piano coerente e rilegge', async () => {
    const r = await lancia(['--applica']); assertEq(r.status, 0, r.stdout + r.stderr);
    assertEq([desc(a), desc(b), desc(c), desc(d)], ['Antonio Romaniello — rata 1 su 3', 'Antonio Romaniello — rata 2 su 3', 'Antonio Romaniello — rata 3 su 3', 'Altro']);
    const copie = fs.readdirSync(cartella); assertEq(copie.length, 1);
    assertEq(JSON.parse(fs.readFileSync(path.join(cartella, copie[0]), 'utf8')).map((x) => x.data.descrizione).sort(), ['Antonio Romaniello', 'Antonio Romaniello', 'RATA 2/3 X'].sort(), 'la copia ha i nomi di prima');
  });
  await test('rilanciato dopo, è già a posto', async () => {
    const r = await lancia(['--applica']); assertEq(r.status, 0); assertTrue(/già a posto/.test(r.stdout) && /Niente da scrivere/.test(r.stdout), r.stdout);
  });

  console.log(`\n${'='.repeat(60)}`);
  console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
  try { fs.unlinkSync(dbPath); } catch (e) {}
  process.exit(failed > 0 ? 1 : 0);
}
main().catch((e) => { console.error('Suite numera-rate fallita ad avviarsi:', e); process.exit(1); });
