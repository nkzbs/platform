// Ponte CommonJS verso l'UNICA fonte di verità in shared/scheduler-lock.js —
// stesso identico ponte di core/backend/src/scheduler-lock.js. Riusa lo STESSO
// client Redis di rate-limit.js (una connessione per processo, non due).
const { withDistributedLock } = require('../../../shared/scheduler-lock.js');
const { redisClient } = require('./rate-limit.js');

function withLock(name, ttlMs, fn) {
  return withDistributedLock(redisClient, 'scheduler-lock:super-admin:' + name, ttlMs, fn);
}

module.exports = { withLock };
