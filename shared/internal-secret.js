// Segreto condiviso per le chiamate tra servizi (Super Admin <-> tenant), header
// x-internal-secret. Un solo posto per leggerlo e confrontarlo: nessun valore di
// riserva scritto nel codice (chi legge il repository lo conoscerebbe), e se la
// variabile manca ogni chiamata interna viene rifiutata invece di accettare un
// segreto noto.
import { timingSafeEqual } from 'node:crypto'

export function internalSecret() {
  return process.env.INTERNAL_API_SECRET || ''
}

export function isInternalSecret(value) {
  const expected = Buffer.from(internalSecret())
  const given = Buffer.from(typeof value === 'string' ? value : '')
  if (expected.length === 0 || given.length !== expected.length) return false
  return timingSafeEqual(given, expected)
}

export function requireInternalSecret(req, res, next) {
  if (!isInternalSecret(req.headers['x-internal-secret'])) {
    return res.status(401).json({ error: 'Secret interno non valido' })
  }
  next()
}
