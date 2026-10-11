'use strict';
// Segreti a riposo in Super Admin: il segreto del 2FA (TOTP) di ogni utente sta nel registro CIFRATO (stessa chiave e stesso algoritmo delle credenziali di backup, vedi
// crypto-secrets.js), non in chiaro. La lettura accetta ancora il vecchio formato in chiaro; migrate() lo riscrive cifrato all'avvio, solo se si rilegge identico.
const db = require('./db');
const { encrypt, decrypt } = require('./crypto-secrets');

const ERRORE = '[errore decifratura]';
const isSealed = (v) => typeof v === 'string' && v.startsWith('enc:');
const sealText = (v) => (v == null || v === '' ? v : encrypt(String(v)));
function unsealText(v) {
  if (v == null || v === '') return null;
  if (!isSealed(v)) return v;
  const t = decrypt(v);
  return t === ERRORE ? null : t;
}
function migrate() {
  const out = { totp: 0, falliti: 0 };
  db.transaction(() => {
    for (const u of db.prepare("SELECT id, totp_secret FROM users WHERE totp_secret IS NOT NULL AND totp_secret != '' AND totp_secret NOT LIKE 'enc:%'").all()) {
      const sealed = sealText(u.totp_secret);
      if (unsealText(sealed) !== u.totp_secret) { out.falliti++; continue; }
      db.prepare('UPDATE users SET totp_secret = ? WHERE id = ?').run(sealed, u.id); out.totp++;
    }
  })();
  return out;
}
module.exports = { sealText, unsealText, migrate, isSealed };
