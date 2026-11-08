'use strict';
// La guida d'uso (routes/guida.js): i testi dei pacchetti attivi, uniti; vuota senza pacchetti. Più: la guida del pacchetto reale ha la forma giusta e cita solo moduli che esistono.
// Server vero, DB temporaneo. Eseguire con: node src/guida.test.js (porta 34877 libera).
const path = require('path'); const os = require('os'); const fs = require('fs'); const crypto = require('crypto');
const TEST_PORT = 34877, BASE = 'http://localhost:' + TEST_PORT;
process.env.DB_PATH = path.join(os.tmpdir(), 'guida-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'gu_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'gu_internal_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'gu_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gu-uploads-'));
let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); console.log('  ✓ ' + name); passed++; } catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; } }
const eq = (a, e, m) => { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${m || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m || 'atteso true'); };

async function main() {
  require('./index.js');
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const seeds = require('./seed-blocchi-verticale');
  const login = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: process.env.INITIAL_ADMIN_PASSWORD }) })).json();
  const get = () => fetch(BASE + '/api/guida', { headers: { Authorization: 'Bearer ' + login.token } }).then((r) => r.json());

  await test('serve il login; senza pacchetti la guida è assente', async () => {
    eq((await fetch(BASE + '/api/guida')).status, 401); const g = await get(); eq(g.presente, false); eq(g.capitoli, {});
  });
  await test('con due pacchetti attivi i testi si uniscono (il primo vince sui doppioni, flussi e glossario si sommano); un pacchetto non attivo non conta', async () => {
    seeds.riceviPacchetto('aaa', 1, { guida: { introduzione: { titolo: 'A', testo: ['x'] }, capitoli: { m1: { scopo: 'uno' }, m2: { scopo: 'due' } }, flussi: [{ titolo: 'F1', passi: ['p'] }], glossario: [{ termine: 't1', significato: 's' }] } });
    seeds.riceviPacchetto('bbb', 1, { guida: { introduzione: { titolo: 'B', testo: [] }, capitoli: { m2: { scopo: 'altro' }, m3: { scopo: 'tre' } }, flussi: [{ titolo: 'F2', passi: [] }], glossario: [] } });
    seeds.riceviPacchetto('ccc', 1, { guida: { capitoli: { m9: { scopo: 'nascosto' } } } });
    seeds.attivaPacchetto('aaa'); seeds.attivaPacchetto('bbb');
    const g = await get(); eq(g.presente, true); eq(g.introduzione.titolo, 'A'); eq(Object.keys(g.capitoli).sort(), ['m1', 'm2', 'm3']); eq(g.capitoli.m2.scopo, 'due');
    eq(g.flussi.map((f) => f.titolo), ['F1', 'F2']); eq(g.glossario.length, 1);
  });
  await test('la guida del pacchetto reale: forma giusta, capitoli solo per moduli del pacchetto, ogni passo è testo non vuoto', () => {
    const G = require('../../../super-admin/backend/src/pacchetti/mediazione-immobiliare/guida.json');
    const conosciuti = new Set(['clienti', 'immobili', 'trattative', 'provvigioni', 'quote_societarie', 'richieste_privacy', 'attivita', ...Object.keys(require('../../../super-admin/backend/src/pacchetti/mediazione-immobiliare/moduli.json')).filter((k) => !k.startsWith('_'))]);
    ok(G.introduzione.titolo && G.introduzione.testo.length, 'introduzione');
    for (const [k, c] of Object.entries(G.capitoli)) { ok(conosciuti.has(k), 'capitolo di un modulo sconosciuto: ' + k); ok(c.scopo && c.come_si_usa.length, k + ': scopo e passi'); for (const p of [...c.come_si_usa, ...(c.consigli || [])]) ok(typeof p === 'string' && p.trim(), k + ': passo vuoto'); }
    ok(G.per_ruolo.default && G.per_ruolo.admin, 'passi per ruolo'); ok(G.flussi.length && G.flussi.every((f) => f.titolo && f.passi.length), 'flussi'); ok(G.glossario.every((x) => x.termine && x.significato), 'glossario');
  });

  console.log('\n--- giro guidato ---');
  const H = { Authorization: 'Bearer ' + login.token };
  const giro = () => fetch(BASE + '/api/guida/giro', { headers: H }).then((r) => r.json());
  await test('senza passi nei pacchetti il giro è vuoto e non parte', async () => { const g = await giro(); eq(g.passi, []); eq(g.mostra, false); });
  await test('i passi dei pacchetti attivi si uniscono; incompleti e di altri ruoli restano fuori', async () => {
    seeds.riceviPacchetto('ggg', 1, { guida: { giro: [
      { pagina: 'dashboard', titolo: 'Da qui', testo: 'Prima pagina' }, { pagina: 'clienti', titolo: 'Senza testo' }, { pagina: 'impostazioni', titolo: 'Solo admin', testo: 'x', ruoli: ['admin'] },
      { pagina: 'guida', titolo: 'Per altri', testo: 'x', ruoli: ['contabile'] }] } });
    seeds.attivaPacchetto('ggg');
    const g = await giro(); eq(g.passi.map((p) => p.pagina), ['dashboard', 'impostazioni']);
  });
  await test('non parte da solo davanti ai Primi passi (admin, tenant vuoto)', async () => { eq((await giro()).mostra, false); });
  await test('tenant in uso: parte da solo la prima volta, dopo «visto» non più', async () => {
    require('./db').prepare("INSERT INTO records (module_slug, data) VALUES ('x', '{}')").run();
    eq((await giro()).mostra, true);
    eq((await fetch(BASE + '/api/guida/giro/visto', { method: 'POST', headers: H })).status, 200);
    const g = await giro(); eq(g.mostra, false); eq(g.passi.length, 2);
  });
  await test('il giro del pacchetto reale: passi completi, pagine note, ruoli ammessi', () => {
    const G = require('../../../super-admin/backend/src/pacchetti/mediazione-immobiliare/guida.json');
    const note = new Set(['dashboard', 'impostazioni', 'guida', ...Object.keys(G.capitoli)]);
    ok(G.giro.length >= 5, 'giro troppo corto');
    for (const p of G.giro) { ok(p.titolo && p.testo, 'passo incompleto: ' + p.pagina); ok(note.has(p.pagina), 'pagina sconosciuta: ' + p.pagina); ok(!p.ruoli || p.ruoli.every((r) => typeof r === 'string'), 'ruoli'); }
  });

  console.log(`\n${'='.repeat(60)}\n${passed} passati, ${failed} falliti su ${passed + failed} test.`);
  try { fs.unlinkSync(process.env.DB_PATH); } catch (e) {}
  process.exit(failed > 0 ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
