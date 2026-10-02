'use strict';
// P3 (collaudo operativo 2026-09-03) — audit_log/error_logs non avevano mai retention,
// crescevano per sempre. Test diretto su purgeOldLogs(), nessun server HTTP necessario
// (funzione pura sul DB, stesso principio di reconcileOne in tenant-status-reconciler.test.js).
//
// Eseguire con: node src/audit-retention-scheduler.test.js

const path = require('path');
const os = require('os');
const crypto = require('crypto');

process.env.DB_PATH = path.join(os.tmpdir(), 'audit-retention-test-' + crypto.randomBytes(6).toString('hex') + '.db');

let passed = 0, failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
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

const db = require('./db');
const { purgeOldLogs, RETENTION_DAYS } = require('./audit-retention-scheduler');

function isoDaysAgo(days) { return new Date(Date.now() - days * 86400000).toISOString(); }

console.log('\n--- audit-retention-scheduler.js — retention reale (P3, prima nessuna) ---');

test('una riga più vecchia della soglia viene eliminata, una più recente resta', () => {
  db.prepare('INSERT INTO audit_log (actor, action, target, created_at) VALUES (?, ?, ?, ?)').run('t', 'test.old', 'old-row', isoDaysAgo(RETENTION_DAYS + 10));
  db.prepare('INSERT INTO audit_log (actor, action, target, created_at) VALUES (?, ?, ?, ?)').run('t', 'test.recent', 'recent-row', isoDaysAgo(1));
  const result = purgeOldLogs();
  assertEq(result.auditDeleted, 1);
  assertEq(db.prepare("SELECT id FROM audit_log WHERE target = 'old-row'").get(), undefined, 'la riga vecchia deve essere sparita');
  const recent = db.prepare("SELECT id FROM audit_log WHERE target = 'recent-row'").get();
  assertEq(!!recent, true, 'la riga recente deve restare');
});

test('stesso comportamento su error_logs', () => {
  db.prepare('INSERT INTO error_logs (route, method, message, created_at) VALUES (?, ?, ?, ?)').run('/x', 'GET', 'vecchio', isoDaysAgo(RETENTION_DAYS + 5));
  db.prepare('INSERT INTO error_logs (route, method, message, created_at) VALUES (?, ?, ?, ?)').run('/y', 'GET', 'recente', isoDaysAgo(2));
  const result = purgeOldLogs();
  assertEq(result.errorDeleted, 1);
});

test('una riga ESATTAMENTE alla soglia (mai eliminata per un solo giorno di margine) resta', () => {
  db.prepare('INSERT INTO audit_log (actor, action, target, created_at) VALUES (?, ?, ?, ?)').run('t', 'test.boundary', 'boundary-row', isoDaysAgo(RETENTION_DAYS - 1));
  purgeOldLogs();
  const row = db.prepare("SELECT id FROM audit_log WHERE target = 'boundary-row'").get();
  assertEq(!!row, true, 'una riga appena dentro la soglia non deve essere toccata');
});

console.log(`\n${'='.repeat(60)}`);
console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
if (failed > 0) console.log('Falliti: ' + failures.join(', '));
process.exit(failed > 0 ? 1 : 0);
