// ─── LOCK DISTRIBUITO PER SCHEDULER (G14, PLATFORM-0.6-GAP-ANALYSIS.md) ────────
// Nessuno scheduler di questo repo (core/backend/src/scheduler.js, i 6 in
// super-admin/backend/src/*-scheduler.js) ha oggi un lock: un tick ogni 60s per
// PROCESSO, senza niente che impedisca a due repliche dello stesso servizio (o
// due tick sovrapposti nello stesso processo, se un tick precedente non è ancora
// finito) di eseguire la stessa automazione due volte. Rischio zero oggi (un
// processo per tenant/super-admin — nessuna replica esiste), reale solo se/quando
// arriva la replica orizzontale — questo modulo la prepara senza aspettare che
// succeda davvero.
//
// Redis SET key value NX PX ttlMs: atomico, "prendi il lock solo se libero, con
// scadenza automatica" in un solo comando — nessuna race tra "controllo se è
// libero" e "lo prendo" (a differenza di GET poi SET separati). Il rilascio usa
// uno script Lua (EVAL, eseguito atomicamente da Redis) che cancella la chiave
// SOLO se il valore è ancora il nostro token — altrimenti un'esecuzione più
// lenta della TTL rilascerebbe il lock già ri-acquisito da un'altra replica nel
// frattempo (classico bug di un DEL alla cieca dopo GET separato).
//
// redisClient assente (sviluppo, o produzione senza Redis — ma G13 lo rende
// obbligatorio in produzione, quindi qui non dovrebbe mai succedere davvero in
// produzione): nessun lock, il tick gira come ha sempre fatto — comportamento
// invariato per chi non ha ancora Redis in piedi.
//
// Un errore Redis durante l'acquisizione: fail-open (esegue comunque) — coerente
// col resto di questo codebase ("mai bloccante" su un guasto Redis, vedi
// shared/rate-limit.js) e diverso dalla scelta fail-closed di G13: qui il rischio
// di un guasto Redis è "uno scheduler salta un giro di lock e potenzialmente
// duplica un tick", non "la protezione anti-brute-force sparisce" — molto meno
// grave, e gli scheduler di questo repo sono già scritti per essere per lo più
// idempotenti (vedi scheduled_runs/last_run_at in scheduler.js).
export function withDistributedLock(redisClient, lockKey, ttlMs, fn) {
  if (!redisClient) return fn; // nessun Redis configurato — comportamento di sempre

  return async function guardedTick(...args) {
    const token = Date.now() + ':' + Math.random();
    let acquired = false;
    try {
      acquired = (await redisClient.set(lockKey, token, { NX: true, PX: ttlMs })) === 'OK';
    } catch (e) {
      console.error('scheduler-lock[' + lockKey + ']: Redis non raggiungibile, eseguo comunque (fail-open):', e.message);
      return fn(...args);
    }
    if (!acquired) {
      console.log('scheduler-lock[' + lockKey + ']: tick saltato — un\'altra replica ha già il lock');
      return;
    }
    try {
      return await fn(...args);
    } finally {
      try {
        await redisClient.eval(
          'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end',
          { keys: [lockKey], arguments: [token] }
        );
      } catch (e) {
        console.error('scheduler-lock[' + lockKey + ']: rilascio fallito (la TTL lo pulirà comunque):', e.message);
      }
    }
  };
}
