'use strict';
// I pacchetti di verticale (seed-blocchi-verticale.js): cartella di dati, attivazione per tenant, riconoscimento dei tenant che avevano già applicato un pacchetto,
// e rotta interna POST /api/internal-setup/pacchetto. Eseguire con: node src/pacchetti.test.js (porta 34861 libera).
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const TEST_PORT = 34861, BASE = 'http://localhost:' + TEST_PORT;
process.env.DB_PATH = path.join(os.tmpdir(), 'pacchetti-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'pk_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'pk_internal_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'pk_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-uploads-'));
const SECRET = process.env.INTERNAL_API_SECRET;

let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); console.log('  ✓ ' + name); passed++; } catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; } }
const eq = (a, e, m) => { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${m || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m || 'atteso true'); };

async function main() {
  require('./index.js');
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const db = require('./db'); const E = require('./seed-blocchi-verticale');
  const post = (p, body, secret = SECRET) => fetch(BASE + '/api/internal-setup' + p, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-secret': secret }, body: JSON.stringify(body) });

  await test('i pacchetti si trovano nella cartella dei pacchetti e hanno parti che si leggono', () => {
    const d = E.pacchettiDisponibili(); ok(d.length >= 1 && d.every((x) => /^[a-z0-9-]+$/.test(x)), JSON.stringify(d));
    const P = E.leggiPacchetto(d[0]); eq(Object.keys(P).sort(), ['abbinamenti', 'documenti', 'estensioni', 'moduli', 'proprieta', 'relazioni', 'ruoli', 'sezioni']);
    ok(Object.keys(P.documenti).some((k) => !k.startsWith('_')), 'il pacchetto ha almeno un documento');
    eq(E.leggiPacchetto('../etc'), { estensioni: {}, documenti: {}, abbinamenti: {}, moduli: {}, ruoli: {}, relazioni: {}, proprieta: {}, sezioni: {} }, 'un nome non valido non legge nulla');
  });
  await test('un tenant senza pacchetti attivi non applica niente; attivare un pacchetto che non esiste non fa niente', async () => {
    eq(E.pacchettiAttivi(), []); eq(E.attivaPacchetto('non-esiste'), false); eq(E.attivaPacchetto('../x'), false); eq(E.pacchettiAttivi(), []);
    await E.run(); eq(db.prepare('SELECT COUNT(*) c FROM seed_applicati').get().c, 0);
  });
  await test('un tenant che aveva già applicato blocchi di un pacchetto lo ha attivo da solo (marcatori), una volta sola', () => {
    const slug = E.pacchettiDisponibili()[0], m = E.marcatoriDelPacchetto(slug); ok(m.length > 5, 'i marcatori attesi ci sono');
    eq(E.migraDaMarcatori(), [], 'nessun marcatore: niente da riconoscere');
    db.prepare('INSERT INTO seed_applicati (chiave) VALUES (?)').run(m[0]);
    eq(E.migraDaMarcatori(), [slug]); eq(E.pacchettiAttivi(), [slug]); eq(E.migraDaMarcatori(), [], 'già attivo');
    db.prepare('DELETE FROM seed_applicati').run(); db.prepare('DELETE FROM pacchetti_attivi').run();
  });
  await test('POST /pacchetto: senza il secret 401, pacchetto sconosciuto 404 con i disponibili, noto 200 e attivo (ripetibile)', async () => {
    eq((await fetch(BASE + '/api/internal-setup/pacchetto', { method: 'POST' })).status, 401);
    const no = await post('/pacchetto', { slug: 'nessuno' }); eq(no.status, 404); ok(/disponibili/.test((await no.json()).error));
    eq(E.pacchettiAttivi(), []);
    const slug = E.pacchettiDisponibili()[0];
    for (let i = 0; i < 2; i++) { const r = await post('/pacchetto', { slug }); eq(r.status, 200); eq((await r.json()).attivi, [slug]); }
  });

  console.log(`\n${passed} passati, ${failed} falliti`);
  try { fs.unlinkSync(process.env.DB_PATH); } catch (e) {}
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
