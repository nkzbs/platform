'use strict';
// Competenza (competenza.js): la scadenza dal giorno dichiarato in poi conta nel mese dopo, e il campo `data` la segue.
// Server reale, DB temporaneo. Eseguire con: node src/competenza.test.js (porta 34812).
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const TEST_PORT = 34812;
const BASE = 'http://localhost:' + TEST_PORT;
const dbPath = path.join(os.tmpdir(), 'competenza-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.DB_PATH = dbPath;
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'comp_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'comp_internal_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'comp_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'comp-uploads-'));
process.env.SUPER_ADMIN_URL = 'http://localhost:1';
process.env.TENANT_SLUG = 'comp';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; }
}
function assertEq(a, e, msg) { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${msg || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); }

const F = (key, label, type) => ({ id: 'f_' + key, block_type: 'field', key, label, type });
const SPESE = { version: 3, steps: [F('descrizione', 'Descrizione', 'text'), F('importo', 'Importo', 'currency'), F('data', 'Data', 'date'), F('scadenza', 'Scadenza', 'date')] };

async function main() {
  const { dataDiCompetenza } = require('./competenza');
  console.log('\n--- il calcolo ---');
  await test('prima del giorno di cambio resta nel mese; dal giorno in poi va al primo del mese dopo; dicembre → gennaio', async () => {
    assertEq(dataDiCompetenza('2026-11-15', 27), '2026-11-15');
    assertEq(dataDiCompetenza('2026-11-26', 27), '2026-11-26');
    assertEq(dataDiCompetenza('2026-11-27', 27), '2026-12-01');
    assertEq(dataDiCompetenza('2026-11-30', 27), '2026-12-01');
    assertEq(dataDiCompetenza('2026-12-31', 27), '2027-01-01');
    assertEq(dataDiCompetenza('2026-11-15', 15), '2026-12-01');
  });
  await test('data non valida, o giorno non valido: nessun risultato', async () => {
    assertEq(dataDiCompetenza('', 27), null); assertEq(dataDiCompetenza('15/11/2026', 27), null);
    assertEq(dataDiCompetenza('2026-11-15', 0), null); assertEq(dataDiCompetenza('2026-11-15', 31), null);
  });

  require('./index.js');
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const db = require('./db');
  const roles = require('./module-roles');
  const add = (slug) => db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES (?, ?, 'box', '#000', 1, 1, 70, ?)").run(slug, slug, JSON.stringify(SPESE));
  const R = { importo: 'importo', data: 'data', scadenza: 'scadenza', descrizione: 'descrizione' };
  add('con'); add('senza');
  roles.set('con', { kind: 'spesa', uses: ['avvisi'], roles: R, competenza: { giorno: 27 } });
  roles.set('senza', { kind: 'spesa', uses: ['avvisi'], roles: R });
  const login = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: process.env.INITIAL_ADMIN_PASSWORD }) })).json();
  const H = { Authorization: 'Bearer ' + login.token, 'Content-Type': 'application/json' };
  const crea = async (slug, body) => (await (await fetch(BASE + '/api/records/' + slug, { method: 'POST', headers: H, body: JSON.stringify(body) })).json());
  const modifica = async (slug, id, body) => (await (await fetch(BASE + '/api/records/' + slug + '/' + id, { method: 'PUT', headers: H, body: JSON.stringify(body) })).json());

  console.log('\n--- nei record ---');
  await test('una voce che scade il 15/11 resta a novembre, una che scade il 28/11 va a dicembre (la data è quella di competenza)', async () => {
    const a = await crea('con', { descrizione: 'A', importo: 10, data: '2026-10-20', scadenza: '2026-11-15' });
    assertEq(a.data.data, '2026-11-15');
    const b = await crea('con', { descrizione: 'B', importo: 10, data: '2026-10-20', scadenza: '2026-11-28' });
    assertEq(b.data.data, '2026-12-01'); assertEq(b.data.scadenza, '2026-11-28', 'la scadenza resta quella vera');
  });
  await test('cambiando la scadenza a mano la data la segue', async () => {
    const a = await crea('con', { descrizione: 'C', importo: 10, data: '2026-10-20', scadenza: '2026-11-15' });
    const m = await modifica('con', a.id, { ...a.data, scadenza: '2026-11-30' });
    assertEq(m.data.data, '2026-12-01');
    const n = await modifica('con', a.id, { ...m.data, scadenza: '2026-11-10' });
    assertEq(n.data.data, '2026-11-10');
  });
  await test('modificando altro (scadenza invariata) la data non si tocca', async () => {
    const a = await crea('con', { descrizione: 'D', importo: 10, data: '2026-10-20', scadenza: '2026-11-28' });
    const m = await modifica('con', a.id, { ...a.data, importo: 99 });
    assertEq(m.data.data, '2026-12-01'); assertEq(m.data.importo, 99);
  });
  await test('se cambi a mano anche la data, vince quella scritta a mano', async () => {
    const a = await crea('con', { descrizione: 'E', importo: 10, data: '2026-10-20', scadenza: '2026-11-15' });
    const m = await modifica('con', a.id, { ...a.data, scadenza: '2026-11-30', data: '2026-11-02' });
    assertEq(m.data.data, '2026-11-02');
  });
  await test('senza scadenza la data non si tocca; un modulo senza competenza non cambia', async () => {
    const a = await crea('con', { descrizione: 'F', importo: 10, data: '2026-10-20' });
    assertEq(a.data.data, '2026-10-20');
    const b = await crea('senza', { descrizione: 'G', importo: 10, data: '2026-10-20', scadenza: '2026-11-28' });
    assertEq(b.data.data, '2026-10-20');
  });
  await test('salvare il ruolo dal Builder senza la competenza non la spegne', async () => {
    roles.set('con', { kind: 'spesa', uses: ['avvisi'], roles: R });
    assertEq(roles.get('con').competenza.giorno, 27);
  });

  console.log('\n--- il valore di partenza sui moduli già in uso ---');
  const FIN = require('./seeds/finance-roles.json');
  const dichiara = (slug, extra) => { db.prepare("INSERT OR IGNORE INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES (?, ?, 'box', '#000', 1, 1, 70, '{}')").run(slug, slug); const cfg = { ...FIN.spese_casa }; delete cfg.competenza; roles.set(slug, cfg); db.prepare('UPDATE module_roles SET extra = ? WHERE module_slug = ?').run(JSON.stringify({ ...JSON.parse(db.prepare('SELECT extra FROM module_roles WHERE module_slug = ?').get(slug).extra), ...extra }), slug); };
  const estra = (slug) => JSON.parse(db.prepare('SELECT extra FROM module_roles WHERE module_slug = ?').get(slug).extra);
  await test('una dichiarazione senza competenza (come su Finance prima dell\'aggiornamento) riceve il 27 all\'avvio, una volta sola', async () => {
    dichiara('spese_casa', {}); const e = estra('spese_casa'); delete e.competenza; db.prepare('UPDATE module_roles SET extra = ? WHERE module_slug = ?').run(JSON.stringify(e), 'spese_casa');
    assertEq(roles.get('spese_casa').competenza.giorno, 0);
    assertEq(roles.seedIfEmpty() >= 1, true);
    assertEq(roles.get('spese_casa').competenza.giorno, 27);
    assertEq(roles.seedIfEmpty(), 0, 'il secondo avvio non cambia niente');
  });
  await test('uno zero lasciato da un salvataggio che non la conosceva viene riempito; uno zero scelto (esplicita) resta spento', async () => {
    dichiara('spese_personali', { competenza: { giorno: 0 } });
    assertEq(roles.seedIfEmpty() >= 1, true); assertEq(roles.get('spese_personali').competenza.giorno, 27);
    roles.set('spese_personali', { ...FIN.spese_personali, competenza: { giorno: 0, esplicita: true } });
    assertEq(roles.seedIfEmpty(), 0); assertEq(roles.get('spese_personali').competenza.giorno, 0);
  });

  console.log(`\n${'='.repeat(60)}`);
  console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
  try { fs.unlinkSync(dbPath); } catch (e) {}
  process.exit(failed > 0 ? 1 : 0);
}
main().catch((e) => { console.error('Suite competenza fallita ad avviarsi:', e); process.exit(1); });
