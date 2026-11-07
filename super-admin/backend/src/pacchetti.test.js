'use strict';
// I pacchetti di verticale custoditi in Super Admin (lib/pacchetti.js): lettura con versione, invio al tenant e riallineamento dopo un aggiornamento.
// Il tenant è finto (nessuna rete): si intercetta callTenantAPI. Eseguire con: node src/pacchetti.test.js
const path = require('path');
const os = require('os');
const crypto = require('crypto');
process.env.DB_PATH = path.join(os.tmpdir(), 'pacchetti-sa-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.JWT_SECRET = 'pks_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'pks_internal_' + crypto.randomBytes(8).toString('hex');
process.env.ENCRYPTION_KEY = 'pks_enc_' + crypto.randomBytes(8).toString('hex');

let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); console.log('  ✓ ' + name); passed++; } catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; } }
const eq = (a, e, m) => { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${m || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m || 'atteso true'); };

// il tenant finto: risponde come il core (GET /pacchetti, POST /pacchetto) e registra cosa riceve
const client = require('./lib/tenant-api-client');
let statoTenant = { pacchetti: [], seed_applicati: [] }; const ricevuti = [];
client.callTenantAPI = async (slug, method, p, body) => {
  if (method === 'GET' && p === '/api/internal-setup/pacchetti') return statoTenant;
  if (method === 'POST' && p === '/api/internal-setup/pacchetto') { ricevuti.push({ slug, body }); return { ok: true }; }
  throw new Error('chiamata inattesa ' + method + ' ' + p);
};
const P = require('./lib/pacchetti');

(async () => {
  await test('i pacchetti si leggono dalla cartella: nome, descrizione, versione e tutte le parti', () => {
    ok(P.disponibili().includes('mediazione-immobiliare'));
    const p = P.leggi('mediazione-immobiliare'); eq([p.slug, p.nome, p.versione >= 1], ['mediazione-immobiliare', 'Mediazione immobiliare', true]);
    eq(Object.keys(p.parti), P.PARTI); ok(Object.keys(p.parti.documenti).some((k) => !k.startsWith('_')), 'documenti'); ok(p.parti.moduli.quote_societarie, 'il modulo Quote societarie');
    eq([P.leggi('../x'), P.leggi('non-esiste'), P.leggi(undefined)], [null, null, null]);
    eq(P.elenco().map((x) => Object.keys(x)), [['slug', 'nome', 'descrizione', 'versione']]);
  });
  await test('invia: il tenant riceve slug, versione e tutte le parti; un pacchetto che non esiste dà un errore con i disponibili', async () => {
    await P.invia('zucca', 'mediazione-immobiliare');
    eq(ricevuti.length, 1); eq(ricevuti[0].slug, 'zucca'); eq(Object.keys(ricevuti[0].body).sort(), ['parti', 'slug', 'versione']); eq(Object.keys(ricevuti[0].body.parti), P.PARTI);
    let err = null; try { await P.invia('zucca', 'inventato'); } catch (e) { err = e.message; } ok(/sconosciuto a Super Admin.*mediazione-immobiliare/.test(err), err); eq(ricevuti.length, 1);
  });
  await test('sincronizza: un tenant senza pacchetti né blocchi applicati non riceve niente; con una versione più vecchia riceve; aggiornato non riceve', async () => {
    ricevuti.length = 0; const v = P.leggi('mediazione-immobiliare').versione;
    statoTenant = { pacchetti: [], seed_applicati: [] }; eq(await P.sincronizza('finance'), { inviati: [] }); eq(ricevuti.length, 0);
    statoTenant = { pacchetti: [{ slug: 'mediazione-immobiliare', versione: v - 1 > 0 ? v - 1 : 0, attivo: true }], seed_applicati: [] };
    eq(await P.sincronizza('zucca'), { inviati: ['mediazione-immobiliare'] }); eq(ricevuti.length, 1);
    ricevuti.length = 0; statoTenant = { pacchetti: [{ slug: 'mediazione-immobiliare', versione: v, attivo: true }], seed_applicati: [] };
    eq(await P.sincronizza('zucca'), { inviati: [] }); eq(ricevuti.length, 0);
  });
  await test('sincronizza: un tenant che aveva già applicato blocchi del pacchetto (prima dei pacchetti) lo riceve, una sola volta', async () => {
    ricevuti.length = 0;
    statoTenant = { pacchetti: [], seed_applicati: ['estensione:clienti:profilo_mediazione', 'altro:x'] };
    eq(await P.sincronizza('zucca'), { inviati: ['mediazione-immobiliare'] }); eq(ricevuti.length, 1);
    statoTenant = { pacchetti: [{ slug: 'mediazione-immobiliare', versione: P.leggi('mediazione-immobiliare').versione, attivo: true }], seed_applicati: ['estensione:clienti:profilo_mediazione'] };
    ricevuti.length = 0; eq(await P.sincronizza('zucca'), { inviati: [] });
  });

  console.log(`\n${passed} passati, ${failed} falliti`);
  process.exit(failed ? 1 : 0);
})();
