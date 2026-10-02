// Fase 12.5 (PLATFORM-MASTER-ROADMAP.md, audit 2026-09-02) — client HTTP condiviso verso
// l'API di un tenant (core/backend), estratto da routes/tenants.js perché ora serve anche a
// lib/tenant-config-from-analysis.js. Stesso pattern di autenticazione già in uso per
// mintTenantAdminToken (secret interno, rete Docker `http://platform-<slug>:80`).
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || 'changeme_internal';

// MAX_ATTEMPTS 6 -> 18 (2026-09-11, bug reale in produzione: un tenant con
// analisi coperta 8/8 è nato con SOLO i 2 moduli placeholder di core/backend,
// zero moduli reali installati, zero errore visibile — installModulesByIds
// aveva ricevuto un ECONNREFUSED, esaurito i 6 tentativi (~6s) prima che il
// server Express del container fosse davvero in ascolto, e propagato
// un'eccezione che however NON bloccava comunque il resto della route in
// modo visibile). Stesso principio già applicato a waitForTenantDb (20s->90s)
// e ai timeout nginx: su questo NAS sotto carico la finestra tra "il .db
// esiste" e "il server accetta connessioni" può superare ampiamente i 6s
// concessi finora. 18 tentativi da 1s (~18s) lascia margine reale senza
// rallentare il caso comune (il server è quasi sempre già su, ogni retry in
// più costa zero quando non serve).
const MAX_ATTEMPTS = 18;

async function callTenantAPI(slug, method, path, body, attempt = 1) {
  try {
    const r = await fetch('http://platform-' + slug + ':80' + path, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await r.json();
    if (!r.ok) throw Object.assign(new Error(data.error || 'Chiamata al tenant fallita'), { status: r.status });
    return data;
  } catch (e) {
    // waitForTenantDb (chiamato prima di ogni uso di questa funzione durante il
    // provisioning) garantisce che il file .db sia seminato, non che il server Express
    // del container sia già in ascolto — la finestra tra le due cose è più larga di
    // quanto sembrasse: verificato dal vivo (2026-09-02, sandbox ai-sandbox appena
    // creato) che 3 tentativi da 500ms non bastavano sempre sotto carico (più
    // container in avvio in contemporanea su questa macchina). Non applicato per
    // errori HTTP con status esplicito (risposte reali del tenant, non un container
    // non ancora pronto).
    if (e.status === undefined && attempt < MAX_ATTEMPTS) {
      await new Promise((r2) => setTimeout(r2, 1000));
      return callTenantAPI(slug, method, path, body, attempt + 1);
    }
    throw e;
  }
}

module.exports = { callTenantAPI };
