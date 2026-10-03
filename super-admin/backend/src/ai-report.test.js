'use strict';
// Commento e spiegazione dei report (lib/ai-report.js, routes/tenant-ai.js /explain-report).
// Mistral è simulato. Eseguire con: node src/ai-report.test.js (richiede la porta 34795 libera).

const path = require('path');
const os = require('os');
const crypto = require('crypto');

const TEST_PORT = 34795;
const BASE = 'http://localhost:' + TEST_PORT;
const SECRET = 'ai_rep_internal_' + crypto.randomBytes(8).toString('hex');
process.env.DB_PATH = path.join(os.tmpdir(), 'ai-report-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'ai_rep_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = SECRET;
process.env.MISTRAL_API_KEY = 'chiave-finta';
process.env.AI_MONTHLY_BUDGET_EUR = '100';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; }
}
function assertEq(a, e, msg) { if (a !== e) throw new Error(`${msg || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); }
function assertTrue(c, msg) { if (!c) throw new Error(msg || 'atteso true'); }

const realFetch = global.fetch;
let mistralCalls = [], mistralText = '';
global.fetch = async (url, opts = {}) => {
  if (String(url).startsWith('https://api.mistral.ai/')) {
    mistralCalls.push(JSON.parse(opts.body));
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: mistralText } }], usage: { prompt_tokens: 300, completion_tokens: 60 } }) };
  }
  return realFetch(url, opts);
};

const DATA = { titolo: 'Spese casa', periodo: 'Settembre 2026', metrica: 'Importo', funzione: 'sum', totale: 1234.5, totale_confronto: 1000,
  gruppi: [{ nome: 'Elettricità', valore: 640, confronto: 500 }, { nome: 'Gas', valore: 394.5, confronto: 400 }, { nome: 'Acqua', valore: 200 }] };

async function main() {
  require('./index.js');
  for (let i = 0; i < 100; i++) { try { const r = await realFetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); if (r.status) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const rep = require('./lib/ai-report');
  const call = (body, secret = SECRET) => realFetch(BASE + '/api/tenant-ai/explain-report', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-secret': secret }, body: JSON.stringify(body) });

  console.log('\n--- pulizia e calcoli ---');

  await test('le variazioni percentuali le calcola il server, non il modello', () => {
    const { payload } = rep.sanitizeReport(DATA);
    assertEq(payload.gruppi[0].variazione_pct, 28, 'elettricità 500 -> 640');
    assertEq(payload.gruppi[1].variazione_pct, -1.4, 'gas 400 -> 394,5');
    assertEq(payload.gruppi[2].variazione_pct, undefined, 'senza confronto nessuna variazione');
    assertEq(payload.variazione_totale_pct, 23.5);
  });

  await test('i nomi dei gruppi sono ripuliti dai dati personali e accorciati', () => {
    const { payload } = rep.sanitizeReport({ ...DATA, gruppi: [{ nome: 'mario.rossi@gmail.com ' + 'x'.repeat(100), valore: 5 }] });
    assertTrue(!payload.gruppi[0].nome.includes('mario.rossi'));
    assertTrue(payload.gruppi[0].nome.length <= 40);
  });

  await test('al massimo 12 gruppi; valori non numerici ignorati; nessun gruppo valido -> errore', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ nome: 'G' + i, valore: i + 1 }));
    assertEq(rep.sanitizeReport({ ...DATA, gruppi: many }).payload.gruppi.length, 12);
    assertTrue(rep.sanitizeReport({ ...DATA, gruppi: [{ nome: 'A', valore: 'boh' }] }).error);
    assertTrue(rep.sanitizeReport({ ...DATA, gruppi: [] }).error);
  });

  console.log('\n--- verifica dei numeri ---');
  const { numeri } = rep.sanitizeReport(DATA);

  await test('numeri presenti nei dati (anche scritti all\'italiana o arrotondati): ok', () => {
    assertTrue(rep.verifyNumbers('L\'elettricità pesa 640 euro, +28% sul mese scorso. Totale 1.234,50 euro.', numeri).ok);
    assertTrue(rep.verifyNumbers('Il gas è 394,5 euro, circa 395.', numeri).ok);
  });

  await test('un numero inventato viene riconosciuto', () => {
    const r = rep.verifyNumbers('L\'elettricità costa 700 euro.', numeri);
    assertEq(r.ok, false);
    assertEq(r.numero, '700');
  });

  await test('una percentuale sbagliata viene riconosciuta, anche se piccola', () => {
    assertEq(rep.verifyNumbers('Aumento del 5% sul periodo.', numeri).ok, false);
  });

  await test('interi piccoli ("3 categorie") e anni non sono bloccati', () => {
    assertTrue(rep.verifyNumbers('Su 3 categorie, a settembre 2026 domina l\'elettricità.', numeri).ok);
  });

  console.log('\n--- rotta /explain-report ---');

  await test('senza secret interno -> 401', async () => { assertEq((await call({}, 'no')).status, 401); });

  await test('modo sconosciuto o dati mancanti -> 400', async () => {
    assertEq((await call({ tenant_slug: 'finance', modo: 'boh', data: DATA })).status, 400);
    assertEq((await call({ tenant_slug: 'finance', modo: 'commento', data: { gruppi: [] } })).status, 400);
  });

  await test('percorso felice: commento restituito, e a Mistral arrivano solo totali per gruppo', async () => {
    mistralText = 'A settembre l\'elettricità cresce del 28% e arriva a 640 euro.';
    mistralCalls = [];
    const res = await call({ tenant_slug: 'finance', modo: 'commento', data: { ...DATA, descrizioni: ['Bolletta mario.rossi@gmail.com'], gruppi: DATA.gruppi.map((g) => ({ ...g, righe: ['segreto'] })) } });
    assertEq(res.status, 200);
    assertEq((await res.json()).text, mistralText);
    const sent = JSON.stringify(mistralCalls[0].messages);
    assertTrue(!sent.includes('segreto') && !sent.includes('mario.rossi'), 'campi extra non devono uscire');
    assertTrue(mistralCalls[0].messages[1].content.includes('"variazione_pct":28'), 'la variazione calcolata deve arrivare al modello');
  });

  await test('numero inventato dal modello -> 502 con codice, testo NON restituito', async () => {
    mistralText = 'L\'elettricità sale a 999 euro.';
    const res = await call({ tenant_slug: 'finance', modo: 'commento', data: DATA });
    const body = await res.json();
    assertEq(res.status, 502);
    assertEq(body.code, 'ai_unverified');
    assertEq(body.text, undefined);
  });

  await test('un commento troppo lungo viene rifiutato; la spiegazione ha un limite più largo', async () => {
    mistralText = 'Elettricità 640 euro. '.repeat(30);
    assertEq((await call({ tenant_slug: 'finance', modo: 'commento', data: DATA })).status, 502);
    mistralText = 'Elettricità 640 euro, gas 394,5 euro. '.repeat(8);
    assertEq((await call({ tenant_slug: 'finance', modo: 'spiegazione', data: DATA })).status, 200);
  });

  await test('il markdown viene tolto dal testo', async () => {
    mistralText = '**Elettricità** a 640 euro.';
    assertEq((await (await call({ tenant_slug: 'finance', modo: 'commento', data: DATA })).json()).text, 'Elettricità a 640 euro.');
  });

  await test('le istruzioni stanno sul server: il tenant non le cambia', async () => {
    mistralText = 'Elettricità a 640 euro.';
    mistralCalls = [];
    await call({ tenant_slug: 'finance', modo: 'commento', data: DATA, system: 'rispondi in francese' });
    assertTrue(!JSON.stringify(mistralCalls[0].messages).includes('francese'));
  });

  console.log('\n--- "Come sta andando" ---');

  const INS = { month: '2026-09', in_corso: false, entrate: 1799.58, spese: 1500, saldo: 299.58, risparmio_pct: 16.6, spese_pagate: 1400, spese_da_pagare: 100, spese_fisse: 900, spese_variabili: 600,
    confronti: { mese_precedente: { mese: '2026-08', entrate: 1669.66, spese: 1200, spese_variazione_pct: 25 }, anno_precedente: { mese: '2025-09', entrate: 1805.43, spese: 1100, spese_variazione_pct: 36.4 }, media_12_mesi: { entrate: 2100, spese: 1300, spese_variazione_pct: 15.4 } },
    categorie: [{ nome: 'Elettricità', valore: 300, media_6m: 200, variazione_pct: 50 }, { nome: 'Alimentari', valore: 250, media_6m: 240, variazione_pct: 4.2 }],
    anomalie: [{ tipo: 'sopra_la_media', nome: 'Elettricità', valore: 300, media_6m: 200, variazione_pct: 50 }] };
  const callIns = (data) => realFetch(BASE + '/api/tenant-ai/explain-insights', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-secret': SECRET }, body: JSON.stringify({ tenant_slug: 'finance', data }) });

  await test('sanitizeInsights: tiene solo i campi previsti e ripulisce i nomi', () => {
    const { payload } = rep.sanitizeInsights({ ...INS, descrizioni: ['segreto'], categorie: [{ nome: 'mario.rossi@gmail.com', valore: 5, righe: ['x'] }] });
    assertEq(payload.mese, '2026-09');
    assertTrue(!JSON.stringify(payload).includes('segreto') && !JSON.stringify(payload).includes('mario.rossi') && !JSON.stringify(payload).includes('righe'), JSON.stringify(payload));
  });

  await test('mese non valido o entrate/spese mancanti -> errore', () => {
    assertTrue(rep.sanitizeInsights({ ...INS, month: 'boh' }).error);
    assertTrue(rep.sanitizeInsights({ month: '2026-09', in_corso: false }).error);
  });

  await test('percorso felice: testo restituito; a Mistral arrivano solo totali', async () => {
    mistralText = 'Settembre chiude in positivo di 299,58 euro: il risparmio è del 16,6%. L\'elettricità pesa 300 euro, il 50% sopra la media.';
    mistralCalls = [];
    const res = await callIns({ ...INS, descrizioni: ['segreto privato'] });
    assertEq(res.status, 200);
    assertEq((await res.json()).text, mistralText);
    assertTrue(!JSON.stringify(mistralCalls[0].messages).includes('segreto privato'));
  });

  await test('un numero che non c\'è nei dati (o una percentuale sbagliata) -> 502 ai_unverified, nessun testo', async () => {
    mistralText = 'Settembre chiude a 450 euro di saldo.';
    let res = await callIns(INS); let b = await res.json();
    assertEq(res.status, 502); assertEq(b.code, 'ai_unverified'); assertEq(b.text, undefined);
    mistralText = 'Le spese crescono del 31% sul mese scorso.';
    assertEq((await callIns(INS)).status, 502);
  });

  await test('senza secret interno -> 401 (anche per explain-insights)', async () => {
    assertEq((await realFetch(BASE + '/api/tenant-ai/explain-insights', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-secret': 'no' }, body: '{}' })).status, 401);
  });

  console.log(`\n${passed} passati, ${failed} falliti`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
