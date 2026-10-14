'use strict';
// Lettura busta paga (routes/tenant-ai.js /payslip): il tenant manda solo l'estratto testuale del PDF (già ripulito da redact()),
// l'AI propone periodo/lordo/netto/ore pagate/trattenute, qui si controlla l'output. Mistral è simulato.
// Eseguire con: node src/ai-payslip.test.js (richiede la porta 34794 libera).

const path = require('path');
const os = require('os');
const crypto = require('crypto');

const TEST_PORT = 34794;
const BASE = 'http://localhost:' + TEST_PORT;
const SECRET = 'payslip_internal_' + crypto.randomBytes(8).toString('hex');
process.env.DB_PATH = path.join(os.tmpdir(), 'ai-payslip-sa-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'payslip_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = SECRET;
process.env.ENCRYPTION_KEY = 'payslip_enc_' + crypto.randomBytes(8).toString('hex');
process.env.MISTRAL_API_KEY = 'chiave-generale-super-admin';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; }
}
function assertEq(a, e, msg) { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${msg || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); }
function assertTrue(c, msg) { if (!c) throw new Error(msg || 'atteso true'); }

const realFetch = global.fetch;
let mistralChat = [], mistralReply = '';
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u === 'https://api.mistral.ai/v1/chat/completions') {
    mistralChat.push(JSON.parse(opts.body));
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: mistralReply } }], usage: { prompt_tokens: 100, completion_tokens: 100 } }) };
  }
  return realFetch(url, opts);
};

async function main() {
  require('./index.js');
  for (let i = 0; i < 100; i++) { try { const r = await realFetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); if (r.status) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const db = require('./db');
  db.prepare("INSERT INTO tenants (name, slug, port, db_path, status) VALUES ('Finance', 'finance', 47401, '/x/f.db', 'active')").run();
  const api = (body, secret = SECRET) => realFetch(BASE + '/api/tenant-ai/payslip', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-secret': secret }, body: body ? JSON.stringify(body) : undefined });
  const TESTO = 'Busta paga di ottobre 2026 per Mario Rossi, CF MRARSS80A01H501Z, IBAN IT60X0542811101000000123456\nLordo 2200,00\nNetto 1700,00\nOre pagate 168\nTrattenute 500,00';

  console.log('\n--- lettura busta paga ---');

  await test('senza secret interno -> 401', async () => { assertEq((await api({ tenant_slug: 'finance', data: { testo: TESTO } }, 'no')).status, 401); });

  await test('senza tenant_slug o testo -> 400', async () => {
    assertEq((await api({ tenant_slug: 'finance', data: {} })).status, 400);
    assertEq((await api({ data: { testo: TESTO } })).status, 400);
  });

  await test('legge i campi e li propone, con confidenza clampata alle sole opzioni valide', async () => {
    mistralChat = [];
    mistralReply = JSON.stringify({ periodo: '2026-10-15', lordo: 2200, netto: 1700, ore_pagate: 168, trattenute: 500, confidenza: 'altissima' });
    const r = await api({ tenant_slug: 'finance', data: { testo: TESTO } });
    const j = await r.json();
    assertEq(r.status, 200, JSON.stringify(j));
    assertEq(j.suggestion.periodo, '2026-10-01', 'il periodo si arrotonda al primo del mese');
    assertEq(j.suggestion.lordo, 2200); assertEq(j.suggestion.netto, 1700); assertEq(j.suggestion.ore_pagate, 168); assertEq(j.suggestion.trattenute, 500);
    assertEq(j.suggestion.confidenza, 'bassa', 'un valore non ammesso diventa "bassa"');
  });

  await test('il testo che arriva a Mistral ha già IBAN e codice fiscale tolti (redact lato Super Admin)', async () => {
    const sent = mistralChat[0].messages.find((m) => m.role === 'user').content;
    assertTrue(!/MRARSS80A01H501Z/.test(sent) && !/IT60X0542811101000000123456/.test(sent), sent);
    assertTrue(/1700,00/.test(sent), 'gli importi restano');
  });

  await test('valori non numerici o fuori scala diventano null, mai inventati', async () => {
    mistralReply = JSON.stringify({ periodo: 'boh', lordo: 'tanti', netto: 999999, ore_pagate: -5, trattenute: null, confidenza: 'media' });
    const j = await (await api({ tenant_slug: 'finance', data: { testo: TESTO } })).json();
    assertEq(j.suggestion.periodo, null); assertEq(j.suggestion.lordo, null); assertEq(j.suggestion.netto, null); assertEq(j.suggestion.ore_pagate, null); assertEq(j.suggestion.trattenute, null);
  });

  await test('risposta dell\'AI non in JSON -> 502, nessuna proposta', async () => {
    mistralReply = 'non sono un JSON';
    assertEq((await api({ tenant_slug: 'finance', data: { testo: TESTO } })).status, 502);
  });

  await test('senza chiave Mistral configurata per il tenant -> 503 "ai_not_configured"', async () => {
    delete process.env.MISTRAL_API_KEY;
    const r = await api({ tenant_slug: 'finance', data: { testo: TESTO } });
    assertEq(r.status, 503); assertEq((await r.json()).code, 'ai_not_configured');
    process.env.MISTRAL_API_KEY = 'chiave-generale-super-admin';
  });

  console.log(`\n${passed} passati, ${failed} falliti`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
