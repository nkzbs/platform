const express = require('express');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const db = require('../db');
const { requireAuth, requireQueryToken } = require('./auth');

// Carica il tenant e lo attacca a req.tenant, così le route sotto non lo
// ricaricano una seconda volta. Va SEMPRE dopo requireAuth — applicato
// esplicitamente route per route invece che con router.param, per non
// dipendere dall'ordine di esecuzione tra param callback e middleware di
// route (Express non lo garantisce in modo ovvio).
function requireTenantScope(req, res, next) {
  const tenant = db.prepare('SELECT * FROM tenants WHERE slug = ?').get(req.params.slug);
  if (!tenant) return res.status(404).json({ error: 'Tenant non trovato' });
  req.tenant = tenant;
  next();
}
const { logAudit } = require('../audit-log');
const { notifyBackupResult } = require('../notifier');
const { runBackupForTenant } = require('../backup-scheduler');
const { syncNginxDomains } = require('../nginx-domain-sync');
const { generatePassword, setTenantAdminPassword } = require('../credentials');
const { moduleStatsForTenant } = require('../lib/module-stats');
const cloudflare = require('../cloudflare');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { encrypt: encryptSecret } = require('../crypto-secrets');
const { internalSecret } = require('../../../../shared/internal-secret.js');

const router = express.Router();

// G2 (PLATFORM-0.6-GAP-ANALYSIS.md, 2026-08-22) — non più accesso diretto a
// Docker: ogni operazione container passa dal docker-provisioner, unico
// servizio con /var/run/docker.sock montato. Stesso principio già in uso per
// le chiamate interne tenant→Super Admin (x-internal-secret).
const PROVISIONER_URL = process.env.PROVISIONER_URL || 'http://docker-provisioner:4000';
const INTERNAL_SECRET = internalSecret();
const provisionerHeaders = { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET };
// Stesso principio di SUPPORT_UPLOAD_DIR (support.js)/UPLOAD_DIR (core/backend) — invocato
// solo a runtime da questa route (mai al boot), quindi non blocca l'avvio fuori da un
// container, ma senza un override resterebbe comunque non testabile su un host senza /data
// montato. Default invariato in produzione.
const BACKUP_ROOT = process.env.BACKUP_ROOT || '/data/backups';

async function provisionerRequest(method, path, body) {
  const res = await fetch(PROVISIONER_URL + path, {
    method,
    headers: provisionerHeaders,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.error || 'Operazione container fallita'), { status: res.status });
  return data;
}

// Come provisionerRequest, ma per /images/build-core: risponde NDJSON (una riga
// per step, può durare oltre un minuto) invece di un solo JSON finale — letta
// riga per riga e inoltrata a `log`, stesso principio del popup di avanzamento
// già usato da redeployTenant sotto. Chiamata PRIMA di redeployTenant: così
// "Aggiorna" ricostruisce sempre platform-core:latest dal sorgente più
// recente invece di assumere che qualcuno l'abbia già fatto da fuori (il
// vecchio flusso, un passaggio manuale via scripts/redeploy-nas.sh dal
// laptop dello sviluppatore — dimenticarlo faceva sembrare "Aggiorna"
// riuscito mentre in realtà ricreava il container dalla stessa immagine di
// prima, bug reale trovato dal vivo il 18/10).
async function buildCoreImage({ log } = {}) {
  const say = (m) => { try { if (log) log(m) } catch (e) { /* un log non deve mai fermare la build */ } };
  const res = await fetch(PROVISIONER_URL + '/images/build-core', { method: 'POST', headers: provisionerHeaders });
  if (!res.ok || !res.body) throw new Error('Provisioner non raggiungibile per la build (' + res.status + ')');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let final = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx); buf = buf.slice(idx + 1);
      if (!line.trim()) continue;
      let evt; try { evt = JSON.parse(line) } catch (e) { continue }
      if (evt.done) { final = evt; continue }
      if (evt.msg) say(evt.msg);
    }
  }
  if (!final || !final.ok) throw new Error((final && final.error) || 'Build dell\'immagine fallita');
  return final;
}

// F8 (PLATFORM-MASTER-ROADMAP.md) — Resource Optimization/G20: su questo NAS (1.9GB RAM
// totali, misurato) creare più tenant hosted in burst causa swap thrashing — 90% di
// fallimento oltre 1-2 container creati in contemporanea. Non risolvibile lato codice nel
// senso pieno (serve più RAM o multi-nodo, decisione infrastrutturale dell'utente, fuori da
// qui) — ma la causa scatenante sì: più processi Node che bootano insieme dentro Docker.
// Serializzare le creazioni dei tenant
// elimina il picco di RAM concorrente — chi arriva mentre un altro tenant è in creazione
// aspetta in coda, non viene mai rifiutato.
let hostedCreationQueue = Promise.resolve();
function enqueueHostedCreation(fn) {
  const run = hostedCreationQueue.then(fn, fn);
  hostedCreationQueue = run.catch(() => {});
  return run;
}

const BASE_PORT = 4000;

function getNextPort() {
  const last = db.prepare('SELECT MAX(port) as port FROM tenants').get();
  return (last.port || BASE_PORT) + 1;
}

// Attende che il container appena creato abbia finito il proprio primo avvio —
// core/backend/src/db.js crea il file .db e semina i moduli di default in modo
// asincrono al boot, quindi subito dopo container.start() il file può non esistere
// ancora o esistere ma senza tabelle popolate. Si va a controllare direttamente il
// file (stesso accesso diretto già usato per backup/restore), non l'API HTTP del
// tenant, perché quest'ultima richiederebbe comunque attendere il boot del server.
//
// 90s, non più 20s (2026-09-08, bug reale trovato dal vivo dall'utente durante
// un test pre-demo: OGNI creazione tenant dal 30/8 in poi falliva con questo
// identico timeout; un primo alzamento a 45s non è bastato — "5 tenant creati,
// troppi errori"). Misurato sulla NAS reale: 1.9GB RAM totali, ~580MB
// disponibili con solo i container di base già accesi (Coffee/Finance/Super
// Admin/Redis/provisioner/nginx), swap già in uso — un nuovo container Node
// che boota sotto pressione di memoria può impiegare molto più dei 20s
// previsti per seminare il proprio DB, senza che nulla sia realmente rotto
// (G20, PLATFORM-MASTER-ROADMAP.md — RAM in più fuori discussione per scelta
// dell'utente, ma la causa scatenante — troppo poco tempo concesso, non
// troppa poca RAM in assoluto — è mitigabile qui). Il vincolo reale non è
// questa funzione da sola: sulla STESSA richiesta HTTP, dopo questa attesa,
// si sommano ANCHE installazione moduli/applyAnalysisConfigToTenant/DNS —
// per questo il timeout del proxy nginx di super-admin-frontend (che prima
// era il vero limite, mai alzato dal default 60s) è stato portato a 150s
// (super-admin/frontend/nginx.conf) — 90s qui lascia margine reale a quei
// passi successivi entro quella finestra, invece di quasi azzerarlo come
// facevano i precedenti 45s contro un nginx ancora a 60s.
function waitForTenantDb(dbPath, timeoutMs = 90000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tryOpen = () => {
      try {
        if (fs.existsSync(dbPath)) {
          const tdb = new Database(dbPath, { readonly: true, fileMustExist: true });
          let ready = false;
          try {
            const row = tdb.prepare('SELECT COUNT(*) as c FROM modules').get();
            ready = !!(row && row.c > 0);
          } finally {
            tdb.close();
          }
          if (ready) return resolve(true);
        }
      } catch (e) {
        // file in scrittura o tabella non ancora creata — riprova finché non scade il timeout
      }
      if (Date.now() - start > timeoutMs) return reject(new Error('Timeout in attesa che il database del nuovo tenant sia pronto'));
      setTimeout(tryOpen, 300);
    };
    tryOpen();
  });
}

// Fase 12.5 (PLATFORM-MASTER-ROADMAP.md, audit 2026-09-02) — B2a: chiama l'API del
// tenant (core/backend, /api/modules/internal/*) invece di aprire il suo file .db
// direttamente. Estratta in lib/tenant-api-client.js (2026-09-02, B2b) perché ora
// serve anche a lib/tenant-config-from-analysis.js.
const { callTenantAPI } = require('../lib/tenant-api-client');

// Installa nel tenant appena creato i moduli del Registro scelti come default
// (vedi registry.js PUT /default-modules) — stesso principio di cloneModulesFromTemplate
// sopra (API del tenant, non file diretto), ma la sorgente è il Registro (le
// registry_modules di Super Admin) invece di un tenant intero.
async function installDefaultModules(targetSlug) {
  const defaults = db.prepare(`
    SELECT rm.* FROM default_modules dm
    JOIN registry_modules rm ON rm.id = dm.registry_module_id
    ORDER BY rm.name
  `).all();
  if (defaults.length === 0) return null;
  const modules = defaults.map((m, i) => ({
    name: m.name, slug: m.slug, icon: m.icon, color: m.color, active: 1, installed: 1,
    sort_order: 90 + i, schema_json: m.schema_json, schema_version: 1, support_module: 0,
  }));
  const result = await callTenantAPI(targetSlug, 'POST', '/api/modules/internal/install-batch', { modules });
  return { modules: result.installed };
}

// Installa un elenco ESPLICITO di moduli del Registro in un tenant già creato —
// gemella di installDefaultModules sopra, stesso principio (API del tenant), ma la
// lista arriva da chi chiama invece che dalla tabella default_modules globale. Usata
// da routes/client-analyses.js per preinstallare i moduli scelti durante un'analisi
// accettata, invece del set di default generico.
async function installModulesByIds(targetSlug, registryModuleIds) {
  if (!Array.isArray(registryModuleIds) || registryModuleIds.length === 0) return null;
  const placeholders = registryModuleIds.map(() => '?').join(',');
  const mods = db.prepare(`SELECT * FROM registry_modules WHERE id IN (${placeholders})`).all(...registryModuleIds);
  if (mods.length === 0) return null;
  const modules = mods.map((m, i) => ({
    name: m.name, slug: m.slug, icon: m.icon, color: m.color, active: 1, installed: 1, sort_order: 90 + i,
    schema_json: m.schema_json, registry_module_id: m.id, registry_source_tenant_slug: m.source_tenant_slug,
    registry_slug: m.slug, registry_version: m.version,
  }));
  const result = await callTenantAPI(targetSlug, 'POST', '/api/modules/internal/install-batch', { modules });
  return { modules: result.installed };
}

// Le sandbox (is_sandbox=1, create da super-builder.js per il Super Builder AI)
// sono escluse per default: sono un tenant tecnico, non un cliente, e prima
// comparivano mischiate tra i tenant reali (contate nei totali, azioni complete
// start/stop/delete/backup/redeploy). ?include_sandboxes=1 le riporta dentro,
// per i rari casi di manutenzione diretta su una sandbox bloccata.
// Colonne che non devono mai uscire verso il browser: la chiave di cifratura e il
// segreto JWT del tenant (servono solo al container) e le credenziali del backup
// offsite. Prima l'elenco e la risposta di creazione restituivano la riga intera.
const SECRET_TENANT_COLUMNS = ['encryption_key', 'jwt_secret', 'backup_offsite_credentials'];
function withoutSecrets(tenant) {
  const out = { ...tenant };
  for (const c of SECRET_TENANT_COLUMNS) delete out[c];
  return out;
}

router.get('/', requireAuth, async (req, res) => {
  const includeSandboxes = req.query.include_sandboxes === '1';
  const sandboxFilter = includeSandboxes ? '' : 'AND (is_sandbox = 0 OR is_sandbox IS NULL) ';
  const tenants = db.prepare(`SELECT * FROM tenants WHERE 1=1 ${sandboxFilter}ORDER BY created_at DESC`).all();
  // PLATFORM-UI-REDESIGN-CATALOG.md #3 — colonna "Moduli" nell'overview, stesso
  // pattern già in uso per il singolo tenant (GET /:slug) — mai una query
  // nuova, riusa moduleStatsForTenant già esistente in lib/module-stats.js.
  // Chiamate in parallelo (G2b/G15: ora una richiesta di rete per tenant, non
  // più un'apertura file locale) — N tenant non devono costare N x il tempo di uno.
  const counts = await Promise.all(tenants.map((t) => moduleStatsForTenant(t.slug)));
  const withModuleCounts = tenants.map((t, i) => ({ ...withoutSecrets(t), n_moduli: counts[i].total }));
  res.json(withModuleCounts);
});

// Dice al frontend se l'automazione sottodominio Cloudflare è attiva — così
// TenantsPage può spiegare perché un nuovo tenant arriva (o non arriva) con un
// dominio già assegnato, senza indovinare dal solo campo domain=null.
router.get('/cloudflare/status', requireAuth, (req, res) => {
  res.json({ configured: cloudflare.isConfigured(), zone: cloudflare.zoneName() });
});

// Provisioning vero e proprio — estratto dalla route POST / così anche altro codice
// interno (es. super-builder.js, che crea al volo un tenant sandbox) può creare un
// tenant senza duplicare la logica Docker/clonazione, ed è sempre l'unico punto che
// decide come nasce un tenant.
// `skipDefaults`: non installare i moduli di default (chi crea da un'analisi sceglie lui i moduli). `onStep(fase)`: avviso a ogni fase (per mostrare l'avanzamento e misurare i tempi).
async function createTenant({ name, slug, domain, actor, isSandbox, skipDefaults, onStep }) {
  const step = (f) => { try { if (onStep) onStep(f); } catch (e) { /* mai bloccare la creazione per un avviso */ } };
  // Stesso formato richiesto dal docker-provisioner per il nome container
  // (SLUG_RE, super-admin/docker-provisioner/src/docker.js) — validato QUI,
  // PRIMA di inserire la riga 'creating', non più solo là (2026-09-11, bug
  // reale segnalato dal vivo: un client mobile con autocorrezione iOS ha
  // inviato "Bianchi " con maiuscola e spazio finale, il provisioner l'ha
  // giustamente rifiutato ma solo DOPO che la riga tenants era già stata
  // scritta — risultato un tenant fantasma bloccato in stato 'error' da
  // ripulire a mano). Controllare prima significa che uno slug non valido
  // non crea mai più quella riga fantasma.
  if (typeof slug !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    throw Object.assign(new Error('Slug non valido: "' + slug + '" — solo lettere minuscole, numeri e trattini, senza spazi'), { status: 400 });
  }
  // Controllo esplicito PRIMA dell'INSERT (2026-08-16) — senza, uno slug già
  // in uso falliva con il messaggio SQLite grezzo ("UNIQUE constraint failed:
  // tenants.slug") invece di un errore comprensibile, e il catch sotto finiva
  // per marcare "error" il tenant ESISTENTE con quello slug (vedi commento
  // sopra insertedOwnRow) — bug reale, non solo un messaggio brutto.
  if (db.prepare('SELECT id FROM tenants WHERE slug = ?').get(slug)) {
    throw Object.assign(new Error('Slug "' + slug + '" già in uso da un altro tenant'), { status: 400 });
  }

  const port = getNextPort();
  // Biforcazione introdotta il 26/10/2026 (chiusura del gap "ogni tenant vede
  // l'intero volume condiviso", vedi tenantHostConfig in docker-provisioner):
  // containerDbPath è ciò che il CONTAINER del tenant vede dentro il proprio
  // /data (ora la sua sottocartella scoped, non più la radice del volume) —
  // resta '/data/<slug>.db' per sempre, non cambia mai. hostDbPath è ciò che
  // SUPER ADMIN vede sul proprio mount (l'intero volume, invariato) — include
  // la sottocartella del tenant, ed è quello che va nella colonna db_path.
  // Confondere i due (mandare hostDbPath al container, o viceversa) rompe
  // silenziosamente ogni redeploy successivo — stesso tipo di incidente della
  // "finance.db sbagliata" di stanotte, ma auto-inflitto.
  const containerDbPath = '/data/' + slug + '.db';
  const hostDbPath = '/data/' + slug + '/' + slug + '.db';
  const cleanDomain = domain ? String(domain).trim().toLowerCase() : null;
  // Password vera, generata qui, MAI una costante fissa uguale per ogni tenant —
  // prima ogni tenant nasceva con admin/platform2024 scritto nel codice, chiunque
  // lo sapesse poteva entrare in qualunque tenant raggiungibile. Passata al
  // container come variabile ambiente (stesso meccanismo già usato per
  // TENANT_NAME), letta da core/backend/src/db.js al primo avvio.
  const initialPassword = generatePassword();
  const encryptionKey = crypto.randomBytes(32).toString('hex');
  // Random per-tenant, MAI il fallback condiviso 'changeme' (o il valore di Super
  // Admin stesso) — stesso principio già applicato a password/encryption_key sopra,
  // mancava per JWT_SECRET: con un secret uguale su ogni tenant, un token firmato
  // per un tenant era valido anche su tutti gli altri. Non serve che Super Admin lo
  // rilegga più avanti: la firma dei token "al posto dell'utente" (vedi Builder
  // integrato) avviene DENTRO il tenant stesso via l'endpoint interno protetto da
  // INTERNAL_API_SECRET — il valore resta solo qui (per riuso in un futuro
  // redeploy manuale del container) e nell'env del container.
  const jwtSecret = crypto.randomBytes(32).toString('hex');

  // Bug reale trovato il 2026-08-16: se l'INSERT sotto fallisce perché lo
  // slug esiste già (es. un tentativo di ricreare "finance" per errore), il
  // catch in fondo eseguiva comunque `UPDATE tenants SET status='error'
  // WHERE slug=?` — che colpisce il tenant ESISTENTE con quello slug, non
  // "il nostro" (mai inserito). Risultato osservato: il tenant reale
  // "finance", sano e in esecuzione da ore, marcato "error" solo perché
  // qualcuno aveva provato a creare un tenant chiamato allo stesso modo.
  // `insertedOwnRow` distingue i due casi: l'UPDATE di stato nel catch
  // scatta SOLO se siamo davvero noi ad aver inserito la riga in questa
  // chiamata (un fallimento successivo, es. Docker), mai su un fallimento
  // dell'INSERT stesso.
  let insertedOwnRow = false;
  try {
    db.prepare('INSERT INTO tenants (name, slug, port, db_path, status, domain, encryption_key, jwt_secret, is_sandbox, provisioning_step) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(name, slug, port, hostDbPath, 'creating', cleanDomain, encryptionKey, jwtSecret, isSandbox ? 1 : 0, 'creating_container');
    insertedOwnRow = true;

    // L'array Env resta assemblato QUI (con tutti i secret del tenant appena
    // generati) esattamente come prima — il docker-provisioner lo riceve come
    // dato opaco, non lo interpreta: image/network/volume/restart-policy restano
    // fissati lato provisioner, non passabili da qui (vedi G2).
    step('container');
    await provisionerRequest('POST', '/tenants', {
      slug,
      port,
      env: [
        'PORT=3000',
        'DB_PATH=' + containerDbPath,
        'JWT_SECRET=' + jwtSecret,
        'TENANT_SLUG=' + slug,
        'TENANT_NAME=' + name,
        'INITIAL_ADMIN_PASSWORD=' + initialPassword,
        'ENCRYPTION_KEY=' + encryptionKey,
        // Usato solo dal tenant per chiamare gli endpoint /api/registry/public/* del
        // Super Admin (registro moduli) — non è mai esposto fuori dalla rete Docker
        // interna, quindi un secret condiviso semplice è sufficiente qui.
        'INTERNAL_API_SECRET=' + internalSecret(),
        'SUPER_ADMIN_URL=' + (process.env.SUPER_ADMIN_INTERNAL_URL || 'http://super-admin-backend:3000'),
        // Stesso Redis di Super Admin, se configurato — TENANT_SLUG (già passato
        // sopra) isola i contatori di questo tenant dagli altri che condividono
        // lo stesso Redis (vedi shared/rate-limit.js). Assente = in-memory come
        // sempre, nessuna rottura per un NAS non ancora aggiornato con Redis.
        ...(process.env.REDIS_URL ? ['REDIS_URL=' + process.env.REDIS_URL] : []),
      ],
    });

    db.prepare('UPDATE tenants SET provisioning_step = ? WHERE slug = ?').run('seeding_database', slug);
    // Concetto di verticale/modello rimosso per intero (2026-10-02, richiesto
    // esplicitamente dall'utente) — ogni tenant nasce da zero. Se Super Admin
    // ha configurato un set di moduli di default (vedi registry.js PUT
    // /default-modules), installarli ora. Se non è configurato nulla, restano
    // i placeholder seminati da core stesso (comportamento identico a prima).
    // Il dominio non dipende dal database del tenant: si parte subito, in parallelo, e si aspetta alla fine (prima erano due attese una dopo l'altra).
    let cloudflareResult = null;
    let finalDomain = cleanDomain;
    const autoDomain = slug + '.' + cloudflare.zoneName();
    if (!finalDomain && cloudflare.isConfigured()) {
      finalDomain = autoDomain;
      db.prepare('UPDATE tenants SET domain = ? WHERE slug = ?').run(finalDomain, slug);
    }
    const cloudflarePromise = cloudflare.isConfigured() && finalDomain === autoDomain
      ? cloudflare.upsertSubdomain(slug).catch((e) => ({ error: e.message }))
      : Promise.resolve(null);
    step('database');
    await waitForTenantDb(hostDbPath);
    step('moduli_default');
    const cloneResult = skipDefaults ? null : await installDefaultModules(slug);

    // Se non è stato indicato un dominio esplicito e Cloudflare è configurato,
    // il tenant riceve subito un sottodominio automatico "<slug>.platform-core.it"
    // — nessun passaggio manuale su Cloudflare per l'operatore. L'automazione
    // Cloudflare riguarda solo la nostra zona: si attiva sia quando il dominio è
    // stato lasciato vuoto (generato qui) sia quando è stato passato esplicito ma
    // COINCIDE comunque con "<slug>.platform-core.it" — stesso controllo già usato
    // da PATCH /:slug/domain. Prima si guardava solo "dominio assente", quindi un
    // dominio esplicito che ricadeva comunque nella nostra zona (es. passato da
    // uno script/chiamata diretta invece che dal wizard, che lo lascia vuoto)
    // saltava silenziosamente il DNS — trovato il 2026-08-08 su retail/servizi/
    // associazione creati così: nessun errore, ma il sottodominio non risolveva
    // finché qualcuno non se ne accorgeva provando ad aprirlo.
    db.prepare('UPDATE tenants SET provisioning_step = ? WHERE slug = ?').run('configuring_domain', slug);
    step('dominio');
    cloudflareResult = await cloudflarePromise;

    db.prepare('UPDATE tenants SET status = ?, provisioning_step = ? WHERE slug = ?').run('active', 'active', slug);
    const tenant = db.prepare('SELECT * FROM tenants WHERE slug = ?').get(slug);
    logAudit(actor || 'system', 'tenant.create', slug, { name, port, cloned: cloneResult, cloudflare: cloudflareResult });
    syncNginxDomains().catch(() => {}); // best effort, non blocca la risposta
    return { tenant, initialPassword, cloneResult, cloudflareResult };
  } catch (err) {
    // F7 — provisioning_step NON viene toccato qui: resta quello scritto PRIMA della fase che
    // ha fallito, così si sa esattamente dove il processo si è fermato (gate della fase).
    // provisioning_error salva il messaggio per diagnosi rapida senza dover cercare nei log.
    if (insertedOwnRow) db.prepare('UPDATE tenants SET status = ?, provisioning_error = ? WHERE slug = ?').run('error', String(err.message || err), slug);
    throw err;
  }
}

router.post('/', requireAuth, async (req, res) => {
  const { name, slug, domain } = req.body;
  if (!name || !slug) return res.status(400).json({ error: 'Nome e slug obbligatori' });

  try {
    const { tenant, initialPassword, cloneResult, cloudflareResult } = await enqueueHostedCreation(() => createTenant({ name, slug, domain, actor: req.user.username }));
    // La password viene restituita UNA volta sola, qui — non è salvata da nessuna
    // parte in Super Admin (nel tenant sì, come hash bcrypt, mai in chiaro). Se
    // l'operatore la perde, l'unica strada è "Reset credenziali", non un recupero.
    res.json({ ...withoutSecrets(tenant), initial_credentials: { username: 'admin', password: initialPassword }, cloned_from_template: cloneResult, cloudflare: cloudflareResult });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/:slug/stop', requireAuth, requireTenantScope, async (req, res) => {
  const { slug } = req.params;
  try {
    await provisionerRequest('POST', '/tenants/' + slug + '/stop');
    db.prepare('UPDATE tenants SET status = ? WHERE slug = ?').run('stopped', slug);
    logAudit(req.user.username, 'tenant.stop', slug, null);
    syncNginxDomains().catch(() => {});
    res.json({ status: 'stopped' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Estratta a parte (2026-09-12) — un tenant non usato per giorni può finire
// fermo (riconciliazione DB<->Docker, o fermato a mano) e nessun percorso lo
// riavviava mai da solo prima di scriverci dentro via HTTP: bug reale trovato
// dal vivo, il sandbox condiviso di Core (ensureSandbox in super-builder.js)
// risultava "esistente" (riga + file .db) ma il container era fermo da 5
// giorni — ogni scrittura falliva in silenzio (connessione rifiutata) e
// l'operatore vedeva "modulo pubblicato" senza che fosse mai stato scritto
// da nessuna parte. Riusata anche dalla route POST /:slug/start sopra.
async function ensureTenantRunning(slug) {
  const tenant = db.prepare('SELECT status FROM tenants WHERE slug = ?').get(slug);
  if (tenant && tenant.status !== 'active') {
    await provisionerRequest('POST', '/tenants/' + slug + '/start');
    db.prepare('UPDATE tenants SET status = ? WHERE slug = ?').run('active', slug);
  }
}

router.post('/:slug/start', requireAuth, requireTenantScope, async (req, res) => {
  const { slug } = req.params;
  try {
    try {
      await provisionerRequest('POST', '/tenants/' + slug + '/start');
    } catch (startErr) {
      // Container assente (tenant registrato ma mai avviato qui, o rimosso a mano):
      // lo si ricrea sullo stesso volume dati con i segreti già salvati.
      // `force` perché un container che non esiste non ha sessioni da proteggere.
      await redeployTenant(req.tenant, { force: true, actor: req.user.username });
    }
    db.prepare('UPDATE tenants SET status = ? WHERE slug = ?').run('active', slug);
    logAudit(req.user.username, 'tenant.start', slug, null);
    syncNginxDomains().catch(() => {});
    res.json({ status: 'active' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Ricrea il container di un tenant con l'ultima immagine platform-core disponibile
// sul NAS, riusando ESATTAMENTE i secret già salvati per lui (jwt_secret,
// encryption_key, porta, db_path — stessa tabella usata da createTenant) invece di
// uno script di shell con i valori copiati a mano: prima di questa funzione ogni
// aggiornamento del codice richiedeva rincollare i secret giusti a mano in un
// redeploy5.sh, un tenant alla volta o tutti insieme senza vie di mezzo — fragile
// (un typo rompe i token di sessione di quel tenant) e non mirato (non si poteva
// aggiornare SOLO un tenant urgente senza toccare gli altri, né propagare a TUTTI
// in un giro batch pensato per la notte, quando 100 tenant non sono un'eccezione).
//
// Guardia sessione attiva: prima di riavviare, controlla se qualcuno ha usato il
// tenant negli ultimi 3 minuti (tabella 'sessions' del suo .db, stesso accesso
// diretto readonly di /:slug/sessions) — un riavvio interrompe chi lo sta usando
// in quel momento. Blocca a meno di force:true. Ritorna un risultato tipizzato
// invece di scrivere su `res` — così sia la route singola sia quella bulk (sotto)
// possono riusarla senza duplicare la logica di ricreazione container.
async function redeployTenant(tenant, { force, actor, log }) {
  const say = (m) => { try { if (log) log(m) } catch (e) { /* un log non deve mai fermare l'aggiornamento */ } }
  say('Controllo se qualcuno sta usando "' + tenant.name + '"…')
  if (!force && fs.existsSync(tenant.db_path)) {
    let tdb;
    try {
      tdb = new Database(tenant.db_path, { readonly: true, fileMustExist: true });
      // last_active_at, non last_seen_at: quest'ultimo si aggiorna anche col solo
      // polling passivo (campanella notifiche ogni 30s) — una tab dimenticata aperta
      // sembrerebbe sempre "attiva ora" altrimenti. Vedi core/backend/src/routes/auth.js.
      const recent = tdb.prepare("SELECT username, last_active_at FROM sessions WHERE last_active_at >= datetime('now', '-3 minutes') ORDER BY last_active_at DESC LIMIT 1").get();
      if (recent) {
        say('Sessione attiva: ' + recent.username + ' (ultima azione ' + recent.last_active_at + ' UTC). Mi fermo.')
        return { ok: false, skipped: 'active_session', active_session: recent };
      }
      say('Nessuna sessione attiva negli ultimi 3 minuti.')
    } catch (e) {
      // Tabella 'sessions' non ancora presente (tenant mai riavviato dopo
      // l'introduzione del log accessi) — nessun blocco, nulla da rilevare.
    } finally {
      if (tdb) tdb.close();
    }
  }

  // Stop+remove del vecchio container e ricreazione con l'ultima immagine
  // avvengono ATOMICAMENTE dentro il docker-provisioner (un solo endpoint), non
  // più come due passi separati da qui — stesso comportamento (container già
  // assente/non trovato non blocca la ricreazione), solo spostato.
  say(force ? 'Aggiornamento forzato: eventuali utenti collegati vengono scollegati.' : 'Via libera.')
  say('Fermo il vecchio container, lo rimuovo e ne creo uno nuovo con l\'ultima immagine (stessi dati)…')
  await provisionerRequest('POST', '/tenants/' + tenant.slug + '/redeploy', {
    port: tenant.port,
    env: [
      'PORT=3000',
      // NON tenant.db_path: quella colonna è la vista di SUPER ADMIN sul dato
      // (include la sottocartella del tenant, vedi createTenant più sopra), il
      // container deve sempre e solo vedere '/data/<slug>.db' dentro il proprio
      // /data scoped. Ricostruito qui, mai riletto dalla colonna — il punto più
      // delicato di tutta la migrazione al volume per-tenant (26/10/2026): un
      // redeploy che rimandasse la colonna grezza cercherebbe il database nel
      // posto sbagliato e non lo troverebbe, in silenzio.
      'DB_PATH=/data/' + tenant.slug + '.db',
      'JWT_SECRET=' + tenant.jwt_secret,
      'TENANT_SLUG=' + tenant.slug,
      'TENANT_NAME=' + tenant.name,
      'ENCRYPTION_KEY=' + tenant.encryption_key,
      'INTERNAL_API_SECRET=' + internalSecret(),
      'SUPER_ADMIN_URL=' + (process.env.SUPER_ADMIN_INTERNAL_URL || 'http://super-admin-backend:3000'),
      ...(process.env.REDIS_URL ? ['REDIS_URL=' + process.env.REDIS_URL] : []),
    ],
  });

  say('Nuovo container creato.')
  db.prepare('UPDATE tenants SET status = ? WHERE slug = ?').run('active', tenant.slug);
  logAudit(actor || 'system', 'tenant.redeploy', tenant.slug, { forced: !!force });
  // Con un log attivo (popup di Super Admin) aspetto che il tenant risponda davvero, così "AGGIORNATO" vuol dire che è su e non solo che il container è partito.
  if (log) {
    say('Attendo che il tenant risponda…')
    let up = false
    for (let i = 0; i < 40 && !up; i++) {
      await new Promise((r) => setTimeout(r, 1500))
      try { const r = await fetch('http://platform-' + tenant.slug + ':80/api/tenant-info', { signal: AbortSignal.timeout(3000) }); up = r.ok } catch (e) { /* ancora in avvio */ }
    }
    if (!up) { say('Il tenant non risponde entro 60 secondi: controlla nei Dettagli.'); return { ok: true, healthy: false } }
    say('Il tenant risponde correttamente.')
  }
  return { ok: true, healthy: true };
}

router.post('/:slug/redeploy', requireAuth, requireTenantScope, async (req, res) => {
  const { slug } = req.params;
  const force = !!(req.body && req.body.force);
  // ?stream=1: una riga JSON per ogni passo (popup di avanzamento in Super Admin), poi una riga finale {done:true,...}.
  if (req.query.stream === '1') {
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    const send = (o) => { try { res.write(JSON.stringify(o) + '\n') } catch (e) { /* client chiuso */ } };
    // Battito ogni 20s senza "msg" (il popup in TenantsPage.jsx mostra una riga solo
    // se o.msg è presente, quindi non sporca la lista) — scoperto dal vivo (26/10/2026)
    // che la build e l'attesa "il tenant risponde" possono restare silenziose per
    // diversi minuti: Cloudflare chiude da sé una connessione proxy inattiva intorno ai
    // 100s, il client vede "Errore di rete: Load failed" anche se il redeploy sul
    // server prosegue e finisce comunque. Scrivere byte regolarmente tiene viva la
    // connessione end-to-end senza dover inseguire i tempi esatti di ogni passo.
    const heartbeat = setInterval(() => send({ at: new Date().toISOString() }), 20000);
    try {
      await buildCoreImage({ log: (msg) => send({ msg, at: new Date().toISOString() }) });
      const result = await redeployTenant(req.tenant, { force, actor: req.user.username, log: (msg) => send({ msg, at: new Date().toISOString() }) });
      if (result.ok) syncNginxDomains().catch(() => {});
      send({ done: true, ok: !!result.ok, healthy: result.healthy, skipped: result.skipped, active_session: result.active_session });
    } catch (err) {
      send({ msg: 'Errore: ' + err.message, at: new Date().toISOString() });
      send({ done: true, ok: false, error: err.message });
    } finally {
      clearInterval(heartbeat);
    }
    return res.end();
  }
  try {
    const tenant = req.tenant;
    await buildCoreImage();
    const result = await redeployTenant(tenant, { force, actor: req.user.username });
    if (!result.ok) {
      return res.status(409).json({
        error: 'Sessione attiva rilevata (' + result.active_session.username + ', ultima azione ' + result.active_session.last_active_at + ' UTC) — riprova più tardi o ripeti con force:true',
        active_session: result.active_session,
      });
    }
    syncNginxDomains().catch(() => {});
    res.json({ status: 'redeployed' });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Propaga l'ultima immagine a TUTTI i tenant attivi CHE NON LO HANNO ESCLUSO — non
// un "aggiorna tutti" indiscriminato: un tenant con auto_update_enabled=0 (es.
// pinnato a una versione, o ospitato altrove) resta fuori dal giro e compare nei
// risultati come 'auto_update_disabled', non semplicemente ignorato in silenzio.
// Pensato per il batch notturno: si prepara e verifica l'aggiornamento su un
// tenant di prova durante il giorno (via /:slug/redeploy sopra, che IGNORA questo
// flag di proposito — è sempre un'azione esplicita), poi si lancia questo a
// orario concordato. Sequenziale (non in parallelo) per non sovraccaricare
// l'host con N container che ripartono nello stesso istante; un tenant con
// sessione attiva viene SALTATO (non forzato) e segnalato nel risultato, non
// blocca gli altri. Nessuno scheduler automatico qui dentro — resta un'azione
// esplicita, lanciata quando si decide che è il momento giusto.
router.post('/redeploy-all', requireAuth, async (req, res) => {
  const force = !!(req.body && req.body.force);
  // Bug reale segnalato dall'utente (2026-08-28): questa query includeva anche i
  // tenant sandbox, mentre GET / li esclude sempre — risultato osservato: "3
  // tenant aggiornati su 3" nel messaggio di esito, ma solo 2 visibili nella
  // lista sotto. Stesso filtro di GET / ora.
  const allTenants = db.prepare("SELECT * FROM tenants WHERE status != 'deleted' AND (is_sandbox = 0 OR is_sandbox IS NULL)").all();
  try {
    await buildCoreImage();
  } catch (err) {
    return res.status(500).json({ error: 'Build dell\'immagine fallita, nessun tenant toccato: ' + err.message });
  }
  const results = [];
  for (const tenant of allTenants) {
    if (!tenant.auto_update_enabled) {
      results.push({ slug: tenant.slug, ok: false, skipped: 'auto_update_disabled' });
      continue;
    }
    try {
      const result = await redeployTenant(tenant, { force, actor: req.user.username });
      results.push({ slug: tenant.slug, ok: result.ok, skipped: result.skipped || null, active_session: result.active_session || null });
    } catch (err) {
      results.push({ slug: tenant.slug, ok: false, error: err.message });
    }
  }
  syncNginxDomains().catch(() => {});
  logAudit(req.user.username, 'tenant.redeploy_all', null, { count: allTenants.length, results });
  res.json({ results });
});

// Elimina tenant
// Estratta a parte (2026-09-11) — prima viveva solo dentro la route DELETE,
// ora riusata anche dallo smaltimento automatico del sandbox di Super
// Builder dopo il rilascio di un modulo (vedi registry.js /release):
// stessa identica procedura, nessuna scorciatoia diversa per il sandbox.
async function deleteTenantBySlug(slug, actor) {
  const tenant = db.prepare('SELECT * FROM tenants WHERE slug = ?').get(slug);

  // Rete di sicurezza: backup del .db PRIMA di procedere con l'eliminazione reale.
  // Non bloccante — se il backup fallisce (es. .db già corrotto o assente) si procede
  // comunque con l'eliminazione, altrimenti un tenant già rotto diventerebbe impossibile
  // da eliminare. L'esito del backup viene comunque loggato e restituito nella risposta,
  // così chi elimina sa se la rete di sicurezza ha funzionato o no.
  let safetyBackup = { ok: false, skipped: true };
  if (tenant && fs.existsSync(tenant.db_path)) {
    safetyBackup = await runBackupForTenant(slug, { trigger: 'pre-delete', actor });
  }

  await fetch(PROVISIONER_URL + '/tenants/' + slug, { method: 'DELETE', headers: provisionerHeaders }).catch(() => {});
  // Il container viene rimosso, ma il file .db vive sul volume condiviso
  // (platform_platform-data) e sopravvive alla rimozione del container — finora
  // restava lì per sempre. Se poi si ricreava un tenant con lo stesso slug, il nuovo
  // container si riconnetteva al vecchio database invece di ripartire pulito: è
  // probabilmente la causa di più di un "non vedo i cambiamenti" di questa sessione.
  // Dal 26/10/2026 il .db (+ -wal/-shm) e la cartella upload del tenant stanno
  // nella sua stessa sottocartella per-tenant del volume (vedi tenantHostConfig
  // in docker-provisioner) — rimuoverla tutta intera invece di un unlink del
  // solo .db e un rm separato della vecchia cartella upload piatta copre
  // entrambi insieme, senza lasciare nulla orfano.
  if (tenant && tenant.db_path) {
    try { fs.rmSync(path.dirname(tenant.db_path), { recursive: true, force: true }); } catch (e) {} // già assente: va bene così
  }
  // Rimuove anche il record DNS Cloudflare, se questo tenant ne aveva uno assegnato
  // in automatico (vedi cloudflare.js) — best effort, un tenant senza sottodominio
  // nostro (dominio custom del cliente) semplicemente non ha nulla da rimuovere.
  if (tenant && tenant.domain && tenant.domain.endsWith('.' + cloudflare.zoneName())) {
    // Etichetta ricavata dal dominio REALE del tenant, non dal suo slug —
    // un dominio assegnato a mano (PATCH /:slug/domain) può non coincidere
    // con lo slug, quindi non si può ricostruirlo al volo.
    const label = tenant.domain.slice(0, -('.' + cloudflare.zoneName()).length);
    try { await cloudflare.deleteSubdomain(label); } catch (e) {}
  }
  db.prepare('DELETE FROM tenants WHERE slug = ?').run(slug);
  logAudit(actor, 'tenant.delete', slug, { safety_backup: safetyBackup.ok ? safetyBackup.file : null });
  syncNginxDomains().catch(() => {});
  return { ok: true, safety_backup: safetyBackup };
}

router.delete('/:slug', requireAuth, requireTenantScope, async (req, res) => {
  try {
    const result = await deleteTenantBySlug(req.params.slug, req.user.username);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Dettaglio consumi live del tenant (CPU, RAM, rete, dimensione DB)
// Moduli REALI installati su questo tenant, per categoria (group_name della
// sidebar) — vedi lib/module-stats.js. category null = "senza categoria"
// (molti tenant, es. Finance e Retail, non hanno mai valorizzato i gruppi
// sidebar — mostrato così com'è, non nascosto né inventato).
router.get('/:slug/module-stats', requireAuth, requireTenantScope, async (req, res) => {
  res.json(await moduleStatsForTenant(req.params.slug));
});

router.get('/:slug/stats', requireAuth, requireTenantScope, async (req, res) => {
  const { slug } = req.params;
  const tenant = req.tenant;

  // Dimensione reale del file .db — leggibile anche a container fermo
  let db_size_mb = null;
  try {
    const st = fs.statSync(tenant.db_path);
    db_size_mb = Math.round((st.size / 1024 / 1024) * 100) / 100;
  } catch (e) {
    db_size_mb = null; // file non ancora creato, es. tenant appena provisionato
  }

  try {
    const info = await provisionerRequest('GET', '/tenants/' + slug + '/inspect');

    if (!info.State.Running) {
      return res.json({
        status: info.State.Status,
        running: false,
        db_size_mb,
        cpu_percent: null,
        mem_usage_mb: null,
        mem_limit_mb: null,
        mem_percent: null,
        net_rx_mb: null,
        net_tx_mb: null,
        started_at: null,
      });
    }

    const stats = await provisionerRequest('GET', '/tenants/' + slug + '/stats');

    const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
    const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
    const cpuCount = (stats.cpu_stats.cpu_usage.percpu_usage || []).length || 1;
    const cpuPercent = systemDelta > 0 && cpuDelta > 0 ? (cpuDelta / systemDelta) * cpuCount * 100 : 0;

    const memUsage = stats.memory_stats.usage || 0;
    const memLimit = stats.memory_stats.limit || 0;
    const memPercent = memLimit ? (memUsage / memLimit) * 100 : 0;

    const nets = stats.networks || {};
    const netRx = Object.values(nets).reduce((s, n) => s + (n.rx_bytes || 0), 0);
    const netTx = Object.values(nets).reduce((s, n) => s + (n.tx_bytes || 0), 0);

    res.json({
      status: info.State.Status,
      running: true,
      db_size_mb,
      cpu_percent: Math.round(cpuPercent * 10) / 10,
      mem_usage_mb: Math.round(memUsage / 1024 / 1024),
      mem_limit_mb: memLimit ? Math.round(memLimit / 1024 / 1024) : null,
      mem_percent: Math.round(memPercent * 10) / 10,
      net_rx_mb: Math.round((netRx / 1024 / 1024) * 100) / 100,
      net_tx_mb: Math.round((netTx / 1024 / 1024) * 100) / 100,
      started_at: info.State.StartedAt,
    });
  } catch (err) {
    res.status(500).json({ error: err.message, db_size_mb });
  }
});

// Assegna/aggiorna il dominio del tenant. Per ora è SOLO tracciamento nel DB —
// nessuna chiamata reale a Cloudflare/Certbot ancora (richiede le credenziali API
// e la scelta se una VM per tenant o una VM condivisa per gruppo di verticali,
// vedi § Platform_0_1 su "1 VM per tenant"/roadmap raggruppamento per verticale).
// Preparare il campo ora evita di dover fare una migrazione dati più avanti,
// quando il provisioning reale del dominio sarà deciso.
router.patch('/:slug/domain', requireAuth, requireTenantScope, async (req, res) => {
  const { slug } = req.params;
  const { domain } = req.body;
  const cleanDomain = domain ? String(domain).trim().toLowerCase() : null;
  db.prepare('UPDATE tenants SET domain = ? WHERE slug = ?').run(cleanDomain, slug);

  // Se il dominio assegnato è un nostro sottodominio (<slug>.platform-core.it),
  // tiene allineato anche il record DNS Cloudflare — un dominio custom del
  // cliente invece non tocca Cloudflare, non è nella nostra zona.
  let cloudflareResult = null;
  if (cleanDomain && cleanDomain.endsWith('.' + cloudflare.zoneName())) {
    const label = cleanDomain.slice(0, -('.' + cloudflare.zoneName()).length);
    try { cloudflareResult = await cloudflare.upsertSubdomain(label); } catch (e) { cloudflareResult = { error: e.message }; }
  }

  logAudit(req.user.username, 'tenant.domain.update', slug, { domain: cleanDomain, cloudflare: cloudflareResult });
  syncNginxDomains().catch(() => {});
  res.json({ ok: true, domain: cleanDomain, cloudflare: cloudflareResult });
});

// Backup manuale del .db del tenant, via l'API nativa di better-sqlite3 (VACUUM
// INTO, consistente anche a container attivo — non un semplice cp del file, che
// rischierebbe una copia a metà scrittura). Il file finisce sotto
// /data/backups/<slug>/, sullo stesso volume condiviso. Nessuna pianificazione
// automatica ancora: va innescato a mano da qui, o da uno scheduler esterno che
// chiami questo stesso endpoint (es. cron su un job che fa una POST autenticata).
router.post('/:slug/backup', requireAuth, requireTenantScope, async (req, res) => {
  const { slug } = req.params;

  const result = await runBackupForTenant(slug, { trigger: 'manual', actor: req.user.username });
  if (result.ok) res.json(result);
  else res.status(500).json(result);
});

// Configurazione backup automatico per il tenant — on/off, frequenza, quanti tenere.
// Letta/scritta qui, ma pensata per essere esposta nella futura sezione Impostazioni
// del tenant (dominio + licenza + backup + notifiche in un unico posto).
router.get('/:slug/backup-settings', requireAuth, requireTenantScope, (req, res) => {
  const tenant = req.tenant;
  res.json({
    backup_auto_enabled: !!tenant.backup_auto_enabled,
    backup_auto_frequency_hours: tenant.backup_auto_frequency_hours,
    backup_auto_retention: tenant.backup_auto_retention,
    // G18 — l'URL non è un segreto (nessuna credenziale al suo interno, per design:
    // quelle vivono cifrate in backup_offsite_credentials), va bene restituirlo così
    // com'è perché la UI possa mostrarlo/modificarlo. Le credenziali NON vengono mai
    // restituite né in chiaro né cifrate — solo se sono presenti o no, stesso
    // principio di mascheramento già in uso altrove nel progetto per i segreti.
    backup_offsite_url: tenant.backup_offsite_url || null,
    backup_offsite_credentials_configured: !!tenant.backup_offsite_credentials,
    // Backup settimanale via mail: acceso, ultimo invio e se la posta di Super Admin è configurata (la passphrase non si restituisce qui)
    backup_mail_weekly: !!tenant.backup_mail_weekly,
    backup_mail_last_sent: tenant.backup_mail_last_sent || null,
    backup_mail_smtp_ready: !!(process.env.SMTP_HOST && process.env.NOTIFY_EMAIL_TO),
  });
});

// Backup settimanale via mail: accendi/spegni, invio di prova, e la passphrase che cifra l'allegato (la lettura è registrata nel log attività).
const weeklyMail = require('../weekly-backup-mail');
router.put('/:slug/backup-mail', requireAuth, requireTenantScope, (req, res) => {
  const t = weeklyMail.setEnabled(req.params.slug, !!(req.body && req.body.enabled));
  if (!t) return res.status(404).json({ error: 'Tenant non trovato' });
  logAudit(req.user.username, 'tenant.backup_mail.' + (t.backup_mail_weekly ? 'on' : 'off'), req.params.slug, null);
  res.json({ backup_mail_weekly: !!t.backup_mail_weekly, backup_mail_last_sent: t.backup_mail_last_sent || null });
});
router.post('/:slug/backup-mail/send-now', requireAuth, requireTenantScope, async (req, res) => {
  const r = await weeklyMail.sendNow(req.params.slug, { actor: req.user.username });
  res.status(r.ok ? 200 : 502).json(r);
});
router.post('/:slug/backup-mail/passphrase', requireAuth, requireTenantScope, (req, res) => {
  const p = weeklyMail.getPassphrase(req.tenant);
  if (!p) return res.status(404).json({ error: 'Backup via mail non ancora attivo.' });
  logAudit(req.user.username, 'tenant.backup_mail.passphrase_view', req.params.slug, null);
  res.json({ passphrase: p });
});

router.patch('/:slug/backup-settings', requireAuth, requireTenantScope, (req, res) => {
  const { slug } = req.params;
  const tenant = req.tenant;

  const enabled = req.body.backup_auto_enabled != null ? (req.body.backup_auto_enabled ? 1 : 0) : tenant.backup_auto_enabled;
  const freq = req.body.backup_auto_frequency_hours != null ? Math.max(1, parseInt(req.body.backup_auto_frequency_hours, 10) || 24) : tenant.backup_auto_frequency_hours;
  const retention = req.body.backup_auto_retention != null ? Math.max(1, parseInt(req.body.backup_auto_retention, 10) || 7) : tenant.backup_auto_retention;

  // G18 — backup_offsite_url: stringa vuota o null disattiva esplicitamente
  // l'off-site (un solo campo, mai un toggle separato che potrebbe disallinearsi
  // dall'URL — vedi offsite-backup.js). undefined (campo assente dal body) lascia
  // invariato quello che c'è già, stesso pattern degli altri campi qui sopra.
  const offsiteUrl = req.body.backup_offsite_url !== undefined ? (req.body.backup_offsite_url || null) : tenant.backup_offsite_url;
  // backup_offsite_credentials: se il body lo manda, sostituisce interamente quello
  // salvato (mai un merge parziale — evita di lasciare in giro chiavi vecchie di
  // uno schema di destinazione precedente); {} esplicito o null lo azzera.
  let offsiteCredentials = tenant.backup_offsite_credentials;
  if (req.body.backup_offsite_credentials !== undefined) {
    const creds = req.body.backup_offsite_credentials;
    offsiteCredentials = (creds && Object.keys(creds).length > 0) ? encryptSecret(JSON.stringify(creds)) : null;
  }

  db.prepare('UPDATE tenants SET backup_auto_enabled = ?, backup_auto_frequency_hours = ?, backup_auto_retention = ?, backup_offsite_url = ?, backup_offsite_credentials = ? WHERE slug = ?')
    .run(enabled, freq, retention, offsiteUrl, offsiteCredentials, slug);
  logAudit(req.user.username, 'tenant.backup_settings.update', slug, { enabled, freq, retention, offsite_url: offsiteUrl, offsite_credentials_configured: !!offsiteCredentials });
  res.json({
    ok: true,
    backup_auto_enabled: !!enabled,
    backup_auto_frequency_hours: freq,
    backup_auto_retention: retention,
    backup_offsite_url: offsiteUrl,
    backup_offsite_credentials_configured: !!offsiteCredentials,
  });
});

// Token admin per il Builder integrato: chiede al tenant stesso di firmare un
// token (endpoint interno protetto da INTERNAL_API_SECRET, rete Docker interna,
// mai esposto fuori) — Super Admin non conosce mai il JWT_SECRET del tenant,
// coerente col fatto che ora è random per-tenant (vedi createTenant sopra).
// Nota: qui si chiama il tenant sul suo hostname Docker interno (raggiungibile
// da questo backend); il frontend però deve chiamare l'API del tenant da FUORI
// Docker (dal browser), quindi costruisce da sé l'URL pubblico usando la stessa
// logica già in uso per il link "Apri →" (host corrente + porta del tenant) —
// questo endpoint restituisce solo il token, mai un URL Docker-interno che nel
// browser non risolverebbe.
// Estratta a parte (2026-08-16) così anche routes/registry.js può ottenere un
// token admin per un tenant (installazione manuale di un modulo, bypass Store)
// senza un secondo giro HTTP verso se stesso — stesso pattern già in uso per
// ensureSandbox (super-builder.js), esportata e richiesta da chi la usa.
// credentials opzionale ({username, password}) — se presente chiama
// /internal-login (verifica bcrypt vera contro QUEL tenant) invece di
// /internal-token (primo admin, nessuna credenziale). Vedi open-session sotto.
async function mintTenantAdminToken(slug, credentials) {
  const path = credentials ? '/api/auth/internal-login' : '/api/auth/internal-token';
  const r = await fetch('http://platform-' + slug + ':80' + path, {
    method: 'POST',
    headers: {
      'x-internal-secret': internalSecret(),
      'Content-Type': 'application/json',
    },
    body: credentials ? JSON.stringify(credentials) : undefined,
  });
  const data = await r.json();
  if (!r.ok) throw Object.assign(new Error(data.error || 'Il tenant ha rifiutato la richiesta di token'), { status: credentials ? 400 : 502 });
  return data.token;
}

// Proxy "Apri →" per un tenant SENZA dominio ancora assegnato (appena creato, o
// un sandbox che non ne avrà mai uno) — introdotto il 26/10/2026 insieme alla
// chiusura delle porte tenant pubblicate sull'host (vedi tenantHostConfig in
// docker-provisioner): prima il link apriva direttamente host:porta dal browser
// dell'admin, bypassando nginx/Cloudflare; ora quella porta non è più
// raggiungibile da fuori Docker, quindi questo endpoint fa da tramite sulla
// rete interna (Super Admin ci è già sopra) — stesso principio di
// mintTenantAdminToken sopra (fetch diretto a 'http://platform-<slug>:80'),
// solo che qui si inoltra una richiesta GENERICA, non una chiamata API fissa.
// Nessuna lettura di contenuto da parte di Super Admin: i byte passano, non
// vengono interpretati — stesso principio dei bridge già esistenti
// (open-session sopra), Super Admin non deve mai leggere cosa c'è dentro.
router.all('/:slug/preview/*', requireAuth, requireTenantScope, async (req, res) => {
  const suffix = req.params[0] || '';
  const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  const target = 'http://platform-' + req.tenant.slug + ':80/' + suffix + qs;
  const forwardHeaders = Object.assign({}, req.headers);
  delete forwardHeaders.host;
  delete forwardHeaders['content-length'];
  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers: forwardHeaders,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body || {}),
    });
    res.status(upstream.status);
    const ct = upstream.headers.get('content-type');
    if (ct) res.setHeader('content-type', ct);
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.send(buf);
  } catch (e) {
    res.status(502).json({ error: 'Tenant non raggiungibile (container fermo?)' });
  }
});

router.post('/:slug/builder-token', requireAuth, requireTenantScope, async (req, res) => {
  const tenant = req.tenant;
  try {
    const token = await mintTenantAdminToken(tenant.slug);
    logAudit(req.user.username, 'tenant.builder_token_minted', tenant.slug, null);
    res.json({ token });
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message || 'Tenant non raggiungibile (container fermo?)' });
  }
});

// "Apri →" da TenantsPage.jsx — login reale come admin del tenant, non solo
// l'uso interno del Builder (vedi /builder-token sopra, lasciato invariato per
// non introdurre un prompt credenziali ad ogni apertura del pannello Builder,
// usato molto più di frequente e già dentro una sessione Core/Partner valida).
//
// Vera esclusione richiesta esplicitamente dall'utente (2026-08-30, dopo aver
// usato il Partner Portal reale): non basta ri-confermare la PROPRIA password
// (versione precedente di questa route, step-up su users.stepup_until) — serve
// conoscere le credenziali admin DI QUEL TENANT specifico. Se il Partner non le
// conosce (es. il cliente le ha cambiate), non entra: nessuna scorciatoia.
// {username, password} arrivano nel body e vengono verificati dal tenant
// stesso via bcrypt (mintTenantAdminToken → /internal-login, vedi sopra), mai
// confrontati qui — Super Admin non legge né conserva mai una password di
// tenant. 400 (non 401) su credenziali sbagliate, stesso motivo già in uso
// altrove in questo file: un 401 sul dominio di Super Admin scatena il logout
// globale via lib/api.js, e una password del TENANT sbagliata non invalida
// affatto la sessione di chi sta operando.
router.post('/:slug/open-session', requireAuth, requireTenantScope, async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username e password del tenant sono obbligatori' });
  const tenant = req.tenant;
  try {
    const token = await mintTenantAdminToken(tenant.slug, { username, password });
    logAudit(req.user.username, 'tenant.admin_login_as', tenant.slug, { as_username: username });
    res.json({ token });
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message || 'Tenant non raggiungibile (container fermo?)' });
  }
});

// Elenco backup fatti per un tenant (sopravvivono anche se il tenant viene
// eliminato — restano su /data/backups/ finché non li cancella qualcuno a mano,
// nessuna retention automatica per ora, dichiarato non nascosto).
router.get('/:slug/backups', requireAuth, requireTenantScope, (req, res) => {
  const rows = db.prepare('SELECT * FROM tenant_backups WHERE tenant_slug = ? ORDER BY created_at DESC').all(req.params.slug);
  res.json(rows);
});

// Portabilità/esportazione dei dati (GDPR): un backup esiste già per ogni tenant (vedi
// sopra), ma finora non c'era modo di scaricarlo — solo di elencarlo o usarlo per un
// ripristino interno. Il .db SQLite del tenant È l'export strutturato/portabile (è
// esattamente lo schema+dati reali, non serve reinventare un formato JSON parallelo).
// Auth via query string (?token=), stesso pattern di /update-manager/export: un <a href>
// di download normale non può mandare l'header Authorization.
router.get('/:slug/backups/:backupId/download', requireQueryToken, (req, res) => {
  const backup = db.prepare('SELECT * FROM tenant_backups WHERE id = ? AND tenant_slug = ?').get(req.params.backupId, req.params.slug);
  if (!backup || backup.status !== 'ok') return res.status(404).json({ error: 'Backup non trovato' });
  if (!fs.existsSync(backup.file_path)) return res.status(404).json({ error: 'File di backup non più presente su disco' });
  res.download(backup.file_path, req.params.slug + '_' + backup.created_at.replace(/[:\s]/g, '-') + '.db');
});

// Log accessi del tenant: username/data/durata, letto direttamente dalla tabella
// `sessions` del .db del tenant (stesso accesso diretto readonly già usato da
// waitForTenantDb) — nessuna API interna nuova sul lato tenant, coerente con come
// Super Admin legge già dati tenant-side per backup/clonazione moduli.
router.get('/:slug/sessions', requireAuth, requireTenantScope, (req, res) => {
  const tenant = req.tenant;
  if (!fs.existsSync(tenant.db_path)) return res.json([]);
  let tdb;
  try {
    tdb = new Database(tenant.db_path, { readonly: true, fileMustExist: true });
    const rows = tdb.prepare('SELECT id, username, login_at, last_seen_at, revoked_at FROM sessions ORDER BY login_at DESC LIMIT 100').all();
    res.json(rows);
  } catch (e) {
    // tabella non ancora presente (tenant creato prima di questa feature, mai
    // riavviato) — nessun errore rumoroso, semplicemente nessun accesso registrato
    res.json([]);
  } finally {
    if (tdb) tdb.close();
  }
});

// Stato "attivo ora" di TUTTI i tenant in una chiamata sola — pensato per il
// bollino sulla lista principale (non nascosto sotto "Dettagli" come lo storico
// accessi completo): un tenant con almeno una sessione vista negli ultimi N
// minuti (default 5) risulta attivo. Una query per tenant, ma tutte in un solo
// giro di rete dal frontend invece di N chiamate — importante quando i tenant
// diventano tanti.
router.get('/active-sessions', requireAuth, (req, res) => {
  const minutes = Math.max(1, parseInt(req.query.minutes, 10) || 5);
  const tenants = db.prepare("SELECT slug, db_path FROM tenants WHERE status != 'deleted'").all();
  const result = {};
  tenants.forEach((t) => {
    result[t.slug] = null;
    if (!fs.existsSync(t.db_path)) return;
    let tdb;
    try {
      tdb = new Database(t.db_path, { readonly: true, fileMustExist: true });
      // last_active_at, non last_seen_at — vedi commento in redeployTenant sopra.
      result[t.slug] = tdb.prepare("SELECT username, last_active_at FROM sessions WHERE revoked_at IS NULL AND last_active_at >= datetime('now', ?) ORDER BY last_active_at DESC LIMIT 1").get('-' + minutes + ' minutes') || null;
    } catch (e) {
      // tabella non ancora presente — nessuna sessione attiva rilevabile, non un errore
    } finally {
      if (tdb) tdb.close();
    }
  });
  res.json(result);
});

// Logout remoto: marca la sessione come revocata direttamente sul .db del tenant
// (stesso accesso diretto già usato per leggere le sessioni sopra, stavolta in
// scrittura) — requireAuth in core/backend la controlla ad OGNI richiesta
// autenticata, non solo al login, quindi il token smette di funzionare alla
// primissima chiamata successiva dell'utente, non aspetta le 24h di scadenza
// naturale. Richiede un tenant già aggiornato con la colonna revoked_at (core
// da questa versione in poi) — se la colonna non esiste ancora, fallisce con un
// errore chiaro invece di un errore SQL criptico.
router.post('/:slug/sessions/:sid/revoke', requireAuth, requireTenantScope, (req, res) => {
  const tenant = req.tenant;
  let tdb;
  try {
    tdb = new Database(tenant.db_path, { fileMustExist: true });
    const info = tdb.prepare('UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP WHERE id = ? AND revoked_at IS NULL').run(req.params.sid);
    logAudit(req.user.username, 'tenant.session_revoke', req.params.slug, { sid: req.params.sid, changed: info.changes });
    res.json({ ok: true, changed: info.changes });
  } catch (err) {
    res.status(500).json({ error: 'Impossibile revocare (tenant non ancora aggiornato con l\'ultima immagine?): ' + err.message });
  } finally {
    if (tdb) tdb.close();
  }
});

// Ripristina il .db del tenant da un backup precedente. Ferma il container (se
// attivo) prima di sovrascrivere il file — copiare sopra un database mentre il
// container ci scrive sarebbe la stessa classe di rischio già evitata nel backup
// con VACUUM INTO, qui però stiamo scrivendo, non solo leggendo, quindi non basta
// un readonly: va fermato per davvero. Prima di sovrascrivere, salva a sua volta
// una copia dello stato attuale ("pre-restore") — così un ripristino sbagliato
// non è un vicolo cieco, è a sua volta annullabile.
router.post('/:slug/restore/:backupId', requireAuth, requireTenantScope, async (req, res) => {
  const { slug, backupId } = req.params;
  const tenant = req.tenant;
  const backup = db.prepare('SELECT * FROM tenant_backups WHERE id = ? AND tenant_slug = ?').get(backupId, slug);
  if (!backup || backup.status !== 'ok') return res.status(404).json({ error: 'Backup non trovato o non valido' });
  if (!fs.existsSync(backup.file_path)) return res.status(404).json({ error: 'Il file di questo backup non è più presente su disco' });

  let wasRunning = false;
  try {
    try {
      const info = await provisionerRequest('GET', '/tenants/' + slug + '/inspect');
      wasRunning = info.State.Running;
      if (wasRunning) await provisionerRequest('POST', '/tenants/' + slug + '/stop');
    } catch (e) {
      // container non trovato/già fermo — si ripristina comunque il file, non è
      // un errore bloccante per il restore in sé
    }

    const safetyDir = BACKUP_ROOT + '/' + slug;
    fs.mkdirSync(safetyDir, { recursive: true });
    const safetyPath = path.join(safetyDir, slug + '_pre-restore_' + Date.now() + '.db');
    if (fs.existsSync(tenant.db_path)) fs.copyFileSync(tenant.db_path, safetyPath);
    let safetySizeMb = null;
    try { safetySizeMb = Math.round((fs.statSync(safetyPath).size / 1024 / 1024) * 100) / 100; } catch (e) {}
    if (safetySizeMb != null) {
      db.prepare("INSERT INTO tenant_backups (tenant_slug, file_path, size_mb, status, trigger) VALUES (?, ?, ?, ?, 'pre-restore')").run(slug, safetyPath, safetySizeMb, 'ok');
    }

    fs.copyFileSync(backup.file_path, tenant.db_path);

    if (wasRunning) {
      await provisionerRequest('POST', '/tenants/' + slug + '/start');
      db.prepare('UPDATE tenants SET status = ? WHERE slug = ?').run('active', slug);
    }

    logAudit(req.user.username, 'tenant.restore', slug, { backup_id: backup.id, restored_from: backup.file_path, safety_copy: safetyPath });
    res.json({ ok: true, restarted: wasRunning });
  } catch (err) {
    // Se qualcosa fallisce a metà, prova comunque a far ripartire il container
    // con quello che c'è sul disco in questo momento, invece di lasciare il
    // tenant fermo e senza spiegazione.
    if (wasRunning) {
      try { await provisionerRequest('POST', '/tenants/' + slug + '/start'); db.prepare('UPDATE tenants SET status = ? WHERE slug = ?').run('active', slug); } catch (e) {}
    }
    res.status(500).json({ error: err.message });
  }
});

// categoria (2026-08-30, Fase 5/6) — testo libero, stessa route minima già
// vista per gli altri singoli campi di questo file (domain, ecc.).
router.patch('/:slug/categoria', requireAuth, requireTenantScope, (req, res) => {
  const categoria = (req.body.categoria || '').trim() || null;
  db.prepare('UPDATE tenants SET categoria = ? WHERE slug = ?').run(categoria, req.params.slug);
  logAudit(req.user.username, 'tenant.categoria.update', req.params.slug, { categoria });
  res.json({ ok: true, categoria });
});

// Invito per il PRIMO admin di un tenant (o per chiunque, con il ruolo che serve): crea un link monouso nel tenant (rotta interna) e, se richiesto e se c'è un dominio, lo spedisce per mail.
// Il link porta al tenant, dove la persona sceglie da sé utente e password: nessuna password gira. Resta valido 72 ore.
router.post('/:slug/invite', requireAuth, requireTenantScope, async (req, res) => {
  const tenant = db.prepare("SELECT * FROM tenants WHERE slug = ? AND status != 'deleted'").get(req.params.slug);
  if (!tenant) return res.status(404).json({ error: 'Tenant non trovato' });
  const { nome, email, invia_email: inviaEmail } = req.body || {};
  const role = ['admin', 'user'].includes(req.body && req.body.role) ? req.body.role : 'admin';
  let inv;
  try { inv = await require('../lib/tenant-api-client').callTenantAPI(tenant.slug, 'POST', '/api/internal-invite', { nome, email, role }); }
  catch (e) { return res.status(e.status || 502).json({ error: e.status === 400 ? e.message : 'Il tenant non risponde: è acceso?' }); }
  const link = tenant.domain ? 'https://' + tenant.domain + '/invito/' + inv.token : null;
  let mail = null;
  if (inviaEmail) {
    if (!email) mail = { sent: false, reason: 'Manca l\'indirizzo email.' };
    else if (!link) mail = { sent: false, reason: 'Questo tenant non ha un dominio: usa il link o i pulsanti WhatsApp/Telegram.' };
    else mail = await require('../notifier').sendInviteMail({ to: String(email), nome: String(nome || '').slice(0, 80), tenantName: tenant.name, link, ore: inv.ore });
  }
  logAudit(req.user.username, 'tenant.invite', tenant.slug, { role, email: !!email, mail: mail ? mail.sent : null });
  res.json({ token: inv.token, scade: inv.scade, ore: inv.ore, link, porta: tenant.port, mail });
});

// --- Credenziali ------------------------------------------------------------
// Genera una nuova password per l'utente 'admin' del tenant e la scrive
// direttamente nel suo .db — funziona anche se il tenant è fermo (manutenzione,
// licenza sospesa/scaduta), perché non passa dalla sua API ma dal file diretto,
// stesso meccanismo già usato per i backup. Vecchia password immediatamente
// invalidata (sovrascritta, non solo affiancata).
router.post('/:slug/reset-credentials', requireAuth, requireTenantScope, (req, res) => {
  const { slug } = req.params;
  const tenant = db.prepare('SELECT * FROM tenants WHERE slug = ?').get(slug);
  if (!tenant) return res.status(404).json({ error: 'Tenant non trovato' });
  if (!fs.existsSync(tenant.db_path)) return res.status(409).json({ error: 'Il database di questo tenant non è ancora pronto — riprova tra qualche secondo' });

  const newPassword = generatePassword();
  try {
    setTenantAdminPassword(tenant.db_path, newPassword);
  } catch (err) {
    return res.status(500).json({ error: 'Impossibile scrivere le nuove credenziali: ' + err.message });
  }
  logAudit(req.user.username, 'tenant.credentials.reset', slug, null);
  res.json({ username: 'admin', password: newPassword });
});

// Attiva/disattiva un tenant dalla propagazione di massa (/redeploy-all e lo
// scheduler notturno) — non tocca in alcun modo il redeploy mirato singolo, che
// resta sempre disponibile su qualunque tenant a prescindere da questo flag.
router.post('/:slug/auto-update', requireAuth, requireTenantScope, (req, res) => {
  const { slug } = req.params;
  const enabled = !!(req.body && req.body.enabled);
  const tenant = db.prepare('SELECT id FROM tenants WHERE slug = ?').get(slug);
  if (!tenant) return res.status(404).json({ error: 'Tenant non trovato' });
  db.prepare('UPDATE tenants SET auto_update_enabled = ? WHERE slug = ?').run(enabled ? 1 : 0, slug);
  logAudit(req.user.username, 'tenant.auto_update_toggle', slug, { enabled });
  res.json({ slug, auto_update_enabled: enabled });
});

module.exports = router;
module.exports.createTenant = createTenant;
module.exports.enqueueHostedCreation = enqueueHostedCreation;
module.exports.waitForTenantDb = waitForTenantDb;
module.exports.redeployTenant = redeployTenant;
module.exports.installModulesByIds = installModulesByIds;
module.exports.mintTenantAdminToken = mintTenantAdminToken;
module.exports.deleteTenantBySlug = deleteTenantBySlug;
module.exports.ensureTenantRunning = ensureTenantRunning;
