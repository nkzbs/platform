'use strict';
// Movimenti bancari (bank-import.js, routes/bank.js). Estratto di prova INVENTATO, nel formato
// "Estratto Conto Italia": nessun dato personale vero. Eseguire con: node src/bank-import.test.js (porta 34802 libera).

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const TEST_PORT = 34802;
const BASE = 'http://localhost:' + TEST_PORT;
const dbPath = path.join(os.tmpdir(), 'bank-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.DB_PATH = dbPath;
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'bank_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'bank_internal_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'bank_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bank-uploads-'));
process.env.SUPER_ADMIN_URL = 'http://localhost:1';
process.env.TENANT_SLUG = 'finance';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; }
}
function assertEq(a, e, msg) { if (a !== e) throw new Error(`${msg || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); }
function assertTrue(c, msg) { if (!c) throw new Error(msg || 'atteso true'); }

const H1 = 'IT00X0000000000000000001234';
// Due pagine, intestazione ripetuta, piè di pagina, importi "centrati" (testo sopra e sotto), descrizioni su più righe.
const PAGE1 = `                                      Estratto Conto Italia

Rapporto:                         ${H1} ROSSI MARIO
Periodo:                          Da:   01/09/2026                      A:     30/09/2026
Data e ora di stampa:             03/10/2026 12:08

Saldo Contabile Finale                       30/09/2026                                         +100,00 Euro
    Data
                 Valuta        Dare       Avere                              Descrizione
  contabile
                                                     EMOLUMENTI ACME SRL Data Regolamento:
                                                     25/09/26 Coord.Ordinante: IT94 X033 8001 6000 0001 3279 025
  25/09/2026      25/09/2026                1.800,50 Note: VOCIRETRIB.
                                                     80074591/202609 Id.Operazione: 0001486

                                                     Pagamento POS CARTA 111111 ESEGUITO IL 20/09 C/O
  21/09/2026      20/09/2026      -45,30             DISTRIBUTORE SAINI SRL Operazione C-LESS - Carta fisica
  21/09/2026      20/09/2026      -2,50              COMM. SU BONIFICI
                                                     VS DISPOSIZIONE DI BONIFICO Conto Casa Bonifico
                                                     Disposto in: Internet Coor.Benef.: IT88 M051 1654 8500 0000 0003 548 Data
  21/09/2026      21/09/2026     -300,00
                                                     Ordine: 21/09/26 Data Accredito: 21/09/26 Cro: 28925383601

                                                                                                       1
`;
const PAGE2 = `    Data
                 Valuta        Dare       Avere                              Descrizione
  contabile
                                                     Pagamento POS CARTA 111111 ESEGUITO IL 18/09 C/O
  19/09/2026      18/09/2026      -12,00             CONAD SUPERMERCATI Operazione C-LESS - Carta fisica
                                                     Pagamento POS CARTA 111111 ESEGUITO IL 18/09 C/O
  19/09/2026      18/09/2026      -12,00             CONAD SUPERMERCATI Operazione C-LESS - Carta fisica
                                                     RICARICA CARTA/E PREPAGATA/E N. 472675******0983
  15/09/2026      15/09/2026     -200,00
                                                     VS DISPOSIZIONE DI BONIFICO MARIO ROSSI, ROSSI ANNA Bonifico
  12/09/2026      12/09/2026     -150,00             Disposto in: Internet Data Ordine: 12/09/26
                                                     PAGAMENTO UTENZA PAG.TO CBILL DI EURO 64,00 BILLER: AJZ8Z
  10/09/2026      10/09/2026      -64,00             N.DOCUMENTO 180022100431698154
                                                     Prelievo di contante ATM CARTA 111111 DEL 08/09/26 21:07
  09/09/2026      08/09/2026     -100,00             SPORTELLO 0002

                                                                                                       2
`;
// il testo reale ha le pagine separate da \f e l'intestazione colonne ripetuta su ogni pagina
const TEXT = PAGE1 + '\f' + PAGE2 + '\f' + PAGE2.replace('CONAD', 'CONAD ');

async function main() {
  require('./index.js');
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const db = require('./db');
  const bank = require('./bank-import');

  console.log('\n--- lettura dell\'estratto ---');
  const parsed = bank.parseStatement(PAGE1 + '\f' + PAGE2);

  await test('intestazione: ultime 4 cifre del conto, intestatario, periodo', () => {
    assertEq(parsed.header.iban_last4, '1234'); assertEq(parsed.header.holder, 'ROSSI MARIO');
    assertEq(parsed.header.from, '2026-09-01'); assertEq(parsed.header.to, '2026-09-30');
  });
  await test('legge tutti i movimenti (uno per riga di importo), con valuta e data contabile', () => {
    assertEq(parsed.movements.length, 10);
    const pos = parsed.movements[1];
    assertEq(pos.amount, -45.3); assertEq(pos.date, '2026-09-20'); assertEq(pos.booked, '2026-09-21');
  });
  await test('importi all\'italiana: 1.800,50 -> 1800.5; i piè di pagina e le intestazioni ripetute non entrano nelle descrizioni', () => {
    assertEq(parsed.movements[0].amount, 1800.5);
    for (const m of parsed.movements) assertTrue(!/Estratto Conto|Descrizione|contabile/.test(m.description), m.description);
  });
  await test('la descrizione di un importo "centrato" (testo sopra e sotto) è assegnata al movimento giusto', () => {
    assertTrue(/DISTRIBUTORE SAINI/.test(parsed.movements[1].description), parsed.movements[1].description);
    const giro = parsed.movements.find((m) => m.amount === -300);
    assertTrue(/Conto Casa/.test(giro.description) && /Cro: 28925383601/.test(giro.description), giro.description);
    assertTrue(!/DISTRIBUTORE/.test(giro.description), 'non deve prendere il testo del movimento prima');
  });

  console.log('\n--- classificazione ---');
  const cl = (d, a) => bank.classify(d, a, 'ROSSI MARIO');
  await test('stipendio, commissioni, carta con esercente, utenze, prelievo', () => {
    assertEq(cl('EMOLUMENTI ACME SRL Data', 1800).kind, 'stipendio');
    assertEq(cl('COMM. SU BONIFICI', -2.5).kind, 'commissioni');
    const c = cl('Pagamento POS CARTA 1 ESEGUITO IL 20/09 C/O DISTRIBUTORE SAINI SRL Operazione C-LESS', -45.3);
    assertEq(c.kind, 'carta'); assertEq(c.merchant, 'DISTRIBUTORE SAINI SRL');
    assertEq(cl('PAGAMENTO UTENZA PAG.TO CBILL DI EURO 64,00', -64).kind, 'utenza');
    assertEq(cl('Prelievo di contante ATM CARTA 1', -100).kind, 'prelievo');
  });
  await test('giri tra conti propri: Conto Casa, cointestato con l\'intestatario, ricarica della prepagata', () => {
    assertEq(cl('VS DISPOSIZIONE DI BONIFICO Conto Casa Bonifico', -300).kind, 'giro_interno');
    assertEq(cl('VS DISPOSIZIONE DI BONIFICO MARIO ROSSI, ROSSI ANNA Bonifico', -150).kind, 'giro_interno');
    assertEq(cl('RICARICA CARTA/E PREPAGATA/E N. 472675******0983', -200).kind, 'giro_interno');
  });
  await test('un bonifico a una persona con lo stesso cognome ma nome diverso NON è un giro interno', () => {
    assertEq(cl('MOOD SRL BONIFICO A VOSTRO FAVORE ROSSI LUCA', 120).kind, 'bonifico_in');
    assertEq(cl('VS DISPOSIZIONE DI BONIFICO ROSSI LUCA Bonifico', -50).kind, 'bonifico_out');
  });
  await test('categoria suggerita da parole chiave', () => {
    assertEq(bank.categoryHint('x', 'DISTRIBUTORE SAINI SRL'), 'Auto & Benzina');
    assertEq(bank.categoryHint('x', 'CONAD SUPERMERCATI'), 'Alimentari');
    assertEq(bank.categoryHint('x', 'BAR ROMA'), 'Intrattenimento');
    assertEq(bank.categoryHint('x', 'XYZ'), null);
  });
  await test('gli IBAN nelle descrizioni si mascherano (restano le ultime 4 cifre)', () => {
    const m = bank.maskIban('Coor.Benef.: IT88 M051 1654 8500 0000 0003 548 Data');
    assertTrue(!/M051/.test(m) && /IBAN…3548/.test(m), m);
  });

  console.log('\n--- importazione e abbinamento ---');
  const seedModule = (slug) => { db.prepare('DELETE FROM modules WHERE slug = ?').run(slug); db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES (?, ?, 'box', '#000', 1, 1, 50, '{}')").run(slug, slug); };
  ['spese_personali', 'spese_casa', 'entrate'].forEach(seedModule);
  const rec = (slug, d) => db.prepare('INSERT INTO records (module_slug, user_id, data) VALUES (?, NULL, ?)').run(slug, JSON.stringify(d)).lastInsertRowid;

  let r1;
  await test('importa un estratto: crea il conto, i movimenti, dice quanti nuovi', () => {
    r1 = bank.importParsed(parsed, { fileName: 'a.pdf' });
    assertEq(r1.nuovi, 10); assertEq(r1.duplicati, 0); assertEq(r1.iban_last4, '1234');
    assertEq(db.prepare('SELECT COUNT(*) c FROM bank_accounts').get().c, 1);
  });
  await test('ricaricare lo stesso estratto non duplica niente; due movimenti identici nello stesso giorno restano due', () => {
    const again = bank.importParsed(bank.parseStatement(PAGE1 + '\f' + PAGE2), { fileName: 'a-bis.pdf' });
    assertEq(again.nuovi, 0); assertEq(again.duplicati, 10);
    assertEq(db.prepare("SELECT COUNT(*) c FROM bank_movements WHERE amount = -12").get().c, 2, 'i due caffè uguali');
  });
  await test('nelle descrizioni salvate non ci sono IBAN interi', () => {
    assertEq(db.prepare("SELECT COUNT(*) c FROM bank_movements WHERE description LIKE '%M051 1654%'").get().c, 0);
  });

  rec('entrate', { descrizione: 'Stipendio', data: '2026-09-25', importo: 1800.5, categoria: 'Stipendio' });
  rec('spese_personali', { descrizione: 'Benzina', data: '2026-09-20', importo: 45.3, categoria: 'Auto & Benzina', _stato: 'pagato' });
  rec('spese_personali', { descrizione: 'Contributo Casa', data: '2026-09-21', importo: 300, categoria: 'Contributo Casa', _stato: 'pagato' });
  rec('spese_casa', { descrizione: 'Bolletta', data: '2026-09-30', importo: 64, categoria: 'Utenze', _stato: 'pagato' });
  await test('abbina stipendio, benzina, contributo alla casa e bolletta con lo stesso importo e una data vicina', () => {
    const n = bank.rematch();
    assertEq(n, 4);
    const kinds = db.prepare('SELECT kind, match_module m FROM bank_movements WHERE match_id IS NOT NULL ORDER BY kind').all().map((x) => x.kind + ':' + x.m).join(',');
    assertEq(kinds, 'carta:spese_personali,giro_interno:spese_personali,stipendio:entrate,utenza:spese_casa');
  });
  await test('una riga di Finance non si abbina a due movimenti (i due da 12 € restano da registrare)', () => {
    rec('spese_personali', { descrizione: 'Spesa', data: '2026-09-18', importo: 12, categoria: 'Alimentari', _stato: 'pagato' });
    bank.rematch();
    assertEq(db.prepare("SELECT COUNT(*) c FROM bank_movements WHERE amount = -12 AND match_id IS NOT NULL").get().c, 1);
  });

  await test('riepilogo del mese: entrate e uscite reali, giri interni, spese non registrate in Finance', () => {
    const s = bank.monthSummary('2026-09');
    assertEq(s.entrate_reali, 1800.5);
    assertEq(s.giri_interni, 650, 'casa 300 + cointestato 150 + prepagata 200');
    assertEq(s.non_registrate_n, 1, 'un solo "12 €" ancora senza spesa');
    assertEq(s.non_registrate, 12);
    assertEq(bank.monthSummary('2020-01'), null);
  });
  await test('"da registrare" non include giri interni, prelievi, commissioni, né ciò che è già abbinato', () => {
    const l = bank.listMovements({ month: '2026-09', filter: 'da_registrare' });
    assertEq(l.length, 1); assertEq(l[0].amount, -12);
  });

  await test('registra un movimento come spesa personale già pagata, con categoria suggerita, e lo abbina', () => {
    const mov = bank.listMovements({ month: '2026-09', filter: 'da_registrare' })[0];
    const out = bank.registerAsExpense(mov.id);
    assertEq(out.data.categoria, 'Alimentari'); assertEq(out.data._stato, 'pagato'); assertEq(out.data.importo, 12); assertEq(out.data.data, '2026-09-18');
    assertEq(bank.listMovements({ month: '2026-09', filter: 'da_registrare' }).length, 0);
    assertTrue(!!bank.registerAsExpense(mov.id).error, 'non si registra due volte');
  });
  await test('un\'entrata non si registra come spesa; ignorare toglie un movimento da "da registrare"', () => {
    const e = db.prepare("SELECT id FROM bank_movements WHERE amount > 0").get();
    assertTrue(!!bank.registerAsExpense(e.id).error);
    db.prepare("UPDATE bank_movements SET match_id = NULL, match_module = NULL WHERE kind = 'carta' AND amount = -45.3").run();
    const id = db.prepare("SELECT id FROM bank_movements WHERE amount = -45.3").get().id;
    assertEq(bank.listMovements({ month: '2026-09', filter: 'da_registrare' }).length, 1);
    bank.setIgnored(id, true);
    assertEq(bank.listMovements({ month: '2026-09', filter: 'da_registrare' }).length, 0);
  });

  console.log('\n--- rotte ---');
  const login = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: process.env.INITIAL_ADMIN_PASSWORD }) })).json();
  const H = { Authorization: 'Bearer ' + login.token };
  bank.extractText = async () => TEXT; // pdftotext simulato: il PDF vero non serve nei test
  const upload = async (files) => { const fd = new FormData(); for (const [n, b] of files) fd.append('files', new Blob([b]), n); return fetch(BASE + '/api/bank/import', { method: 'POST', headers: H, body: fd }); };

  await test('senza login -> 401', async () => { assertEq((await fetch(BASE + '/api/bank/summary')).status, 401); });
  await test('carica un PDF: letto, movimenti già presenti riconosciuti come duplicati', async () => {
    const res = await upload([['estratto.pdf', Buffer.from('%PDF-1.4 finto')]]);
    const b = await res.json();
    assertEq(res.status, 200);
    assertEq(b.results[0].error, undefined);
    assertEq(b.results[0].duplicati > 0, true);
  });
  await test('un file che non è un PDF viene rifiutato con un messaggio, senza bloccare gli altri', async () => {
    const res = await upload([['foto.png', Buffer.from('PNG...')], ['estratto.pdf', Buffer.from('%PDF-1.4 finto')]]);
    const b = await res.json();
    assertEq(b.results[0].error, 'Non è un PDF.');
    assertEq(b.results[1].error, undefined);
  });
  await test('nessun file -> 400; riepilogo e movimenti si leggono, mese non valido -> 400', async () => {
    assertEq((await fetch(BASE + '/api/bank/import', { method: 'POST', headers: H })).status, 400);
    const s = await (await fetch(BASE + '/api/bank/summary?month=2026-09', { headers: H })).json();
    assertEq(s.entrate_reali, 1800.5);
    assertTrue((await (await fetch(BASE + '/api/bank/movements?month=2026-09&filter=giri', { headers: H })).json()).length === 3);
    assertEq((await fetch(BASE + '/api/bank/summary?month=boh', { headers: H })).status, 400);
  });

  console.log(`\n${'='.repeat(60)}`);
  console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
  try { fs.unlinkSync(dbPath); } catch (e) {}
  process.exit(failed > 0 ? 1 : 0);
}
main().catch((e) => { console.error('Suite bank fallita ad avviarsi:', e); process.exit(1); });
