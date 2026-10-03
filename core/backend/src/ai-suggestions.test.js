'use strict';
// Assistente AI per le bollette (ai-suggestions.js, routes/ai.js): spento di default, l'AI
// PROPONE e non scrive, accettare applica solo ciò che è ammesso, e gli errori (tetto di
// spesa raggiunto, Super Admin irraggiungibile) non toccano mai i record. Super Admin è
// simulato con un piccolo server HTTP.
//
// Eseguire con: node src/ai-suggestions.test.js (richiede le porte 34791 e 34792 libere).

const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');

const TEST_PORT = 34791;
const FAKE_PORT = 34792;
const BASE = 'http://localhost:' + TEST_PORT;
const SECRET = 'ai_sug_internal_' + crypto.randomBytes(8).toString('hex');
const dbPath = path.join(os.tmpdir(), 'ai-sug-test-' + crypto.randomBytes(6).toString('hex') + '.db');

process.env.DB_PATH = dbPath;
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'ai_sug_test_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = SECRET;
process.env.INITIAL_ADMIN_PASSWORD = 'ai_sug_test_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-sug-test-uploads-'));
process.env.SUPER_ADMIN_URL = 'http://localhost:' + FAKE_PORT;
process.env.TENANT_SLUG = 'finance';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; }
}
function assertEq(a, e, msg) { if (a !== e) throw new Error(`${msg || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); }
function assertTrue(c, msg) { if (!c) throw new Error(msg || 'atteso true'); }

// Super Admin finto: tiene le richieste ricevute e risponde come deciso dal test.
let sa = { calls: [], reply: null, status: 200 };
const fakeSA = http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    if (req.headers['x-internal-secret'] !== SECRET) { res.writeHead(401); return res.end('{}'); }
    if (req.url.startsWith('/api/tenant-ai/budget')) { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ spent_eur: 0.42, budget_eur: 10, percent: 4.2 })); }
    if (req.url === '/api/tenant-ai/classify-bill') {
      sa.calls.push(JSON.parse(body));
      res.writeHead(sa.status, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(sa.reply));
    }
    res.writeHead(404); res.end('{}');
  });
});

async function main() {
  await new Promise((r) => fakeSA.listen(FAKE_PORT, r));
  require('./index.js');
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const db = require('./db');
  for (const k of require('./features').KEYS) require('./features').set(k, true); // le funzioni facoltative sono spente di default: qui servono
  const ai = require('./ai-suggestions');

  // Moduli di prova con il campo "categoria" (le categorie ammesse vengono da qui).
  const schema = JSON.stringify({ fields: [
    { key: 'descrizione', label: 'Descrizione', type: 'text', required: true },
    { key: 'importo', label: 'Importo', type: 'currency' },
    { key: 'data', label: 'Data', type: 'date' },
    { key: 'categoria', label: 'Categoria', type: 'select', options: ['Elettricità', 'Gas', 'Acqua', 'Altro'] },
    { key: 'scadenza', label: 'Scadenza', type: 'date' },
    { key: 'note', label: 'Note', type: 'textarea' },
  ] });
  for (const slug of ['spese_casa', 'spese_personali']) {
    db.prepare('DELETE FROM modules WHERE slug = ?').run(slug);
    db.prepare("INSERT INTO modules (name, slug, icon, color, installed, sort_order, schema_json) VALUES (?, ?, 'box', '#2563EB', 1, 50, ?)").run(slug, slug, schema);
  }
  const newBill = (extra = {}) => db.prepare('INSERT INTO records (module_slug, user_id, data) VALUES (?, ?, ?)').run('spese_casa', null,
    JSON.stringify({ descrizione: 'A2A Energia', importo: 0, data: '2026-09-07', categoria: 'Altro', note: 'Importato da Gmail', _stato: 'da_smistare', ...extra })).lastInsertRowid;
  const getData = (id) => JSON.parse(db.prepare('SELECT data FROM records WHERE id = ?').get(id).data);
  const pendingCount = () => db.prepare("SELECT COUNT(*) c FROM ai_suggestions WHERE status = 'pending'").get().c;

  const login = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: process.env.INITIAL_ADMIN_PASSWORD }) })).json();
  const H = { Authorization: 'Bearer ' + login.token, 'Content-Type': 'application/json' };
  const api = (m, p, body) => fetch(BASE + '/api/ai' + p, { method: m, headers: H, body: body ? JSON.stringify(body) : undefined });
  const PROPOSTA = { modulo: 'spese_casa', categoria: 'Elettricità', fornitore: 'A2A Energia', importo: 64, scadenza: '2026-09-07', confidenza: 'alta' };

  console.log('\n--- interruttore ---');

  await test('spento di default: il poller non chiama nessuno', async () => {
    sa.calls = [];
    const id = newBill();
    const out = await ai.suggestForRecord({ moduleSlug: 'spese_casa', recordId: id, mittente: 'A2A', subject: 'Bolletta', text: 'testo' });
    assertEq(out.skipped, 'disattivato');
    assertEq(sa.calls.length, 0, 'chiamate a Super Admin');
  });

  await test('impostazioni: spento, e il consumo del mese arriva da Super Admin', async () => {
    const s = await (await api('GET', '/settings')).json();
    assertEq(s.bollette_enabled, false);
    assertEq(s.budget.spent_eur, 0.42);
  });

  await test('si accende e si spegne dalle impostazioni', async () => {
    assertEq((await (await api('PUT', '/settings', { bollette_enabled: true })).json()).bollette_enabled, true);
    assertEq(ai.isEnabled(), true);
  });

  await test('senza login nessuna rotta risponde', async () => {
    assertEq((await fetch(BASE + '/api/ai/settings')).status, 401);
  });

  console.log('\n--- luce o gas dal PDF allegato ---');

  const att = require('./attachment-text');
  const PDF_LUCE = 'Bolletta energia elettrica\nPOD IT001E12345678901234\nConsumo fatturato 180 kWh fascia F1\nTotale da pagare 44,00 euro\nScadenza 01/10/2026\nPotenza impegnata 3 kW\nIBAN IT60X0542811101000000123456';
  const PDF_GAS = 'Bolletta gas naturale\nPDR 12345678901234\nConsumo 52 Smc\nCoefficiente C 1,02\nTotale da pagare 61,00 euro';

  await test('energyHint: kWh/POD -> luce; Smc/PDR -> gas; entrambi; troppo poco -> nessun indizio', () => {
    assertEq(att.energyHint(PDF_LUCE), 'luce'); assertEq(att.energyHint(PDF_GAS), 'gas');
    assertEq(att.energyHint(PDF_LUCE + '\n' + PDF_GAS), 'entrambi');
    assertEq(att.energyHint('La tua bolletta Gas/Luce è pronta'), null, 'il solo titolo non basta');
  });
  await test('relevantExtract tiene le righe utili, toglie i codici lunghi e l\'IBAN, e non supera 1500 caratteri', () => {
    const e = att.relevantExtract(PDF_LUCE + '\n' + 'Totale da pagare altro '.repeat(300));
    assertTrue(/180 kWh/.test(e) && /Totale da pagare 44,00/.test(e));
    assertTrue(!/IT001E12345678901234/.test(e) && !/IT60X0542811101000000123456/.test(e), e.slice(0, 200));
    assertTrue(e.length <= 1500);
  });
  await test('con un PDF allegato (appena scaricato) a Super Admin arrivano l\'indizio e l\'estratto, non l\'intero PDF', async () => {
    require('./bank-import').extractText = async () => PDF_LUCE; // pdftotext simulato
    const id = newBill({ descrizione: 'A2A Energia Gas/Luce', categoria: 'Altro', _stato: 'da_smistare' });
    sa.calls = []; sa.status = 200; sa.reply = { suggestion: { modulo: 'spese_casa', categoria: 'Elettricità', fornitore: 'A2A', importo: 44, scadenza: '2026-10-01', confidenza: 'alta' } };
    const out = await ai.suggestForRecord({ moduleSlug: 'spese_casa', recordId: id, mittente: 'a2a', subject: 'Bolletta Gas/Luce', text: 'La tua bolletta', attachments: [{ bytes: Buffer.from('%PDF'), filename: 'bolletta.pdf', mimeType: 'application/pdf' }], force: true });
    assertTrue(!!out.id, JSON.stringify(out));
    const d = sa.calls[0].data;
    assertEq(d.indizio_energia, 'luce');
    assertTrue(/180 kWh/.test(d.allegati) && !/IT60X05428/.test(d.allegati) && !/POD IT001E/.test(d.allegati));
  });
  await test('senza allegati appena scaricati si leggono quelli già salvati per il record (file locale)', async () => {
    const id = newBill({ descrizione: 'A2A Energia Gas/Luce', categoria: 'Altro', _stato: 'da_smistare' });
    const stored = 'test-' + crypto.randomBytes(4).toString('hex') + '.pdf';
    fs.writeFileSync(path.join(process.env.UPLOAD_DIR, stored), Buffer.from('%PDF finto'));
    const up = db.prepare("INSERT INTO uploads (original_name, stored_name, mime_type, size) VALUES ('b.pdf', ?, 'application/pdf', 10)").run(stored).lastInsertRowid;
    db.prepare("INSERT INTO record_attachments (module_slug, record_id, upload_id, tipo) VALUES ('spese_casa', ?, ?, 'gmail')").run(id, up);
    require('./bank-import').extractText = async () => PDF_GAS;
    sa.calls = [];
    await ai.suggestForRecord({ moduleSlug: 'spese_casa', recordId: id, force: true });
    assertEq(sa.calls[0].data.indizio_energia, 'gas');
  });
  await test('se il PDF non si legge, la proposta parte lo stesso, senza indizio', async () => {
    require('./bank-import').extractText = async () => { throw new Error('manca pdftotext'); };
    const id = newBill({ descrizione: 'Bolletta', categoria: 'Altro', _stato: 'da_smistare' });
    sa.calls = [];
    await ai.suggestForRecord({ moduleSlug: 'spese_casa', recordId: id, text: 'testo', attachments: [{ bytes: Buffer.from('x'), filename: 'a.pdf', mimeType: 'application/pdf' }], force: true });
    assertEq(sa.calls.length, 1); assertEq(sa.calls[0].data.indizio_energia, undefined);
  });

  console.log('\n--- dashboard ---');

  await test('overview: proposte di entrambi i moduli e righe "da smistare" ancora da chiedere (solo admin)', async () => {
    db.prepare("DELETE FROM ai_suggestions").run();
    db.prepare("DELETE FROM records WHERE json_extract(data, '$._stato') = 'da_smistare'").run(); // parte pulita, senza righe lasciate dai test sopra
    const a = newBill({ _stato: 'da_smistare' });
    const b = newBill({ _stato: 'da_smistare' });
    const c = db.prepare('INSERT INTO records (module_slug, user_id, data) VALUES (?, ?, ?)').run('spese_personali', null, JSON.stringify({ descrizione: 'Rata', importo: 10, data: '2026-09-10', categoria: 'Altro', _stato: 'da_smistare' })).lastInsertRowid;
    db.prepare("INSERT INTO ai_suggestions (module_slug, record_id, kind, payload, status) VALUES ('spese_casa', ?, 'bolletta', ?, 'pending')").run(a, JSON.stringify({ proposta: { categoria: 'Gas', importo: 10, scadenza: null, fornitore: 'X', confidenza: 'alta' }, corrente: {} }));
    const o = await (await api('GET', '/overview')).json();
    assertEq(o.items.length, 1); assertEq(o.items[0].record_id, a);
    const asked = o.to_ask.map((x) => x.module_slug + ':' + x.record_id).sort().join();
    assertEq(asked, ['spese_casa:' + b, 'spese_personali:' + c].sort().join(), 'la riga con proposta non va richiesta di nuovo');
    assertEq((await fetch(BASE + '/api/ai/overview')).status, 401);
  });

  console.log('\n--- proposta ---');
  sa.reply = { suggestion: PROPOSTA };

  let recId, sugId;
  await test('con l\'assistente acceso il poller chiede la proposta, mandando il testo della mail e le categorie ammesse', async () => {
    sa.calls = [];
    recId = newBill();
    const out = await ai.suggestForRecord({ moduleSlug: 'spese_casa', recordId: recId, mittente: 'A2A Energia', subject: 'La tua bolletta', text: 'Totale da pagare 64,00 euro' });
    assertTrue(out.id, 'suggerimento creato');
    sugId = out.id;
    const sent = sa.calls[0].data;
    assertEq(sent.testo, 'Totale da pagare 64,00 euro');
    assertEq(sent.mittente, 'A2A Energia');
    assertEq(sent.moduli.spese_casa.categorie.join(','), 'Elettricità,Gas,Acqua,Altro');
  });

  await test('PROPONE ma non scrive: il record resta com\'era', () => {
    const d = getData(recId);
    assertEq(d.categoria, 'Altro');
    assertEq(d.importo, 0);
    assertEq(d.scadenza, undefined);
  });

  await test('l\'elenco dei suggerimenti in attesa mostra record e proposta', async () => {
    const list = await (await api('GET', '/suggestions?module=spese_casa')).json();
    const s = list.find((x) => x.id === sugId);
    assertEq(s.record.descrizione, 'A2A Energia');
    assertEq(s.proposta.categoria, 'Elettricità');
    assertEq(s.corrente.categoria, 'Altro');
  });

  await test('una seconda richiesta per lo stesso record non crea un doppione', async () => {
    const before = pendingCount();
    const out = await ai.suggestForRecord({ moduleSlug: 'spese_casa', recordId: recId, force: true });
    assertEq(out.skipped, 'già presente');
    assertEq(pendingCount(), before);
  });

  await test('un modulo che non è di spese non viene proposto', async () => {
    const out = await ai.suggestForRecord({ moduleSlug: 'entrate', recordId: 1, force: true });
    assertEq(out.skipped, 'modulo non supportato');
  });

  await test('se la proposta non cambia nulla non viene salvata', async () => {
    sa.reply = { suggestion: { modulo: 'spese_casa', categoria: 'Altro', fornitore: null, importo: null, scadenza: null, confidenza: 'bassa' } };
    const id = newBill();
    const out = await ai.suggestForRecord({ moduleSlug: 'spese_casa', recordId: id, force: true });
    assertEq(out.skipped, 'nessuna differenza');
    sa.reply = { suggestion: PROPOSTA };
  });

  console.log('\n--- accettare e ignorare ---');

  await test('accettare applica categoria, importo, scadenza e fornitore, e lascia la riga in "da smistare"', async () => {
    const out = await (await api('POST', '/suggestions/' + sugId + '/accept')).json();
    assertEq(out.applied.join(','), 'categoria,importo,scadenza,fornitore');
    const d = getData(recId);
    assertEq(d.categoria, 'Elettricità');
    assertEq(d.importo, 64);
    assertEq(d.scadenza, '2026-09-07');
    assertTrue(d.note.includes('Fornitore: A2A Energia'));
    assertEq(d._stato, 'da_smistare', 'lo smistamento resta una scelta tua');
  });

  await test('l\'accettazione lascia traccia nella cronologia del record', () => {
    const h = db.prepare("SELECT action, actor FROM record_history WHERE record_id = ? ORDER BY id DESC").get(recId);
    assertEq(h.action, 'update');
    assertEq(h.actor, 'admin');
  });

  await test('accettare due volte lo stesso suggerimento -> 404', async () => {
    assertEq((await api('POST', '/suggestions/' + sugId + '/accept')).status, 404);
  });

  await test('una categoria non ammessa NON viene applicata nemmeno se è nella proposta (difesa in profondità)', async () => {
    const id = newBill();
    db.prepare('INSERT INTO ai_suggestions (module_slug, record_id, payload) VALUES (?, ?, ?)').run('spese_casa', id, JSON.stringify({ proposta: { categoria: 'Viaggi di lusso', importo: 10 }, corrente: {} }));
    const sid = db.prepare('SELECT MAX(id) m FROM ai_suggestions').get().m;
    const out = await (await api('POST', '/suggestions/' + sid + '/accept')).json();
    assertEq(out.applied.join(','), 'importo');
    assertEq(getData(id).categoria, 'Altro');
  });

  await test('una riga già "da pagare" o "pagato" non cambia stato accettando', async () => {
    const id = newBill({ _stato: 'pagato' });
    const o = await ai.suggestForRecord({ moduleSlug: 'spese_casa', recordId: id, force: true });
    const out = await (await api('POST', '/suggestions/' + o.id + '/accept')).json();
    assertEq(out.applied.includes('stato'), false);
    assertEq(getData(id)._stato, 'pagato');
  });

  await test('ignorare lascia il record intatto e chiude il suggerimento', async () => {
    const id = newBill();
    const out = await ai.suggestForRecord({ moduleSlug: 'spese_casa', recordId: id, force: true });
    const before = JSON.stringify(getData(id));
    assertEq((await api('POST', '/suggestions/' + out.id + '/dismiss')).status, 200);
    assertEq(JSON.stringify(getData(id)), before);
    assertEq(db.prepare('SELECT status FROM ai_suggestions WHERE id = ?').get(out.id).status, 'dismissed');
  });

  console.log('\n--- quando qualcosa non va ---');

  await test('tetto di spesa raggiunto (429 da Super Admin): messaggio chiaro, nessun suggerimento, record intatto', async () => {
    sa.status = 429; sa.reply = { error: 'Tetto mensile AI raggiunto', code: 'ai_budget_exceeded' };
    const id = newBill();
    const before = pendingCount();
    const res = await api('POST', '/suggest/spese_casa/' + id);
    const body = await res.json();
    assertEq(res.status, 429);
    assertEq(body.code, 'ai_budget_exceeded');
    assertEq(pendingCount(), before);
    assertEq(getData(id).categoria, 'Altro');
    sa.status = 200; sa.reply = { suggestion: PROPOSTA };
  });

  await test('Super Admin irraggiungibile: errore gestito, il poller non si rompe', async () => {
    await new Promise((r) => fakeSA.close(r));
    const id = newBill();
    const out = await ai.suggestForRecord({ moduleSlug: 'spese_casa', recordId: id, force: true });
    assertTrue(out.error, 'deve segnalare l\'errore senza lanciare eccezioni');
    assertEq(getData(id).categoria, 'Altro');
  });

  console.log(`\n${'='.repeat(60)}`);
  console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
  try { fs.unlinkSync(dbPath); } catch (e) {}
  process.exit(failed > 0 ? 1 : 0);
}
main().catch((e) => { console.error('Suite AI fallita ad avviarsi:', e); process.exit(1); });
