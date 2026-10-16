'use strict';
// Segreti a riposo in Super Admin (secrets-at-rest.js): il segreto del 2FA sta cifrato nel registro; il vecchio formato in chiaro si legge e si migra. Eseguire con: node src/secrets-at-rest.test.js
const path = require('path'); const os = require('os'); const crypto = require('crypto');
process.env.DB_PATH = path.join(os.tmpdir(), 'sa-secrets-test-' + crypto.randomBytes(6).toString('hex') + '.db');
let passed = 0, failed = 0;
function test(name, fn) { try { fn(); console.log('  ✓ ' + name); passed++; } catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; } }
const eq = (a, e, m) => { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${m || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m || 'atteso true'); };
const db = require('./db'); const sar = require('./secrets-at-rest');

test('si cifra e si rilegge; il cifrato non contiene il segreto; il vecchio in chiaro si legge; manomesso o vuoto = assente', () => {
  const s = sar.sealText('JBSWY3DPEHPK3PXP'); ok(s.startsWith('enc:') && !s.includes('JBSWY3DP'), s); eq(sar.unsealText(s), 'JBSWY3DPEHPK3PXP');
  eq(sar.unsealText('JBSWY3DPEHPK3PXP'), 'JBSWY3DPEHPK3PXP'); eq(sar.unsealText(''), null); eq(sar.unsealText(null), null);
  eq(sar.unsealText(s.slice(0, -2) + 'zz'), null, 'manomesso → assente, mai un testo di errore come segreto');
});
test('la migrazione cifra i segreti 2FA in chiaro senza cambiarli e non fa niente la seconda volta', () => {
  db.prepare("INSERT INTO users (username, password_hash, role, totp_secret, totp_enabled) VALUES ('legacy', 'x', 'admin', 'KRSXG5DSNFXGOIDB', 1)").run();
  const m = sar.migrate(); eq([m.totp, m.falliti], [1, 0]);
  const v = db.prepare("SELECT totp_secret FROM users WHERE username = 'legacy'").get().totp_secret; ok(v.startsWith('enc:') && !v.includes('KRSXG5')); eq(sar.unsealText(v), 'KRSXG5DSNFXGOIDB');
  eq(sar.migrate().totp, 0, 'idempotente');
});
console.log(`\n${'='.repeat(60)}\n${passed} passati, ${failed} falliti su ${passed + failed} test.`);
try { require('fs').unlinkSync(process.env.DB_PATH); } catch (e) {}
process.exit(failed > 0 ? 1 : 0);
