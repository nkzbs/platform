'use strict';
// Autenticatore software minimo per testare routes/webauthn.js con una vera
// coppia di chiavi e una vera firma ECDSA — non un mock che restituisce dati
// finti, un vero authenticatorData/attestationObject/assertion costruiti a
// mano secondo WebAuthn (fmt 'none', ES256/P-256), più un encoder CBOR
// minimo (solo i pochi tipi che servono qui: buffer, stringa, intero
// positivo/negativo, Map, oggetto piatto — non una libreria CBOR generica).
// Usata SOLO dai test, mai da codice di produzione.
const crypto = require('crypto');

function b64url(buf) { return Buffer.from(buf).toString('base64url'); }

function cborEncodeLength(majorType, length) {
  if (length < 24) return Buffer.from([(majorType << 5) | length]);
  if (length < 256) return Buffer.from([(majorType << 5) | 24, length]);
  if (length < 65536) { const b = Buffer.alloc(3); b[0] = (majorType << 5) | 25; b.writeUInt16BE(length, 1); return b; }
  const b = Buffer.alloc(5); b[0] = (majorType << 5) | 26; b.writeUInt32BE(length, 1); return b;
}
function cborEncode(value) {
  if (Buffer.isBuffer(value)) return Buffer.concat([cborEncodeLength(2, value.length), value]);
  if (typeof value === 'string') { const s = Buffer.from(value, 'utf8'); return Buffer.concat([cborEncodeLength(3, s.length), s]); }
  if (typeof value === 'number') {
    if (Number.isInteger(value) && value >= 0) return cborEncodeLength(0, value);
    if (Number.isInteger(value) && value < 0) return cborEncodeLength(1, -1 - value);
    throw new Error('numero CBOR non supportato: ' + value);
  }
  if (value instanceof Map) {
    const parts = [cborEncodeLength(5, value.size)];
    for (const [k, v] of value) { parts.push(cborEncode(k)); parts.push(cborEncode(v)); }
    return Buffer.concat(parts);
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    const parts = [cborEncodeLength(5, keys.length)];
    for (const k of keys) { parts.push(cborEncode(k)); parts.push(cborEncode(value[k])); }
    return Buffer.concat(parts);
  }
  throw new Error('impossibile codificare in CBOR: ' + typeof value);
}

// Chiave pubblica EC2/ES256 in forma COSE_Key — stessa identica struttura
// (Map con chiavi intere) che un vero authenticator manderebbe dentro
// attestedCredentialData.
function coseKeyFromJwk(jwk) {
  return new Map([
    [1, 2], // kty: EC2
    [3, -7], // alg: ES256
    [-1, 1], // crv: P-256
    [-2, Buffer.from(jwk.x, 'base64url')],
    [-3, Buffer.from(jwk.y, 'base64url')],
  ]);
}

function buildAuthenticatorData({ rpID, signCount, attestedCredentialData }) {
  const rpIdHash = crypto.createHash('sha256').update(rpID).digest();
  let flags = 0x01 | 0x04; // UP + UV, sempre "presente e verificato" — stesso comportamento di un Touch ID/Face ID/PIN andati a buon fine
  if (attestedCredentialData) flags |= 0x40; // AT
  const flagsBuf = Buffer.from([flags]);
  const countBuf = Buffer.alloc(4); countBuf.writeUInt32BE(signCount, 0);
  const parts = [rpIdHash, flagsBuf, countBuf];
  if (attestedCredentialData) {
    const { aaguid, credentialId, coseKey } = attestedCredentialData;
    const credIdLen = Buffer.alloc(2); credIdLen.writeUInt16BE(credentialId.length, 0);
    parts.push(aaguid, credIdLen, credentialId, cborEncode(coseKey));
  }
  return Buffer.concat(parts);
}

// Una "passkey" software: una coppia di chiavi P-256 vera, un credential id
// casuale, un contatore che sale a ogni uso (come un authenticator vero, per
// la stessa difesa anti-clonazione che il server verifica).
function createVirtualAuthenticator() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const credentialId = crypto.randomBytes(32);
  const jwk = publicKey.export({ format: 'jwk' });
  const coseKey = coseKeyFromJwk(jwk);
  let signCount = 0;

  return {
    credentialId,
    async register({ rpID, origin, challenge }) {
      signCount += 1;
      const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge, origin, crossOrigin: false }));
      const authData = buildAuthenticatorData({
        rpID, signCount,
        attestedCredentialData: { aaguid: Buffer.alloc(16), credentialId, coseKey },
      });
      const attestationObject = cborEncode({ fmt: 'none', attStmt: {}, authData });
      return {
        id: b64url(credentialId), rawId: b64url(credentialId),
        response: { clientDataJSON: b64url(clientDataJSON), attestationObject: b64url(attestationObject), transports: ['internal'] },
        clientExtensionResults: {}, type: 'public-key', authenticatorAttachment: 'platform',
      };
    },
    async authenticate({ rpID, origin, challenge, userHandle, tamperSignature }) {
      signCount += 1;
      const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin, crossOrigin: false }));
      const authData = buildAuthenticatorData({ rpID, signCount });
      const clientDataHash = crypto.createHash('sha256').update(clientDataJSON).digest();
      let signature = crypto.sign('sha256', Buffer.concat([authData, clientDataHash]), privateKey);
      if (tamperSignature) signature = Buffer.concat([signature.subarray(0, -1), Buffer.from([signature[signature.length - 1] ^ 0xff])]);
      return {
        id: b64url(credentialId), rawId: b64url(credentialId),
        response: {
          clientDataJSON: b64url(clientDataJSON), authenticatorData: b64url(authData), signature: b64url(signature),
          userHandle: userHandle ? b64url(userHandle) : undefined,
        },
        clientExtensionResults: {}, type: 'public-key',
      };
    },
  };
}

module.exports = { createVirtualAuthenticator };
