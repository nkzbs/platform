'use strict';
// ensureDriveFolder (routes/google-oauth.js): se l'id della cartella salvato si perde
// (successo dal vivo su Finance il 25/10/2026 — l'utente ha chiesto "non è che ricrea
// la cartella ogni volta che riconnetto Google?" prima che diventasse un problema vero),
// NON se ne crea una seconda alla cieca: prima si cerca per nome una già esistente.
// Eseguire con: node src/google-drive-folder.test.js

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const dbPath = path.join(os.tmpdir(), 'drive-folder-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.DB_PATH = dbPath;
process.env.JWT_SECRET = 'dff_secret_' + crypto.randomBytes(8).toString('hex');
process.env.ENCRYPTION_KEY = 'dff_enc_' + crypto.randomBytes(16).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'dff_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dff-uploads-'));
process.env.TENANT_NAME = 'Finance';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; }
}
function assertEq(a, e, msg) { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${msg || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); }

(async () => {
  const db = require('./db');
  const { seal, unseal } = require('./secrets-at-rest');
  const { ensureDriveFolder } = require('./routes/google-oauth');

  const setCreds = (obj) => {
    db.prepare("DELETE FROM connections WHERE integration_id = 'google'").run();
    db.prepare("INSERT INTO connections (integration_id, connected, credentials, connected_at) VALUES ('google', 1, ?, CURRENT_TIMESTAMP)").run(seal(obj));
  };
  const getCreds = () => unseal(db.prepare("SELECT credentials FROM connections WHERE integration_id = 'google'").get().credentials);
  const credsBase = { client_id: 'c', client_secret: 's', access_token: 'tok_valido', token_expiry: Date.now() + 3600000 };

  const calls = [];
  const realFetch = global.fetch;
  let searchResult = { files: [] };
  global.fetch = async (url, opt) => {
    calls.push(String(url));
    if (String(url).includes('/drive/v3/files?q=')) {
      return { ok: true, json: async () => searchResult };
    }
    if (opt && opt.method === 'POST' && String(url).endsWith('/drive/v3/files')) {
      return { ok: true, json: async () => ({ id: 'cartella_nuova' }) };
    }
    throw new Error('chiamata inattesa: ' + url);
  };

  await test('id già salvato: non cerca né crea, usa quello', async () => {
    setCreds({ ...credsBase, drive_folder_id: 'cartella_gia_nota' });
    calls.length = 0;
    const id = await ensureDriveFolder();
    assertEq(id, 'cartella_gia_nota');
    assertEq(calls.length, 0);
  });

  await test('id perso ma la cartella esiste già su Drive: la ritrova per nome, non ne crea una seconda', async () => {
    setCreds({ ...credsBase }); // drive_folder_id assente, come successo davvero
    calls.length = 0;
    searchResult = { files: [{ id: 'cartella_esistente' }] };
    const id = await ensureDriveFolder();
    assertEq(id, 'cartella_esistente');
    assertEq(calls.length, 1, 'solo la ricerca, mai una POST di creazione');
    assertEq(calls[0].includes('mimeType'), true);
    assertEq(getCreds().drive_folder_id, 'cartella_esistente', 'il ritrovamento viene ri-salvato, non si ricerca di nuovo la prossima volta');
  });

  await test('id perso e nessuna cartella già su Drive: la crea, solo in questo caso', async () => {
    setCreds({ ...credsBase });
    calls.length = 0;
    searchResult = { files: [] };
    const id = await ensureDriveFolder();
    assertEq(id, 'cartella_nuova');
    assertEq(calls.length, 2, 'prima cerca, non trova, poi crea');
    assertEq(getCreds().drive_folder_id, 'cartella_nuova');
  });

  global.fetch = realFetch;
  console.log(`\n${'='.repeat(60)}`);
  console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
  try { fs.unlinkSync(dbPath); } catch (e) {}
  process.exit(failed > 0 ? 1 : 0);
})();
