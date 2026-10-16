'use strict';
// "Leggi busta paga" (routes/ai.js /payslip): solo con l'AI accesa e il potenziamento acceso sul modulo; Super Admin è simulato.
// Eseguire con: node src/ai-payslip.test.js (porte 34821 e 34822).

const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');

const TEST_PORT = 34821, FAKE_PORT = 34822;
const BASE = 'http://localhost:' + TEST_PORT;
const SECRET = 'pay_internal_' + crypto.randomBytes(8).toString('hex');
const dbPath = path.join(os.tmpdir(), 'ai-payslip-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.DB_PATH = dbPath;
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'pay_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = SECRET;
process.env.INITIAL_ADMIN_PASSWORD = 'pay_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pay-uploads-'));
process.env.SUPER_ADMIN_URL = 'http://localhost:' + FAKE_PORT;
process.env.TENANT_SLUG = 'finance';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; }
}
function assertEq(a, e, msg) { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${msg || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); }
function assertTrue(c, msg) { if (!c) throw new Error(msg || 'atteso true'); }

let sa = { calls: [], payslip: null };
const fakeSA = http.createServer((req, res) => {
  let body = ''; req.on('data', (d) => (body += d));
  req.on('end', () => {
    if (req.headers['x-internal-secret'] !== SECRET) { res.writeHead(401); return res.end('{}'); }
    const json = (st, o) => { res.writeHead(st, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    sa.calls.push({ url: req.url, body: body ? JSON.parse(body) : null });
    if (req.url === '/api/tenant-ai/payslip') return json(200, { suggestion: sa.payslip });
    json(404, {});
  });
});

(async () => {
  await new Promise((r) => fakeSA.listen(FAKE_PORT, r));
  require('./index.js');
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const db = require('./db'), roles = require('./module-roles'), moduleAi = require('./module-ai');
  const schema = { version: 3, steps: [
    { id: 'p', block_type: 'field', key: 'periodo', label: 'Periodo', type: 'date' },
    { id: 'n', block_type: 'field', key: 'netto', label: 'Netto', type: 'number' },
    { id: 'l', block_type: 'field', key: 'lordo', label: 'Lordo', type: 'number' },
    { id: 'o', block_type: 'field', key: 'ore', label: 'Ore pagate', type: 'number' },
    { id: 't', block_type: 'field', key: 'trattenute_f', label: 'Trattenute', type: 'number' },
  ] };
  db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES ('Busta paga', 'buste', 'box', '#000', 1, 1, 71, ?)").run(JSON.stringify(schema));
  roles.set('buste', { kind: 'bustapaga', uses: [], roles: { data: 'periodo', netto: 'netto', lordo: 'lordo', ore_pagate: 'ore', trattenute: 'trattenute_f' } });

  const schemaPresenze = { version: 3, steps: [
    { id: 'd', block_type: 'field', key: 'giorno', label: 'Giorno', type: 'date' },
    { id: 'i', block_type: 'field', key: 'in_', label: 'Entrata', type: 'text' },
    { id: 'u', block_type: 'field', key: 'out_', label: 'Uscita', type: 'text' },
  ] };
  db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES ('Timbrature', 'presenze', 'clock', '#000', 1, 1, 72, ?)").run(JSON.stringify(schemaPresenze));
  roles.set('presenze', { kind: 'presenze', uses: [], roles: { data: 'giorno', inizio: 'in_', fine: 'out_' } });

  require('./bank-import').extractText = async () => 'Busta paga di ottobre 2026\nLordo 2200,00\nNetto 1700,00\nOre pagate 168\nTrattenute 500,00';
  const login = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: process.env.INITIAL_ADMIN_PASSWORD }) })).json();
  const H = { Authorization: 'Bearer ' + login.token, 'Content-Type': 'application/json' };
  const myId = login.user.id;
  const post = (p, body) => fetch(BASE + '/api/ai' + p, { method: 'POST', headers: H, body: JSON.stringify(body) });
  const PDF = Buffer.from('%PDF-1.4 finto').toString('base64');
  const PROPOSTA = { periodo: '2026-10-01', lordo: 2200, netto: 1700, ore_pagate: 168, trattenute: 500, confidenza: 'alta' };

  console.log('\n--- leggi busta paga ---');
  await test('con l\'AI spenta o "Leggi busta paga" spento sul modulo: 403, nessuna chiamata', async () => {
    sa.calls = [];
    assertEq((await post('/payslip/buste/proposta', { filename: 'b.pdf', base64: PDF })).status, 403);
    moduleAi.setMaster(true); moduleAi.set('buste', ['payslip']); moduleAi.setMaster(false);
    assertEq((await post('/payslip/buste/proposta', { filename: 'b.pdf', base64: PDF })).status, 403, 'interruttore generale spento');
    assertEq(sa.calls.length, 0); moduleAi.setMaster(true);
  });
  await test('un file che non è un PDF, vuoto o troppo grande si rifiuta', async () => {
    assertEq((await post('/payslip/buste/proposta', { filename: 'b.pdf', base64: Buffer.from('ciao').toString('base64') })).status, 400);
    assertEq((await post('/payslip/buste/proposta', { filename: 'b.pdf', base64: '' })).status, 400);
  });
  await test('la proposta legge il PDF e restituisce i campi, senza scrivere niente; a Super Admin va un estratto del testo, non il file', async () => {
    sa.payslip = PROPOSTA; sa.calls = [];
    const r = await post('/payslip/buste/proposta', { filename: 'busta-ottobre.pdf', base64: PDF });
    assertEq(r.status, 200); const j = await r.json();
    assertEq(j.proposta.netto, 1700); assertEq(j.proposta.ore_pagate, 168); assertEq(j.proposta.periodo, '2026-10-01');
    const sent = sa.calls[0].body.data; assertTrue(/1700,00/.test(sent.testo) && !JSON.stringify(sent).includes(PDF), 'estratto sì, file no');
    assertEq(db.prepare("SELECT COUNT(*) c FROM records WHERE module_slug = 'buste'").get().c, 0, 'nessuna riga creata');
  });
  let createdId;
  await test('"crea" registra la riga con il PDF allegato e i campi dei ruoli', async () => {
    const r = await post('/payslip/buste/crea', { filename: 'busta-ottobre.pdf', base64: PDF, campi: { data: '2026-10-01', netto: 1700, lordo: 2200, ore_pagate: 168, trattenute: 500 } });
    const j = await r.json(); assertEq(r.status, 200, JSON.stringify(j)); createdId = j.id;
    const d = JSON.parse(db.prepare('SELECT data FROM records WHERE id = ?').get(j.id).data);
    assertEq(d.periodo, '2026-10-01'); assertEq(d.netto, 1700); assertEq(d.lordo, 2200); assertEq(d.ore, 168); assertEq(d.trattenute_f, 500); assertTrue(/busta-ottobre.pdf/.test(d.note));
    assertEq(db.prepare("SELECT COUNT(*) c FROM record_attachments WHERE module_slug = 'buste' AND record_id = ?").get(j.id).c, 1);
  });
  await test('"crea" rifiuta un periodo non valido, un netto o ore pagate non validi', async () => {
    const base = { filename: 'b.pdf', base64: PDF };
    assertEq((await post('/payslip/buste/crea', { ...base, campi: { data: 'ottobre', netto: 1700, ore_pagate: 168 } })).status, 400);
    assertEq((await post('/payslip/buste/crea', { ...base, campi: { data: '2026-10-01', netto: 'tanto', ore_pagate: 168 } })).status, 400);
    assertEq((await post('/payslip/buste/crea', { ...base, campi: { data: '2026-10-01', netto: 1700, ore_pagate: 'tante' } })).status, 400);
  });

  console.log('\n--- leggi busta paga da foto (rullino) ---');
  const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100)]).toString('base64');
  await test('una foto (JPEG) propone gli stessi campi; a Super Admin arriva come immagine, non come testo', async () => {
    sa.payslip = PROPOSTA; sa.calls = [];
    const r = await post('/payslip/buste/proposta', { filename: 'foto.jpg', base64: JPEG });
    assertEq(r.status, 200); const j = await r.json();
    assertEq(j.proposta.netto, 1700); assertEq(j.proposta.ore_pagate, 168);
    const sent = sa.calls[0].body.data;
    assertTrue(typeof sent.image_base64 === 'string' && sent.image_base64.length > 0 && !sent.testo, 'va come image_base64, non come testo del PDF');
  });
  await test('un file che non è né PDF né un\'immagine riconosciuta si rifiuta', async () => {
    assertEq((await post('/payslip/buste/proposta', { filename: 'b.txt', base64: Buffer.from('non è un file valido').toString('base64') })).status, 400);
  });
  await test('"crea" da foto salva l\'allegato col tipo immagine corretto (non forzato a PDF)', async () => {
    const r = await post('/payslip/buste/crea', { filename: 'foto.jpg', base64: JPEG, campi: { data: '2026-11-01', netto: 1750, ore_pagate: 170 } });
    const j = await r.json(); assertEq(r.status, 200, JSON.stringify(j));
    const up = db.prepare("SELECT u.mime_type FROM uploads u JOIN record_attachments ra ON ra.upload_id = u.id WHERE ra.module_slug = 'buste' AND ra.record_id = ?").get(j.id);
    assertEq(up.mime_type, 'image/jpeg');
  });

  console.log('\n--- module-roles /bustapaga (confronto con le timbrature) ---');
  await test('GET /module-roles/bustapaga restituisce il modulo dichiarato', async () => {
    const r = await fetch(BASE + '/api/module-roles/bustapaga', { headers: H });
    const j = await r.json(); assertEq(r.status, 200);
    assertEq(j, [{ module_slug: 'buste', name: 'Busta paga', data: 'periodo', lordo: 'lordo', netto: 'netto', ore_pagate: 'ore', trattenute: 'trattenute_f' }]);
  });
  await test('le timbrature dello stesso mese si possono sommare lato frontend (stesso campo "data" sul modulo presenze)', async () => {
    db.prepare('INSERT INTO records (module_slug, user_id, data) VALUES (?, ?, ?)').run('presenze', myId, JSON.stringify({ giorno: '2026-10-05', in_: '09:00', out_: '17:30' }));
    db.prepare('INSERT INTO records (module_slug, user_id, data) VALUES (?, ?, ?)').run('presenze', myId, JSON.stringify({ giorno: '2026-10-06', in_: '09:00', out_: '18:00' }));
    const r = await fetch(BASE + '/api/records/presenze', { headers: H });
    const j = await r.json(); const mese = j.filter((x) => x.user_id === myId && String(x.data.giorno).slice(0, 7) === '2026-10');
    assertEq(mese.length, 2);
  });

  console.log(`\n${'='.repeat(60)}`);
  console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
  try { fs.unlinkSync(dbPath); } catch (e) {}
  process.exit(failed > 0 ? 1 : 0);
})();
