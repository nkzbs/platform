'use strict';
// G18 (PLATFORM-0.6-GAP-ANALYSIS.md, 2026-08-22) — cifratura a riposo per segreti
// operativi di Super Admin (oggi: credenziali della destinazione di backup off-site
// di un tenant, es. access key S3/password WebDAV future). Porting diretto di
// core/backend/src/crypto-fields.js (stesso algoritmo AES-256-GCM, stesso formato
// `enc:<iv>:<tag>:<ciphertext>` esadecimale) — SOLO encrypt/decrypt, non le varianti
// encryptFields/decryptFields per campi schema-v3, che qui non si applicano.
//
// Chiave DIVERSA da quella di core/backend deliberatamente: lì la chiave è per-tenant
// (ENCRYPTION_KEY+TENANT_SLUG di QUEL container, per cifrare dati del tenant stesso).
// Qui la chiave è GLOBALE a questo processo Super Admin (una sola env var, come
// INTERNAL_API_SECRET) perché il segreto protetto non appartiene a nessun tenant
// specifico — è un'operazione di Core/partner sulla propria infrastruttura di backup,
// non un dato del tenant. Riusare la chiave per-tenant avrebbe mischiato due domini
// di fiducia senza motivo (perché il container del tenant dovrebbe poter decifrare
// le credenziali S3 di Core?).
const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
// Salt fisso (non per-tenant, vedi sopra) — scryptSync richiede comunque un salt,
// questo esiste solo per la derivazione della chiave, non per isolare tenant diversi.
const SALT = 'super-admin-offsite-backup';

function deriveKey() {
  const base = process.env.ENCRYPTION_KEY || 'changeme_super_admin_encryption_key';
  return crypto.scryptSync(base, SALT, 32);
}

function encrypt(plaintext) {
  if (plaintext === undefined || plaintext === null || plaintext === '') return plaintext;
  const key = deriveKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

function decrypt(stored) {
  if (!stored || !String(stored).startsWith('enc:')) return stored;
  try {
    const parts = stored.slice(4).split(':');
    if (parts.length !== 3) return stored;
    const [ivHex, tagHex, ctHex] = parts;
    const key = deriveKey();
    const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const plain = Buffer.concat([decipher.update(Buffer.from(ctHex, 'hex')), decipher.final()]);
    return plain.toString('utf8');
  } catch (e) {
    return '[errore decifratura]';
  }
}

module.exports = { encrypt, decrypt };
