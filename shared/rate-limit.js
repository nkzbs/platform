// ─── RATE LIMITING — UNICA fonte di verità, condivisa tra i due backend ────────
// Due modalità, stessa interfaccia (`rateLimit({...})` risolto da
// `createRateLimiter`, mai un'API diversa da imparare a seconda della
// modalità): in-memory (default, comportamento di sempre — nessuna
// dipendenza esterna, un riavvio del processo azzera i contatori,
// accettabile per un rate limit) oppure Redis (iniettato come client, non
// importato qui — shared/ non ha un proprio node_modules, stesso motivo di
// bcrypt in instance-pairing.js) per condividere i contatori tra PIÙ
// repliche dello STESSO servizio (oggi non il caso — un processo per
// tenant/super-admin — ma il primo passo per poterle avere in futuro senza
// riscrivere tutti i punti di chiamata).
//
// keyPrefix: isolamento tra servizi diversi che condividono lo stesso Redis
// (es. più tenant sullo stesso container Redis) — un login-brute-force su un
// tenant non deve consumare la quota di un altro, principio invariato dalla
// versione solo-in-memory, qui garantito da un prefisso invece che da
// processi separati.
export function createRateLimiter(redisClient, keyPrefix) {
  const prefix = keyPrefix ? keyPrefix + ':' : '';

  if (!redisClient) {
    return function rateLimit({ windowMs, max, keyFn, message }) {
      const hits = new Map(); // key -> array di timestamp entro la finestra

      setInterval(() => {
        const now = Date.now();
        for (const [key, arr] of hits.entries()) {
          const recent = arr.filter((t) => now - t < windowMs);
          if (recent.length === 0) hits.delete(key);
          else hits.set(key, recent);
        }
      }, Math.max(windowMs, 60000)).unref();

      return (req, res, next) => {
        const key = prefix + ((keyFn ? keyFn(req) : (req.headers['x-real-ip'] || req.ip)) || 'unknown');
        const now = Date.now();
        const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
        if (recent.length >= max) {
          return res.status(429).json({ error: message || 'Troppe richieste, riprova tra poco' });
        }
        recent.push(now);
        hits.set(key, recent);
        next();
      };
    };
  }

  // Redis: sliding window log via sorted set (ZADD/ZREMRANGEBYSCORE/ZCARD) —
  // stesso identico significato della versione in-memory (conta gli eventi
  // negli ultimi windowMs), non un algoritmo diverso da capire a parte.
  // G13 (PLATFORM-0.6-GAP-ANALYSIS.md) — la politica su un errore Redis non è
  // più unica per tutti i limiter: `failClosed: true` (login, pairing,
  // operazioni amministrative sensibili) blocca la richiesta (503) se Redis
  // non risponde, perché per QUESTI limiter il rischio di un rate limit
  // disattivato silenziosamente (porta anti-brute-force spalancata) supera
  // il rischio di un 503 occasionale. Il default resta fail-open (invariato,
  // usato da 'api-global') — coerente con "mai bloccante" già applicato
  // altrove in questo codebase (audit-log, notifiche) per tutto ciò che non
  // è un limiter di sicurezza.
  return function rateLimit({ windowMs, max, keyFn, message, name, failClosed }) {
    // `name`: OBBLIGATORIO su Redis, ignorato su in-memory — identifica QUALE
    // limiter è questo (es. 'login', 'api-global', 'pairing-verify'). Senza
    // un nome esplicito, stabile e uguale su OGNI replica dello stesso
    // servizio, due limiter diversi nello stesso processo finirebbero sulla
    // stessa chiave Redis (stesso prefix, stessa IP) sommandosi tra loro — un
    // id generato a caso per istanza risolverebbe quello ma romperebbe
    // l'altra metà del requisito (repliche diverse devono condividere la
    // STESSA chiave, quindi lo stesso nome, non uno casuale per processo).
    // Nella versione in-memory non serve: ogni chiusura ha già la propria Map
    // separata, isolamento automatico che Redis (store esterno condiviso) non dà gratis.
    if (!name) throw new Error('rateLimit({name: ...}) obbligatorio quando Redis è configurato — vedi shared/rate-limit.js');
    return async (req, res, next) => {
      const key = prefix + name + ':' + ((keyFn ? keyFn(req) : (req.headers['x-real-ip'] || req.ip)) || 'unknown');
      const now = Date.now();
      try {
        const redisKey = 'ratelimit:' + key;
        await redisClient.zRemRangeByScore(redisKey, 0, now - windowMs);
        const count = await redisClient.zCard(redisKey);
        if (count >= max) {
          return res.status(429).json({ error: message || 'Troppe richieste, riprova tra poco' });
        }
        await redisClient.zAdd(redisKey, { score: now, value: String(now) + ':' + Math.random() });
        await redisClient.expire(redisKey, Math.ceil(windowMs / 1000));
        next();
      } catch (e) {
        if (failClosed) {
          console.error('rate-limit[' + name + ']: Redis non raggiungibile, richiesta BLOCCATA (limiter fail-closed):', e.message);
          return res.status(503).json({ error: 'Servizio temporaneamente non disponibile, riprova tra poco' });
        }
        console.error('rate-limit[' + name + ']: Redis non raggiungibile, richiesta lasciata passare:', e.message);
        next();
      }
    };
  };
}
