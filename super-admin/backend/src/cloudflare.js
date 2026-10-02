// Automazione sottodominio Cloudflare — un record DNS per tenant, stesso IP
// pubblico già usato da coffee/finance (il NAS ha un solo indirizzo pubblico,
// tutto il routing per-dominio avviene dopo, dentro platform-nginx via Host
// header). Creato "proxato" (nuvoletta arancione): l'HTTPS pubblico lo
// termina Cloudflare (modalità SSL/TLS "Flexible" sulla zona — nessun
// certificato da gestire lato NAS), poi inoltra in HTTP semplice verso il
// NAS sulla porta 80, già forwardata dal router, dove il reverse-proxy DSM
// smista verso platform-nginx (Host header) sulla sua porta pubblicata.
//
// Non genera mai una finta "automazione riuscita" se manca la configurazione:
// stesso principio già seguito per SMTP (Fase A) e per l'AI (Fase D) — vedi
// isConfigured().

const API_BASE = 'https://api.cloudflare.com/client/v4';

function isConfigured() {
  return !!(process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ZONE_ID && process.env.CLOUDFLARE_ORIGIN_IP);
}

function zoneName() {
  return process.env.CLOUDFLARE_ZONE_NAME || 'platform-core.it';
}

async function cf(path, options = {}) {
  const res = await fetch(API_BASE + path, {
    ...options,
    headers: {
      'Authorization': 'Bearer ' + process.env.CLOUDFLARE_API_TOKEN,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const data = await res.json();
  if (!data.success) {
    const msg = (data.errors || []).map((e) => e.message).join('; ') || res.statusText;
    throw new Error('Cloudflare API: ' + msg);
  }
  return data.result;
}

// Crea o aggiorna il record A "<slug>.platform-core.it" -> IP pubblico del NAS.
// Se esiste già, lascia il suo stato "proxied" attuale invece di sovrascriverlo
// (un record impostato a mano diversamente da un operatore resta come deciso) —
// solo per un record NUOVO si applica il default (proxato, vedi commento sopra).
async function upsertSubdomain(slug) {
  if (!isConfigured()) return { skipped: true, reason: 'cloudflare_not_configured' };
  const name = slug + '.' + zoneName();
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;

  const existing = await cf('/zones/' + zoneId + '/dns_records?type=A&name=' + encodeURIComponent(name));
  if (existing.length > 0) {
    const rec = existing[0];
    if (rec.content === process.env.CLOUDFLARE_ORIGIN_IP) return { updated: false, unchanged: true, name };
    const updated = await cf('/zones/' + zoneId + '/dns_records/' + rec.id, {
      method: 'PATCH',
      body: JSON.stringify({ content: process.env.CLOUDFLARE_ORIGIN_IP }),
    });
    return { updated: true, name, proxied: updated.proxied };
  }

  const created = await cf('/zones/' + zoneId + '/dns_records', {
    method: 'POST',
    body: JSON.stringify({ type: 'A', name, content: process.env.CLOUDFLARE_ORIGIN_IP, proxied: true, ttl: 1 }),
  });
  return { created: true, name, proxied: created.proxied };
}

// Rimuove il record DNS del tenant — usato alla cancellazione del tenant, best
// effort (se il record non esiste già, non è un errore).
async function deleteSubdomain(slug) {
  if (!isConfigured()) return { skipped: true, reason: 'cloudflare_not_configured' };
  const name = slug + '.' + zoneName();
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  const existing = await cf('/zones/' + zoneId + '/dns_records?type=A&name=' + encodeURIComponent(name));
  if (existing.length === 0) return { deleted: false, reason: 'not_found' };
  await cf('/zones/' + zoneId + '/dns_records/' + existing[0].id, { method: 'DELETE' });
  return { deleted: true, name };
}

module.exports = { isConfigured, zoneName, upsertSubdomain, deleteSubdomain };
