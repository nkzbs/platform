'use strict';
// "Importare da PDF" e "Chiedi ai dati" (routes/ai.js): solo con l'AI accesa e il potenziamento acceso sul modulo; Super Admin è simulato.
// Eseguire con: node src/ai-import-ask.test.js (porte 34813 e 34814).

const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');

const TEST_PORT = 34813, FAKE_PORT = 34814;
const BASE = 'http://localhost:' + TEST_PORT;
const SECRET = 'imp_internal_' + crypto.randomBytes(8).toString('hex');
const dbPath = path.join(os.tmpdir(), 'ai-import-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.DB_PATH = dbPath;
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'imp_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = SECRET;
process.env.INITIAL_ADMIN_PASSWORD = 'imp_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'imp-uploads-'));
process.env.SUPER_ADMIN_URL = 'http://localhost:' + FAKE_PORT;
process.env.TENANT_SLUG = 'finance';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; }
}
function assertEq(a, e, msg) { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${msg || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); }
function assertTrue(c, msg) { if (!c) throw new Error(msg || 'atteso true'); }

let sa = { calls: [], bill: null, ask: null };
const fakeSA = http.createServer((req, res) => {
  let body = ''; req.on('data', (d) => (body += d));
  req.on('end', () => {
    if (req.headers['x-internal-secret'] !== SECRET) { res.writeHead(401); return res.end('{}'); }
    const json = (st, o) => { res.writeHead(st, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    sa.calls.push({ url: req.url, body: body ? JSON.parse(body) : null });
    if (req.url === '/api/tenant-ai/classify-bill') return json(200, { suggestion: sa.bill });
    if (req.url === '/api/tenant-ai/ask-data') return sa.ask.status === 200 ? json(200, { query: sa.ask.query }) : json(sa.ask.status, { error: sa.ask.error, code: sa.ask.code });
    json(404, {});
  });
});

(async () => {
  await new Promise((r) => fakeSA.listen(FAKE_PORT, r));
  require('./index.js');
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const db = require('./db'), roles = require('./module-roles'), moduleAi = require('./module-ai');
  const schema = { version: 3, steps: [
    { id: 'c', block_type: 'field', key: 'categoria', label: 'Categoria', type: 'select', options: ['Elettricità', 'Gas', 'Altro'] },
    { id: 'w1', block_type: 'workflow_state', key: 'da_smistare', label: 'Da smistare', initial: true }, { id: 'w2', block_type: 'workflow_state', key: 'da_pagare', label: 'Da pagare' },
  ] };
  db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES ('Costi', 'costi', 'box', '#000', 1, 1, 70, ?)").run(JSON.stringify(schema));
  roles.set('costi', { kind: 'spesa', uses: [], roles: { importo: 'importo', data: 'data', scadenza: 'scadenza', categoria: 'categoria', descrizione: 'descrizione', stato: '_stato' }, avvisi: { states: { nuovo: 'da_smistare', da_fare: 'da_pagare' } } });
  require('./bank-import').extractText = async () => 'Bolletta energia elettrica\nTotale da pagare 64,00 euro\nScadenza 31/10/2026\nConsumo 180 kWh';
  const login = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: process.env.INITIAL_ADMIN_PASSWORD }) })).json();
  const H = { Authorization: 'Bearer ' + login.token, 'Content-Type': 'application/json' };
  const post = (p, body) => fetch(BASE + '/api/ai' + p, { method: 'POST', headers: H, body: JSON.stringify(body) });
  const PDF = Buffer.from('%PDF-1.4 finto').toString('base64');
  const PROPOSTA = { modulo: 'costi', categoria: 'Elettricità', fornitore: 'A2A Energia', importo: 64, scadenza: '2026-10-31', confidenza: 'alta' };

  console.log('\n--- importare da PDF ---');
  await test('con l\'AI spenta o "Importare" spento sul modulo: 403, nessuna chiamata', async () => {
    sa.calls = [];
    assertEq((await post('/import/costi/proposta', { filename: 'b.pdf', base64: PDF })).status, 403);
    moduleAi.setMaster(true); moduleAi.set('costi', ['import']); moduleAi.setMaster(false);
    assertEq((await post('/import/costi/proposta', { filename: 'b.pdf', base64: PDF })).status, 403, 'interruttore generale spento');
    assertEq(sa.calls.length, 0); moduleAi.setMaster(true);
  });
  await test('un file che non è un PDF, vuoto o troppo grande si rifiuta', async () => {
    assertEq((await post('/import/costi/proposta', { filename: 'b.pdf', base64: Buffer.from('ciao').toString('base64') })).status, 400);
    assertEq((await post('/import/costi/proposta', { filename: 'b.pdf', base64: '' })).status, 400);
    assertEq((await post('/import/costi/proposta', { filename: 'b.pdf', base64: Buffer.concat([Buffer.from('%PDF'), Buffer.alloc(3.2 * 1024 * 1024)]).toString('base64') })).status, 400);
  });
  await test('la proposta legge il PDF e restituisce i campi, senza scrivere niente; a Super Admin va un estratto, non il file', async () => {
    sa.bill = PROPOSTA; sa.calls = [];
    const r = await post('/import/costi/proposta', { filename: 'bolletta-a2a.pdf', base64: PDF });
    assertEq(r.status, 200); const j = await r.json(); assertEq(j.proposta.categoria, 'Elettricità'); assertEq(j.proposta.importo, 64); assertEq(j.categorie, ['Elettricità', 'Gas', 'Altro'], 'le categorie ammesse le dà il server');
    const sent = sa.calls[0].body.data; assertTrue(/64,00/.test(sent.allegati) && !JSON.stringify(sent).includes(PDF), 'estratto sì, file no');
    assertEq(db.prepare("SELECT COUNT(*) c FROM records WHERE module_slug = 'costi'").get().c, 0, 'nessuna riga creata');
  });
  await test('"crea" salva la riga nello stato "nuovo" con il PDF allegato e i campi dei ruoli', async () => {
    const r = await post('/import/costi/crea', { filename: 'bolletta-a2a.pdf', base64: PDF, campi: { descrizione: 'A2A Energia', importo: 64, scadenza: '2026-10-31', categoria: 'Elettricità' } });
    const j = await r.json(); assertEq(r.status, 200, JSON.stringify(j));
    const d = JSON.parse(db.prepare('SELECT data FROM records WHERE id = ?').get(j.id).data);
    assertEq(d._stato, 'da_smistare'); assertEq(d.importo, 64); assertEq(d.categoria, 'Elettricità'); assertEq(d.scadenza, '2026-10-31'); assertTrue(/bolletta-a2a.pdf/.test(d.note));
    assertEq(db.prepare("SELECT COUNT(*) c FROM record_attachments WHERE module_slug = 'costi' AND record_id = ?").get(j.id).c, 1);
    assertTrue(/da smistare/.test(j.message), j.message);
  });
  await test('"crea" rifiuta una categoria non ammessa, un importo non valido e una scadenza sbagliata', async () => {
    const base = { filename: 'b.pdf', base64: PDF };
    assertEq((await post('/import/costi/crea', { ...base, campi: { importo: 10, categoria: 'Viaggi' } })).status, 400);
    assertEq((await post('/import/costi/crea', { ...base, campi: { importo: 'tanto' } })).status, 400);
    assertEq((await post('/import/costi/crea', { ...base, campi: { importo: 10, scadenza: 'domani' } })).status, 400);
  });

  console.log('\n--- chiedi ai dati ---');
  const rec = (d) => db.prepare('INSERT INTO records (module_slug, user_id, data) VALUES (?, NULL, ?)').run('costi', JSON.stringify({ _stato: 'da_pagare', ...d }));
  rec({ descrizione: 'A2A', data: '2025-02-10', importo: 80, categoria: 'Elettricità' }); rec({ descrizione: 'A2A', data: '2025-03-10', importo: 60, categoria: 'Elettricità' });
  await test('con l\'AI spenta: 403', async () => {
    moduleAi.setMaster(false); assertEq((await post('/ask', { domanda: 'quanto ho speso di luce?' })).status, 403); moduleAi.setMaster(true);
  });
  await test('la domanda diventa una query validata ed eseguita; il risultato dice cosa è stato capito; a Super Admin vanno domanda e catalogo, non righe', async () => {
    sa.calls = []; sa.ask = { status: 200, query: { modulo: 'costi', calcolo: 'somma', periodo: { da: '2025-01-01', a: '2025-12-31' }, filtri: [{ ruolo: 'categoria', op: 'uguale', valore: 'Elettricità' }], raggruppa: 'mese', titolo: 'Luce nel 2025' } };
    const r = await post('/ask', { domanda: 'Quanto ho speso di luce nel 2025?' }); const j = await r.json();
    assertEq(r.status, 200, JSON.stringify(j)); assertEq(j.totale, 140); assertEq(j.righe.map((x) => x.etichetta), ['2025-02', '2025-03']);
    assertTrue(j.filtro.includes('Categoria = Elettricità') && j.filtro[0] === 'Modulo: Costi', j.filtro.join('|'));
    const sent = sa.calls[0].body.data; assertEq(sent.catalogo[0].slug, 'costi'); assertTrue(!JSON.stringify(sent).includes('"A2A"'), 'nessuna riga esce');
  });
  await test('una query che Super Admin manda fuori catalogo viene rifiutata anche qui (difesa in profondità)', async () => {
    sa.ask = { status: 200, query: { modulo: 'utenti', calcolo: 'somma', filtri: [], raggruppa: 'nessuno' } };
    assertEq((await post('/ask', { domanda: 'quanti utenti ci sono?' })).status, 422);
  });
  await test('"non so rispondere" di Super Admin torna come 422 con il motivo; domanda troppo corta -> 400', async () => {
    sa.ask = { status: 422, error: 'non posso rispondere a questa domanda', code: 'ai_unanswerable' };
    const r = await post('/ask', { domanda: 'che tempo fa domani?' }); assertEq(r.status, 422); assertEq((await r.json()).code, 'ai_unanswerable');
    assertEq((await post('/ask', { domanda: 'a' })).status, 400);
  });
  await test('senza login: 401', async () => { assertEq((await fetch(BASE + '/api/ai/ask', { method: 'POST' })).status, 401); });

  console.log(`\n${'='.repeat(60)}`);
  console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
  try { fs.unlinkSync(dbPath); } catch (e) {}
  process.exit(failed > 0 ? 1 : 0);
})();
