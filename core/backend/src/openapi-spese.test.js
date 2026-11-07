'use strict';
// Le spese di OpenAPI.it: conferma del costo chiesta dal server, registro delle richieste, contatore del mese (produzione e prova separati), tetto mensile, prezzi personalizzati.
// Server vero, DB temporaneo; OpenAPI.it è sostituito da un finto. Eseguire con: node src/openapi-spese.test.js (porta 34871 libera).
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const TEST_PORT = 34871, BASE = 'http://localhost:' + TEST_PORT;
process.env.DB_PATH = path.join(os.tmpdir(), 'oa-spese-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'sp_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'sp_internal_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'sp_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-uploads-'));

let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); console.log('  ✓ ' + name); passed++; } catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; } }
const eq = (a, e, m) => { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${m || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m || 'atteso true'); };

async function main() {
  let sandbox = false, chiamate = 0, fallisci = false;
  require.cache[require.resolve('./lib/openapi-it')] = { id: 'fake', filename: 'fake', loaded: true, exports: {
    credenziali: () => ({ email: 'a@b.it', apiKey: 'x', sandbox }),
    valoreAlMqAvanzato: async () => { chiamate++; if (fallisci) { const e = new Error('Servizio non disponibile'); e.status = 502; throw e; } return { data: { quotazione: { min: '1', med: '2000', max: '3' }, citta: 'Bergamo' } }; },
    comparabili: async () => ({ data: [] }), omi: async () => ({ data: null }),
  } };
  require.cache[require.resolve('./lib/ai-valutazione')] = { id: 'fake-ai', filename: 'fake-ai', loaded: true, exports: { considerazioni: async () => null } };
  require('./index.js');
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const db = require('./db'); const S = require('./lib/openapi-spese');
  const F = (key, type = 'text') => ({ id: 'f_' + key, block_type: 'field', key, label: key, type });
  db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES ('Case', 'case', 'box', '#000', 1, 1, 70, ?)").run(JSON.stringify({ version: 3, steps: [F('via'), F('mq', 'number'), F('valore', 'currency'),
    { id: 'ea1', block_type: 'external_action', key: 'stima', label: 'Stima', adapter: 'valutazione_immobiliare', risultato_in: 'rep', campi: { indirizzo: 'via', superficie: 'mq' }, esito: { valore: 'valore' } }] }));
  const rec = () => db.prepare("INSERT INTO records (module_slug, data) VALUES ('case', ?)").run(JSON.stringify({ via: 'Via Roma 1', mq: 100 })).lastInsertRowid;
  const login = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: process.env.INITIAL_ADMIN_PASSWORD }) })).json();
  const H = { Authorization: 'Bearer ' + login.token, 'Content-Type': 'application/json' };
  const azione = (id, corpo = {}) => fetch(BASE + '/api/records/case/' + id + '/azione/stima', { method: 'POST', headers: H, body: JSON.stringify(corpo) });
  const spese = async () => (await fetch(BASE + '/api/connections/openapi_it/spese', { headers: H })).json();
  const imposta = (corpo, headers = H) => fetch(BASE + '/api/connections/openapi_it/impostazioni', { method: 'PUT', headers, body: JSON.stringify(corpo) });

  await test('senza conferma il server non esegue: 409 con costo (qui ignoto), ambiente, spesa del mese e tetto; nessuna chiamata, nessuna riga', async () => {
    const id = rec(); const r = await azione(id); eq(r.status, 409); const j = await r.json();
    eq([j.code, j.costo, j.noto, j.ambiente, j.speso_mese, j.tetto], ['conferma_costo', null, false, 'produzione', 0, null]); ok(/Valutazione/.test(j.nome));
    eq(chiamate, 0); eq((await spese()).produzione.richieste, 0); eq(JSON.parse(db.prepare('SELECT data FROM records WHERE id = ?').get(id).data).valore, undefined);
  });
  await test('con la conferma esegue e registra la spesa; un prezzo scritto dall\'utente entra nel contatore del mese', async () => {
    eq((await imposta({ prezzi: { valutazione_immobiliare: 0.5 } })).status, 200);
    const j = await (await azione(rec())).json(); eq([j.costo, j.noto], [0.5, true], 'ora il prezzo è noto');
    const r = await azione(rec(), { conferma: true }); eq(r.status, 200);
    const s = await spese(); eq([s.produzione.speso, s.produzione.richieste, s.prova.richieste, s.ambiente], [0.5, 1, 0, 'produzione']);
    eq([s.ultime[0].servizio, s.ultime[0].costo, s.ultime[0].utente], ['valutazione_immobiliare', 0.5, 'admin']);
    ok(s.prezzi.find((p) => p.servizio === 'valutazione_immobiliare').personalizzato && s.prezzi.find((p) => p.servizio === 'catasto_ispezione_nazionale').prezzo === 23.7, 'prezzi di listino e personalizzati');
  });
  await test('in ambiente di prova non si paga: la richiesta si registra a parte, e il speso reale resta quello di prima', async () => {
    sandbox = true; const j = await (await azione(rec())).json(); eq(j.ambiente, 'prova');
    eq((await azione(rec(), { conferma: true })).status, 200);
    const s = await spese(); eq([s.produzione.speso, s.produzione.richieste, s.prova.stimato, s.prova.richieste, s.ambiente], [0.5, 1, 0.5, 1, 'prova']); sandbox = false;
  });
  await test('tetto mensile: la richiesta che lo supera è rifiutata (402) senza chiamare il servizio né scrivere; un tetto più alto la sblocca', async () => {
    eq((await imposta({ tetto_mensile: 1 })).status, 200);
    eq((await azione(rec(), { conferma: true })).status, 200); // 0,5 + 0,5 = 1,0: ancora nel tetto
    const n = chiamate, righe = (await spese()).produzione.richieste;
    const r = await azione(rec(), { conferma: true }); eq(r.status, 402); const j = await r.json(); eq([j.code, j.tetto, j.speso_mese], ['tetto_superato', 1, 1]); ok(/tetto/.test(j.error));
    eq(chiamate, n, 'il servizio non è stato chiamato'); eq((await spese()).produzione.richieste, righe);
    eq((await imposta({ tetto_mensile: 5 })).status, 200); eq((await azione(rec(), { conferma: true })).status, 200);
  });
  await test('se il servizio fallisce non si registra nessuna spesa', async () => {
    const prima = (await spese()).produzione; fallisci = true; const r = await azione(rec(), { conferma: true }); eq(r.status, 502); fallisci = false;
    eq((await spese()).produzione, prima);
  });
  await test('impostazioni: tetto e prezzi validati, servizio sconosciuto rifiutato, null toglie tetto e riporta al listino, solo l\'amministratore', async () => {
    for (const male of [{ tetto_mensile: -1 }, { tetto_mensile: 'tanto' }, { prezzi: { inventato: 1 } }, { prezzi: { catasto_indirizzo: -2 } }, { prezzi: [] }]) eq((await imposta(male)).status, 400, JSON.stringify(male));
    eq((await imposta({ tetto_mensile: null, prezzi: { valutazione_immobiliare: null } })).status, 200);
    const s = await spese(); eq([s.tetto, s.prezzi.find((p) => p.servizio === 'valutazione_immobiliare').prezzo], [null, null]);
    eq((await imposta({ tetto_mensile: 3 }, { 'Content-Type': 'application/json' })).status, 401); eq((await fetch(BASE + '/api/connections/openapi_it/spese')).status, 401);
  });
  await test('il contatore è del mese corrente: le richieste di un altro mese non contano', () => {
    db.prepare("INSERT INTO openapi_spese (quando, servizio, costo, ambiente) VALUES ('2020-01-15 10:00:00', 'catasto_indirizzo', 99, 'produzione')").run();
    const r = S.riepilogo(new Date('2026-11-20T10:00:00Z')); ok(r.produzione.speso < 90, 'il mese vecchio non entra: ' + r.produzione.speso);
    eq(S.riepilogo(new Date('2020-01-31T10:00:00Z')).produzione.speso, 99);
  });

  console.log(`\n${passed} passati, ${failed} falliti`);
  try { fs.unlinkSync(process.env.DB_PATH); } catch (e) {}
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
