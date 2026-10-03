'use strict';
// Commento e spiegazione dei report (report-ai.js, routes/ai.js, invia_report_periodico).
// Super Admin e CallMeBot sono simulati. Interruttore spento di default; il commento al report
// mensile non blocca mai l'invio; "Spiega questo report" manda solo totali.
//
// Eseguire con: node src/report-ai.test.js (richiede le porte 34796 e 34797 libere).

const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');

const TEST_PORT = 34796;
const FAKE_PORT = 34797;
const BASE = 'http://localhost:' + TEST_PORT;
const SECRET = 'rep_ai_internal_' + crypto.randomBytes(8).toString('hex');
const dbPath = path.join(os.tmpdir(), 'report-ai-test-' + crypto.randomBytes(6).toString('hex') + '.db');

process.env.DB_PATH = dbPath;
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'rep_ai_test_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = SECRET;
process.env.INITIAL_ADMIN_PASSWORD = 'rep_ai_test_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rep-ai-test-uploads-'));
process.env.SUPER_ADMIN_URL = 'http://localhost:' + FAKE_PORT;
process.env.TENANT_SLUG = 'finance';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; }
}
function assertEq(a, e, msg) { if (a !== e) throw new Error(`${msg || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); }
function assertTrue(c, msg) { if (!c) throw new Error(msg || 'atteso true'); }

let sa = { calls: [], status: 200, reply: { text: 'Commento di prova.' } };
const fakeSA = http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    if (req.headers['x-internal-secret'] !== SECRET) { res.writeHead(401); return res.end('{}'); }
    if (req.url === '/api/tenant-ai/budget') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ spent_eur: 0, budget_eur: 10, percent: 0 })); }
    if (req.url === '/api/tenant-ai/explain-report') {
      sa.calls.push(JSON.parse(body));
      res.writeHead(sa.status, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(sa.reply));
    }
    res.writeHead(404); res.end('{}');
  });
});

let wa = [];
const realFetch = global.fetch;
global.fetch = async (url, opts) => {
  if (String(url).startsWith('https://api.callmebot.com/')) { wa.push(decodeURIComponent(String(url))); return { status: 200, text: async () => '<p>Message queued.</p>' }; }
  return realFetch(url, opts);
};

const ymd = (y, m) => new Date(Date.UTC(y, m, 15)).toISOString().slice(0, 10);

async function main() {
  await new Promise((r) => fakeSA.listen(FAKE_PORT, r));
  require('./index.js');
  for (let i = 0; i < 100; i++) { try { if ((await realFetch(BASE + '/health')).ok) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const db = require('./db');
  const reportAi = require('./report-ai');
  const { runAzioni } = require('./automation-engine');

  const login = await (await realFetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: process.env.INITIAL_ADMIN_PASSWORD }) })).json();
  const H = { Authorization: 'Bearer ' + login.token, 'Content-Type': 'application/json' };
  const api = (m, p, body) => realFetch(BASE + '/api/ai' + p, { method: m, headers: H, body: body ? JSON.stringify(body) : undefined });

  console.log('\n--- interruttori ---');

  await test('il commento ai report è spento di default', async () => {
    const s = await (await api('GET', '/settings')).json();
    assertEq(s.report_enabled, false);
    assertEq(s.bollette_enabled, false);
  });

  await test('i due interruttori sono indipendenti', async () => {
    await api('PUT', '/settings', { report_enabled: true });
    let s = await (await api('GET', '/settings')).json();
    assertEq(s.report_enabled, true);
    assertEq(s.bollette_enabled, false, 'le bollette non devono cambiare');
    await api('PUT', '/settings', { bollette_enabled: true });
    s = await (await api('GET', '/settings')).json();
    assertEq(s.report_enabled, true, 'il report non deve cambiare');
    await api('PUT', '/settings', { bollette_enabled: false, report_enabled: false });
    assertEq(reportAi.isEnabled(), false);
  });

  console.log('\n--- "Spiega questo report" ---');

  const REPORT = { titolo: 'Spese casa', periodo: 'Mese precedente', metrica: 'Importo', funzione: 'sum', totale: 300, totale_confronto: 250,
    gruppi: [{ label: 'Elettricità', value: 200, righe: ['segreto'] }, { label: 'Gas', value: 100 }] };

  await test('senza login -> 401', async () => {
    assertEq((await realFetch(BASE + '/api/ai/explain-report', { method: 'POST' })).status, 401);
  });

  await test('funziona anche con l\'interruttore spento; a Super Admin arrivano solo totali per gruppo', async () => {
    sa.calls = []; sa.status = 200; sa.reply = { text: 'L\'elettricità pesa 200 euro su 300.' };
    const res = await api('POST', '/explain-report', REPORT);
    assertEq(res.status, 200);
    assertEq((await res.json()).text, sa.reply.text);
    assertEq(sa.calls[0].modo, 'spiegazione');
    assertEq(sa.calls[0].data.gruppi[0].nome, 'Elettricità');
    assertEq(sa.calls[0].data.gruppi[0].valore, 200);
    assertTrue(!JSON.stringify(sa.calls[0]).includes('segreto'), 'nessun campo extra');
  });

  await test('nessun gruppo -> 400, e nessuna chiamata', async () => {
    sa.calls = [];
    assertEq((await api('POST', '/explain-report', { ...REPORT, gruppi: [] })).status, 400);
    assertEq(sa.calls.length, 0);
  });

  await test('tetto di spesa raggiunto -> 429 con il codice', async () => {
    sa.status = 429; sa.reply = { error: 'Tetto raggiunto', code: 'ai_budget_exceeded' };
    const res = await api('POST', '/explain-report', REPORT);
    assertEq(res.status, 429);
    assertEq((await res.json()).code, 'ai_budget_exceeded');
  });

  await test('commento non verificabile (numero inventato) -> errore, nessun testo', async () => {
    sa.status = 502; sa.reply = { error: 'scartato', code: 'ai_unverified' };
    const res = await api('POST', '/explain-report', REPORT);
    assertEq(res.status, 502);
    assertEq((await res.json()).text, undefined);
  });

  console.log('\n--- totali per gruppo ---');

  await test('gruppiDaRighe somma per categoria, ordina per valore e aggiunge il confronto', () => {
    const g = reportAi.gruppiDaRighe(
      [{ categoria: 'Gas', importo: 40 }, { categoria: 'Luce', importo: '90' }, { categoria: 'Gas', importo: 20 }],
      [{ categoria: 'Gas', importo: 30 }], 'categoria', 'importo');
    assertEq(JSON.stringify(g), JSON.stringify([{ nome: 'Luce', valore: 90, confronto: 0 }, { nome: 'Gas', valore: 60, confronto: 30 }]));
  });

  console.log('\n--- report mensile su WhatsApp ---');

  const now = new Date();
  const mesePrec = ymd(now.getUTCFullYear(), now.getUTCMonth() - 1);
  const mesePrecPrec = ymd(now.getUTCFullYear(), now.getUTCMonth() - 2);
  const ins = (data, importo, cat) => db.prepare("INSERT INTO records (module_slug, user_id, data) VALUES ('spese_casa', NULL, ?)").run(JSON.stringify({ descrizione: 'riga segreta ' + cat, data, importo, categoria: cat, _stato: 'pagato' }));
  ins(mesePrec, 200, 'Elettricità'); ins(mesePrec, 100, 'Gas'); ins(mesePrecPrec, 150, 'Elettricità');
  db.prepare("INSERT OR REPLACE INTO connections (integration_id, connected, credentials) VALUES ('whatsapp_callmebot', 1, ?)").run(JSON.stringify({ api_key: 'chiave-finta' }));
  db.prepare("INSERT INTO records (module_slug, user_id, data) VALUES ('whatsapp_destinatari', NULL, ?)").run(JSON.stringify({ nome: 'Nima', numero: '+39 333 111 1111', triggers: ['report'], attivo: true }));
  const AZ = [{ target: '__interno__', azione: 'invia_report_periodico', config: { periodo: 'mese', raggruppa_per: 'categoria', trigger_tag: 'report', titolo: 'Report mensile' } }];
  const run = async () => { wa = []; sa.calls = []; runAzioni(AZ, {}, 'spese_casa', 'Report mensile', null, { triggerDesc: 'il 1° del mese' }, {}); for (let i = 0; i < 100 && !wa.length; i++) await new Promise((r) => setTimeout(r, 30)); await new Promise((r) => setTimeout(r, 50)); };

  await test('interruttore spento: il report parte senza commento e l\'AI non viene chiamata', async () => {
    sa.status = 200; sa.reply = { text: 'Commento di prova.' };
    await run();
    assertEq(wa.length, 1);
    assertTrue(!wa[0].includes('💬'), 'nessun commento');
    assertEq(sa.calls.length, 0, 'chiamate a Super Admin');
  });

  await test('acceso: il commento è aggiunto in coda, con solo totali per categoria', async () => {
    reportAi.setEnabled(true);
    await run();
    assertEq(wa.length, 1);
    assertTrue(wa[0].includes('Report mensile') && wa[0].includes('💬 Commento di prova.'), wa[0]);
    assertEq(sa.calls.length, 1);
    assertEq(sa.calls[0].modo, 'commento');
    assertEq(sa.calls[0].data.gruppi[0].nome, 'Elettricità');
    assertEq(sa.calls[0].data.gruppi[0].valore, 200);
    assertEq(sa.calls[0].data.gruppi[0].confronto, 150);
    assertEq(sa.calls[0].data.totale, 300);
    assertTrue(!JSON.stringify(sa.calls[0]).includes('segreta'), 'le descrizioni non devono uscire');
  });

  await test('se l\'AI rifiuta (tetto, numero inventato, errore) il report parte lo stesso, senza commento', async () => {
    sa.status = 502; sa.reply = { error: 'scartato', code: 'ai_unverified' };
    await run();
    assertEq(wa.length, 1);
    assertTrue(wa[0].includes('Report mensile') && !wa[0].includes('💬'), wa[0]);
  });

  await test('anteprima (dryRun): niente invio e niente chiamata all\'AI', async () => {
    wa = []; sa.calls = []; sa.status = 200;
    const dryLog = [];
    runAzioni(AZ, {}, 'spese_casa', 'Report mensile', null, { triggerDesc: 't' }, { dryRun: true, dryLog });
    await new Promise((r) => setTimeout(r, 150));
    assertEq(wa.length, 0);
    assertEq(sa.calls.length, 0);
  });

  await test('un report settimanale (senza periodo "mese") non chiede mai il commento', async () => {
    sa.calls = []; wa = [];
    db.prepare("INSERT INTO records (module_slug, user_id, data) VALUES ('spese_casa', NULL, ?)").run(JSON.stringify({ descrizione: 'x', data: new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10), importo: 10, categoria: 'Gas' }));
    runAzioni([{ target: '__interno__', azione: 'invia_report_periodico', config: { periodo: 'settimana', raggruppa_per: 'categoria', trigger_tag: 'report', titolo: 'Settimana' } }], {}, 'spese_casa', 'Settimana', null, { triggerDesc: 't' }, {});
    for (let i = 0; i < 100 && !wa.length; i++) await new Promise((r) => setTimeout(r, 30));
    assertEq(wa.length, 1);
    assertEq(sa.calls.length, 0);
  });

  console.log(`\n${'='.repeat(60)}`);
  console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
  try { fs.unlinkSync(dbPath); } catch (e) {}
  process.exit(failed > 0 ? 1 : 0);
}
main().catch((e) => { console.error('Suite report-ai fallita ad avviarsi:', e); process.exit(1); });
