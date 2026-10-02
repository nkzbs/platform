'use strict';
// P2 (collaudo operativo 2026-09-03) — POST /modules/registry/:id/install non aveva MAI
// avuto un test automatico, nonostante sia l'azione più usata per popolare un tenant (e
// nonostante il file abbia già due commenti che descrivono bug reali trovati proprio qui:
// slug locale derivato dal NOME invece che dallo slug canonico del Registro — 2026-08-29 —
// e dipendenze duplicate per non aver controllato anche registry_slug — 2026-08-30).
//
// Un finto Super Admin (http.Server locale, stesso principio già usato in
// tenant-status-reconciler.test.js) sta al posto del vero servizio Registro — SUPER_ADMIN_URL
// punta lì, nessun altro tenant/container reale coinvolto.
//
// Eseguire con: node src/registry-install.test.js (richiede le porte 34590/34591 libere).

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');

const TEST_PORT = 34590;
const FAKE_SUPER_ADMIN_PORT = 34591;
const BASE = 'http://localhost:' + TEST_PORT;
const dbPath = path.join(os.tmpdir(), 'registry-install-test-' + crypto.randomBytes(6).toString('hex') + '.db');

process.env.DB_PATH = dbPath;
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'registry_install_test_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'registry_install_test_internal_' + crypto.randomBytes(8).toString('hex');
process.env.SUPER_ADMIN_URL = 'http://127.0.0.1:' + FAKE_SUPER_ADMIN_PORT;
process.env.TENANT_SLUG = 'ri-test-tenant';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'registry-install-test-uploads-'));

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
function assertTrue(cond, msg) { if (!cond) throw new Error(msg || 'atteso true'); }

// Registro finto: un elenco di moduli pubblicati (usato dal path "installa dipendenza
// mancante automaticamente") + una install-per-id che restituisce il payload REALE che
// il vero Super Admin darebbe (id/name/slug/schema_json/...).
const REGISTRY_MODULES = [
  { id: 501, name: 'Clienti', slug: 'clienti_generico', requires_license: false, schema_json: JSON.stringify({ fields: [{ key: 'nome', type: 'text' }] }) },
];

function startFakeSuperAdmin() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://x');
      if (url.pathname === '/api/registry/public/modules') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(REGISTRY_MODULES.map(({ id, name, slug, requires_license }) => ({ id, name, slug, requires_license }))));
        return;
      }
      const m = url.pathname.match(/^\/api\/registry\/public\/modules\/(\d+)\/install$/);
      if (m) {
        const id = Number(m[1]);
        const mod = REGISTRY_MODULES.find((r) => r.id === id);
        if (!mod) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'non trovato' })); return; }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(mod));
        return;
      }
      res.writeHead(404); res.end();
    });
    server.listen(FAKE_SUPER_ADMIN_PORT, () => resolve(server));
  });
}

async function waitForServer(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const res = await fetch(BASE + '/health'); if (res.ok) return; } catch (e) { /* non ancora in ascolto */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Server Core non pronto entro ' + timeoutMs + 'ms');
}

async function main() {
  const fakeSuperAdmin = await startFakeSuperAdmin();
  require('./index.js');
  await waitForServer(10000);

  const db = require('./db');
  const bcrypt = require('bcryptjs');
  const passwordHash = bcrypt.hashSync('registry_install_pw', 10);
  db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('ri_admin', ?, 'admin')").run(passwordHash);
  const loginRes = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'ri_admin', password: 'registry_install_pw' }) });
  const auth = { Authorization: 'Bearer ' + (await loginRes.json()).token, 'Content-Type': 'application/json' };

  console.log('\n--- modules.js — POST /registry/:id/install (P2, mai testato prima d\'ora) ---');

  await test('installa la dipendenza (clienti_generico, id 501) -> modulo reale installato con slug CANONICO, non uno slugificato dal nome', async () => {
    const res = await fetch(BASE + '/api/modules/registry/501/install', { method: 'POST', headers: auth, body: JSON.stringify({}) });
    assertEq(res.status, 200);
    const body = await res.json();
    // Bug reale del 2026-08-29: prima qui sarebbe stato "clienti" (slug della label
    // "Clienti"), non "clienti_generico" (lo slug canonico del Registro) — le
    // relazioni di altri moduli verso "clienti_generico" sarebbero rimaste orfane.
    assertEq(body.slug, 'clienti_generico');
    const row = db.prepare("SELECT * FROM modules WHERE slug = 'clienti_generico'").get();
    assertTrue(!!row, 'il modulo deve esistere davvero nel DB del tenant');
    assertEq(row.registry_module_id, 501);
  });

  await test('installare un modulo con una relazione verso una dipendenza NON nel registro -> 409, elenco chiaro, nessuna installazione a metà', async () => {
    REGISTRY_MODULES.push({
      id: 502, name: 'Ordini', slug: 'ordini_generico', requires_license: false,
      schema_json: JSON.stringify({ fields: [], relations: [{ target_module: 'fornitori_inesistente' }] }),
    });
    const res = await fetch(BASE + '/api/modules/registry/502/install', { method: 'POST', headers: auth, body: JSON.stringify({}) });
    assertEq(res.status, 409);
    const body = await res.json();
    assertTrue(body.missing_modules.includes('fornitori_inesistente'));
    assertTrue(!db.prepare("SELECT id FROM modules WHERE slug = 'ordini_generico'").get(), 'non deve installarsi finché manca la dipendenza');
  });

  await test('installare un modulo la cui dipendenza ESISTE nel registro (senza licenza) -> auto-installata, entrambi presenti', async () => {
    REGISTRY_MODULES.push({
      id: 503, name: 'Fatture', slug: 'fatture_generico', requires_license: false,
      schema_json: JSON.stringify({ fields: [], relations: [{ target_module: 'pagamenti_generico' }] }),
    });
    REGISTRY_MODULES.push({ id: 504, name: 'Pagamenti', slug: 'pagamenti_generico', requires_license: false, schema_json: JSON.stringify({ fields: [] }) });
    const res = await fetch(BASE + '/api/modules/registry/503/install', { method: 'POST', headers: auth, body: JSON.stringify({}) });
    assertEq(res.status, 200);
    const body = await res.json();
    assertTrue(body.auto_installed.includes('pagamenti_generico'), 'la dipendenza libera deve auto-installarsi, non bloccare');
    assertTrue(!!db.prepare("SELECT id FROM modules WHERE slug = 'fatture_generico'").get());
    assertTrue(!!db.prepare("SELECT id FROM modules WHERE slug = 'pagamenti_generico'").get());
  });

  await test('installare lo STESSO modulo una seconda volta (relazione già soddisfatta dal registry_slug) -> non lo re-installa/duplica', async () => {
    // Bug reale del 2026-08-30: senza controllare anche registry_slug (non solo slug
    // locale), una seconda analisi/installazione che dipende da un modulo già presente
    // lo considerava "mancante" e lo reinstallava da capo — duplicati fino a 5 copie.
    REGISTRY_MODULES.push({
      id: 505, name: 'Note spese', slug: 'note_spese_generico', requires_license: false,
      schema_json: JSON.stringify({ fields: [], relations: [{ target_module: 'clienti_generico' }] }),
    });
    const before = db.prepare("SELECT COUNT(*) as n FROM modules WHERE slug = 'clienti_generico' OR registry_slug = 'clienti_generico'").get().n;
    const res = await fetch(BASE + '/api/modules/registry/505/install', { method: 'POST', headers: auth, body: JSON.stringify({}) });
    assertEq(res.status, 200);
    const after = db.prepare("SELECT COUNT(*) as n FROM modules WHERE slug = 'clienti_generico' OR registry_slug = 'clienti_generico'").get().n;
    assertEq(after, before, 'clienti_generico non deve moltiplicarsi solo perché un altro modulo lo referenzia di nuovo');
  });

  fakeSuperAdmin.close();
  console.log(`\n${'='.repeat(60)}`);
  console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
  if (failed > 0) console.log('Falliti: ' + failures.join(', '));
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Suite registry-install fallita ad avviarsi:', e);
  process.exit(1);
});
