'use strict';
// F7 (PLATFORM-MASTER-ROADMAP.md) — Provisioning Engine: `tenants.provisioning_step` tracciato
// da createTenant() (routes/tenants.js) prima di ogni fase. Gate della fase: "se il
// provisioning fallisce a metà, Platform sa esattamente dove è arrivato" — questo test lo
// verifica in due scenari, ciascuno un PROCESSO SEPARATO (non lo stesso processo con
// process.env cambiato a runtime): PROVISIONER_URL in routes/tenants.js è una `const` letta
// UNA VOLTA al require() del modulo, non riletta dinamicamente — scoperto scrivendo questo
// test (un primo tentativo con un solo processo e PROVISIONER_URL cambiato dopo il boot
// falliva silenziosamente, sempre col valore congelato al boot). Comportamento corretto lato
// applicativo (un server non si aspetta che le proprie env var cambino a runtime) — il limite
// era nel test, non nel codice.
//
// Scenario 1 (provisioner-fail.child.js): provider irraggiungibile fin dal boot -> si ferma a
// 'creating_container'. Scenario 2 (provisioner-ok.child.js): un vero docker-provisioner
// avviato PRIMA, stesso principio di isolamento di rete/volume Docker già stabilito in F0.1.7.1.C2
// #5 (provisioner.test.js) — mai le risorse condivise reali di questa macchina.
//
// Nota realistica su Scenario 2: waitForTenantDb() (tenants.js) verifica il file .db con
// fs.existsSync() sul filesystem del PROCESSO CHIAMANTE — in produzione super-admin/backend
// gira SEMPRE dentro un container con lo stesso volume Docker del container tenant, quindi lo
// vede. Un test lanciato con `node` sul Mac host (fuori da Docker) non vede quel volume — non
// un bug applicativo, un limite di come si testa in locale senza un'infrastruttura Docker
// Compose completa per i test (fuori scope qui). Verificato quindi fino al punto davvero
// raggiungibile da questo host: il container Docker nasce per davvero, provisioning_step
// avanza correttamente oltre 'creating_container'.
//
// Eseguire con: node src/tenant-provisioning.test.js (richiede Docker + porte 34579-34581 libere).

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const { execSync, spawn } = require('child_process');

const runId = crypto.randomBytes(4).toString('hex');
const testNetwork = 'tptest-net-' + runId;
const testVolume = 'tptest-vol-' + runId;
const SLUG = 'tptest-' + runId;
const PROVISIONER_PORT = 34581;

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
  if (actual !== expected) throw new Error(`${msg || ''}: atteso ${JSON.stringify(expected)}, ottenuto ${JSON.stringify(actual)}`);
}
function assertTrue(cond, msg) { if (!cond) throw new Error(msg || 'atteso true'); }

async function waitFor(checkFn, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await checkFn()) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('Timeout atteso entro ' + timeoutMs + 'ms');
}

function spawnBackend(port, dbPath, provisionerUrl) {
  return spawn('node', ['src/index.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      DB_PATH: dbPath, PORT: String(port),
      JWT_SECRET: 'tp_test_secret_' + crypto.randomBytes(8).toString('hex'),
      INTERNAL_API_SECRET: 'tp_test_internal_' + crypto.randomBytes(8).toString('hex'),
      PROVISIONER_URL: provisionerUrl,
      SUPPORT_UPLOAD_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'tp-test-uploads-')),
      CLOUDFLARE_API_TOKEN: '',
    },
    stdio: 'ignore',
  });
}

async function loginCore(base) {
  const dbPath = process.env.__lastDbPath;
  const db = new (require('better-sqlite3'))(dbPath);
  const bcrypt = require('bcryptjs');
  db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('tp_core', ?, 'admin')").run(bcrypt.hashSync('tp_test_pw', 10));
  db.close();
  const res = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'tp_core', password: 'tp_test_pw' }) });
  return { Authorization: 'Bearer ' + (await res.json()).token, 'Content-Type': 'application/json' };
}

async function main() {
  // ─── Scenario 1 — fallimento a metà: provisioner irraggiungibile fin dal boot ───────────
  console.log('\n--- tenants.js — provisioning_step, fallimento a metà (F7) ---');
  const port1 = 34579;
  const dbPath1 = path.join(os.tmpdir(), 'tp-test-fail-' + crypto.randomBytes(6).toString('hex') + '.db');
  process.env.__lastDbPath = dbPath1;
  const backend1 = spawnBackend(port1, dbPath1, 'http://127.0.0.1:1'); // porta chiusa, ECONNREFUSED immediato
  try {
    const base1 = 'http://localhost:' + port1;
    await waitFor(() => fetch(base1 + '/health').then((r) => r.ok).catch(() => false), 10000);
    const auth1 = await loginCore(base1);

    const failSlug = 'tp-fail-' + runId;
    await test('POST /tenants con provisioner irraggiungibile -> 500', async () => {
      const res = await fetch(base1 + '/api/tenants', { method: 'POST', headers: auth1, body: JSON.stringify({ name: 'TP Fail Test', slug: failSlug }) });
      assertEq(res.status, 500);
    });

    await test('provisioning_step="creating_container" (ultimo scritto PRIMA della chiamata fallita), status="error", provisioning_error popolato', () => {
      const db = new (require('better-sqlite3'))(dbPath1, { readonly: true });
      const row = db.prepare('SELECT * FROM tenants WHERE slug = ?').get(failSlug);
      db.close();
      assertTrue(!!row, 'il tenant deve comunque esistere come riga (insertedOwnRow)');
      assertEq(row.status, 'error');
      assertEq(row.provisioning_step, 'creating_container');
      assertTrue(!!row.provisioning_error, 'il messaggio di errore deve essere salvato per diagnosi rapida');
    });
  } finally {
    backend1.kill('SIGKILL');
    try { fs.unlinkSync(dbPath1); } catch (e) {}
  }

  // ─── Scenario 2 — Docker reale, fino al limite testabile da questo host ─────────────────
  console.log('\n--- tenants.js — provisioning_step con Docker reale, fino al limite testabile da questo host (F7) ---');
  // L'immagine 'platform-core:latest' è costruita da un job CI SEPARATO (build-and-push-images,
  // dipende dal successo di QUESTO job stesso) — su un runner pulito non esiste ancora quando
  // questo test gira, a differenza di una macchina di sviluppo dove è già stata costruita in
  // precedenza. Skip esplicito e informativo, mai un timeout/fallimento silenzioso — trovato il
  // 2026-08-28 dopo che l'intera suite falliva su CI da quando questo test è stato aggiunto.
  try {
    execSync('docker image inspect platform-core:latest', { stdio: 'ignore' });
  } catch (e) {
    console.log('  ⏭ Scenario 2 saltato — immagine platform-core:latest non presente su questo host (normale su un runner CI pulito, costruita in un job separato)');
    console.log(`\n${'='.repeat(60)}`);
    console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test (Scenario 2 saltato).');
    if (failed > 0) { console.log('Falliti: ' + failures.join(', ')); process.exit(1); }
    process.exit(0);
  }
  let provisionerProc = null;
  let backend2 = null;
  try {
    execSync('docker network create ' + testNetwork, { stdio: 'ignore' });
    execSync('docker volume create ' + testVolume, { stdio: 'ignore' });

    provisionerProc = spawn('node', ['src/index.js'], {
      cwd: path.join(__dirname, '..', '..', 'docker-provisioner'),
      env: { ...process.env, PORT: String(PROVISIONER_PORT), INTERNAL_API_SECRET: 'tp_test_internal_shared', TENANT_NETWORK: testNetwork, DATA_VOLUME: testVolume },
      stdio: 'ignore',
    });
    await waitFor(() => fetch('http://localhost:' + PROVISIONER_PORT + '/tenants/x/inspect').then((r) => r.status === 401).catch(() => false), 20000);

    const port2 = 34580;
    const dbPath2 = path.join(os.tmpdir(), 'tp-test-ok-' + crypto.randomBytes(6).toString('hex') + '.db');
    process.env.__lastDbPath = dbPath2;
    // INTERNAL_API_SECRET deve coincidere tra super-admin/backend e il docker-provisioner
    // appena avviato, altrimenti provisionerRequest riceve 401 — passato esplicito qui invece
    // che lasciato generare a caso da spawnBackend.
    backend2 = spawn('node', ['src/index.js'], {
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env, DB_PATH: dbPath2, PORT: String(port2),
        JWT_SECRET: 'tp_test_secret_2', INTERNAL_API_SECRET: 'tp_test_internal_shared',
        PROVISIONER_URL: 'http://localhost:' + PROVISIONER_PORT,
        SUPPORT_UPLOAD_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'tp-test-uploads2-')),
        CLOUDFLARE_API_TOKEN: '',
      },
      stdio: 'ignore',
    });
    const base2 = 'http://localhost:' + port2;
    await waitFor(() => fetch(base2 + '/health').then((r) => r.ok).catch(() => false), 10000);
    const auth2 = await loginCore(base2);

    // getNextPort() (tenants.js) calcola MAX(port)+1 su QUESTO DB isolato, vuoto —
    // partirebbe da 4001, che su questa macchina di sviluppo è già occupata dal vero
    // container platform-finance (i binding di porta Docker sono globali sull'host,
    // l'isolamento di rete/volume del test non protegge da questo). Riga fittizia con
    // porta alta per spingere il calcolo su un intervallo sicuramente libero — scoperto
    // debuggando provisioning_step bloccato su 'creating_container': il container veniva
    // creato ma non avviato (bind fallita), provisionerRequest tornava 500 prima che
    // tenants.js potesse scrivere 'seeding_database'.
    {
      const seedDb = new (require('better-sqlite3'))(dbPath2);
      seedDb.prepare("INSERT INTO tenants (name, slug, port, db_path, status, encryption_key, jwt_secret, is_sandbox) VALUES ('port seed', 'tp-port-seed', 49999, '/data/tp-port-seed.db', 'error', 'x', 'x', 1)").run();
      seedDb.close();
    }

    await fetch(base2 + '/api/tenants', { method: 'POST', headers: auth2, body: JSON.stringify({ name: 'TP Success Test', slug: SLUG }) });

    await test('Il container Docker reale è stato creato davvero (non un mock)', () => {
      const out = execSync('docker ps -a --filter name=platform-' + SLUG + ' --format "{{.Names}}"').toString().trim();
      assertEq(out, 'platform-' + SLUG);
    });

    await test('provisioning_step è arrivato almeno a "seeding_database" (creating_container superato con successo)', async () => {
      // Breve poll (non un cambio di logica): due processi Node separati che leggono/scrivono
      // lo stesso file SQLite possono avere un margine di sincronizzazione minimo — la fetch
      // sopra ha già atteso la risposta HTTP completa, questo è solo un margine di cortesia.
      let row = null;
      await waitFor(() => {
        const db = new (require('better-sqlite3'))(dbPath2, { readonly: true });
        row = db.prepare('SELECT * FROM tenants WHERE slug = ?').get(SLUG);
        db.close();
        return row && (row.provisioning_step === 'seeding_database' || row.provisioning_step === 'active');
      }, 3000).catch(() => {});
      assertTrue(row && (row.provisioning_step === 'seeding_database' || row.provisioning_step === 'active'),
        'atteso seeding_database o oltre, ottenuto ' + (row && row.provisioning_step));
    });
  } finally {
    if (backend2) backend2.kill('SIGKILL');
    if (provisionerProc) provisionerProc.kill('SIGKILL');
    try { execSync('docker rm -f platform-' + SLUG, { stdio: 'ignore' }); } catch (e) {}
    try { execSync('docker network rm ' + testNetwork, { stdio: 'ignore' }); } catch (e) {}
    try { execSync('docker volume rm ' + testVolume, { stdio: 'ignore' }); } catch (e) {}
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
  if (failed > 0) console.log('Falliti: ' + failures.join(', '));
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Suite provisioning engine fallita ad avviarsi:', e);
  process.exit(1);
});
