'use strict';
// Posta in uscita: SMTP classico o Resend (lib/email.js). Un finto server SMTP in ascolto su una porta locale
// riceve davvero il messaggio; nessuna rete esterna. Eseguire con: node src/email-smtp.test.js

const path = require('path');
const os = require('os');
const fs = require('fs');
const net = require('net');
const crypto = require('crypto');

process.env.DB_PATH = path.join(os.tmpdir(), 'email-smtp-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.JWT_SECRET = 'jwt_' + crypto.randomBytes(8).toString('hex');
process.env.ENCRYPTION_KEY = 'email_smtp_test_encryption_key_00';
process.env.INTERNAL_API_SECRET = 'int_' + crypto.randomBytes(8).toString('hex');
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'email-uploads-'));

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; }
}
function ok(c, m) { if (!c) throw new Error(m || 'atteso true'); }

// Finto server SMTP: saluta, accetta l'accesso (PLAIN/LOGIN), prende il messaggio e lo tiene in `ricevuti`.
function avviaSmtp({ rifiutaAccesso = false } = {}) {
  const ricevuti = [];
  const srv = net.createServer((sock) => {
    let dati = false, buf = '', corpo = '', rcpt = [], loginFase = 0;
    sock.write('220 finto ESMTP\r\n');
    sock.on('data', (c) => {
      buf += c.toString();
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const riga = buf.slice(0, i); buf = buf.slice(i + 2);
        if (dati) {
          if (riga === '.') { dati = false; ricevuti.push({ rcpt, corpo }); corpo = ''; sock.write('250 ok\r\n'); } else corpo += riga + '\n';
          continue;
        }
        const U = riga.toUpperCase();
        if (loginFase === 1) { loginFase = 2; sock.write('334 UGFzc3dvcmQ6\r\n'); continue; }
        if (loginFase === 2) { loginFase = 0; sock.write(rifiutaAccesso ? '535 5.7.8 Credenziali non valide\r\n' : '235 ok\r\n'); continue; }
        if (U.startsWith('EHLO') || U.startsWith('HELO')) sock.write('250-finto\r\n250 AUTH PLAIN LOGIN\r\n');
        else if (U.startsWith('AUTH PLAIN')) sock.write(rifiutaAccesso ? '535 5.7.8 Credenziali non valide\r\n' : '235 ok\r\n');
        else if (U.startsWith('AUTH LOGIN')) { loginFase = 1; sock.write('334 VXNlcm5hbWU6\r\n'); }
        else if (U.startsWith('MAIL FROM')) sock.write('250 ok\r\n');
        else if (U.startsWith('RCPT TO')) { rcpt.push(riga); sock.write('250 ok\r\n'); }
        else if (U === 'DATA') { dati = true; sock.write('354 vai\r\n'); }
        else if (U === 'QUIT') { sock.write('221 ciao\r\n'); sock.end(); }
        else sock.write('250 ok\r\n');
      }
    });
    sock.on('error', () => {});
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, porta: srv.address().port, ricevuti })));
}

async function main() {
  const db = require('./db');
  const seal = require('./secrets-at-rest').seal;
  const email = require('./lib/email');
  const salva = (id, creds, connected = 1) => db.prepare('INSERT INTO connections (integration_id, connected, credentials) VALUES (?, ?, ?) ON CONFLICT(integration_id) DO UPDATE SET connected = excluded.connected, credentials = excluded.credentials').run(id, connected, seal(creds));

  await test('senza nessuna connessione: non configurata, nessun invio finto', async () => {
    const st = email.stato(); ok(!st.ok && st.via === null, 'stato');
    const r = await email.invia({ to: 'a@b.it', subject: 's', html: '<p>x</p>' });
    ok(!r.ok && /Posta in uscita/.test(r.motivo), 'motivo: ' + r.motivo);
  });

  await test('con le credenziali di Resend: il canale è Resend', async () => {
    salva('email_resend', { api_key: 're_x', from_email: 'n@d.it' });
    ok(email.stato().via === 'resend', 'via');
  });

  const { srv, porta, ricevuti } = await avviaSmtp();
  await test('SMTP collegato: vince su Resend e il messaggio arriva al server', async () => {
    salva('email_smtp', { host: '127.0.0.1', port: String(porta), cifratura: 'nessuna', user: 'info@d.it', pass: 'segreta', from_email: 'info@d.it', from_name: 'Agenzia Prova' });
    ok(email.stato().via === 'smtp', 'via smtp');
    const r = await email.invia({ to: 'cliente@x.it', subject: 'Oggetto prova', html: email.htmlDaTesto('Ciao dal test') });
    ok(r.ok && r.via === 'smtp', 'invio: ' + JSON.stringify(r));
    ok(ricevuti.length === 1, 'messaggi ricevuti: ' + ricevuti.length);
    ok(/cliente@x\.it/.test(ricevuti[0].rcpt.join()), 'destinatario');
    const corpo = ricevuti[0].corpo.replace(/=\n/g, ''); // il testo arriva in quoted-printable: si ricuciono le righe spezzate
    ok(/Subject: Oggetto prova/.test(corpo) && /Agenzia Prova/.test(corpo) && /Ciao dal test/.test(corpo), 'oggetto, nome mittente e testo');
  });

  await test('SMTP scollegato (connected = 0): torna a Resend', async () => {
    salva('email_smtp', { host: '127.0.0.1', port: String(porta), cifratura: 'nessuna', from_email: 'info@d.it' }, 0);
    ok(email.stato().via === 'resend', 'via resend');
  });

  await test('SMTP incompleto (manca il mittente): non conta come collegato', async () => {
    salva('email_smtp', { host: '127.0.0.1', port: String(porta), cifratura: 'nessuna' }, 1);
    ok(email.stato().via === 'resend', 'via resend');
  });
  srv.close();

  const rifiuto = await avviaSmtp({ rifiutaAccesso: true });
  await test('password sbagliata: l\'errore del server arriva a chi chiama, senza la password', async () => {
    salva('email_smtp', { host: '127.0.0.1', port: String(rifiuto.porta), cifratura: 'nessuna', user: 'info@d.it', pass: 'segreta', from_email: 'info@d.it' });
    const r = await email.invia({ to: 'a@b.it', subject: 's', html: 'x' });
    ok(!r.ok && r.via === 'smtp' && /535|Credenziali/.test(r.motivo), 'errore: ' + JSON.stringify(r));
    ok(!/segreta/.test(r.motivo), 'la password non deve comparire');
  });
  rifiuto.srv.close();

  await test('server irraggiungibile: errore chiaro, nessun blocco', async () => {
    salva('email_smtp', { host: '127.0.0.1', port: '1', cifratura: 'nessuna', from_email: 'info@d.it' });
    const r = await email.invia({ to: 'a@b.it', subject: 's', html: 'x' });
    ok(!r.ok && r.via === 'smtp' && r.motivo, 'errore: ' + JSON.stringify(r));
  });

  console.log(`\n${passed} passati, ${failed} falliti`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
