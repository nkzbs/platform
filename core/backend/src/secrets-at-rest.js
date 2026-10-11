'use strict';
// Segreti a riposo: le credenziali dei collegamenti (Google, WhatsApp, Telegram…) e i segreti del 2FA stanno nel database CIFRATI con la chiave del progetto (la stessa dei
// campi cifrati, AES-256-GCM), non in chiaro. Chi ottiene il file del database o una sua copia non legge più token, chiavi e segreti.
// Ogni punto del codice che li legge o li scrive passa da qui. La lettura accetta ancora il vecchio formato in chiaro (e il suo valore si riscrive cifrato all'avvio con
// migrate()): un database vecchio continua a funzionare. Se la cifratura non si riesce a decifrare (chiave diversa) il segreto risulta assente, mai un testo di errore usato come valore.
const db = require('./db');
const { encrypt, decrypt } = require('./crypto-fields');

const ERRORE = '[errore decifratura]';
const isSealed = (v) => typeof v === 'string' && v.startsWith('enc:');

// Stringa dal database → oggetto (o null se vuota, illeggibile o non decifrabile).
function unseal(raw) {
  if (!raw) return null;
  let txt = raw;
  if (isSealed(raw)) { txt = decrypt(raw); if (txt === ERRORE) return null; }
  try { const o = JSON.parse(txt); return o && typeof o === 'object' && !Array.isArray(o) ? o : null; } catch (e) { return null; }
}
const seal = (obj) => encrypt(JSON.stringify(obj));

// Un segreto in forma di testo (es. il segreto TOTP del 2FA).
function unsealText(v) {
  if (v == null || v === '') return null;
  if (!isSealed(v)) return v;
  const t = decrypt(v);
  return t === ERRORE ? null : t;
}
const sealText = (v) => (v == null || v === '' ? v : encrypt(String(v)));

// Cifra ciò che è ancora in chiaro. Idempotente. Verifica che si rilegga identico PRIMA di scrivere: se non torna, la riga resta com'era (e si conta come fallita).
function migrate() {
  const out = { connessioni: 0, totp: 0, falliti: 0 };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  db.transaction(() => {
    for (const r of db.prepare("SELECT integration_id, credentials FROM connections WHERE credentials IS NOT NULL AND credentials != '' AND credentials NOT LIKE 'enc:%'").all()) {
      let obj; try { obj = JSON.parse(r.credentials); } catch (e) { out.falliti++; continue; }
      const sealed = seal(obj);
      if (!same(unseal(sealed), obj)) { out.falliti++; continue; }
      db.prepare('UPDATE connections SET credentials = ? WHERE integration_id = ?').run(sealed, r.integration_id); out.connessioni++;
    }
    for (const u of db.prepare("SELECT id, totp_secret FROM users WHERE totp_secret IS NOT NULL AND totp_secret != '' AND totp_secret NOT LIKE 'enc:%'").all()) {
      const sealed = sealText(u.totp_secret);
      if (unsealText(sealed) !== u.totp_secret) { out.falliti++; continue; }
      db.prepare('UPDATE users SET totp_secret = ? WHERE id = ?').run(sealed, u.id); out.totp++;
    }
  })();
  return out;
}

module.exports = { seal, unseal, sealText, unsealText, migrate, isSealed };
