'use strict';
// scripts/imposta-data-pagamento.js: il 27 del mese della scadenza per le voci pagate senza data di pagamento; prova a secco, copia, scrittura con verifica, contro un backend vero.
// Eseguire con: node src/imposta-data-pagamento.test.js (porta 34882).
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
// asincrono di proposito: il server gira in questo stesso processo, con spawnSync non risponderebbe mai allo script
const esegui = (args, env) => new Promise((resolve) => { const p = spawn(process.execPath, args, { env }); let stdout = '', stderr = ''; p.stdout.on('data', (d) => { stdout += d; }); p.stderr.on('data', (d) => { stderr += d; }); p.on('close', (status) => resolve({ status, stdout, stderr })); });

const TEST_PORT = 34882;
const BASE = 'http://localhost:' + TEST_PORT;
const dbPath = path.join(os.tmpdir(), 'imposta-dp-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.DB_PATH = dbPath;
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'idp_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'idp_internal_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'idp_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'idp-uploads-'));
process.env.SUPER_ADMIN_URL = 'http://localhost:1';
process.env.TENANT_SLUG = 'idp';

let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); console.log('  ✓ ' + name); passed++; } catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; } }
function assertEq(a, e, msg) { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${msg || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); }
function assertTrue(c, msg) { if (!c) throw new Error(msg || 'atteso true'); }

const F = (key, label, type) => ({ id: 'f_' + key, block_type: 'field', key, label, type });
const SCHEMA = { version: 3, steps: [F('descrizione', 'Descrizione', 'text'), F('importo', 'Importo', 'currency'), F('data', 'Data', 'date'), F('scadenza', 'Scadenza', 'date'), F('data_pagamento', 'Data pagamento', 'date'),
  { id: 'w1', block_type: 'workflow_state', key: 'da_pagare', label: 'Da pagare', initial: true }, { id: 'w2', block_type: 'workflow_state', key: 'pagato', label: 'Pagato' },
  { id: 't1', block_type: 'workflow_transition', from: 'da_pagare', to: 'pagato', label: 'Segna pagato' }] };

async function main() {
  const { calcola, giornoDiPagamento, leggiArgomenti } = require('../../../scripts/imposta-data-pagamento');

  console.log('\n--- il calcolo ---');
  await test('il 27 del mese della scadenza; senza scadenza il mese della data; mai oltre oggi', async () => {
    assertEq(giornoDiPagamento('2026-03-15', 27, '2026-11-24'), '2026-03-27'); assertEq(giornoDiPagamento('2026-03-30', 27, '2026-11-24'), '2026-03-27');
    assertEq(giornoDiPagamento('2026-11-28', 27, '2026-11-24'), '2026-11-24', 'il 27 è nel futuro: vale oggi');
    assertEq(giornoDiPagamento('2026-11-10', 27, '2026-11-27'), '2026-11-27', 'il giorno stesso va bene');
  });
  await test('calcola: solo le pagate senza data; una data di pagamento già scritta non si sovrascrive; senza nessuna data si salta', async () => {
    const a = { statoPagato: 'pagato', campoPagamento: 'data_pagamento', campoScadenza: 'scadenza', campoData: 'data', giorno: 27 };
    const righe = [
      { id: 1, data: { _stato: 'pagato', scadenza: '2026-03-15', data: '2026-03-15' } },
      { id: 2, data: { _stato: 'pagato', data: '2026-04-10' } },                                 // senza scadenza: vale la data
      { id: 3, data: { _stato: 'pagato', scadenza: '2026-03-15', data_pagamento: '2026-03-20' } }, // già scritta
      { id: 4, data: { _stato: 'da_pagare', scadenza: '2026-03-15' } },                            // non pagata
      { id: 5, data: { _stato: 'pagato' } },                                                       // pagata ma senza date
    ];
    const r = calcola(righe, a, '2026-11-24');
    assertEq(r.daFare.map((x) => [x.r.id, x.nuova]), [[1, '2026-03-27'], [2, '2026-04-27']]);
    assertEq(r.saltate.map((x) => x.id), [5]);
  });
  await test('opzioni: giorno fuori da 2–28 o nessun modulo → errore chiaro', async () => {
    let e1 = ''; try { leggiArgomenti(['--modulo', 'x', '--giorno', '31']); } catch (e) { e1 = e.message; } assertTrue(/giorno/.test(e1), e1);
    let e2 = ''; try { leggiArgomenti([]); } catch (e) { e2 = e.message; } assertTrue(/modulo/.test(e2), e2);
  });

  require('./index.js');
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const db = require('./db');
  db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES ('spese_dp', 'spese_dp', 'box', '#000', 1, 1, 70, ?)").run(JSON.stringify(SCHEMA));
  const riga = (d) => Number(db.prepare('INSERT INTO records (module_slug, user_id, data) VALUES (?, NULL, ?)').run('spese_dp', JSON.stringify(d)).lastInsertRowid);
  const a = riga({ descrizione: 'Luce', importo: 80, data: '2026-03-15', scadenza: '2026-03-15', _stato: 'pagato' });
  const b = riga({ descrizione: 'Gas', importo: 50, data: '2026-04-30', scadenza: '2026-04-30', _stato: 'pagato' });
  const c = riga({ descrizione: 'Già con data', importo: 10, data: '2026-03-10', scadenza: '2026-03-10', data_pagamento: '2026-03-12', _stato: 'pagato' });
  const d = riga({ descrizione: 'Da pagare', importo: 10, data: '2026-03-10', scadenza: '2026-03-10', _stato: 'da_pagare' });
  const dp = (id) => JSON.parse(db.prepare('SELECT data FROM records WHERE id = ?').get(id).data).data_pagamento;
  const login = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: process.env.INITIAL_ADMIN_PASSWORD }) })).json();
  const cartella = fs.mkdtempSync(path.join(os.tmpdir(), 'idp-copie-'));
  const script = path.join(__dirname, '..', '..', '..', 'scripts', 'imposta-data-pagamento.js');
  const lancia = (extra) => esegui([script, '--modulo', 'spese_dp', '--cartella-copie', cartella, ...extra], { ...process.env, PLATFORM_URL: BASE, PLATFORM_API_TOKEN: login.token });

  console.log('\n--- contro un backend vero ---');
  await test('la prova a secco elenca le righe giuste e non scrive niente', async () => {
    const r = await lancia([]);
    assertEq(r.status, 0, r.stderr);
    assertTrue(/PROVA A SECCO/.test(r.stdout) && r.stdout.includes('2026-03-15  →  2026-03-27') && r.stdout.includes('2026-04-30  →  2026-04-27'), r.stdout);
    assertTrue(!r.stdout.includes('Già con data  ') && !r.stdout.includes('Da pagare  '), 'la già datata e la non pagata non sono tra quelle da compilare');
    assertEq([dp(a), dp(b), dp(c), dp(d)], [undefined, undefined, '2026-03-12', undefined]);
    assertEq(fs.readdirSync(cartella).length, 0, 'nessuna copia in prova a secco');
  });
  await test('con --applica salva la copia, compila solo le giuste e le rilegge', async () => {
    const r = await lancia(['--applica']);
    assertEq(r.status, 0, r.stdout + r.stderr);
    assertEq([dp(a), dp(b), dp(c), dp(d)], ['2026-03-27', '2026-04-27', '2026-03-12', undefined], 'la già datata resta com\'era');
    const copie = fs.readdirSync(cartella); assertEq(copie.length, 1);
    const salvate = JSON.parse(fs.readFileSync(path.join(cartella, copie[0]), 'utf8'));
    assertEq(salvate.map((x) => x.id).sort(), [a, b].sort(), 'la copia ha le righe com\'erano prima');
    assertTrue(salvate.every((x) => !x.data.data_pagamento), 'la copia non ha la data di pagamento (era vuota)');
    assertTrue(/2 righe aggiornate, tutte verificate/.test(r.stdout), r.stdout);
  });
  await test('rilanciato dopo, non c\'è più niente da compilare', async () => {
    const r = await lancia(['--applica']); assertEq(r.status, 0);
    assertTrue(/Niente da compilare/.test(r.stdout), r.stdout);
  });
  await test('senza token si ferma con un errore chiaro', async () => {
    const r = await esegui([script, '--modulo', 'spese_dp'], { PATH: process.env.PATH });
    assertEq(r.status, 1); assertTrue(/PLATFORM_API_TOKEN/.test(r.stderr), r.stderr);
  });

  console.log(`\n${'='.repeat(60)}`);
  console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
  try { fs.unlinkSync(dbPath); } catch (e) {}
  process.exit(failed > 0 ? 1 : 0);
}
main().catch((e) => { console.error('Suite imposta-data-pagamento fallita ad avviarsi:', e); process.exit(1); });
