'use strict';
// Test end-to-end VERO: un backend Platform reale (lo stesso core/backend/src/index.js
// di sempre, DB temporaneo), un token API reale, il server MCP di questo pacchetto
// avviato per davvero come processo a parte (stdio), e un client MCP reale che gli
// parla il protocollo vero — non un mock di nessuno dei tre pezzi.
// Eseguire con: node src/mcp-server.test.js (porta 34826, richiede core/backend/node_modules)

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const TEST_PORT = 34826;
const BASE = 'http://localhost:' + TEST_PORT;
const BACKEND_SRC = path.join(__dirname, '..', '..', 'core', 'backend', 'src');
const dbPath = path.join(os.tmpdir(), 'mcp-test-' + crypto.randomBytes(6).toString('hex') + '.db');

process.env.DB_PATH = dbPath;
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'mcp_test_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'mcp_test_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-uploads-'));

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; }
}
function assertEq(a, e, msg) { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${msg || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); }
function assertTrue(c, msg) { if (!c) throw new Error(msg || 'atteso true'); }

async function main() {
  // Backend reale, stesso codice del resto dei test — ma require()ato dalla SUA
  // cartella (percorsi relativi interni, es. require('../db'), vanno risolti da lì).
  require(path.join(BACKEND_SRC, 'index.js'));
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }

  const login = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: process.env.INITIAL_ADMIN_PASSWORD }) })).json();
  const tokenRes = await (await fetch(BASE + '/api/api-tokens', { method: 'POST', headers: { Authorization: 'Bearer ' + login.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ label: 'test mcp' }) })).json();

  // Un modulo di spesa vero per provare lista/leggi/crea/modifica.
  const db = require(path.join(BACKEND_SRC, 'db.js'));
  const F = (key, label, type, extra = {}) => ({ id: 'f_' + key, block_type: 'field', key, label, type, ...extra });
  db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES (?, ?, 'box', '#000', 1, 1, 50, ?)")
    .run('Spese Prova', 'spese_prova', JSON.stringify({ version: 3, steps: [F('descrizione', 'Descrizione', 'text'), F('importo', 'Importo', 'currency'), F('data', 'Data', 'date')] }));

  const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(__dirname, 'index.js')],
    env: { PLATFORM_URL: BASE, PLATFORM_API_TOKEN: tokenRes.token, PATH: process.env.PATH },
  });
  await client.connect(transport);

  const callTool = async (name, args) => {
    const r = await client.callTool({ name, arguments: args || {} });
    const testo = r.content && r.content[0] && r.content[0].text;
    if (r.isError) return { isError: true, messaggio: testo };
    return { isError: false, data: testo ? JSON.parse(testo) : null };
  };

  await test('elenco strumenti: ci sono tutti e sono quelli attesi', async () => {
    const r = await client.listTools();
    const nomi = r.tools.map((t) => t.name).sort();
    assertEq(nomi, ['chiedi_ai_dati', 'crea_record', 'debito_casa', 'elenco_moduli', 'leggi_record', 'lista_record', 'modifica_record', 'report_busta_paga', 'schema_modulo'].sort());
  });

  await test('elenco_moduli: vede il modulo "spese" appena creato', async () => {
    const { data } = await callTool('elenco_moduli');
    assertTrue(data.some((m) => m.slug === 'spese_prova'));
  });

  await test('schema_modulo: i campi dichiarati, con tipo', async () => {
    const { data } = await callTool('schema_modulo', { modulo: 'spese_prova' });
    assertEq(data.campi.map((c) => c.key), ['descrizione', 'importo', 'data']);
  });

  let idCreato;
  await test('crea_record: scrive per davvero (stessa API dell\'app)', async () => {
    const { data } = await callTool('crea_record', { modulo: 'spese_prova', dati: { descrizione: 'benzina', importo: 20, data: '2026-10-25' } });
    assertEq(data.data.descrizione, 'benzina');
    idCreato = data.id;
  });

  await test('lista_record: lo ritrova', async () => {
    const { data } = await callTool('lista_record', { modulo: 'spese_prova' });
    assertEq(data.totale, 1);
    assertEq(data.righe[0].id, idCreato);
  });

  await test('leggi_record: lo stesso record, tutti i campi', async () => {
    const { data } = await callTool('leggi_record', { modulo: 'spese_prova', id: idCreato });
    assertEq(data.data.importo, 20);
  });

  await test('modifica_record: cambia per davvero', async () => {
    await callTool('modifica_record', { modulo: 'spese_prova', id: idCreato, dati: { descrizione: 'benzina', importo: 35, data: '2026-10-25' } });
    const { data } = await callTool('leggi_record', { modulo: 'spese_prova', id: idCreato });
    assertEq(data.data.importo, 35);
  });

  await test('debito_casa: senza niente configurato, attivo:false (nessun errore)', async () => {
    const { data } = await callTool('debito_casa');
    assertEq(data, { attivo: false });
  });

  await test('un token revocato smette di funzionare', async () => {
    await fetch(BASE + '/api/api-tokens/' + tokenRes.id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + login.token } });
    const r = await callTool('elenco_moduli');
    assertTrue(r.isError, 'il server MCP riporta l\'errore del backend, non va in crash');
  });

  await client.close();
  console.log(`\n${passed} passati, ${failed} falliti su ${passed + failed} test.`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('ERRORE FATALE', e); process.exit(1); });
