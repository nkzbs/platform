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
const { estraiImporto, estraiScadenzaGenerica } = require('./gmail-poller');

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
console.log('\n--- scadenza da una bolletta ---');
const RIF = new Date('2026-08-20T00:00:00Z');
const ISO = (t) => estraiScadenzaGenerica(t, RIF);
test('"Rata unica entro il 08.09.2026" è la scadenza, anche se nel testo c\'è la fine del contratto nel 2028 (caso reale A2A)', () => {
  assertEq(ISO('Data di decorrenza 01.05.2026 Data di scadenza del contratto: 30.04.2028\nDATI PER IL PAGAMENTO Rata unica entro il 08.09.2026'), '2026-09-08');
});
test('una data del contratto, di rinnovo o di offerta non è mai la scadenza del pagamento', () => {
  assertEq(ISO('scadenza del contratto 30.04.2028'), null);
  assertEq(ISO('rinnovo il 15/01/2027'), null);
});
test('senza etichette si prende la data più vicina nei prossimi 90 giorni, non la più lontana', () => {
  assertEq(ISO('Emessa il 19/08/2026. Pagamento 08/09/2026. Valida fino al 30/12/2026'), '2026-09-08');
  assertEq(ISO('solo una data lontana 30/04/2028'), null);
});
test('date testuali ("entro il 8 settembre 2026") e date passate ignorate', () => {
  assertEq(ISO('da pagare entro il 8 settembre 2026'), '2026-09-08');
  assertEq(ISO('fattura del 01/07/2026'), null);
});
console.log(`\n${'='.repeat(60)}\n${passed} passati, ${failed} falliti su ${passed + failed} test.`);
process.exit(failed ? 1 : 0);
