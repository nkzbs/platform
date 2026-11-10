// (Token, zona e indirizzo del NAS: da Impostazioni → Server, mai dall'ambiente — vedi lib/cloudflare.js.)
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
const lib = require('./lib/cloudflare'); // token e zona: quelli salvati in Impostazioni, altrimenti le variabili d'ambiente (un solo collegamento)
const zonaId = () => lib.impostazioni().zona;

function isConfigured() {
  return !!(lib.token() && zonaId() && lib.impostazioni().ip);
}

// Basta token e zona (senza l'indirizzo del NAS) per dare a un tenant su Linode il suo indirizzo.
function configuredForRemote() { return !!(lib.token() && zonaId()); }

function zoneName() {
  return lib.impostazioni().dominio;
}

async function cf(path, options = {}) {
  const res = await fetch(API_BASE + path, {
    ...options,
    headers: {
      'Authorization': 'Bearer ' + lib.token(),
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
async function upsertSubdomain(slug, ip, opz = {}) {
  if (!(ip ? lib.token() && zonaId() : isConfigured())) return { skipped: true, reason: 'cloudflare_not_configured' };
  const name = slug + '.' + zoneName();
  const zoneId = zonaId();

  const existing = await cf('/zones/' + zoneId + '/dns_records?type=A&name=' + encodeURIComponent(name));
  if (existing.length > 0) {
    const rec = existing[0];
    const stessoProxy = typeof opz.proxied !== 'boolean' || rec.proxied === opz.proxied;
    if (rec.content === (ip || lib.impostazioni().ip) && stessoProxy) return { updated: false, unchanged: true, name };
    const updated = await cf('/zones/' + zoneId + '/dns_records/' + rec.id, {
      method: 'PATCH',
      body: JSON.stringify({ content: (ip || lib.impostazioni().ip), ...(typeof opz.proxied === 'boolean' ? { proxied: opz.proxied } : {}) }),
    });
    return { updated: true, name, proxied: updated.proxied };
  }

  const created = await cf('/zones/' + zoneId + '/dns_records', {
    method: 'POST',
    body: JSON.stringify({ type: 'A', name, content: (ip || lib.impostazioni().ip), proxied: typeof opz.proxied === 'boolean' ? opz.proxied : true, ttl: 1 }),
  });
  return { created: true, name, proxied: created.proxied };
}

// Rimuove il record DNS del tenant — usato alla cancellazione del tenant, best
// effort (se il record non esiste già, non è un errore).
async function deleteSubdomain(slug) {
  if (!isConfigured()) return { skipped: true, reason: 'cloudflare_not_configured' };
  const name = slug + '.' + zoneName();
  const zoneId = zonaId();
  const existing = await cf('/zones/' + zoneId + '/dns_records?type=A&name=' + encodeURIComponent(name));
  if (existing.length === 0) return { deleted: false, reason: 'not_found' };
  await cf('/zones/' + zoneId + '/dns_records/' + existing[0].id, { method: 'DELETE' });
  return { deleted: true, name };
}

// Modalità SSL/TLS reale della zona, letta dalla stessa API — non assunta
// "flexible" da un commento. Usata dal pannello "Sicurezza della
// piattaforma" (2026-10-15): la zona OGGI è in Flexible (vedi commento in
// cima al file), quindi il traffico tra Cloudflare e il NAS viaggia in
// chiaro — il pannello deve mostrarlo com'è davvero, non quello che
// vorremmo fosse.
async function sslMode() {
  if (!isConfigured()) return null;
  const zoneId = zonaId();
  const result = await cf('/zones/' + zoneId + '/settings/ssl');
  return result.value;
}

module.exports = { configuredForRemote, isConfigured, zoneName, upsertSubdomain, deleteSubdomain, sslMode };
