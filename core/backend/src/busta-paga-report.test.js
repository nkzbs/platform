'use strict';
// Vista permanente nell'app (routes/busta-paga-report.js) per "Platform è la base, il bot è
// opzionale" (richiesto dall'utente il 2026-10-25): le stesse righeOre/datiSaldi di
// bot-payslip.js, già testate via il bot in telegram-bot.test.js, qui esposte via HTTP reale
// con login reale di due utenti — verificano soprattutto che la separazione per proprietario
// (view_own_only) valga anche su questa rotta, e che senza modulo bustapaga torni disponibile:false.
// Eseguire con: node src/busta-paga-report.test.js (porta 34822).

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const TEST_PORT = 34822;
const BASE = 'http://localhost:' + TEST_PORT;
const dbPath = path.join(os.tmpdir(), 'bp-report-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.DB_PATH = dbPath;
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'bp_report_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'bp_report_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-report-uploads-'));

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; }
}
function assertEq(a, e, msg) { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${msg || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); }
function assertTrue(c, msg) { if (!c) throw new Error(msg || 'atteso true'); }

async function login(username, password) {
  const res = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
  const body = await res.json();
  if (!res.ok) throw new Error('login fallito per ' + username + ': ' + JSON.stringify(body));
  return body.token;
}

async function main() {
  require('./index.js');
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const db = require('./db');
  const roles = require('./module-roles');
  const F = (key, label, type, extra = {}) => ({ id: 'f_' + key, block_type: 'field', key, label, type, ...extra });
  const addModule = (slug, name, steps) => db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES (?, ?, 'box', '#000', 1, 1, 50, ?)").run(name, slug, JSON.stringify({ version: 3, steps }));

  console.log('\n--- senza modulo bustapaga ---');
  const bcrypt = require('bcryptjs');
  const hash = bcrypt.hashSync('pw_di_prova_123', 4);
  db.prepare("INSERT INTO users (id, username, password_hash, display_name, role) VALUES (5, 'nima', ?, 'Nima', 'user')").run(hash);
  db.prepare("INSERT INTO users (id, username, password_hash, display_name, role) VALUES (6, 'fede', ?, 'Fede', 'user')").run(hash);
  const tokNima = await login('nima', 'pw_di_prova_123');
  const tokFede = await login('fede', 'pw_di_prova_123');

  await test('senza login -> 401', async () => {
    assertEq((await fetch(BASE + '/api/busta-paga-report/ore')).status, 401);
  });
  await test('senza nessun modulo bustapaga -> disponibile:false su entrambe le rotte', async () => {
    const ore = await (await fetch(BASE + '/api/busta-paga-report/ore', { headers: { Authorization: 'Bearer ' + tokNima } })).json();
    const saldi = await (await fetch(BASE + '/api/busta-paga-report/saldi', { headers: { Authorization: 'Bearer ' + tokNima } })).json();
    assertEq(ore, { disponibile: false }); assertEq(saldi, { disponibile: false });
  });

  console.log('\n--- con bustapaga + presenze: righe e saldi separati per proprietario ---');
  addModule('busta-paga', 'Busta Paga', [F('periodo', 'Periodo', 'date'), F('netto', 'Netto', 'currency'), F('ore_pagate', 'Ore pagate', 'number'), F('ferie_saldo', 'Ferie residue', 'number'), F('permessi_saldo', 'Permessi residui', 'number'), F('rol_saldo', 'ROL residui', 'number'), F('periodo_label', 'Periodo (etichetta)', 'text'), F('proprietario', 'Di chi è', 'select', { options: ['Nima', 'Fede'] })]);
  roles.set('busta-paga', { kind: 'bustapaga', uses: [], roles: { data: 'periodo', netto: 'netto', ore_pagate: 'ore_pagate' } });
  addModule('timbrature', 'Timbrature', [F('data', 'Data', 'date'), F('entrata', 'Entrata', 'text'), F('uscita', 'Uscita', 'text')]);
  roles.set('timbrature', { kind: 'presenze', uses: [], roles: { data: 'data', inizio: 'entrata', fine: 'uscita' } });

  const put = (slug, d, uid) => db.prepare('INSERT INTO records (module_slug, user_id, data) VALUES (?, ?, ?)').run(slug, uid, JSON.stringify(d)).lastInsertRowid;
  put('busta-paga', { periodo: '2026-09-01', periodo_label: 'Settembre', netto: 1900, ore_pagate: 168, ferie_saldo: 10, permessi_saldo: 2, rol_saldo: 4, proprietario: 'Nima' }, 5);
  put('busta-paga', { periodo: '2026-09-01', periodo_label: 'Settembre', netto: 1500, ore_pagate: 150, ferie_saldo: 20, permessi_saldo: 6, rol_saldo: 8, proprietario: 'Fede' }, 6);
  put('timbrature', { data: '2026-09-05', entrata: '08:00', uscita: '16:00' }, 6);
  put('timbrature', { data: '2026-09-12', entrata: '08:00', uscita: '16:00' }, 6); // 16h timbrate per Fede, niente per Nima

  await test('/ore: Nima vede solo la sua riga, nessuna timbratura sua -> timbrate null', async () => {
    const r = await (await fetch(BASE + '/api/busta-paga-report/ore', { headers: { Authorization: 'Bearer ' + tokNima } })).json();
    assertEq(r.disponibile, true); assertEq(r.ha_timbrature, true);
    assertEq(r.righe.length, 1); assertEq(r.righe[0].pagate, 168); assertEq(r.righe[0].timbrate, null);
  });
  await test('/ore: Fede vede solo la sua riga, con lo scarto vero contro le sue timbrature (16h contro 150h pagate)', async () => {
    const r = await (await fetch(BASE + '/api/busta-paga-report/ore', { headers: { Authorization: 'Bearer ' + tokFede } })).json();
    assertEq(r.righe.length, 1); assertEq(r.righe[0].pagate, 150); assertEq(r.righe[0].timbrate, 16); assertEq(r.righe[0].diff, -134);
  });
  await test('/saldi: ciascuno i propri (Fede 20/6/8, Nima 10/2/4), mai quelli dell\'altro', async () => {
    const sN = await (await fetch(BASE + '/api/busta-paga-report/saldi', { headers: { Authorization: 'Bearer ' + tokNima } })).json();
    const sF = await (await fetch(BASE + '/api/busta-paga-report/saldi', { headers: { Authorization: 'Bearer ' + tokFede } })).json();
    assertEq([sN.ferie.valore, sN.permessi.valore, sN.rol.valore], [10, 2, 4]);
    assertEq([sF.ferie.valore, sF.permessi.valore, sF.rol.valore], [20, 6, 8]);
  });

  console.log('\n--- vista mista (chi guarda non è né Nima né Fede: vede entrambi insieme) ---');
  await test('bug reale del 25/10/2026: chi vede più persone insieme ha le ore timbrate GIUSTE per ciascuna riga, non quelle di chi guarda ripetute due volte', async () => {
    const loginAdmin = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: process.env.INITIAL_ADMIN_PASSWORD }) })).json();
    const r = await (await fetch(BASE + '/api/busta-paga-report/ore', { headers: { Authorization: 'Bearer ' + loginAdmin.token } })).json();
    assertEq(r.righe.length, 2, 'vede le righe di entrambi (nessuna corrispondenza proprietario per "Admin")');
    const righeNima = r.righe.filter((x) => x.proprietario === 'Nima');
    const righeFede = r.righe.filter((x) => x.proprietario === 'Fede');
    assertEq(righeNima.length, 1); assertEq(righeFede.length, 1);
    assertEq(righeNima[0].timbrate, null, 'Nima non ha timbrature sue: resta null, non quelle di Fede');
    assertEq(righeFede[0].timbrate, 16, 'Fede: le sue 16h vere, non quelle (nulle) di Nima');
  });

  console.log(`\n${passed} passati, ${failed} falliti su ${passed + failed} test.`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('ERRORE FATALE', e); process.exit(1); });
