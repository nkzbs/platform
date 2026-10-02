const { captureSnapshot } = require('./lib/analytics');
const { withLock } = require('./scheduler-lock');

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// Una foto al giorno (upsert su snapshot_date, quindi se il container riparte
// più volte nello stesso giorno non crea righe duplicate, aggiorna quella di
// oggi con i numeri correnti) — sufficiente per un trend di business, non
// serve granularità oraria. Scatta anche subito all'avvio (dopo un breve
// ritardo, per non competere con gli altri scheduler) così un'installazione
// nuova ha almeno un punto storico dal primo giorno, invece di aspettare la
// mezzanotte simbolica delle 24h.
function startAnalyticsScheduler() {
  const INTERVAL_MS = 24 * 60 * 60 * 1000;

  async function tick() {
    try {
      await captureSnapshot(todayStr());
    } catch (e) {
      console.error('Analytics snapshot fallita:', e.message);
    }
  }

  // G14 — lock distribuito (no-op senza Redis), TTL 5 min: un tick qui è una
  // singola captureSnapshot(), non serve più margine di così.
  const guardedTick = withLock('analytics', 5 * 60 * 1000, tick);
  setTimeout(guardedTick, 120 * 1000);
  setInterval(guardedTick, INTERVAL_MS);
  console.log('Analytics scheduler avviato — una foto al giorno');
}

module.exports = { startAnalyticsScheduler };
