const db = require('../db');
const { moduleStatsForTenants } = require('./module-stats');

// Calcola e salva (upsert) la foto del giorno indicato — tenant attivi, moduli
// reali installati su tutta la piattaforma.
//
// Bug reale trovato in sessione (2026-08-30, testando la nuova Dashboard):
// questa funzione non era mai stata `async` nonostante chiamasse
// moduleStatsForTenants (che LO è, fa una fetch per tenant) senza await —
// `.total` letto su una Promise è sempre `undefined`, che il vincolo
// NOT NULL della colonna rifiuta all'inserimento. La foto giornaliera
// falliva silenziosamente da sempre (tick() sotto la ingoia in un
// try/catch che logga soltanto) — mai un solo snapshot con moduli reali.
async function captureSnapshot(dateStr) {
  const tenants = db.prepare(
    "SELECT slug FROM tenants WHERE status != 'deleted' AND (is_sandbox = 0 OR is_sandbox IS NULL)"
  ).all();

  const totalModules = (await moduleStatsForTenants(tenants.map((t) => t.slug))).total;

  const snapshot = {
    snapshot_date: dateStr,
    total_tenants: tenants.length,
    total_modules_installed: totalModules,
    currency: 'EUR',
  };

  db.prepare(`
    INSERT INTO metrics_snapshots (snapshot_date, total_tenants, total_modules_installed, currency)
    VALUES (@snapshot_date, @total_tenants, @total_modules_installed, @currency)
    ON CONFLICT(snapshot_date) DO UPDATE SET
      total_tenants = excluded.total_tenants,
      total_modules_installed = excluded.total_modules_installed,
      currency = excluded.currency
  `).run(snapshot);

  return snapshot;
}

module.exports = { captureSnapshot };
