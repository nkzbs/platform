const db = require('./db');
const { logAudit } = require('./audit-log');
const { withLock } = require('./scheduler-lock');
const { internalSecret } = require('../../../shared/internal-secret.js');

// P0 trovato in un collaudo operativo dal vivo (2026-09-03): tenants.status non si
// riallinea mai da solo se un container Docker si ferma FUORI dall'app (crash, OOM,
// stop manuale via `docker stop`, RAM insufficiente) — stesso pattern già visto una volta
// come incidente reale (7 tenant "attivi" nel DB ma in realtà fermi da giorni, scoperto
// solo controllando docker ps a mano). Nessuna delle altre route (start/stop/redeploy/
// license-scheduler) copre questo caso: scrivono tutte 'status' solo quando è L'APP a
// fermare/avviare il container, mai quando succede altrove.
const PROVISIONER_URL = process.env.PROVISIONER_URL || 'http://docker-provisioner:4000';
const INTERNAL_SECRET = internalSecret();

// Il tenant in 'creating' è transitorio: il container potrebbe non esistere
// ancora o essere a metà provisioning, mai da riconciliare qui (competerebbe con
// createTenant()). Solo 'active'/'stopped' sono stati stabili che questo scheduler può
// correggere in sicurezza.
async function reconcileOne(tenant) {
  let res;
  try {
    res = await fetch(PROVISIONER_URL + '/tenants/' + tenant.slug + '/inspect', {
      headers: { 'x-internal-secret': INTERNAL_SECRET },
    });
  } catch (e) {
    return; // provisioner irraggiungibile in questo giro — non è un'anomalia del tenant, si riprova al prossimo tick
  }

  if (res.status === 404) {
    // Il container non esiste affatto (rimosso fuori dall'app) — anomalia più seria di
    // un semplice stop, non si indovina lo stato giusto: si logga per farla notare a un
    // operatore invece di scrivere un 'status' a caso.
    logAudit('scheduler', 'tenant.status_reconcile.missing_container', tenant.slug, { db_status: tenant.status });
    return;
  }
  if (!res.ok) return; // altro errore del provisioner — riprova al prossimo tick, mai bloccante

  const info = await res.json();
  const realStatus = info?.State?.Running ? 'active' : 'stopped';
  if (realStatus === tenant.status) return;

  db.prepare('UPDATE tenants SET status = ? WHERE slug = ?').run(realStatus, tenant.slug);
  logAudit('scheduler', 'tenant.status_reconcile', tenant.slug, { from: tenant.status, to: realStatus });
}

function startTenantStatusReconciler() {
  const CHECK_INTERVAL_MS = 15 * 60 * 1000; // stesso ritmo di backup/license/pairing — riconciliazione, non tempo reale

  async function tick() {
    const tenants = db.prepare(
      "SELECT slug, status FROM tenants WHERE status IN ('active', 'stopped')"
    ).all();
    for (const tenant of tenants) {
      await reconcileOne(tenant); // sequenziale di proposito: N chiamate HTTP al provisioner, non serve parallelismo per un tick ogni 15 minuti
    }
  }

  const guardedTick = withLock('tenant-status-reconcile', 10 * 60 * 1000, tick);
  setTimeout(guardedTick, 180 * 1000); // dopo gli altri scheduler all'avvio, stesso principio di scaglionamento
  setInterval(guardedTick, CHECK_INTERVAL_MS);
  console.log('Riconciliazione stato tenant avviata — controllo ogni 15 minuti (DB vs Docker reale)');
}

module.exports = { startTenantStatusReconciler, reconcileOne };
