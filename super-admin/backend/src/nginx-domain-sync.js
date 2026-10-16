const fs = require('fs');
const db = require('./db');
const { internalSecret } = require('../../../shared/internal-secret.js');

// G2 (PLATFORM-0.6-GAP-ANALYSIS.md, 2026-08-22) — non più accesso diretto a
// Docker: il reload nginx passa dal docker-provisioner, unico servizio che
// tiene /var/run/docker.sock. Stesso principio già in uso per le chiamate
// interne tenant→Super Admin (x-internal-secret).
const PROVISIONER_URL = process.env.PROVISIONER_URL || 'http://docker-provisioner:4000';
const INTERNAL_SECRET = internalSecret();

// Percorso condiviso con il container nginx: entrambi montano la stessa cartella
// dell'host (./infra/nginx), vedi docker-compose.yml. Qui scriviamo il file,
// nginx lo legge via `include` nel suo nginx.conf.
const MAP_PATH = '/etc/nginx-shared/tenants-map.conf';

// Rigenera la mappa $host -> container tenant. Solo i tenant con un dominio
// assegnato E status='active' finiscono in mappa — un tenant fermo (manutenzione,
// licenza scaduta/sospesa) non deve avere il suo dominio ancora instradato verso
// un container che non risponde: meglio che quella richiesta cada nel default
// (oggi il Super Admin, in futuro una pagina "tenant non disponibile" dedicata,
// non costruita in questo giro).
function regenerateTenantsMap() {
  const tenants = db.prepare(
    "SELECT slug, domain FROM tenants WHERE domain IS NOT NULL AND domain != '' AND status = 'active'"
  ).all();

  let content = 'map $host $tenant_upstream {\n    default "";\n';
  for (const t of tenants) {
    // Solo caratteri di un dominio valido, niente virgolette/righe che romperebbero
    // la sintassi nginx — il dominio arriva già ripulito da tenants.js, questa è
    // una seconda barriera, non l'unica.
    const safeDomain = String(t.domain).replace(/[^a-z0-9.\-]/gi, '');
    if (!safeDomain) continue;
    content += `    ${safeDomain} "platform-${t.slug}:80";\n`;
  }
  content += '}\n';

  fs.mkdirSync('/etc/nginx-shared', { recursive: true });
  fs.writeFileSync(MAP_PATH, content);
}

// Reload grazioso di nginx (SIGHUP), non un restart — nginx ricarica la config
// senza interrompere le connessioni in corso. La ricerca label-poi-fallback-nome
// (trovato mancante il 2026-08-04: senza il fallback, ogni creazione/
// eliminazione tenant riscriveva la mappa dei domini ma nginx non se ne
// accorgeva mai finché qualcuno non lo riavviava a mano) vive ora dentro
// docker-provisioner — questa funzione si limita a chiamarlo.
async function reloadNginx() {
  try {
    const res = await fetch(PROVISIONER_URL + '/nginx/reload', {
      method: 'POST',
      headers: { 'x-internal-secret': INTERNAL_SECRET },
    });
    const data = await res.json();
    if (!res.ok) {
      console.warn('nginx-domain-sync: reload fallito —', data.error);
      return { ok: false, error: data.error };
    }
    return { ok: true };
  } catch (err) {
    console.warn('nginx-domain-sync: reload fallito —', err.message);
    return { ok: false, error: err.message };
  }
}

// Punto unico chiamato da tenants.js dopo ogni operazione che cambia il routing
// per dominio (creazione, eliminazione, cambio dominio, stop/start, blocco/sblocco
// licenza). Deliberatamente "best effort": se il reload nginx fallisce, l'azione
// principale (es. creare il tenant) NON viene annullata — il routing per dominio
// resta disallineato finché non si risolve, ma il tenant esiste ed è comunque
// raggiungibile via IP:porta diretta. Chi chiama logga l'esito se vuole, non è
// obbligato a gestirlo.
async function syncNginxDomains() {
  regenerateTenantsMap();
  return reloadNginx();
}

module.exports = { syncNginxDomains, regenerateTenantsMap, reloadNginx };
