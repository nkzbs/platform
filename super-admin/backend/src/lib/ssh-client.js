'use strict';
// Il trasporto SSH dell'esportazione di un tenant (ssh2, JavaScript puro). Si connette con password o chiave privata, FISSANDO l'impronta del server (quella che chi esporta ha
// confermato: se cambia, non si procede) ed esegue comandi, con un flusso opzionale su stdin. Le credenziali restano in memoria, non si scrivono né si loggano.
const crypto = require('crypto');
const { Client } = require('ssh2');

const impronta = (key) => 'SHA256:' + crypto.createHash('sha256').update(key).digest('base64').replace(/=+$/, '');

// opts: { host, port, username, password | privateKey (+ passphrase), fingerprint (se già nota: deve combaciare), timeoutMs }
// Ritorna { fingerprint, run(cmd, { stdin, onStdout }) → { code, stdout, stderr }, close() }.
function connect(opts) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let fingerprint = null, rifiutata = false;
    const fail = (e) => { try { conn.end(); } catch (x) { /* già chiusa */ } reject(e); };
    conn.on('ready', () => resolve({
      fingerprint,
      close: () => { try { conn.end(); } catch (e) { /* già chiusa */ } },
      run: (cmd, { stdin, onStdout } = {}) => new Promise((res, rej) => {
        conn.exec(cmd, (err, stream) => {
          if (err) return rej(err);
          let out = '', errOut = '';
          stream.on('data', (d) => { out = (out + d).slice(-20000); if (onStdout) onStdout(d); });
          stream.stderr.on('data', (d) => { errOut = (errOut + d).slice(-20000); });
          stream.on('close', (code) => res({ code: code == null ? 1 : code, stdout: out, stderr: errOut }));
          if (stdin == null) stream.end();
          else if (typeof stdin === 'string' || Buffer.isBuffer(stdin)) stream.end(stdin);
          else { stdin.on('error', (e) => { try { stream.close(); } catch (x) { /* chiuso */ } rej(e); }); stdin.pipe(stream); }
        });
      }),
    }));
    conn.on('error', (e) => fail(rifiutata ? Object.assign(new Error('L\'impronta del server non è quella confermata: mi fermo.'), { code: 'fingerprint' }) : e));
    conn.connect({
      host: opts.host, port: opts.port || 22, username: opts.username,
      password: opts.password, privateKey: opts.privateKey, passphrase: opts.passphrase,
      readyTimeout: opts.timeoutMs || 20000, keepaliveInterval: 15000,
      hostVerifier: (key) => { fingerprint = impronta(key); if (opts.fingerprint && opts.fingerprint !== fingerprint) { rifiutata = true; return false; } return true; },
    });
  });
}

module.exports = { connect, impronta };
