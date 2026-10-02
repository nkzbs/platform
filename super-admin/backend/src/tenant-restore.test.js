'use strict';
// F0.1.7.1.C2 (PLATFORM-MASTER-ROADMAP.md), priorità #4 del piano di regression
// (docs/F0-REGRESSION-PLAN.md) — restore da backup (routes/tenants.js, POST
// /:slug/restore/:backupId), la più distruttiva delle operazioni sui tenant
// (sovrascrive il .db corrente) e, prima di questo file, senza alcun test.
//
// Bug reale trovato e corretto in questa stessa sessione durante la scrittura di questo
// test: la copia di sicurezza pre-restore non passava mai `trigger` all'INSERT in
// tenant_backups, quindi finiva col default di colonna 'manual' invece di 'pre-restore'
// — a differenza dell'eliminazione tenant (routes/tenants.js, DELETE /:slug), che passa
// esplicitamente trigger:'pre-delete' a runBackupForTenant. Risultato pre-fix: una copia
// di sicurezza creata dal sistema appariva nell'elenco backup come se l'utente l'avesse
// creata a mano. Il test "la copia di sicurezza ha trigger=pre-restore" sotto è la
// regressione permanente sul fix.
//
// Il container reale (docker-provisioner) non è raggiungibile in questo ambiente di test
// (PROVISIONER_URL punta a una porta locale chiusa apposta) — questo esercita il ramo
// realistico "tenant non in esecuzione/provisioner irraggiungibile" (wasRunning=false),
// che la route stessa tratta come non bloccante (fallisce silenziosamente l'inspect e
// procede comunque col ripristino file). Il ramo "container in esecuzione, stop/start
// riusciti" richiederebbe un vero docker-provisioner: fuori scope per un test che deve
// girare senza Docker — vedi C2 #5.
//
// Eseguire con: node src/tenant-restore.test.js (richiede porta 34570 libera in locale).

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const TEST_PORT = 34570;
const BASE = 'http://localhost:' + TEST_PORT;
const dbPath = path.join(os.tmpdir(), 'tenant-restore-test-' + crypto.randomBytes(6).toString('hex') + '.db');

process.env.DB_PATH = dbPath;
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'tenant_restore_test_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'tenant_restore_test_internal_' + crypto.randomBytes(8).toString('hex');
process.env.PROVISIONER_URL = 'http://127.0.0.1:1'; // porta chiusa, ECONNREFUSED immediato — nessun vero Docker richiesto
process.env.SUPPORT_UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tenant-restore-test-uploads-'));
// BACKUP_ROOT (routes/tenants.js) — di default '/data/backups', non esiste/non è scrivibile
// fuori da un container: override qui, stesso principio di SUPPORT_UPLOAD_DIR sopra.
const backupRootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tenant-restore-test-backuproot-'));
process.env.BACKUP_ROOT = backupRootDir;

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
      const res = await fetch(BASE + '/health');
      if (res.ok) return;
    } catch (e) { /* non ancora in ascolto */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Server Super Admin non pronto entro ' + timeoutMs + 'ms');
}

async function main() {
  require('./index.js');
  await waitForServer(10000);

  const db = require('./db');
  const bcrypt = require('bcryptjs');

  const passwordHash = bcrypt.hashSync('restore_test_pw', 10);
  db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('restore_test_core', ?, 'admin')").run(passwordHash);

  const tenantDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tenant-restore-test-data-'));
  const tenantDbPath = path.join(tenantDir, 'tenant-current.db');
  const backupFilePath = path.join(tenantDir, 'tenant-backup.db');
  fs.writeFileSync(tenantDbPath, 'CONTENUTO ATTUALE DEL TENANT');
  fs.writeFileSync(backupFilePath, 'CONTENUTO DEL BACKUP DA RIPRISTINARE');

  const SLUG = 'restore-test-tenant';
  db.prepare("INSERT INTO tenants (name, slug, port, db_path, status) VALUES ('Tenant Restore Test', ?, 49999, ?, 'active')").run(SLUG, tenantDbPath);
  const backupId = db.prepare("INSERT INTO tenant_backups (tenant_slug, file_path, size_mb, status) VALUES (?, ?, 1, 'ok')").run(SLUG, backupFilePath).lastInsertRowid;
  const failedBackupId = db.prepare("INSERT INTO tenant_backups (tenant_slug, file_path, size_mb, status) VALUES (?, ?, 1, 'failed')").run(SLUG, backupFilePath).lastInsertRowid;

  const loginRes = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'restore_test_core', password: 'restore_test_pw' }),
  });
  const auth = { Authorization: 'Bearer ' + (await loginRes.json()).token, 'Content-Type': 'application/json' };

  console.log('\n--- routes/tenants.js — restore da backup (F0.1.7.1.C2) ---');

  await test('POST /:slug/restore/:backupId su un backup con status "failed" -> 404 (non ripristina mai un backup non valido)', async () => {
    const res = await fetch(BASE + '/api/tenants/' + SLUG + '/restore/' + failedBackupId, { method: 'POST', headers: auth });
    assertEq(res.status, 404);
    assertEq(fs.readFileSync(tenantDbPath, 'utf8'), 'CONTENUTO ATTUALE DEL TENANT', 'il file del tenant non deve essere toccato se il backup non è valido');
  });

  await test('POST /:slug/restore/:backupId su un id inesistente -> 404', async () => {
    const res = await fetch(BASE + '/api/tenants/' + SLUG + '/restore/999999', { method: 'POST', headers: auth });
    assertEq(res.status, 404);
  });

  await test('POST /:slug/restore/:backupId su un tenant inesistente -> 404 (requireTenantScope)', async () => {
    const res = await fetch(BASE + '/api/tenants/tenant-che-non-esiste/restore/' + backupId, { method: 'POST', headers: auth });
    assertEq(res.status, 404);
  });

  await test('POST /:slug/restore/:backupId senza auth -> 401', async () => {
    const res = await fetch(BASE + '/api/tenants/' + SLUG + '/restore/' + backupId, { method: 'POST' });
    assertEq(res.status, 401);
  });

  await test('Restore valido: 200, provisioner irraggiungibile trattato come non bloccante -> restarted:false', async () => {
    const res = await fetch(BASE + '/api/tenants/' + SLUG + '/restore/' + backupId, { method: 'POST', headers: auth });
    const body = await res.json();
    assertEq(res.status, 200);
    assertEq(body.ok, true);
    assertEq(body.restarted, false, 'il provisioner non è raggiungibile in questo test -> wasRunning resta false');
  });

  await test('Il file del tenant ora contiene i byte del backup, non più quelli originali', async () => {
    assertEq(fs.readFileSync(tenantDbPath, 'utf8'), 'CONTENUTO DEL BACKUP DA RIPRISTINARE');
  });

  await test("REGRESSIONE — la copia di sicurezza pre-restore ha trigger='pre-restore' (bug corretto in questa sessione: prima finiva 'manual')", () => {
    const safety = db.prepare("SELECT * FROM tenant_backups WHERE tenant_slug = ? AND trigger = 'pre-restore'").all(SLUG);
    assertEq(safety.length, 1, "deve esistere esattamente una riga con trigger='pre-restore'");
    assertTrue(fs.existsSync(safety[0].file_path), 'il file della copia di sicurezza deve esistere davvero su disco');
    assertEq(fs.readFileSync(safety[0].file_path, 'utf8'), 'CONTENUTO ATTUALE DEL TENANT', 'la copia di sicurezza deve contenere il contenuto PRE-restore, non quello nuovo');
  });

  await test('audit_log registra tenant.restore con backup_id e safety_copy', () => {
    const row = db.prepare("SELECT * FROM audit_log WHERE action = 'tenant.restore' AND target = ?").get(SLUG);
    assertTrue(!!row, 'deve esistere una riga di audit per il restore');
    const details = JSON.parse(row.details);
    assertEq(details.backup_id, backupId);
    assertTrue(!!details.safety_copy);
  });

  console.log(`\n${'='.repeat(60)}`);
  console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
  if (failed > 0) console.log('Falliti: ' + failures.join(', '));

  try { fs.unlinkSync(dbPath); } catch (e) {}
  try { fs.rmSync(tenantDir, { recursive: true, force: true }); } catch (e) {}
  try { fs.rmSync(process.env.SUPPORT_UPLOAD_DIR, { recursive: true, force: true }); } catch (e) {}
  try { fs.rmSync(backupRootDir, { recursive: true, force: true }); } catch (e) {}
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Suite restore backup fallita ad avviarsi:', e);
  process.exit(1);
});
