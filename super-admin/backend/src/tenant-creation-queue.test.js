'use strict';
// F8 (PLATFORM-MASTER-ROADMAP.md) — Resource Optimization/G20: creare più tenant hosted in
// burst su un NAS con poca RAM causa swap thrashing (misurato: 90% di fallimento oltre 1-2
// container in contemporanea, vedi gap-analysis). enqueueHostedCreation (routes/tenants.js)
// serializza le creazioni hosted per eliminare il picco di RAM concorrente — questo test
// verifica solo la coda in isolamento (nessun Docker reale coinvolto, non serve): due lavori
// in coda non partono mai in sovrapposizione, e un lavoro fallito non blocca la coda per i
// successivi.
//
// Richiede DB_PATH prima di require('./routes/tenants') perché quel modulo carica ../db al
// require — stesso motivo per cui altri test in questo file impostano process.env PRIMA.
//
// Eseguire con: node src/tenant-creation-queue.test.js

const path = require('path');
const os = require('os');
const crypto = require('crypto');

process.env.DB_PATH = path.join(os.tmpdir(), 'tp-queue-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.JWT_SECRET = 'tq_test_secret';
process.env.INTERNAL_API_SECRET = 'tq_test_internal';

const { enqueueHostedCreation } = require('./routes/tenants');

let passed = 0, failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    console.log('  ✓ ' + name);
    passed++;
  } catch (e) {
    console.error('  ✗ ' + name);
    console.error('    ' + e.message);
    failed++;
    failures.push(name);
  }
}
function assertTrue(cond, msg) { if (!cond) throw new Error(msg || 'atteso true'); }

function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  console.log('\n--- routes/tenants.js — enqueueHostedCreation, serializzazione (F8/G20) ---');

  await test('due lavori accodati non si sovrappongono mai nel tempo', async () => {
    const events = [];
    const jobA = enqueueHostedCreation(async () => {
      events.push('A start');
      await delay(120);
      events.push('A end');
      return 'a';
    });
    // Accodato SUBITO dopo, mentre A è ancora in corso — deve aspettare A.
    const jobB = enqueueHostedCreation(async () => {
      events.push('B start');
      await delay(20);
      events.push('B end');
      return 'b';
    });
    const [a, b] = await Promise.all([jobA, jobB]);
    assertTrue(a === 'a' && b === 'b', 'entrambi i risultati devono arrivare al chiamante giusto');
    assertTrue(
      events.join(',') === 'A start,A end,B start,B end',
      'B non deve iniziare prima che A sia finito, ottenuto: ' + events.join(',')
    );
  });

  await test('un lavoro che fallisce non blocca la coda per i successivi', async () => {
    let thirdRan = false;
    const jobFail = enqueueHostedCreation(async () => { throw new Error('creazione simulata fallita'); });
    const jobAfter = enqueueHostedCreation(async () => { thirdRan = true; return 'ok'; });

    await jobFail.catch(() => {}); // atteso: propaga l'errore al chiamante originale
    const result = await jobAfter;
    assertTrue(result === 'ok' && thirdRan, 'il lavoro dopo un fallimento deve comunque eseguire');
  });

  await test('un lavoro fallito propaga davvero il proprio errore al chiamante (non silenziato)', async () => {
    let threw = false;
    try {
      await enqueueHostedCreation(async () => { throw new Error('errore specifico di questo lavoro'); });
    } catch (e) {
      threw = e.message === 'errore specifico di questo lavoro';
    }
    assertTrue(threw, 'il chiamante deve ricevere il vero errore, non uno generico o nessuno');
  });

  console.log(`\n${'='.repeat(60)}`);
  console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
  if (failed > 0) console.log('Falliti: ' + failures.join(', '));
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Suite tenant-creation-queue fallita ad avviarsi:', e);
  process.exit(1);
});
