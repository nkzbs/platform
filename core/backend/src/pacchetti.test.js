'use strict';
// I pacchetti di verticale (seed-blocchi-verticale.js): ricevuti da Super Admin e tenuti nel tenant, attivazione, riconoscimento dei tenant che avevano già applicato
// blocchi, rotta interna POST /api/internal-setup/pacchetto e GET /pacchetti. Il pacchetto vero sta in Super Admin: qui si legge da lì come fa Super Admin per inviarlo.
// Eseguire con: node src/pacchetti.test.js (porta 34861 libera).
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
const CARTELLA_SA = path.join(__dirname, '../../../super-admin/backend/src/pacchetti/mediazione-immobiliare');
const parte = (n) => JSON.parse(fs.readFileSync(path.join(CARTELLA_SA, n + '.json'), 'utf8'));
const PARTI = ['estensioni', 'documenti', 'abbinamenti', 'moduli', 'ruoli', 'relazioni', 'proprieta', 'sezioni', 'dimostrativi', 'guida'];
const VERO = Object.fromEntries(PARTI.map((n) => [n, parte(n)]));
const VUOTO = Object.fromEntries(PARTI.map((n) => [n, {}]));

let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); console.log('  ✓ ' + name); passed++; } catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; } }
const eq = (a, e, m) => { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${m || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m || 'atteso true'); };

async function main() {
  require('./index.js');
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const db = require('./db'); const E = require('./seed-blocchi-verticale');
  const post = (p, body, secret = SECRET) => fetch(BASE + '/api/internal-setup' + p, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-secret': secret }, body: JSON.stringify(body) });

  await test('il core non contiene pacchetti: un tenant nuovo non ne ha, e senza pacchetti attivi non applica niente', async () => {
    eq(E.pacchettiDisponibili(), []); eq(E.pacchettiAttivi(), []); eq(E.statoPacchetti().pacchetti, []);
    await E.run(); eq(db.prepare('SELECT COUNT(*) c FROM seed_applicati').get().c, 0);
    ok(!fs.existsSync(path.join(__dirname, 'pacchetti')), 'nessuna cartella di pacchetti nel core');
  });
  await test('si riceve un pacchetto: nome, forma e dimensione controllati; le parti sconosciute si scartano; si può aggiornare', () => {
    ok(E.riceviPacchetto('../x', 1, VUOTO).errore); ok(E.riceviPacchetto('Maiuscole', 1, VUOTO).errore); ok(E.riceviPacchetto('ok', 1, null).errore); ok(E.riceviPacchetto('ok', 1, []).errore);
    ok(E.riceviPacchetto('ok', 1, { documenti: [] }).errore, 'una parte che non è un oggetto'); ok(E.riceviPacchetto('ok', 1, { documenti: { x: 'a'.repeat(2100000) } }).errore, 'troppo grande');
    eq(E.pacchettiDisponibili(), [], 'niente è entrato');
    eq(E.riceviPacchetto('prova', 3, { ...VUOTO, strana: { a: 1 }, ruoli: { m: { kind: 'x' } } }), { ok: true, versione: 3 });
    eq(Object.keys(E.leggiPacchetto('prova')), PARTI, 'solo le parti conosciute'); eq(E.leggiPacchetto('prova').ruoli, { m: { kind: 'x' } });
    eq(E.riceviPacchetto('prova', 4, VUOTO).versione, 4); eq(E.statoPacchetti().pacchetti, [{ slug: 'prova', versione: 4, attivo: false }]);
    db.prepare('DELETE FROM pacchetti_ricevuti').run();
  });
  await test('un tenant che aveva già applicato blocchi di un pacchetto lo ha attivo da solo (marcatori), una volta sola', () => {
    E.riceviPacchetto('mediazione-immobiliare', 1, VERO);
    const m = E.marcatoriDelPacchetto('mediazione-immobiliare'); ok(m.length > 5, 'i marcatori attesi ci sono');
    eq(E.migraDaMarcatori(), [], 'nessun marcatore: niente da riconoscere');
    db.prepare('INSERT INTO seed_applicati (chiave) VALUES (?)').run(m[0]);
    eq(E.migraDaMarcatori(), ['mediazione-immobiliare']); eq(E.pacchettiAttivi(), ['mediazione-immobiliare']); eq(E.migraDaMarcatori(), [], 'già attivo');
    db.prepare('DELETE FROM seed_applicati').run(); db.prepare('DELETE FROM pacchetti_attivi').run(); db.prepare('DELETE FROM pacchetti_ricevuti').run();
  });
  await test('POST /pacchetto: senza il secret 401; con le parti il pacchetto si riceve, si attiva e si applica (ripetibile); senza parti e sconosciuto 404', async () => {
    eq((await fetch(BASE + '/api/internal-setup/pacchetto', { method: 'POST' })).status, 401);
    const no = await post('/pacchetto', { slug: 'nessuno' }); eq(no.status, 404); ok(/ricevuti/.test((await no.json()).error));
    const male = await post('/pacchetto', { slug: 'x', parti: { documenti: 5 } }); eq(male.status, 400);
    for (let i = 0; i < 2; i++) { const r = await post('/pacchetto', { slug: 'mediazione-immobiliare', versione: 1, parti: VERO }); eq(r.status, 200); eq((await r.json()).attivi, ['mediazione-immobiliare']); }
    const nuova = await post('/pacchetto', { slug: 'mediazione-immobiliare', versione: 2, parti: VERO }); eq(nuova.status, 200);
    const riattiva = await post('/pacchetto', { slug: 'mediazione-immobiliare' }); eq(riattiva.status, 200, 'senza parti riapplica quello ricevuto');
  });
  await test('GET /pacchetti dice cosa ha il tenant: i pacchetti con la versione e i blocchi già applicati; serve il secret', async () => {
    eq((await fetch(BASE + '/api/internal-setup/pacchetti')).status, 401);
    const j = await (await fetch(BASE + '/api/internal-setup/pacchetti', { headers: { 'x-internal-secret': SECRET } })).json();
    eq(j.pacchetti, [{ slug: 'mediazione-immobiliare', versione: 2, attivo: true }]); ok(Array.isArray(j.seed_applicati));
  });

  console.log(`\n${passed} passati, ${failed} falliti`);
  try { fs.unlinkSync(process.env.DB_PATH); } catch (e) {}
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
