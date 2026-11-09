'use strict';
// La foto giornaliera di Analytics (lib/analytics.js) deve riuscire anche su database nati prima della rimozione dei partner,
// dove metrics_snapshots ha ancora la colonna obbligatoria total_partners. Nessun server: solo il database.
const path = require('path'), os = require('os'), crypto = require('crypto');
process.env.DB_PATH = path.join(os.tmpdir(), 'analytics-snap-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.JWT_SECRET = 'x_' + crypto.randomBytes(8).toString('hex');
const assert = require('assert');
const db = require('./db');
const { captureSnapshot } = require('./lib/analytics');

let failed = 0;
async function test(nome, fn) { try { await fn(); console.log('  ✓ ' + nome); } catch (e) { failed++; console.log('  ✗ ' + nome + '\n    ' + (e && e.message)); } }

(async () => {
  await test('tabella attuale: la foto si scrive e si aggiorna nello stesso giorno', async () => {
    await captureSnapshot('2026-11-01'); await captureSnapshot('2026-11-01');
    assert.strictEqual(db.prepare("SELECT COUNT(*) n FROM metrics_snapshots WHERE snapshot_date = '2026-11-01'").get().n, 1);
  });
  await test('tabella vecchia con total_partners NOT NULL: la foto riesce e la colonna vale 0', async () => {
    db.exec('DROP TABLE metrics_snapshots; CREATE TABLE metrics_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, snapshot_date TEXT NOT NULL UNIQUE, total_partners INTEGER NOT NULL, total_tenants INTEGER NOT NULL, total_modules_installed INTEGER NOT NULL, currency TEXT DEFAULT \'EUR\', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)');
    await captureSnapshot('2026-11-02');
    const r = db.prepare("SELECT * FROM metrics_snapshots WHERE snapshot_date = '2026-11-02'").get();
    assert.ok(r && r.total_partners === 0 && r.total_tenants >= 0);
  });
  console.log('\n' + (2 - failed) + ' passati, ' + failed + ' falliti');
  process.exit(failed ? 1 : 0);
})();
