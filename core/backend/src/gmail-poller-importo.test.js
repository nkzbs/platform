'use strict';
// Lettura dell'importo da una bolletta (gmail-poller.js estraiImporto): i consumi (Smc, kWh) non sono euro.
const path = require('path');
const os = require('os');
const crypto = require('crypto');
process.env.DB_PATH = path.join(os.tmpdir(), 'poller-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.JWT_SECRET = 'poller_secret';
process.env.INITIAL_ADMIN_PASSWORD = 'poller_pw';
process.env.UPLOAD_DIR = require('fs').mkdtempSync(path.join(os.tmpdir(), 'poller-uploads-'));
let passed = 0, failed = 0;
function test(name, fn) { try { fn(); console.log('  ✓ ' + name); passed++; } catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; } }
function assertEq(a, e, msg) { if (a !== e) throw new Error(`${msg || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); }
const { estraiImporto } = require('./gmail-poller');

console.log('\n--- importo da una bolletta ---');
test('un consumo di gas "44,000000 Smc" non è letto come 44 euro', () => {
  assertEq(estraiImporto('Consumo totale fatturato del periodo al 31 Luglio 2026 44,000000 Smc regolare'), null);
  assertEq(estraiImporto('Consumo totale fatturato 44,000000 Smc\nTotale da pagare Euro 110,25'), 110.25);
});
test('un consumo di luce "595 kWh" non è un importo; l\'importo vero sì', () => {
  assertEq(estraiImporto('Totale 595 kWh a 0,203 €/kWh\nTotale bolletta: 201,00 €'), 201);
});
test('le bollette normali si leggono come prima', () => {
  assertEq(estraiImporto('Totale da pagare Euro 64,00 entro il 07/09'), 64);
  assertEq(estraiImporto('Importo totale: 1.250,50'), 1250.5);
  assertEq(estraiImporto('nessun importo qui'), null);
});
console.log(`\n${'='.repeat(60)}\n${passed} passati, ${failed} falliti su ${passed + failed} test.`);
process.exit(failed ? 1 : 0);
