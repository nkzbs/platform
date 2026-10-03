'use strict';
// "Come sta andando" (insights.js, routes/insights.js): numeri di un mese calcolati dal programma
// su entrate e spese, confronti, anomalie, limiti dichiarati, spiegazione dell'assistente (Super Admin
// simulato) salvata e riusata finché i numeri non cambiano.
// Eseguire con: node src/insights.test.js (porte 34800 e 34801 libere).

const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');

const TEST_PORT = 34800, FAKE_PORT = 34801;
const BASE = 'http://localhost:' + TEST_PORT;
const SECRET = 'insights_internal_' + crypto.randomBytes(8).toString('hex');
const dbPath = path.join(os.tmpdir(), 'insights-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.DB_PATH = dbPath;
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'insights_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = SECRET;
process.env.INITIAL_ADMIN_PASSWORD = 'insights_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'insights-uploads-'));
process.env.SUPER_ADMIN_URL = 'http://localhost:' + FAKE_PORT;
process.env.TENANT_SLUG = 'finance';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; }
}
function assertEq(a, e, msg) { if (a !== e) throw new Error(`${msg || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); }
function assertTrue(c, msg) { if (!c) throw new Error(msg || 'atteso true'); }

let sa = { calls: [], status: 200, reply: { text: 'Settembre chiude in positivo.' } };
const fakeSA = http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    if (req.headers['x-internal-secret'] !== SECRET) { res.writeHead(401); return res.end('{}'); }
    if (req.url === '/api/tenant-ai/explain-insights') { sa.calls.push(JSON.parse(body)); res.writeHead(sa.status, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(sa.reply)); }
    res.writeHead(404); res.end('{}');
  });
});

async function main() {
  await new Promise((r) => fakeSA.listen(FAKE_PORT, r));
  require('./index.js');
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const db = require('./db');
  for (const k of require('./features').KEYS) require('./features').set(k, true); // le funzioni facoltative sono spente di default: qui servono
  const insights = require('./insights');
  for (const slug of ['entrate', 'spese_casa', 'spese_personali']) {
    db.prepare('DELETE FROM modules WHERE slug = ?').run(slug);
    db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES (?, ?, 'box', '#000', 1, 1, 50, '{}')").run(slug, slug);
  }
  const rec = (slug, d) => db.prepare('INSERT INTO records (module_slug, user_id, data) VALUES (?, NULL, ?)').run(slug, JSON.stringify(d)).lastInsertRowid;
  const ent = (data, importo, categoria = 'Stipendio') => rec('entrate', { descrizione: 'riga segreta ' + categoria, data, importo, categoria });
  const sp = (slug, data, importo, categoria, extra = {}) => rec(slug, { descrizione: 'descrizione privata', data, importo, categoria, _stato: 'pagato', ...extra });

  // 2026-04..2026-08: ogni mese 1000 di stipendio, Elettricità 100, Alimentari 200; 2026-09 (mese in esame): stipendio 1800, Elettricità 300 (+200%), Alimentari 210, Benzina 80 (nuova)
  for (const m of ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08']) { ent(m + '-27', 1000); sp('spese_casa', m + '-10', 100, 'Elettricità', { fisso: true }); sp('spese_personali', m + '-15', 200, 'Alimentari'); }
  ent('2026-09-25', 1799.58); ent('2026-09-10', 500, 'Risparmi'); ent('2026-09-11', 99, 'Fondo');
  sp('spese_casa', '2026-09-10', 300, 'Elettricità', { fisso: true }); sp('spese_personali', '2026-09-15', 210, 'Alimentari'); sp('spese_personali', '2026-09-20', 80, 'Benzina', { _stato: 'da_pagare' });
  sp('spese_casa', '2026-09-12', 0, 'Gas', { _stato: 'da_smistare' });

  // Questi test usano casa + personali insieme, come all'inizio (il default ora è la sola vista personale, provato più sotto).
  insights.saveConfig({ spese: { modules: ['spese_casa', 'spese_personali'] } });
  const NOW = new Date('2026-10-03T10:00:00Z');
  const snap = () => insights.buildSnapshot('2026-09', NOW);

  console.log('\n--- numeri del mese ---');

  await test('entrate: gli stipendi sì, Risparmi e Fondo no (non sono soldi guadagnati)', () => { assertEq(snap().entrate, 1799.58); });
  await test('spese del mese = casa + personali, senza le righe "da smistare"', () => { assertEq(snap().spese, 590); });
  await test('saldo, risparmio %, pagate / da pagare, fisse / variabili', () => {
    const s = snap();
    assertEq(s.saldo, 1209.58); assertEq(s.risparmio_pct, 67.2);
    assertEq(s.spese_pagate, 510); assertEq(s.spese_da_pagare, 80);
    assertEq(s.spese_fisse, 300); assertEq(s.spese_variabili, 290);
  });
  await test('confronto con il mese prima e con la media dei 12 mesi (solo mesi con dati)', () => {
    const c = snap().confronti;
    assertEq(c.mese_precedente.spese, 300); assertEq(c.mese_precedente.spese_variazione_pct, 96.7);
    assertEq(c.media_12_mesi.spese, 300); assertEq(c.media_12_mesi.entrate, 1000);
    assertEq(c.anno_precedente.spese, 0); assertEq(c.anno_precedente.spese_variazione_pct, null, 'niente divisione per zero');
  });
  await test('categorie con media degli ultimi 6 mesi e variazione', () => {
    const el = snap().categorie.find((c) => c.nome === 'Elettricità');
    assertEq(el.valore, 300); assertEq(el.media_6m, 100, 'media sui 5 mesi con dati, non sui 6'); assertEq(el.variazione_pct, 200);
  });

  console.log('\n--- anomalie ---');

  await test('Elettricità (+260% sulla media) è un\'anomalia; Alimentari (+5%) no; Benzina è una categoria nuova (80 €)', () => {
    const a = snap().anomalie;
    assertTrue(a.some((x) => x.nome === 'Elettricità' && x.tipo === 'sopra_la_media'), JSON.stringify(a));
    assertTrue(!a.some((x) => x.nome === 'Alimentari'));
    assertTrue(a.some((x) => x.nome === 'Benzina' && x.tipo === 'categoria_nuova'));
  });
  await test('la soglia è un\'impostazione: con +300% Elettricità non è più un\'anomalia', () => {
    insights.saveConfig({ anomaly: { pct: 300 } });
    assertTrue(!snap().anomalie.some((x) => x.nome === 'Elettricità'));
    insights.saveConfig({ anomaly: { pct: 25 } });
  });

  console.log('\n--- vista personale: cosa non è entrata e cosa non è spesa mia ---');

  await test('i contributi alla casa (gruppo Casa) e i riporti di saldo non sono entrate personali', () => {
    rec('entrate', { descrizione: 'Contributo Casa', data: '2026-09-27', importo: 500, categoria: 'Contributo Casa', gruppo: 'Casa' });
    rec('entrate', { descrizione: 'Saldo conto', data: '2026-09-26', importo: 1202, categoria: 'Altro', gruppo: 'Personale' });
    assertEq(snap().entrate, 1799.58, 'restano solo gli stipendi');
  });
  await test('il default è la sola vista personale: le spese di casa (affitto, bollette, pagate anche da altri) non contano', () => {
    assertEq(JSON.stringify(insights.DEFAULT_CONFIG.spese.modules), JSON.stringify(['spese_personali']));
    insights.saveConfig({ spese: { modules: ['spese_personali'] } });
    assertEq(snap().spese, 290, 'solo Alimentari 210 + Benzina 80');
    insights.saveConfig({ spese: { modules: ['spese_casa', 'spese_personali'] } });
  });
  await test('una quota versata alla casa, registrata tra le spese personali ("Contributo Casa"), conta come spesa mia', () => {
    insights.saveConfig({ spese: { modules: ['spese_personali'] } });
    const id = sp('spese_personali', '2026-09-05', 500, 'Contributo Casa');
    assertEq(snap().spese, 790);
    db.prepare('DELETE FROM records WHERE id = ?').run(id);
    insights.saveConfig({ spese: { modules: ['spese_casa', 'spese_personali'] } });
  });

  console.log('\n--- accantonamento trattenuto in busta ---');

  // maggio: accantonamento registrato (riga Fondo, 150 su 1000 di netto); giugno, luglio, agosto: nessuna riga -> stima; settembre: 99 registrato
  ent('2026-05-27', 150, 'Fondo');
  await test('l\'accantonamento registrato (categoria Fondo) non è un\'entrata sul conto ma conta come risparmio', () => {
    const s = insights.buildSnapshot('2026-05', NOW);
    assertEq(s.entrate, 1000, 'il Fondo non è accreditato');
    assertEq(s.accantonato, 150); assertEq(s.accantonato_stimato, false);
    assertEq(s.risparmio_vero_pct, Math.round(((1000 - 300 + 150) / (1000 + 150)) * 1000) / 10);
  });
  await test('dove manca, si stima dal rapporto mediano accantonato/netto degli altri mesi, e lo dice', () => {
    const s = insights.buildSnapshot('2026-06', NOW);
    // rapporti: maggio 150/1000 = 0,15 ; settembre 99/1799,58 = 0,0550 -> mediana 0,1025
    assertEq(s.accantonato, 102.51); assertEq(s.accantonato_stimato, true);
    assertTrue(s.limiti.some((l) => /stima/.test(l)), 'il limite deve parlare di stima');
  });
  await test('prima che l\'accantonamento cominciasse (nessuna riga prima di maggio) non si stima niente', () => {
    const s = insights.buildSnapshot('2026-04', NOW);
    assertEq(s.accantonato, 0); assertEq(s.accantonato_stimato, false);
    assertEq(s.risparmio_vero_pct, s.risparmio_pct);
  });
  await test('anche il campo accantonamento_suggerito sulla riga dello stipendio conta, senza stima', () => {
    db.prepare("UPDATE records SET data = json_set(data, '$.accantonamento_suggerito', 120) WHERE module_slug = 'entrate' AND json_extract(data, '$.data') = '2026-07-27'").run();
    const s = insights.buildSnapshot('2026-07', NOW);
    assertEq(s.accantonato_stimato, false); assertEq(s.accantonato, 120);
  });
  console.log('\n--- riepilogo dalla banca ---');

  await test('senza movimenti bancari il blocco "banca" è vuoto; con i movimenti mostra uscite reali e quelle non registrate', () => {
    assertEq(snap().banca, null);
    db.prepare("INSERT INTO bank_accounts (iban_last4, holder, nome) VALUES ('9999', 'X', 'Conto …9999')").run();
    const acc = db.prepare("SELECT id FROM bank_accounts WHERE iban_last4 = '9999'").get().id;
    const ins = db.prepare('INSERT INTO bank_movements (account_id, date, booked, amount, description, kind, dedupe_key, match_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    ins.run(acc, '2026-09-12', '2026-09-12', -40, 'Pagamento POS', 'carta', 'k1', null);
    ins.run(acc, '2026-09-13', '2026-09-13', -60, 'Pagamento POS', 'carta', 'k2', 1);
    ins.run(acc, '2026-09-14', '2026-09-14', -300, 'Bonifico Conto Casa', 'giro_interno', 'k3', null);
    ins.run(acc, '2026-09-25', '2026-09-25', 1799.58, 'EMOLUMENTI', 'stipendio', 'k4', 1);
    const b = snap().banca;
    assertEq(b.entrate_reali, 1799.58); assertEq(b.uscite_reali, 100, 'i giri interni non sono spese');
    assertEq(b.giri_interni, 300); assertEq(b.non_registrate, 40); assertEq(b.non_registrate_n, 1);
    assertEq(insights.buildSnapshot('2026-08', NOW).banca, null, 'mese senza movimenti');
  });

  console.log('\n--- righe senza data certa ---');

  await test('una spesa con data_incerta non entra in nessun mese, e la scheda dice quante e quanto', () => {
    const before = snap().spese;
    const id = sp('spese_personali', '2026-09-18', 400, 'Alimentari', { data_incerta: true });
    const s = snap();
    assertEq(s.spese, before, 'la riga senza data certa non cambia il mese');
    assertTrue(s.limiti.some((l) => /andata persa/.test(l) && /400/.test(l)), JSON.stringify(s.limiti));
    db.prepare('DELETE FROM records WHERE id = ?').run(id);
    assertTrue(!snap().limiti.some((l) => /andata persa/.test(l)), 'senza righe incerte nessun avviso');
  });

  console.log('\n--- da inizio anno ---');

  // 2025 (anno scorso): stipendio 1000 e spese personali 100 al mese, tutti i mesi. 2026 fino a settembre: i dati seminati sopra
  // (aprile-agosto: stipendio 1000, casa 100 + personali 200; settembre: 1799,58 / 300 + 210 + 80) + gennaio-marzo di prova.
  for (let m = 1; m <= 12; m++) { const mm = String(m).padStart(2, '0'); ent('2025-' + mm + '-27', 1000); sp('spese_personali', '2025-' + mm + '-15', 100, 'Alimentari'); }
  for (const m of ['2026-01', '2026-02', '2026-03']) { ent(m + '-27', 1000); sp('spese_personali', m + '-15', 100, 'Alimentari'); }
  sp('spese_personali', '2026-02-20', 300, 'Rata', { debito: 9999 });
  const Y = () => insights.buildYearSnapshot('2026', NOW);

  await test('anno corrente: da gennaio all\'ultimo mese concluso (settembre), non il mese in corso', () => {
    const y = Y();
    assertEq(y.fino_a, '2026-09'); assertEq(y.mesi, 9);
    assertEq(y.period, 'anno');
  });
  await test('entrate e spese dell\'anno sono la somma dei mesi, con le stesse regole del mese (casa+personali di prova, "da smistare" fuori)', () => {
    const y = Y();
    // entrate: 3 x 1000 (gen-mar) + 5 x 1000 (apr-ago) + 1799,58 (set) ; Risparmi/Fondo/Casa/Saldo conto esclusi
    assertEq(y.entrate, 9799.58);
    // spese: gen-mar 3 x 100 + rata 300 ; apr-ago 5 x 300 ; set 590
    assertEq(y.spese, 300 + 300 + 1500 + 590);
    assertEq(y.saldo, y.entrate - y.spese === y.saldo ? y.saldo : -1);
  });
  await test('come si dividono le spese: rate (collegate a un debito o categoria Rata), fisse, variabili: la somma torna', () => {
    const y = Y();
    assertEq(y.spese_rate, 300);
    assertEq(Math.round((y.spese_rate + y.spese_fisse + y.spese_variabili) * 100) / 100, y.spese);
  });
  await test('confronto con lo stesso periodo dell\'anno prima (gen-set 2025) e variazione percentuale', () => {
    const c = Y().confronti.anno_precedente;
    assertEq(c.anno, '2025'); assertEq(c.entrate, 9000); assertEq(c.spese, 900);
    assertEq(c.spese_variazione_pct, Math.round(((Y().spese - 900) / 900) * 1000) / 10);
  });
  await test('categorie dell\'anno con il valore dell\'anno prima e la variazione', () => {
    const al = Y().categorie.find((k) => k.nome === 'Alimentari');
    assertEq(al.anno_prec, 900);
    assertTrue(al.variazione_pct != null);
  });
  await test('un anno passato va fino a dicembre; l\'anno prossimo (o senza mesi conclusi) è vuoto, senza errori', () => {
    assertEq(insights.buildYearSnapshot('2025', NOW).fino_a, '2025-12');
    assertEq(insights.buildYearSnapshot('2027', NOW).vuoto, true);
    assertEq(insights.buildYearSnapshot('2026', new Date('2026-01-10T00:00:00Z')).vuoto, true, 'a gennaio nessun mese concluso');
  });
  await test('l\'accantonamento dell\'anno somma i mesi (registrato + stimato) e dice se è in parte una stima', () => {
    const y = Y();
    assertTrue(y.accantonato > 0 && y.accantonato_stimato === true, JSON.stringify([y.accantonato, y.accantonato_stimato]));
    assertEq(y.risparmio_vero_pct, Math.round(((y.entrate - y.spese + y.accantonato) / (y.entrate + y.accantonato)) * 1000) / 10);
  });
  await test('rotta: GET ?period=anno restituisce l\'anno; spiegazione dell\'anno salvata e riusata; anno non valido -> 400', async () => {
    const log = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: process.env.INITIAL_ADMIN_PASSWORD }) })).json();
    const HH = { Authorization: 'Bearer ' + log.token, 'Content-Type': 'application/json' };
    const yr = new Date().getUTCFullYear();
    assertEq((await fetch(BASE + '/api/insights?period=anno&year=boh', { headers: HH })).status, 400);
    const g = await (await fetch(BASE + '/api/insights?period=anno&year=2025', { headers: HH })).json();
    assertEq(g.period, 'anno'); assertEq(g.explanation, null);
    sa.calls = []; sa.status = 200; sa.reply = { text: 'Nel 2025 sei in positivo.' };
    const e1 = await (await fetch(BASE + '/api/insights/explain', { method: 'POST', headers: HH, body: JSON.stringify({ period: 'anno', year: '2025' }) })).json();
    assertEq(e1.text, 'Nel 2025 sei in positivo.');
    assertEq(sa.calls[0].data.period, 'anno'); assertEq(sa.calls[0].data.year, '2025');
    const e2 = await (await fetch(BASE + '/api/insights/explain', { method: 'POST', headers: HH, body: JSON.stringify({ period: 'anno', year: '2025' }) })).json();
    assertEq(e2.cached, true); assertEq(sa.calls.length, 1, 'nessuna nuova chiamata');
    assertEq((await (await fetch(BASE + '/api/insights?period=anno&year=2025', { headers: HH })).json()).explanation.text, 'Nel 2025 sei in positivo.');
  });

  console.log('\n--- limiti dichiarati ---');

  await test('il mese in corso è segnalato come parziale; il mese senza entrate lo dice', () => {
    const cur = insights.buildSnapshot('2026-10', NOW);
    assertEq(cur.in_corso, true);
    assertTrue(cur.limiti.some((l) => /parziali/.test(l)));
    assertTrue(cur.limiti.some((l) => /Nessuna entrata/.test(l)));
    assertEq(snap().in_corso, false);
  });
  await test('i limiti dicono sempre cosa non è conteggiato', () => {
    assertTrue(snap().limiti.some((l) => /Risparmi, Fondo/.test(l)));
    assertTrue(snap().limiti.some((l) => /altri conti/.test(l)));
  });
  await test('senza moduli di entrate o di spese -> "non disponibile", mai un errore', () => {
    db.prepare("UPDATE modules SET installed = 0 WHERE slug = 'entrate'").run();
    assertEq(insights.buildSnapshot('2026-09', NOW).available, false);
    db.prepare("UPDATE modules SET installed = 1 WHERE slug = 'entrate'").run();
  });
  await test('il mese di default è l\'ultimo concluso', () => { assertEq(insights.lastClosedMonth(NOW), '2026-09'); assertEq(insights.lastClosedMonth(new Date('2026-01-05T00:00:00Z')), '2025-12'); });

  console.log('\n--- spiegazione dell\'assistente ---');

  const login = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: process.env.INITIAL_ADMIN_PASSWORD }) })).json();
  const H = { Authorization: 'Bearer ' + login.token, 'Content-Type': 'application/json' };
  const call = (m, p, body, h = H) => fetch(BASE + '/api/insights' + p, { method: m, headers: h, body: body ? JSON.stringify(body) : undefined });

  await test('senza login -> 401; mese non valido -> 400', async () => {
    assertEq((await call('GET', '', null, {})).status, 401);
    assertEq((await call('GET', '?month=boh')).status, 400);
    assertEq((await call('POST', '/explain', { month: 'boh' })).status, 400);
  });
  await test('GET restituisce i numeri senza chiamare l\'AI', async () => {
    sa.calls = [];
    const b = await (await call('GET', '?month=2026-09')).json();
    assertEq(b.entrate, 1799.58); assertEq(b.explanation, null);
    assertEq(sa.calls.length, 0);
  });
  await test('POST /explain: a Super Admin vanno solo totali (mai descrizioni), il testo si salva', async () => {
    sa.calls = []; sa.status = 200; sa.reply = { text: 'Settembre chiude in positivo di 1209,58 euro.' };
    const res = await call('POST', '/explain', { month: '2026-09' });
    assertEq(res.status, 200);
    assertEq((await res.json()).text, sa.reply.text);
    const sent = JSON.stringify(sa.calls[0]);
    assertTrue(!sent.includes('privata') && !sent.includes('segreta'), 'descrizioni uscite: ' + sent.slice(0, 200));
    assertTrue(sa.calls[0].data.categorie.length > 0 && sa.calls[0].data.limiti === undefined);
    assertEq((await (await call('GET', '?month=2026-09')).json()).explanation.text, sa.reply.text);
  });
  await test('seconda richiesta con gli stessi numeri: usa il testo salvato, nessuna nuova chiamata (nessun costo)', async () => {
    sa.calls = [];
    const b = await (await call('POST', '/explain', { month: '2026-09' })).json();
    assertEq(b.cached, true); assertEq(sa.calls.length, 0);
  });
  await test('"Riscrivi" forza una nuova chiamata', async () => {
    sa.calls = [];
    await call('POST', '/explain', { month: '2026-09', refresh: true });
    assertEq(sa.calls.length, 1);
  });
  await test('se i numeri cambiano (nuova spesa) il testo salvato risulta "vecchio" e si rigenera', async () => {
    sp('spese_personali', '2026-09-22', 40, 'Alimentari');
    const b = await (await call('GET', '?month=2026-09')).json();
    assertEq(b.explanation.stale, true);
    sa.calls = [];
    await call('POST', '/explain', { month: '2026-09' });
    assertEq(sa.calls.length, 1);
  });
  await test('errori di Super Admin: tetto (429), numero inventato (502), nessuna chiave (503); il testo vecchio resta', async () => {
    sa.status = 429; sa.reply = { error: 'Tetto', code: 'ai_budget_exceeded' };
    let r = await call('POST', '/explain', { month: '2026-09', refresh: true }); assertEq(r.status, 429); assertEq((await r.json()).code, 'ai_budget_exceeded');
    sa.status = 502; sa.reply = { error: 'scartato', code: 'ai_unverified' };
    r = await call('POST', '/explain', { month: '2026-09', refresh: true }); assertEq(r.status, 502);
    sa.status = 503; sa.reply = { error: 'Nessuna chiave', code: 'ai_not_configured' };
    r = await call('POST', '/explain', { month: '2026-09', refresh: true }); assertEq(r.status, 503);
    assertTrue(!!(await (await call('GET', '?month=2026-09')).json()).explanation, 'il testo precedente non va perso');
  });

  await test('l\'accantonamento arriva all\'assistente (numeri e flag di stima), così può citarlo', async () => {
    sa.calls = [];
    await call('POST', '/explain', { month: '2026-06', refresh: true });
    assertEq(sa.calls[0].data.accantonato, insights.buildSnapshot('2026-06', NOW).accantonato); assertTrue(sa.calls[0].data.accantonato > 0); assertEq(sa.calls[0].data.accantonato_stimato, true);
  });

  console.log('\n--- impostazioni ---');

  await test('la configurazione si legge e si cambia (solo admin); un valore strano non rompe i calcoli', async () => {
    const cfg = await (await call('GET', '/config')).json();
    assertEq(cfg.entrate.exclude_categories.join(), 'Risparmi,Fondo');
    const up = await (await call('PUT', '/config', { entrate: { exclude_categories: ['Risparmi'] }, balance_floor_eur: 500 })).json();
    assertEq(up.balance_floor_eur, 500);
    assertEq(insights.buildSnapshot('2026-09', NOW).entrate, 1898.58, 'ora il Fondo conta come entrata');
    await call('PUT', '/config', { entrate: { exclude_categories: ['Risparmi', 'Fondo'] }, balance_floor_eur: 300 });
  });

  console.log(`\n${'='.repeat(60)}`);
  console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
  try { fs.unlinkSync(dbPath); } catch (e) {}
  process.exit(failed > 0 ? 1 : 0);
}
main().catch((e) => { console.error('Suite insights fallita ad avviarsi:', e); process.exit(1); });
