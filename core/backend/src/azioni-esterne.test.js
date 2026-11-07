'use strict';
// Le azioni esterne (blocco di schema `external_action`, lib/azioni-esterne/, rotta POST /:slug/:id/azione/:key): il blocco dice quale adattatore usare e come i campi del
// modulo si collegano; il codice non conosce nomi di moduli. Server vero, DB temporaneo; il servizio esterno è sostituito da un finto (nessuna chiamata di rete).
// Eseguire con: node src/azioni-esterne.test.js (porta 34863 libera).
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const TEST_PORT = 34863, BASE = 'http://localhost:' + TEST_PORT;
process.env.DB_PATH = path.join(os.tmpdir(), 'azioni-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'az_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'az_internal_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'az_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'az-uploads-'));

let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); console.log('  ✓ ' + name); passed++; } catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; } }
const eq = (a, e, m) => { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${m || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m || 'atteso true'); };

async function main() {
  // il servizio esterno finto, messo nella cache dei moduli PRIMA che l'adattatore lo richieda
  const chiamate = [];
  require.cache[require.resolve('./lib/openapi-it')] = { id: 'fake', filename: 'fake', loaded: true, exports: {
    valoreAlMqAvanzato: async (a) => { chiamate.push(a); return { data: { quotazione: { min: '2500', med: '3000', max: '3500' }, citta: 'Bergamo' } }; },
    comparabili: async () => ({ data: [] }), omi: async () => ({ data: null }),
  } };
  // le «considerazioni» dell'AI sono best-effort e dipendono dal percorso di shared/ del container: qui un finto
  require.cache[require.resolve('./lib/ai-valutazione')] = { id: 'fake-ai', filename: 'fake-ai', loaded: true, exports: { considerazioni: async () => null } };
  require('./index.js');
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const db = require('./db'); const registro = require('./lib/azioni-esterne');
  const F = (key, type = 'text') => ({ id: 'f_' + key, block_type: 'field', key, label: key, type });
  const BLOCCO = { id: 'ea1', block_type: 'external_action', key: 'stima', label: 'Stima', adapter: 'valutazione_immobiliare', connection: 'openapi_it', risultato_in: 'report_stima',
    campi: { indirizzo: 'via', comune: 'citta', provincia: 'prov', tipologia: 'tipo', superficie: 'mq' }, esito: { valore: 'valore', al_mq: 'al_mq', data: 'data_stima', fonte: 'fonte' }, tipologie: { Villa: 1 }, tipologia_predefinita: 20 };
  const add = (slug, steps) => db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES (?, ?, 'box', '#000', 1, 1, 70, ?)").run(slug, slug, JSON.stringify({ version: 3, steps }));
  add('case', [F('via'), F('citta'), F('prov'), F('tipo'), F('mq', 'number'), F('valore', 'currency'), F('al_mq', 'currency'), F('data_stima', 'date'), F('fonte'), BLOCCO]);
  add('altro', [F('x'), { ...BLOCCO, key: 'a', adapter: 'non_esiste' }]);
  const rec = (slug, d) => db.prepare('INSERT INTO records (module_slug, data) VALUES (?, ?)').run(slug, JSON.stringify(d)).lastInsertRowid;
  const login = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: process.env.INITIAL_ADMIN_PASSWORD }) })).json();
  const H = { Authorization: 'Bearer ' + login.token };
  const esegui = (slug, id, key, headers = H) => fetch(BASE + '/api/records/' + slug + '/' + id + '/azione/' + key, { method: 'POST', headers });

  await test('gli adattatori sono un elenco chiuso: un nome qualunque (anche __proto__) non carica nulla', () => {
    ok(registro.adattatore('valutazione_immobiliare'), 'quello vero c\'è');
    eq([registro.adattatore('non_esiste'), registro.adattatore('__proto__'), registro.adattatore('constructor'), registro.adattatore(undefined)], [null, null, null, null]);
  });
  await test('esegue l\'azione dichiarata dal blocco: legge e scrive i campi che il blocco dice, e tiene il report sul record', async () => {
    const id = rec('case', { via: 'Via Roma 1', citta: 'Bergamo', tipo: 'Villa', mq: 100 });
    const r = await esegui('case', id, 'stima'); if (r.status !== 200) throw new Error('stato ' + r.status + ' ' + JSON.stringify(await r.clone().json())); eq(r.status, 200);
    const j = await r.json(); eq(j.ok, true);
    eq(chiamate[chiamate.length - 1], { address: 'Via Roma 1, Bergamo', forSale: true, type: 1 }, 'indirizzo e tipologia dal blocco');
    eq([j.record.data.valore, j.record.data.al_mq, j.record.data.fonte.slice(0, 10)], [300000, 3000, 'OpenAPI.it'], 'valore = €/mq × superficie, nei campi dichiarati');
    ok(/^\d{4}-\d{2}-\d{2}$/.test(j.record.data.data_stima)); ok(j.record.data.report_stima && j.record.data.report_stima.dettaglio, 'report sul record');
    const salvato = JSON.parse(db.prepare('SELECT data FROM records WHERE id = ?').get(id).data); eq(salvato.valore, 300000, 'scritto davvero');
    const senzaTipo = rec('case', { via: 'Via B', mq: 50 }); await esegui('case', senzaTipo, 'stima'); eq(chiamate[chiamate.length - 1].type, 20, 'tipologia non mappata: codice di riserva');
  });
  await test('senza indirizzo né comune: 400 con la spiegazione e nessuna chiamata al servizio', async () => {
    const n = chiamate.length; const id = rec('case', { mq: 80 });
    const r = await esegui('case', id, 'stima'); eq(r.status, 400); ok(/indirizzo o un comune/.test((await r.json()).error)); eq(chiamate.length, n);
  });
  await test('azione che il modulo non dichiara: 404; adattatore sconosciuto: 400; record inesistente: 404; senza accesso: 401', async () => {
    const id = rec('case', { via: 'x' }); eq((await esegui('case', id, 'altra')).status, 404);
    const a = rec('altro', { x: '1' }); const r = await esegui('altro', a, 'a'); eq(r.status, 400); ok(/non conosce/.test((await r.json()).error));
    eq((await esegui('case', 99999, 'stima')).status, 404); eq((await esegui('case', id, 'stima', {})).status, 401);
  });
  await test('il servizio che fallisce non scrive nulla sul record e rimanda l\'errore', async () => {
    const f = require('./lib/openapi-it'); const orig = f.valoreAlMqAvanzato;
    f.valoreAlMqAvanzato = async () => { const e = new Error('Credenziali non valide'); e.status = 502; throw e; };
    const id = rec('case', { via: 'Via C', mq: 10 });
    const r = await esegui('case', id, 'stima'); eq(r.status, 502); eq((await r.json()).error, 'Credenziali non valide');
    eq(JSON.parse(db.prepare('SELECT data FROM records WHERE id = ?').get(id).data), { via: 'Via C', mq: 10 }); f.valoreAlMqAvanzato = orig;
  });

  await test('il blocco del pacchetto di Mediazione immobiliare è applicabile a Immobili e usa un adattatore che esiste', async () => {
    const e = require('../../../super-admin/backend/src/pacchetti/mediazione-immobiliare/estensioni.json').immobili.find((x) => x.key === 'valutazione_mercato');
    const b = e.aggiungi[0];
    eq([b.block_type, b.key], ['external_action', 'valutazione']); ok(registro.adattatore(b.adapter), 'adattatore noto');
    const citati = [...Object.values(b.campi), ...Object.values(b.esito), ...b.richiede_uno_di];
    for (const k of citati) ok(e.richiede.immobili.includes(k), 'il campo «' + k + '» è citato dal blocco ma non tra quelli richiesti dall\'estensione');
  });

  console.log(`\n${passed} passati, ${failed} falliti`);
  try { fs.unlinkSync(process.env.DB_PATH); } catch (e) {}
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
