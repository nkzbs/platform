'use strict';
// Mail che sembrano bollette da mittenti senza regola (gmail-unknown.js). Gmail è simulato.
// Eseguire con: node src/gmail-unknown.test.js

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const dbPath = path.join(os.tmpdir(), 'gmail-unknown-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.DB_PATH = dbPath;
process.env.JWT_SECRET = 'gu_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'gu_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gu-uploads-'));

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; }
}
function assertEq(a, e, msg) { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${msg || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); }
function assertTrue(c, msg) { if (!c) throw new Error(msg || 'atteso true'); }

(async () => {
  const db = require('./db');
  const un = require('./gmail-unknown');
  const MAILS = {
    m1: { from: '"Enel Energia" <Bollette@Enel.it>', subject: 'La tua bolletta di ottobre', date: 'Sat, 03 Oct 2026 10:00:00 +0000' },
    m2: { from: 'noreply@a2aenergia.it', subject: 'Bolletta A2A', date: 'Sat, 03 Oct 2026 11:00:00 +0000' },
    m3: { from: 'Banca <info@banca.it>', subject: 'Estratto conto', date: 'Sat, 03 Oct 2026 12:00:00 +0000' },
    m4: { from: 'bollette@enel.it', subject: 'Sollecito', date: 'Sun, 04 Oct 2026 08:00:00 +0000' },
    m5: { from: 'senza-email', subject: 'boh', date: 'Sun, 04 Oct 2026 09:00:00 +0000' },
  };
  let ids = ['m1', 'm2', 'm3'];
  const calls = [];
  const gmailGet = async (tok, p) => {
    calls.push(p);
    if (p.startsWith('/messages?')) return { messages: ids.map((id) => ({ id })) };
    const id = p.split('/')[2].split('?')[0]; const m = MAILS[id];
    return { payload: { headers: [{ name: 'From', value: m.from }, { name: 'Subject', value: m.subject }, { name: 'Date', value: m.date }] } };
  };
  const rules = [{ mittente: 'noreply@a2aenergia.it' }];

  await test('legge mittente e indirizzo dall\'intestazione', () => {
    assertEq(un.parseMittente('"Enel Energia" <Bollette@Enel.it>'), 'bollette@enel.it'); assertEq(un.parseMittente('a@b.it'), 'a@b.it'); assertEq(un.parseMittente('senza-email'), null);
  });
  await test('la ricerca ha parole da bolletta, solo gli ultimi giorni e senza promozioni', () => {
    assertTrue(/newer_than:3d/.test(un.QUERY) && /bolletta/.test(un.QUERY) && /-category:promotions/.test(un.QUERY), un.QUERY);
  });
  await test('un mittente senza regola finisce in lista; uno con regola no', async () => {
    const fresh = await un.scan('tok', gmailGet, rules);
    assertEq(fresh.map((x) => x.mittente), ['bollette@enel.it', 'info@banca.it']);
    assertEq(un.listNuove().length, 2);
  });
  await test('si leggono solo le intestazioni (mai il corpo della mail)', () => {
    assertTrue(calls.filter((c) => c.includes('/messages/')).every((c) => c.includes('format=metadata')), calls.join(' | '));
  });
  await test('lo stesso messaggio non si registra due volte', async () => {
    const fresh = await un.scan('tok', gmailGet, rules); assertEq(fresh.length, 0); assertEq(un.listNuove().length, 2);
  });
  await test('un messaggio già processato da una regola si salta', async () => {
    db.prepare("INSERT INTO gmail_processed_messages (message_id) VALUES ('m5')").run();
    ids = ['m5']; const fresh = await un.scan('tok', gmailGet, rules); assertEq(fresh.length, 0);
  });
  await test('un mittente messo da parte con «Ignora» non si segnala più, ma le sue mail si tengono ignorate', async () => {
    const enel = un.listNuove().find((x) => x.mittente === 'bollette@enel.it');
    assertEq(un.ignora(enel.id), true); assertEq(un.ignora(enel.id), false, 'già ignorata');
    ids = ['m4']; const fresh = await un.scan('tok', gmailGet, rules);
    assertEq(fresh.length, 0); assertEq(un.listNuove().map((x) => x.mittente), ['info@banca.it']);
  });
  await test('creando una regola per il mittente, le sue mail escono dalla lista', () => {
    un.risolviMittente('info@banca.it'); assertEq(un.listNuove().length, 0);
  });
  await test('il messaggio WhatsApp: un solo testo, un mittente una volta, con dove aggiungere la regola', () => {
    const t = un.messaggio([{ mittente: 'a@x.it', oggetto: 'Bolletta' }, { mittente: 'a@x.it', oggetto: 'Sollecito' }, { mittente: 'b@y.it', oggetto: 'Fattura' }, { mittente: 'c@z.it', oggetto: 'F' }, { mittente: 'd@w.it', oggetto: 'G' }]);
    assertTrue(t.includes('• a@x.it — «Bolletta»') && !t.includes('Sollecito') && t.includes('… e altri 1 mittenti') && t.includes('Impostazioni → Connessioni → Google'), t);
  });

  console.log(`\n${'='.repeat(60)}`);
  console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
  try { fs.unlinkSync(dbPath); } catch (e) {}
  process.exit(failed > 0 ? 1 : 0);
})();
