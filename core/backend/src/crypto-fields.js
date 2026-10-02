'use strict';
const crypto = require('crypto');

const ALGO = 'aes-256-gcm';

function deriveKey() {
  const base = process.env.ENCRYPTION_KEY || 'platform-default-key-change-in-prod';
  const salt = process.env.TENANT_SLUG || 'default';
  return crypto.scryptSync(base, salt, 32);
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

function encryptFields(data, fields) {
  if (!data || !fields) return data;
  const out = { ...data };
  fields.forEach((f) => {
    if (f.type === 'encrypted' && out[f.key] !== undefined) {
      out[f.key] = encrypt(out[f.key]);
    }
  });
  return out;
}

function decryptFields(data, fields) {
  if (!data || !fields) return data;
  const out = { ...data };
  fields.forEach((f) => {
    if (f.type === 'encrypted' && out[f.key] !== undefined) {
      out[f.key] = decrypt(out[f.key]);
    }
  });
  return out;
}

module.exports = { encrypt, decrypt, encryptFields, decryptFields };
