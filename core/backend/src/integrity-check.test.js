'use strict';
// Controllo di integrità all'avvio (integrity-check.js) — dopo l'incidente reale del
// 25/10/2026 (un database sbagliato montato, passato inosservato per ore). Niente server
// HTTP qui: solo la logica pura (fingerprint, lettura/scrittura del riferimento, confronto).
// Eseguire con: node src/integrity-check.test.js

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'integrity-test-'));
process.env.DB_PATH = path.join(dataDir, 'tenant.db');
process.env.TENANT_SLUG = 'prova';
process.env.JWT_SECRET = 'ic_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'ic_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ic-uploads-'));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; }
}
function assertEq(a, e, msg) { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${msg || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); }

const db = require('./db');
const { checkIntegrity, accettaStatoAttuale, baselinePath } = require('./integrity-check');
const addModule = (slug) => { db.prepare('DELETE FROM modules WHERE slug = ?').run(slug); db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES (?, ?, 'box', '#000', 1, 1, 50, '{}')").run(slug, slug); };
const addRecords = (slug, n) => { for (let i = 0; i < n; i++) db.prepare('INSERT INTO records (module_slug, user_id, data) VALUES (?, NULL, ?)').run(slug, '{}'); };

test('il file di riferimento vive FUORI dal percorso del .db (accanto, legato al TENANT_SLUG, non al nome del file)', () => {
  const p = baselinePath();
  assertEq(path.dirname(p), dataDir);
  assertEq(path.basename(p), '.prova.integrity-baseline.json');
});

test('primo avvio: nessun riferimento ancora -> ok, lo crea senza avvisare nessuno', () => {
  const r = checkIntegrity();
  assertEq(r, { ok: true, primo_avvio: true });
  assertEq(fs.existsSync(baselinePath()), true);
});

test('un secondo avvio identico: ok, nessun avviso', () => {
  addModule('busta-paga'); addModule('spese_casa'); addRecords('spese_casa', 50);
  accettaStatoAttuale(); // simula "questo è lo stato normale, salvato"
  const r = checkIntegrity();
  assertEq(r.ok, true);
});

test('un modulo sparito (il caso reale: busta-paga mancante) -> ok:false, elenca il modulo perso', () => {
  db.prepare("DELETE FROM modules WHERE slug = 'busta-paga'").run();
  const r = checkIntegrity();
  assertEq(r.ok, false);
  assertEq(r.persi, ['busta-paga']);
});

test('non aggiorna MAI da sola il riferimento dopo un\'incongruenza: lo stesso avviso si ripete al giro dopo', () => {
  const r = checkIntegrity(); // stessa situazione di prima, non accettata esplicitamente
  assertEq(r.ok, false);
  assertEq(r.persi, ['busta-paga']);
});

test('accettaStatoAttuale(): da qui in poi lo stato attuale (senza busta-paga) è il nuovo riferimento', () => {
  accettaStatoAttuale();
  const r = checkIntegrity();
  assertEq(r.ok, true);
});

test('un calo drastico dei record (es. da 50 a 5) anche senza perdere moduli -> ok:false', () => {
  db.prepare("DELETE FROM records WHERE module_slug = 'spese_casa'").run();
  addRecords('spese_casa', 5);
  const r = checkIntegrity();
  assertEq(r.ok, false);
  assertEq(r.calo_drastico, true);
});

test('aggiungere un modulo NUOVO (crescita normale) non fa scattare nessun avviso', () => {
  accettaStatoAttuale();
  addModule('entrate');
  const r = checkIntegrity();
  assertEq(r.ok, true);
});

console.log(`\n${passed} passati, ${failed} falliti su ${passed + failed} test.`);
process.exit(failed ? 1 : 0);
