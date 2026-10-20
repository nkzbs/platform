'use strict';
// Avviso quando il token Google scade (gmail-poller.js, pollGmail): mai un
// errore rumoroso se Google non è mai stato collegato, ma un avviso vero (una
// sola volta, finché non torna a funzionare) se era collegato e ha smesso.
// Eseguire con: node src/gmail-poller-token-alert.test.js

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const dbPath = path.join(os.tmpdir(), 'gmail-token-alert-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.DB_PATH = dbPath;
process.env.JWT_SECRET = 'gta_secret_' + crypto.randomBytes(8).toString('hex');
process.env.ENCRYPTION_KEY = 'gta_enc_' + crypto.randomBytes(16).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'gta_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gta-uploads-'));

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; }
}
function assertEq(a, e, msg) { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${msg || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); }

// gmail-poller.js destruttura getValidAccessToken al require: va sostituito nella
// cache PRIMA del primo require, non dopo (stesso bisogno di controllarlo a piacere
// da qui, senza una vera telefonata a Google).
let tokenShouldFail = true;
const oauthPath = require.resolve('./routes/google-oauth');
require.cache[oauthPath] = {
  id: oauthPath, filename: oauthPath, loaded: true, exports: {
    getValidAccessToken: async () => { if (tokenShouldFail) throw new Error('Refresh fallito: invalid_grant'); return 'tok_finto'; },
    createCalendarEvent: async () => null,
  },
};

(async () => {
  const db = require('./db');
  require('./features'); // crea tenant_features
  db.exec("INSERT INTO tenant_features (key, enabled) VALUES ('gmail', 1) ON CONFLICT(key) DO UPDATE SET enabled = 1");
  const { pollGmail } = require('./gmail-poller');

  const setGoogle = (connected, notified) => {
    db.prepare("DELETE FROM connections WHERE integration_id = 'google'").run();
    db.prepare("INSERT INTO connections (integration_id, connected, google_token_error_notified) VALUES ('google', ?, ?)").run(connected ? 1 : 0, notified ? 1 : 0);
  };
  const notified = () => db.prepare("SELECT google_token_error_notified FROM connections WHERE integration_id = 'google'").get().google_token_error_notified;

  await test('mai collegato: il token fallisce, nessun avviso segnato (stato normale)', async () => {
    setGoogle(false, false);
    tokenShouldFail = true;
    await pollGmail();
    assertEq(notified(), 0);
  });

  await test('era collegato, il token fallisce: primo avviso segnato', async () => {
    setGoogle(true, false);
    tokenShouldFail = true;
    await pollGmail();
    assertEq(notified(), 1);
  });

  await test('era collegato, il token continua a fallire: resta segnato, non si ripete a ogni giro', async () => {
    // già segnato dal test precedente — un secondo giro non deve "ri-avvisare"
    // (qui verifico solo che il flag resti 1 e il percorso non vada in errore).
    tokenShouldFail = true;
    await pollGmail();
    assertEq(notified(), 1);
  });

  await test('il token torna valido: il flag si azzera, pronto per il prossimo guasto', async () => {
    tokenShouldFail = false;
    await pollGmail();
    assertEq(notified(), 0);
  });

  console.log(`\n${'='.repeat(60)}`);
  console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
  try { fs.unlinkSync(dbPath); } catch (e) {}
  process.exit(failed > 0 ? 1 : 0);
})();
