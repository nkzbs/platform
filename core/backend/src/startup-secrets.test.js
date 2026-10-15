'use strict';
// G1 (PLATFORM-0.6-GAP-ANALYSIS.md) rivisitato il 2026-10-14 (segnalato
// dall'utente): JWT_SECRET e INTERNAL_API_SECRET erano già nel gate di
// shared/require-strong-secrets.js, ENCRYPTION_KEY no — un avvio in
// produzione senza quella variabile cifrava tutto (campi 'encrypted',
// credenziali dei collegamenti, segreti 2FA) con un valore di default noto a
// chiunque legga il sorgente, apparendo comunque "avviato correttamente".
// Due livelli di prova, non solo che il codice compila:
// 1. requireStrongSecrets() come funzione pura (nessun processo reale).
// 2. index.js VERO lanciato come processo figlio con NODE_ENV=production:
//    deve DAVVERO uscire con codice 1 se manca, e DAVVERO partire se c'è.
// Eseguire con: node src/startup-secrets.test.js

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { requireStrongSecrets } = require('../../../shared/require-strong-secrets');

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.error('  ✗ ' + name); console.error('    ' + e.message); failed++; failures.push(name); }
}
function assertEq(actual, expected, msg) { if (actual !== expected) throw new Error(`${msg || ''}: atteso ${JSON.stringify(expected)}, ottenuto ${JSON.stringify(actual)}`); }

console.log('\n--- requireStrongSecrets() — funzione pura ---');

test('sviluppo (NODE_ENV != production): secret mancante -> solo un avviso, non esce', () => {
  const originalEnv = process.env.NODE_ENV; delete process.env.NODE_ENV;
  const originalExit = process.exit; let exited = false; process.exit = () => { exited = true; };
  try { requireStrongSecrets([{ name: 'ENCRYPTION_KEY', value: undefined, badDefault: 'x' }]); }
  finally { process.exit = originalExit; process.env.NODE_ENV = originalEnv; }
  assertEq(exited, false);
});

test('produzione: secret mancante -> process.exit(1)', () => {
  const originalEnv = process.env.NODE_ENV; process.env.NODE_ENV = 'production';
  const originalExit = process.exit; let code = null; process.exit = (c) => { code = c; };
  try { requireStrongSecrets([{ name: 'ENCRYPTION_KEY', value: undefined, badDefault: 'platform-default-key-change-in-prod' }]); }
  finally { process.exit = originalExit; process.env.NODE_ENV = originalEnv; }
  assertEq(code, 1);
});

test('produzione: secret UGUALE al default noto -> process.exit(1)', () => {
  const originalEnv = process.env.NODE_ENV; process.env.NODE_ENV = 'production';
  const originalExit = process.exit; let code = null; process.exit = (c) => { code = c; };
  try { requireStrongSecrets([{ name: 'ENCRYPTION_KEY', value: 'platform-default-key-change-in-prod', badDefault: 'platform-default-key-change-in-prod' }]); }
  finally { process.exit = originalExit; process.env.NODE_ENV = originalEnv; }
  assertEq(code, 1);
});

test('produzione: secret reale e diverso dal default -> nessuna uscita', () => {
  const originalEnv = process.env.NODE_ENV; process.env.NODE_ENV = 'production';
  const originalExit = process.exit; let exited = false; process.exit = () => { exited = true; };
  try { requireStrongSecrets([{ name: 'ENCRYPTION_KEY', value: 'una_chiave_vera_e_lunga_abbastanza', badDefault: 'platform-default-key-change-in-prod' }]); }
  finally { process.exit = originalExit; process.env.NODE_ENV = originalEnv; }
  assertEq(exited, false);
});

console.log('\n--- index.js VERO, processo figlio, NODE_ENV=production ---');

function spawnIndex(env) {
  return new Promise((resolve) => {
    const dbPath = path.join(os.tmpdir(), 'startup-secrets-test-' + crypto.randomBytes(6).toString('hex') + '.db');
    const child = spawn(process.execPath, ['src/index.js'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, NODE_ENV: 'production', DB_PATH: dbPath, PORT: '0', ...env },
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const timeout = setTimeout(() => { child.kill(); resolve({ timedOut: true, code: null, stdout, stderr }); }, 3000);
    child.on('exit', (code) => { clearTimeout(timeout); resolve({ timedOut: false, code, stdout, stderr }); });
  });
}

(async () => {
  await test2('ENCRYPTION_KEY assente -> il processo VERO esce con codice 1, messaggio nomina ENCRYPTION_KEY', async () => {
    const res = await spawnIndex({ JWT_SECRET: 'jwt_vero_' + crypto.randomBytes(8).toString('hex'), INTERNAL_API_SECRET: 'internal_vero_' + crypto.randomBytes(8).toString('hex') });
    assertEq(res.timedOut, false, 'non doveva restare in esecuzione');
    assertEq(res.code, 1);
    if (!/ENCRYPTION_KEY/.test(res.stderr)) throw new Error('stderr non nomina ENCRYPTION_KEY: ' + res.stderr.slice(0, 300));
  });

  await test2('ENCRYPTION_KEY uguale al default del codice -> esce con codice 1', async () => {
    const res = await spawnIndex({ JWT_SECRET: 'jwt_vero_' + crypto.randomBytes(8).toString('hex'), INTERNAL_API_SECRET: 'internal_vero_' + crypto.randomBytes(8).toString('hex'), ENCRYPTION_KEY: 'platform-default-key-change-in-prod' });
    assertEq(res.timedOut, false);
    assertEq(res.code, 1);
  });

  await test2('tutti e tre i secret reali -> il processo VERO parte (non esce, resta in ascolto)', async () => {
    // In produzione serve anche REDIS_URL (gate separato, non oggetto di
    // questo fix) — qui solo per isolare la prova che ENCRYPTION_KEY non
    // blocca più un avvio altrimenti valido, non per testare Redis.
    const res = await spawnIndex({ JWT_SECRET: 'jwt_vero_' + crypto.randomBytes(8).toString('hex'), INTERNAL_API_SECRET: 'internal_vero_' + crypto.randomBytes(8).toString('hex'), ENCRYPTION_KEY: 'chiave_vera_' + crypto.randomBytes(16).toString('hex'), REDIS_URL: 'redis://localhost:6379/15', UPLOAD_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'startup-secrets-uploads-')) });
    if (!res.timedOut) throw new Error(`uscito con codice ${res.code} invece di restare su.\nstdout: ${res.stdout.slice(-500)}\nstderr: ${res.stderr.slice(-500)}`);
  });

  console.log(`\n${'='.repeat(60)}`);
  console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
  if (failed > 0) { console.log('Falliti: ' + failures.join(', ')); process.exit(1); }
  process.exit(0);
})();

async function test2(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.error('  ✗ ' + name); console.error('    ' + e.message); failed++; failures.push(name); }
}
