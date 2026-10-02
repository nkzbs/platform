const db = require('./db');
const { logAudit } = require('./audit-log');
const { redeployTenant } = require('./routes/tenants');
const { syncNginxDomains } = require('./nginx-domain-sync');
const { capturePreviousImageIfChanged } = require('./routes/update-manager');
const { withLock } = require('./scheduler-lock');

// ─── UPDATE MANAGER — propagazione notturna ────────────────────────────────────
// Workflow: si valida un aggiornamento a mano su un tenant di prova durante il
// giorno (POST /:slug/redeploy), poi lo si mette in coda (POST /update-manager/queue)
// invece di propagarlo subito a tutti i tenant — quando ce ne sono decine/centinaia,
// riavviarli tutti nel mezzo della giornata sarebbe interruttivo per chiunque li
// stia usando. Questo scheduler controlla ogni 15 minuti se c'è un aggiornamento in
// coda E l'ora corrente (UTC) combacia con quella configurata (default 3 di notte):
// se sì, propaga a TUTTI i tenant attivi (redeployTenant, stessa funzione riusata
// dalla route singola — un solo motore, non una logica duplicata qui), uno alla
// volta, saltando (non forzando) chi ha una sessione attiva rilevata in quel
// momento — capita raramente di notte, ma non è impossibile. Poi svuota la coda,
// così un riavvio dello scheduler nella stessa notte non ripropaga due volte.
function startUpdateScheduler() {
  const CHECK_INTERVAL_MS = 15 * 60 * 1000;

  async function tick() {
    const state = db.prepare('SELECT * FROM update_manager WHERE id = 1').get();
    if (!state || !state.queued) return;

    const now = new Date();
    if (now.getUTCHours() !== (state.run_hour !== null && state.run_hour !== undefined ? state.run_hour : 3)) return;

    // Già eseguito oggi (stesso giorno UTC) — evita di ripropagare più volte
    // nella stessa finestra oraria (il tick gira ogni 15 minuti, la finestra
    // "ora corrente == run_hour" dura un'ora intera).
    if (state.last_run_at) {
      const lastDay = new Date(state.last_run_at).toISOString().slice(0, 10);
      const today = now.toISOString().slice(0, 10);
      if (lastDay === today) return;
    }

    // Il percorso reale più usato è: deploy via SSH di giorno → coda per stanotte
    // → nessuno riapre la pagina Update Manager nel frattempo. Se la cattura del
    // :previous vivesse solo in GET / (pagina aperta), il paracadute del rollback
    // sarebbe silenziosamente assente proprio per questo flusso — richiamata anche
    // qui, prima della propagazione, così non dipende da chi apre cosa e quando.
    await capturePreviousImageIfChanged().catch((e) => console.error('update-manager: snapshot pre-propagazione fallito:', e.message));

    console.log('update-manager: propagazione notturna in corso...');
    const tenants = db.prepare("SELECT * FROM tenants WHERE status != 'deleted'").all();
    const results = [];
    for (const tenant of tenants) {
      // Stessa esclusione di POST /redeploy-all — un tenant con auto_update_enabled=0
      // (pinnato a una versione, o non più su questo host) resta fuori dal giro
      // notturno, segnalato nel risultato invece che ignorato in silenzio.
      if (!tenant.auto_update_enabled) {
        results.push({ slug: tenant.slug, ok: false, skipped: 'auto_update_disabled' });
        continue;
      }
      try {
        const result = await redeployTenant(tenant, { force: false, actor: 'update-scheduler' });
        results.push({ slug: tenant.slug, ok: result.ok, skipped: result.skipped || null });
      } catch (err) {
        results.push({ slug: tenant.slug, ok: false, error: err.message });
      }
    }
    syncNginxDomains().catch(() => {});

    db.prepare('UPDATE update_manager SET queued = 0, last_run_at = ?, last_run_results = ? WHERE id = 1')
      .run(now.toISOString(), JSON.stringify(results));
    logAudit('update-scheduler', 'tenant.redeploy_all', null, { count: tenants.length, results, scheduled: true });
    console.log(`update-manager: propagazione notturna completata — ${results.filter((r) => r.ok).length}/${tenants.length} aggiornati`);
  }

  // G14 — lock distribuito (no-op senza Redis), TTL 30 min: questo tick può
  // redeployare OGNI tenant attivo uno alla volta — il rischio di due repliche
  // che propagano contemporaneamente è il più costoso di tutti gli scheduler
  // qui, merita il margine più ampio.
  const guardedTick = withLock('update-manager', 30 * 60 * 1000, tick);
  setTimeout(guardedTick, 60 * 1000);
  setInterval(guardedTick, CHECK_INTERVAL_MS);
  console.log('Update scheduler avviato — controllo ogni 15 minuti');
}

module.exports = { startUpdateScheduler };
