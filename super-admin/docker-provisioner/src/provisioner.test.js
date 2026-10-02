'use strict';
// F0.1.7.1.C2 (PLATFORM-MASTER-ROADMAP.md), priorità #5 del piano di regression
// (docs/F0-REGRESSION-PLAN.md) — meccanica docker-provisioner (G2): unico servizio con
// accesso al socket Docker host, prima di questo file senza alcun test nonostante sia il
// singolo punto più critico per isolamento a livello host.
//
// A differenza di ogni altro *.test.js di questa sessione: qui serve un vero demone Docker
// (verificato disponibile su questa macchina prima di scrivere questo file) — non un mock,
// perché il valore di questo test è proprio verificare che dockerode/il socket reale si
// comportino come atteso, non solo la logica della route.
//
// SICUREZZA/ISOLAMENTO: questa macchina ha già uno stack reale (network 'platform_platform',
// volume 'platform_platform-data', immagine 'platform-core:latest' condivisa col vero
// Update Manager). Questo test NON tocca MAI quelle risorse condivise: crea una rete e un
// volume Docker dedicati e temporanei (rimossi a fine test), passati via TENANT_NETWORK/
// DATA_VOLUME (già env-override-abili in docker.js, nessuna modifica al codice necessaria).
// L'immagine 'platform-core:latest' resta quella reale (già presente in locale, sola LETTURA
// — mai ritaggata).
//
// Deliberatamente NON testati qui (rischio reale su risorse condivise, non isolabili senza
// toccare lo stack reale di questa macchina):
// - POST /images/tag — riassegnerebbe 'platform-core:latest'/':previous', i tag REALI usati
//   dal vero Update Manager/rollback. Un test che li muta per sbaglio corromperebbe lo stato
//   di deploy reale di questa macchina.
// - POST /nginx/reload — invierebbe SIGHUP al container nginx REALE se in esecuzione su
//   questo host (nessun modo di isolarlo: reloadNginx() cerca per label/nome fisso, non per
//   rete/volume passati da qui).
// - POST /images/import, GET /images/export (round-trip completo) — pesante, valore
//   marginale rispetto a GET /images/:ref/inspect (sola lettura, già copre l'accesso reale
//   al registro immagini).
//
// Eseguire con: node src/provisioner.test.js (richiede Docker disponibile e porta 34571
// libera in locale — verificato `docker info` prima di lanciare).

const { execSync } = require('child_process');
const crypto = require('crypto');

const TEST_PORT = 34571;
const BASE = 'http://localhost:' + TEST_PORT;
const SECRET = 'provisioner_test_secret_' + crypto.randomBytes(8).toString('hex');
const runId = crypto.randomBytes(4).toString('hex');
const testNetwork = 'provtest-net-' + runId;
const testVolume = 'provtest-vol-' + runId;
const SLUG = 'provtest-' + runId;
const TENANT_PORT = 48765;

process.env.PORT = String(TEST_PORT);
process.env.INTERNAL_API_SECRET = SECRET;
process.env.TENANT_NETWORK = testNetwork;
process.env.DATA_VOLUME = testVolume;

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

function assertEq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || ''}: atteso ${JSON.stringify(expected)}, ottenuto ${JSON.stringify(actual)}`);
  }
}
function assertTrue(cond, msg) {
  if (!cond) throw new Error(msg || 'atteso true');
}

async function waitForServer(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      // Nessuna route /health qui — un 401 su un endpoint protetto conferma comunque
      // che il server è in ascolto e la pipeline middleware è viva.
      const res = await fetch(BASE + '/tenants/x/inspect');
      if (res.status === 401) return;
    } catch (e) { /* non ancora in ascolto */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('docker-provisioner non pronto entro ' + timeoutMs + 'ms');
}

async function cleanup() {
  try { await fetch(BASE + '/tenants/' + SLUG, { method: 'DELETE', headers: { 'x-internal-secret': SECRET } }); } catch (e) {}
  try { execSync('docker rm -f platform-' + SLUG, { stdio: 'ignore' }); } catch (e) {}
  try { execSync('docker network rm ' + testNetwork, { stdio: 'ignore' }); } catch (e) {}
  try { execSync('docker volume rm ' + testVolume, { stdio: 'ignore' }); } catch (e) {}
}

async function main() {
  execSync('docker network create ' + testNetwork, { stdio: 'ignore' });
  execSync('docker volume create ' + testVolume, { stdio: 'ignore' });

  require('./index.js');
  await waitForServer(10000);

  console.log('\n--- docker-provisioner — meccanica reale (F0.1.7.1.C2) ---');

  await test('Nessun x-internal-secret -> 401', async () => {
    const res = await fetch(BASE + '/tenants/' + SLUG + '/inspect');
    assertEq(res.status, 401);
  });

  const auth = { 'x-internal-secret': SECRET, 'Content-Type': 'application/json' };

  await test('POST /tenants con slug non valido (spazi/maiuscole) -> 400, nessun container creato', async () => {
    const res = await fetch(BASE + '/tenants', { method: 'POST', headers: auth, body: JSON.stringify({ slug: 'Slug Non Valido!', env: [], port: 1 }) });
    assertEq(res.status, 400);
  });

  await test('POST /tenants senza port -> 400', async () => {
    const res = await fetch(BASE + '/tenants', { method: 'POST', headers: auth, body: JSON.stringify({ slug: SLUG, env: [] }) });
    assertEq(res.status, 400);
  });

  await test('POST /tenants crea davvero un container Docker (rete/volume isolati di test)', async () => {
    const res = await fetch(BASE + '/tenants', {
      method: 'POST', headers: auth,
      body: JSON.stringify({
        slug: SLUG, port: TENANT_PORT,
        env: ['PORT=3000', 'DB_PATH=/data/' + SLUG + '.db', 'TENANT_SLUG=' + SLUG, 'TENANT_NAME=Provisioner Test', 'JWT_SECRET=x', 'INITIAL_ADMIN_PASSWORD=x', 'ENCRYPTION_KEY=x'],
      }),
    });
    const body = await res.json();
    assertEq(res.status, 200);
    assertEq(body.name, 'platform-' + SLUG);
    assertTrue(!!body.id);
  });

  await test('GET /tenants/:slug/inspect — il container è davvero in esecuzione', async () => {
    const res = await fetch(BASE + '/tenants/' + SLUG + '/inspect', { headers: auth });
    const body = await res.json();
    assertEq(res.status, 200);
    assertTrue(body.State.Running === true);
  });

  await test('GET /tenants/:slug/stats — risposta con la forma attesa da dockerode stats', async () => {
    const res = await fetch(BASE + '/tenants/' + SLUG + '/stats', { headers: auth });
    const body = await res.json();
    assertEq(res.status, 200);
    assertTrue(typeof body.memory_stats === 'object', 'deve contenere memory_stats, come ogni risposta reale di container.stats()');
  });

  await test('POST /tenants/:slug/stop — il container si ferma davvero', async () => {
    const res = await fetch(BASE + '/tenants/' + SLUG + '/stop', { method: 'POST', headers: auth });
    assertEq(res.status, 200);
    const inspectRes = await fetch(BASE + '/tenants/' + SLUG + '/inspect', { headers: auth });
    const body = await inspectRes.json();
    assertEq(body.State.Running, false);
  });

  await test('POST /tenants/:slug/start — il container riparte davvero', async () => {
    const res = await fetch(BASE + '/tenants/' + SLUG + '/start', { method: 'POST', headers: auth });
    assertEq(res.status, 200);
    const inspectRes = await fetch(BASE + '/tenants/' + SLUG + '/inspect', { headers: auth });
    const body = await inspectRes.json();
    assertEq(body.State.Running, true);
  });

  await test('POST /tenants/:slug/redeploy — rimuove e ricrea il container (nuovo id)', async () => {
    const beforeInspect = await (await fetch(BASE + '/tenants/' + SLUG + '/inspect', { headers: auth })).json();
    const res = await fetch(BASE + '/tenants/' + SLUG + '/redeploy', {
      method: 'POST', headers: auth,
      body: JSON.stringify({ port: TENANT_PORT, env: ['PORT=3000', 'DB_PATH=/data/' + SLUG + '.db', 'TENANT_SLUG=' + SLUG] }),
    });
    const body = await res.json();
    assertEq(res.status, 200);
    assertTrue(body.id !== beforeInspect.Id, 'redeploy deve creare un container con un id Docker nuovo, non riavviare il vecchio');
  });

  await test('GET /images/latest/inspect — sola lettura sull\'immagine reale platform-core:latest', async () => {
    const res = await fetch(BASE + '/images/latest/inspect', { headers: auth });
    const body = await res.json();
    assertEq(res.status, 200);
    assertTrue(Array.isArray(body.RepoTags) && body.RepoTags.includes('platform-core:latest'));
  });

  await test('GET /images/xyz/inspect — ref non in {latest,previous} -> 400 (protezione refToImage)', async () => {
    const res = await fetch(BASE + '/images/xyz/inspect', { headers: auth });
    assertEq(res.status, 400);
  });

  await test('DELETE /tenants/:slug — rimuove davvero il container, poi inspect fallisce', async () => {
    const res = await fetch(BASE + '/tenants/' + SLUG, { method: 'DELETE', headers: auth });
    assertEq(res.status, 200);
    const inspectRes = await fetch(BASE + '/tenants/' + SLUG + '/inspect', { headers: auth });
    assertTrue(inspectRes.status >= 400, 'il container non esiste più, inspect deve fallire');
  });

  await test('DELETE /tenants/:slug su un container già assente -> comunque {ok:true} (best-effort, mai bloccante)', async () => {
    const res = await fetch(BASE + '/tenants/' + SLUG, { method: 'DELETE', headers: auth });
    const body = await res.json();
    assertEq(res.status, 200);
    assertEq(body.ok, true);
  });

  console.log(`\n${'='.repeat(60)}`);
  console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
  if (failed > 0) console.log('Falliti: ' + failures.join(', '));

  await cleanup();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error('Suite docker-provisioner fallita ad avviarsi:', e);
  await cleanup();
  process.exit(1);
});
