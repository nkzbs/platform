'use strict';
// Non esistono moduli di supporto: ogni modulo è un modulo vero. Qualunque cosa provi a marcarne uno viene azzerata dal database. Eseguire con: node src/no-support-modules.test.js

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const dbPath = path.join(os.tmpdir(), 'nosup-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.DB_PATH = dbPath;
process.env.JWT_SECRET = 'nosup_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'nosup_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nosup-uploads-'));

let passed = 0, failed = 0;
function test(name, fn) { try { fn(); console.log('  ✓ ' + name); passed++; } catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; } }
function assertEq(a, e, msg) { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${msg || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); }

const db = require('./db');
const ins = (slug, sup) => db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json, support_module) VALUES (?, ?, 'box', '#000', 1, 1, 80, '{}', ?)").run(slug, slug, sup);
test('un modulo inserito come "di supporto" (import, installazione, ripristino) risulta un modulo normale', () => {
  ins('righe_ordine', 1);
  assertEq(db.prepare("SELECT support_module FROM modules WHERE slug = 'righe_ordine'").get().support_module, 0);
});
test('provare a marcarlo dopo, con una modifica, non cambia niente', () => {
  ins('altro', 0);
  db.prepare("UPDATE modules SET support_module = 1 WHERE slug = 'altro'").run();
  assertEq(db.prepare("SELECT support_module FROM modules WHERE slug = 'altro'").get().support_module, 0);
});
test('nessun modulo del database è "di supporto"', () => {
  assertEq(db.prepare('SELECT COUNT(*) c FROM modules WHERE support_module != 0').get().c, 0);
});
test('un database esistente con moduli di supporto viene ripulito all\'avvio', () => {
  db.pragma('recursive_triggers = OFF');
  db.exec('DROP TRIGGER modules_no_support_ins; DROP TRIGGER modules_no_support_upd;');
  db.prepare("UPDATE modules SET support_module = 1 WHERE slug IN ('altro', 'righe_ordine')").run();
  assertEq(db.prepare('SELECT COUNT(*) c FROM modules WHERE support_module != 0').get().c, 2, 'prima della pulizia');
  // la stessa istruzione di db.js, rilanciata come all'avvio
  db.exec("UPDATE modules SET support_module = 0 WHERE support_module IS NOT NULL AND support_module != 0;");
  assertEq(db.prepare('SELECT COUNT(*) c FROM modules WHERE support_module != 0').get().c, 0);
});

console.log(`\n${'='.repeat(60)}`);
console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
try { fs.unlinkSync(dbPath); } catch (e) {}
process.exit(failed > 0 ? 1 : 0);
