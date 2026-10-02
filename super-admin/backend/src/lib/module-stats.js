const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || 'changeme_internal';

// Moduli REALI installati su un tenant, per categoria — "reali" nello stesso
// senso dello Store: esclusi i moduli di supporto (righe fattura, giunzioni tra
// moduli...), mai visti/aperti da nessuno. La categoria è group_name (la
// sezione della sidebar del tenant), NON le tag del registro/Store — oggi solo
// alcuni tenant (es. Coffee) la valorizzano davvero; un modulo senza gruppo
// finisce sotto null, mostrato lato frontend come "Senza categoria", scelta
// esplicita invece di nasconderlo o inventare una categoria che non c'è.
// G2b/G15 (PLATFORM-0.6-GAP-ANALYSIS.md) — chiamata di rete interna a
// GET /api/modules/internal/stats invece di aprire il .db grezzo del tenant
// (com'era prima). Usata sia per il dettaglio di UN tenant (routes/tenants.js)
// sia per la somma di TUTTI i tenant (lib/analytics.js), un solo posto invece
// di due copie della stessa query.
async function moduleStatsForTenant(slug) {
  try {
    const res = await fetch('http://platform-' + slug + ':80/api/modules/internal/stats', {
      headers: { 'x-internal-secret': INTERNAL_SECRET },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { total: 0, by_category: [] };
    const body = await res.json();
    return { total: body.total || 0, by_category: body.by_category || [] };
  } catch (e) {
    return { total: 0, by_category: [] }; // tenant irraggiungibile — non un errore da segnalare qui
  }
}

// Somma i risultati di moduleStatsForTenant su più tenant (es. tutto il parco
// installato) — stessa forma { total, by_category }, categorie unite per nome.
// Chiamate in parallelo (Promise.all), non in sequenza: N tenant non devono
// costare N x il tempo di un singolo tenant.
async function moduleStatsForTenants(slugs) {
  const merged = new Map(); // category -> count
  let total = 0;
  const results = await Promise.all(slugs.map((slug) => moduleStatsForTenant(slug)));
  for (const stats of results) {
    total += stats.total;
    stats.by_category.forEach((row) => {
      merged.set(row.category, (merged.get(row.category) || 0) + row.count);
    });
  }
  const by_category = Array.from(merged.entries()).map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count);
  return { total, by_category };
}

module.exports = { moduleStatsForTenant, moduleStatsForTenants };
