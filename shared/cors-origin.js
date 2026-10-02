// G5 (PLATFORM-0.6-GAP-ANALYSIS.md) — whitelist di origini CORS, condivisa tra i
// due backend. Prima: `cors()` senza opzioni, che riflette QUALUNQUE Origin nella
// risposta — un sito malevolo poteva far eseguire richieste autenticate contro
// l'API da un browser con sessione già valida. Stessa zona già usata per
// l'automazione DNS Cloudflare (`CLOUDFLARE_ZONE_NAME`, vedi
// super-admin/backend/src/cloudflare.js) — un tenant/partner/Super Admin vive
// sempre su un sottodominio di quella stessa zona, non serve un secondo elenco
// da mantenere a mano.
//
// In sviluppo (nessun `NODE_ENV=production`) resta permissivo come sempre —
// questo è un controllo di produzione, non deve rompere `npm run dev` locale
// con porte/host variabili.
export function buildCorsOptions(zoneName) {
  const zone = zoneName || 'platform-core.it';
  return {
    origin(origin, callback) {
      if (process.env.NODE_ENV !== 'production') return callback(null, true);
      if (!origin) return callback(null, true); // richieste server-to-server / curl, nessun header Origin
      let hostname;
      try { hostname = new URL(origin).hostname; } catch { return callback(new Error('Origin non valida: ' + origin)); }
      if (hostname === 'localhost' || hostname === zone || hostname.endsWith('.' + zone)) return callback(null, true);
      callback(new Error('Origin non consentita: ' + origin));
    },
  };
}
