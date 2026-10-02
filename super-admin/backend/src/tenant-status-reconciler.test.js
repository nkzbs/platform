'use strict';
// P0 (collaudo operativo 2026-09-03) — tenants.status non si riallineava mai da solo se un
// container si fermava fuori dall'app. Test contro un finto docker-provisioner (http.Server
// locale, non Docker vero, per isolare la logica dal bisogno di un demone reale), controllando esattamente cosa
// risponde /tenants/:slug/inspect per ogni slug.
//
// Eseguire con: node src/tenant-status-reconciler.test.js (richiede le porte 34586/34587 libere).

const path = require('path');
const os = require('os');
const crypto = require('crypto');
const http = require('http');

const TEST_PORT = 34586;
const FAKE_PROVISIONER_PORT = 34587;
const dbPath = path.join(os.tmpdir(), 'tenant-reconcile-test-' + crypto.randomBytes(6).toString('hex') + '.db');

process.env.DB_PATH = dbPath;
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'reconcile_test_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'reconcile_test_internal_' + crypto.randomBytes(8).toString('hex');
process.env.PROVISIONER_URL = 'http://127.0.0.1:' + FAKE_PROVISIONER_PORT;

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
function assertEq(actual, expected, msg) { if (actual !== expected) throw new Error(`${msg || ''}: atteso ${JSON.stringify(expected)}, ottenuto ${JSON.stringify(actual)}`); }

// Finto provisioner: risponde a /tenants/:slug/inspect secondo una mappa slug->stato,
// esattamente come farebbe dockerode con .inspect() reale (solo il campo che ci serve,
// State.Running, il resto del vero payload Docker non è usato da reconcileOne).
const CONTAINER_STATE = {
  'rc-drift-to-stopped': { Running: false },
  'rc-drift-to-active': { Running: true },
  'rc-no-drift': { Running: true },
  // 'rc-missing' — assente di proposito, la richiesta risponderà 404
};

function startFakeProvisioner() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const m = req.url.match(/^\/tenants\/([^/]+)\/inspect$/);
      const slug = m && m[1];
      const state = slug && CONTAINER_STATE[slug];
      if (!state) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'no such container' })); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ State: state }));
    });
    server.listen(FAKE_PROVISIONER_PORT, () => resolve(server));
  });
}

async function main() {
  const fakeProvisioner = await startFakeProvisioner();
  const { reconcileOne } = require('./tenant-status-reconciler');
  const db = require('./db');

  // Contatore deterministico, non Math.random() — con solo 5 inserimenti in questo
  // file un intervallo casuale stretto aveva una probabilità reale di collisione su
  // `tenants.port` (UNIQUE), scoperto da un fallimento vero dell'hook pre-commit.
  let nextPort = 49900;
  function insertTenant(slug, status) {
    db.prepare("INSERT INTO tenants (name, slug, port, db_path, status) VALUES (?, ?, ?, ?, ?)")
      .run(slug, slug, nextPort++, '/tmp/' + slug + '.db', status);
  }
  function tenantStatus(slug) { return db.prepare('SELECT status FROM tenants WHERE slug = ?').get(slug).status; }
  function auditCount(action, slug) { return db.prepare('SELECT COUNT(*) as n FROM audit_log WHERE action = ? AND target = ?').get(action, slug).n; }

  console.log('\n--- tenant-status-reconciler.js — riconciliazione DB<->Docker reale (P0) ---');

  await test('container fermato fuori dall\'app (DB dice active, Docker dice fermo) -> status riallineato a stopped', async () => {
    insertTenant('rc-drift-to-stopped', 'active');
    await reconcileOne({ slug: 'rc-drift-to-stopped', status: 'active' });
    assertEq(tenantStatus('rc-drift-to-stopped'), 'stopped');
    assertEq(auditCount('tenant.status_reconcile', 'rc-drift-to-stopped'), 1, 'deve registrare la correzione in audit_log');
  });

  await test('container avviato fuori dall\'app (DB dice stopped, Docker dice attivo) -> status riallineato ad active', async () => {
    insertTenant('rc-drift-to-active', 'stopped');
    await reconcileOne({ slug: 'rc-drift-to-active', status: 'stopped' });
    assertEq(tenantStatus('rc-drift-to-active'), 'active');
  });

  await test('nessun drift (DB e Docker già d\'accordo) -> nessuna scrittura, nessun audit log', async () => {
    insertTenant('rc-no-drift', 'active');
    await reconcileOne({ slug: 'rc-no-drift', status: 'active' });
    assertEq(tenantStatus('rc-no-drift'), 'active');
    assertEq(auditCount('tenant.status_reconcile', 'rc-no-drift'), 0);
  });

  await test('container inesistente (rimosso fuori dall\'app) -> NON indovina uno status, logga l\'anomalia', async () => {
    insertTenant('rc-missing', 'active');
    await reconcileOne({ slug: 'rc-missing', status: 'active' });
    assertEq(tenantStatus('rc-missing'), 'active', 'lo status non deve essere toccato a caso su un\'anomalia più grave di un semplice stop');
    assertEq(auditCount('tenant.status_reconcile.missing_container', 'rc-missing'), 1);
  });

  fakeProvisioner.close();
  console.log(`\n${'='.repeat(60)}`);
  console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
  if (failed > 0) console.log('Falliti: ' + failures.join(', '));
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Suite tenant-status-reconciler fallita ad avviarsi:', e);
  process.exit(1);
});
