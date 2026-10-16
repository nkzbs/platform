'use strict';
// Proprietario delle righe automatiche PER MODULO (record-owner.js + module-roles.js): riga d'origine → proprietario del modulo → predefinito del progetto → nessuno.
// Eseguire con: node src/record-owner-modulo.test.js

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

process.env.DB_PATH = path.join(os.tmpdir(), 'owner-modulo-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.JWT_SECRET = 'owner_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'owner_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'owner-uploads-'));

let passed = 0, failed = 0;
function test(name, fn) { try { fn(); console.log('  ✓ ' + name); passed++; } catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; } }
const eq = (a, e, msg) => { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${msg || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); };

const db = require('./db');
const roles = require('./module-roles');
const owner = require('./record-owner');
const mk = (u) => db.prepare("INSERT INTO users (username, password_hash, display_name, role) VALUES (?, 'x', ?, 'user')").run(u, u).lastInsertRowid;
const nima = mk('nima'), fede = mk('fede'), carlo = mk('carlo');
const addModule = (slug) => db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES (?, ?, 'box', '#000', 1, 1, 50, '{}')").run(slug, slug);
addModule('casa'); addModule('lavoro'); addModule('altro');
roles.set('casa', { kind: 'spesa', roles: { importo: 'importo' } }); roles.set('lavoro', { kind: 'spesa', roles: { importo: 'importo' } }); roles.set('altro', { kind: 'spesa', roles: { importo: 'importo' } });
db.prepare('UPDATE tenant_settings SET default_owner_user_id = ? WHERE id = 1').run(nima);

test('senza proprietario di modulo vale il predefinito del progetto (come prima)', () => {
  eq(owner.ownerFor(null, 'casa'), nima); eq(owner.ownerFor(null, 'lavoro'), nima); eq(owner.ownerFor(null), nima);
});
test('il proprietario scelto per un modulo vince sul predefinito, solo per quel modulo', () => {
  roles.set('casa', { kind: 'spesa', roles: { importo: 'importo' }, owner_user_id: fede });
  eq(roles.get('casa').owner_user_id, fede); eq(owner.ownerFor(null, 'casa'), fede); eq(owner.ownerFor(null, 'lavoro'), nima);
});
test('la riga che ha generato quella nuova vince su tutto (le rate di un piano sono di chi ha creato il piano)', () => {
  const rid = db.prepare("INSERT INTO records (module_slug, user_id, data) VALUES ('casa', ?, '{}')").run(carlo).lastInsertRowid;
  eq(owner.ownerFor(rid, 'casa'), carlo);
});
test('salvare i ruoli senza indicare il proprietario NON lo cancella; indicarlo vuoto sì', () => {
  roles.set('casa', { kind: 'spesa', roles: { importo: 'importo', data: 'data' } });
  eq(roles.get('casa').owner_user_id, fede);
  roles.set('casa', { kind: 'spesa', roles: { importo: 'importo' }, owner_user_id: null });
  eq(roles.get('casa').owner_user_id, null); eq(owner.ownerFor(null, 'casa'), nima);
  roles.set('casa', { kind: 'spesa', roles: { importo: 'importo' }, owner_user_id: fede });
});
test('un utente che non esiste più non conta: si ricade sul predefinito', () => {
  roles.set('lavoro', { kind: 'spesa', roles: { importo: 'importo' }, owner_user_id: 9999 });
  eq(owner.ownerFor(null, 'lavoro'), nima);
});
test('le righe senza proprietario passano a chi spetta: prima il proprietario del modulo, poi il predefinito', () => {
  const put = (slug) => db.prepare("INSERT INTO records (module_slug, user_id, data) VALUES (?, NULL, '{}')").run(slug).lastInsertRowid;
  const a = put('casa'), b = put('altro'), c = put('lavoro');
  owner.adoptOrphans();
  const uid = (id) => db.prepare('SELECT user_id u FROM records WHERE id = ?').get(id).u;
  eq([uid(a), uid(b), uid(c)], [fede, nima, nima]);
});

console.log(`\n${'='.repeat(60)}\n${passed} passati, ${failed} falliti su ${passed + failed} test.`);
try { fs.unlinkSync(process.env.DB_PATH); } catch (e) {}
process.exit(failed > 0 ? 1 : 0);
