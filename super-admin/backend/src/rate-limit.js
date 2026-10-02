// Ponte CommonJS verso l'UNICA fonte di verità in shared/rate-limit.js —
// stesso identico ponte di core/backend/src/rate-limit.js (vedi lì per il
// ragionamento completo su Redis opzionale/iniettato).
const { createRateLimiter } = require('../../../shared/rate-limit.js');

// G13 (PLATFORM-0.6-GAP-ANALYSIS.md) — vedi il ragionamento completo in
// core/backend/src/rate-limit.js: in produzione niente REDIS_URL blocca il
// boot invece di ricadere silenziosamente sull'in-memory (non condiviso tra
// repliche).
if (process.env.NODE_ENV === 'production' && !process.env.REDIS_URL) {
  console.error('ERRORE FATALE — REDIS_URL non impostato in produzione: il rate limiting in-memory non è condiviso tra repliche. Imposta REDIS_URL prima di avviare con NODE_ENV=production.');
  process.exit(1);
}

let redisClient = null;
if (process.env.REDIS_URL) {
  try {
    const { createClient } = require('redis');
    redisClient = createClient({ url: process.env.REDIS_URL });
    redisClient.on('error', (e) => console.error('rate-limit: errore connessione Redis:', e.message));
    redisClient.connect().catch((e) => console.error('rate-limit: connessione Redis fallita:', e.message));
  } catch (e) {
    console.error('rate-limit: REDIS_URL impostato ma pacchetto "redis" non disponibile, resto in-memory:', e.message);
  }
}

// redisClient esportato anche qui (G14, scheduler-lock.js) — stesso client, non
// una seconda connessione.
module.exports = { rateLimit: createRateLimiter(redisClient, 'super-admin'), redisClient };
