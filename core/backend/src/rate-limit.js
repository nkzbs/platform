// Ponte CommonJS verso l'UNICA fonte di verità in shared/rate-limit.js — a
// differenza degli altri ponti (schema-v3.js, instance-pairing.js), questo
// crea anche il client Redis (se REDIS_URL è configurato) perché shared/
// non ha un proprio node_modules e non può farlo da sé — stesso principio
// dell'iniezione di bcrypt in instance-pairing.js, qui per redis.
// REDIS_URL assente = comportamento di sempre (in-memory), nessuna rottura
// per chi non ha ancora Redis in piedi (es. finché il NAS non è aggiornato).
const { createRateLimiter } = require('../../../shared/rate-limit.js');

// G13 (PLATFORM-0.6-GAP-ANALYSIS.md) — in-memory è innocuo con un processo per
// tenant (oggi), ma diventerebbe silenziosamente inefficace con più repliche
// dello stesso servizio (contatori non condivisi): in produzione, niente
// REDIS_URL è un errore di configurazione da bloccare al boot, non un
// fallback silenzioso. Stesso principio/stile di shared/require-strong-secrets.js
// (solo avviso in sviluppo, mai bloccante lì).
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

// keyPrefix = TENANT_SLUG: isola i contatori di questo tenant da quelli di
// ogni altro tenant che condivide lo stesso Redis (vedi commento in
// shared/rate-limit.js sul perché serve).
// redisClient esportato anche qui (G14, scheduler-lock.js) — stesso client, non
// una seconda connessione: un processo, un client Redis, riusato per ogni uso.
module.exports = { rateLimit: createRateLimiter(redisClient, process.env.TENANT_SLUG || 'tenant'), redisClient };
