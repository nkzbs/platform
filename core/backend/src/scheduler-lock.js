// Ponte CommonJS verso l'UNICA fonte di verità in shared/scheduler-lock.js —
// stesso principio degli altri ponti (rate-limit.js, instance-pairing.js):
// shared/ non ha un proprio node_modules. Riusa lo STESSO client Redis di
// rate-limit.js (una connessione per processo, non due).
const { withDistributedLock } = require('../../../shared/scheduler-lock.js');
const { redisClient } = require('./rate-limit.js');

const TENANT_SLUG = process.env.TENANT_SLUG || 'tenant';

// withLock(nome, ttlMs, fn): lockKey isolato per tenant (stesso Redis condiviso
// da più tenant — vedi keyPrefix in rate-limit.js, stesso motivo qui).
function withLock(name, ttlMs, fn) {
  return withDistributedLock(redisClient, 'scheduler-lock:' + TENANT_SLUG + ':' + name, ttlMs, fn);
}

module.exports = { withLock };
