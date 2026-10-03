'use strict';
// Pulizia dei moduli segnaposto "sito_web" e "sito_avanzato" (legacy-cleanup.js): si tolgono solo se sono davvero vuoti.
const path = require('path');
const os = require('os');
const crypto = require('crypto');
process.env.DB_PATH = path.join(os.tmpdir(), 'cleanup-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.INITIAL_ADMIN_PASSWORD = 'cleanup_pw';
process.env.JWT_SECRET = 'cleanup_secret';

let passed = 0, failed = 0;
function test(name, fn) { try { fn(); console.log('  ✓ ' + name); passed++; } catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; } }
function assertEq(a, e, msg) { if (a !== e) throw new Error(`${msg || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); }

const db = require('./db');
const { removeStubModules } = require('./legacy-cleanup');
const add = (slug, installed, schema) => { db.prepare('DELETE FROM modules WHERE slug = ?').run(slug); db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES (?, ?, 'box', '#000', ?, 1, 90, ?)").run(slug, slug, installed, schema); };
const has = (slug) => !!db.prepare('SELECT 1 FROM modules WHERE slug = ?').get(slug);

console.log('\n--- moduli segnaposto ---');
test('un segnaposto vuoto e non installato si toglie, gli altri moduli restano', () => {
  add('sito_web', 0, '{"version":3,"steps":[]}'); add('sito_avanzato', 0, '{"version":3,"steps":[]}'); add('spese', 1, '{"version":3,"steps":[{"id":"f","block_type":"field","key":"importo"}]}');
  assertEq(removeStubModules().join(), 'sito_web,sito_avanzato');
  assertEq(has('sito_web') || has('sito_avanzato'), false); assertEq(has('spese'), true);
});
test('è idempotente', () => { assertEq(removeStubModules().length, 0); });
test('se è installato, ha dei campi o ha dei record NON si tocca', () => {
  add('sito_web', 1, '{"version":3,"steps":[]}'); assertEq(removeStubModules().length, 0, 'installato'); assertEq(has('sito_web'), true);
  add('sito_web', 0, '{"version":3,"steps":[{"id":"f","block_type":"field","key":"x"}]}'); assertEq(removeStubModules().length, 0, 'con campi'); assertEq(has('sito_web'), true);
  add('sito_web', 0, '{"version":3,"steps":[]}'); db.prepare("INSERT INTO records (module_slug, user_id, data) VALUES ('sito_web', NULL, '{}')").run();
  assertEq(removeStubModules().length, 0, 'con record'); assertEq(has('sito_web'), true);
});
test('uno schema illeggibile non si tocca e non fa errori', () => {
  db.prepare("DELETE FROM records WHERE module_slug = 'sito_web'").run(); add('sito_web', 0, 'non e json');
  assertEq(removeStubModules().length, 0); assertEq(has('sito_web'), true);
});

console.log(`\n${'='.repeat(60)}\n${passed} passati, ${failed} falliti su ${passed + failed} test.`);
process.exit(failed ? 1 : 0);
