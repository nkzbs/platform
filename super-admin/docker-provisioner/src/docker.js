// G2 (PLATFORM-0.6-GAP-ANALYSIS.md) — unica istanza dockerode di tutta la
// piattaforma verso il socket reale. Ogni funzione qui corrisponde a UNA reale
// operazione già in uso oggi (spostata qui pari pari da nginx-domain-sync.js,
// license-scheduler.js, routes/tenants.js, routes/update-manager.js, tutti nel
// backend di Super Admin) — nessuna nuova capacità, solo isolamento di dove
// vive l'accesso al socket. Immagine/network/volume/restart-policy dei
// container tenant restano fissati QUI (non passabili dal chiamante) — è
// questo, insieme alla validazione dello slug sotto, la vera protezione:
// anche un chiamante compromesso può solo agire su un container "platform-<slug
// valido>", mai su nginx/redis/se stesso o su un'immagine arbitraria.
const Docker = require('dockerode');
const { execFile } = require('child_process');
const https = require('https');
const fs = require('fs');
const path = require('path');

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

const IMAGE_NAME = 'platform-core:latest';
const IMAGE_REPO = 'platform-core';

// Tarball HTTPS del branch main, non `git clone` (18/10, bug reale trovato dal
// vivo sul NAS): il seccomp del Docker Engine di Synology blocca la syscall
// getrandom() che git usa per i file temporanei di un clone ("unable to get
// random bytes", ENOSYS) — OpenSSL/Node invece ripiegano su /dev/urandom e non
// ne risentono, quindi un download HTTPS normale funziona dove git fallisce.
const SOURCE_TARBALL_URL = process.env.SOURCE_TARBALL_URL || 'https://codeload.github.com/nkzbs/platform/tar.gz/refs/heads/main';
const SRC_DIR = '/tmp/platform-core-src';
const SRC_TARBALL = '/tmp/platform-core-src.tar.gz';

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 1024 * 1024 * 20 }, (err, stdout, stderr) => {
      if (err) return reject(Object.assign(new Error((stderr || err.message).toString().trim()), { statusCode: 500 }));
      resolve(stdout.toString());
    });
  });
}

function download(url, destPath, redirectsLeft) {
  if (redirectsLeft === undefined) redirectsLeft = 5;
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close(); fs.unlink(destPath, () => {});
        if (redirectsLeft <= 0) return reject(new Error('Troppi redirect scaricando ' + url));
        return resolve(download(res.headers.location, destPath, redirectsLeft - 1));
      }
      if (res.statusCode !== 200) {
        file.close(); fs.unlink(destPath, () => {});
        return reject(new Error('Download sorgente fallito: HTTP ' + res.statusCode + ' da ' + url));
      }
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
      file.on('error', reject);
    }).on('error', (err) => { file.close(); fs.unlink(destPath, () => {}); reject(err); });
  });
}

// Stesso slug pattern già validato lato Super Admin alla creazione di un
// tenant — qui è la SECONDA barriera (mai l'unica): anche se un chiamante
// riuscisse a mandare uno slug malformato, non diventerebbe mai un nome
// container diverso da 'platform-<qualcosa che passa questo regex>'.
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

function containerName(slug) {
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) {
    throw Object.assign(new Error('Slug non valido: ' + slug), { statusCode: 400 });
  }
  return 'platform-' + slug;
}

// DATA_VOLUME/TENANT_NETWORK letti dall'ambiente DI QUESTO servizio (iniettati
// da docker-compose.yml), non dal chiamante: il chiamante manda solo `env`
// (l'array di variabili specifiche del tenant, che già assembla oggi), `port`
// e `slug`.
//
// Niente più `PortBindings` (26/10/2026, chiusura di un gap di sicurezza reale
// — docs/DECISIONI.md: "le porte dei tenant sono pubblicate sull'host: dalla
// rete di casa si raggiungono senza passare da nginx", quindi senza Cloudflare
// né le protezioni di platform-nginx davanti). platform-nginx instrada già per
// nome container sulla rete Docker interna (infra/nginx/nginx.conf, resolver
// 127.0.0.11; mappa generata da nginx-domain-sync.js, porta interna 80 fissa,
// mai la porta pubblicata) — togliere la pubblicazione non tocca il routing
// reale. `port` resta nella firma/nel record del tenant solo perché altri
// punti (collision-check in RegisterExistingModal, tenant-import) lo
// confrontano ancora; non viene più passato a Docker.
//
// `Binds` non è più l'intero volume condiviso (26/10/2026, stesso giro —
// prima ogni container tenant vedeva TUTTI gli altri tenant più il registro
// di Super Admin con le chiavi di ognuno: un container compromesso arrivava
// ovunque). Risolto il vero percorso host del volume (`docker volume
// inspect`, non assunto) e montata solo la sottocartella `/<slug>` di
// quel tenant — stesso principio di containerName() sopra: anche un
// chiamante compromesso agisce solo sulla propria fetta, mai su quella di
// un altro. Docker crea da sé la sottocartella host mancante (comportamento
// consolidato per una directory in Binds) — nessun mkdir esplicito qui.
async function tenantHostConfig(slug, port) {
  const volumeName = process.env.DATA_VOLUME || 'platform_platform-data';
  const vol = await docker.getVolume(volumeName).inspect();
  return {
    Binds: [vol.Mountpoint + '/' + slug + ':/data'],
    NetworkMode: process.env.TENANT_NETWORK || 'platform_platform',
    RestartPolicy: { Name: 'unless-stopped' },
  };
}

async function createTenantContainer(slug, { env, port }) {
  const name = containerName(slug);
  const container = await docker.createContainer({
    Image: IMAGE_NAME,
    name,
    Env: env,
    HostConfig: await tenantHostConfig(slug, port),
    ExposedPorts: { '80/tcp': {} },
  });
  await container.start();
  return { id: container.id, name };
}

async function stopTenant(slug) {
  await docker.getContainer(containerName(slug)).stop();
}

async function startTenant(slug) {
  await docker.getContainer(containerName(slug)).start();
}

// Best-effort, stesso comportamento di oggi (tenants.js: stop/remove ciascuno
// in un try/catch separato, mai bloccante se il container è già assente).
async function removeTenant(slug) {
  const container = docker.getContainer(containerName(slug));
  try { await container.stop(); } catch (e) { /* già fermo o assente */ }
  try { await container.remove(); } catch (e) { /* già assente */ }
}

// Ricostruisce platform-core:latest dal sorgente più recente del branch main
// su GitHub — stesso Dockerfile/contesto (radice del repo) di
// scripts/redeploy-nas.sh, solo eseguito qui invece che dal laptop dello
// sviluppatore via SSH. onLine(msg) riceve i messaggi per il popup di
// avanzamento in Super Admin: solo i 2-3 passaggi di sopra/sotto (scarico,
// costruisco, pronta), non più una riga per ogni passaggio del Dockerfile
// (~80 righe, "troppo verbose" — richiesto dall'utente il 24/10). Durante la
// costruzione (può durare oltre un minuto) l'icona che gira sull'ultima riga
// nel popup basta a dire "sta ancora lavorando", senza un log a fiumi.
// Solo per il log di avanzamento — se GitHub non risponde (rate limit
// anonimo, rete) il build prosegue comunque, non è mai bloccante.
function fetchLatestCommitShort() {
  return new Promise((resolve) => {
    const req = https.get('https://api.github.com/repos/nkzbs/platform/commits/main', {
      headers: { 'User-Agent': 'platform-docker-provisioner', Accept: 'application/vnd.github+json' },
      timeout: 5000,
    }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(body).sha.slice(0, 7)) } catch (e) { resolve(null) }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

async function buildCoreImage(onLine) {
  const say = (m) => { try { if (onLine) onLine(m) } catch (e) { /* un log non deve mai far fallire il build */ } };
  const commit = await fetchLatestCommitShort();
  say('Scarico il sorgente più recente' + (commit ? ' (commit ' + commit + ')' : '') + '…');
  await run('rm', ['-rf', SRC_DIR, SRC_TARBALL]);
  await download(SOURCE_TARBALL_URL, SRC_TARBALL);
  await run('mkdir', ['-p', SRC_DIR]);
  await run('tar', ['xzf', SRC_TARBALL, '-C', SRC_DIR]);
  // L'archivio GitHub (codeload) estrae tutto sotto un'unica cartella
  // 'platform-<branch>/' — il vero contesto di build è lì dentro, non SRC_DIR.
  const entries = fs.readdirSync(SRC_DIR);
  if (entries.length !== 1) throw new Error('Archivio sorgente inatteso: trovate ' + entries.length + ' cartelle invece di 1 (' + entries.join(', ') + ')');
  const buildContext = path.join(SRC_DIR, entries[0]);
  say('Sorgente scaricato ed estratto. Costruisco l\'immagine…');
  const stream = await docker.buildImage(
    { context: buildContext, src: ['core/Dockerfile', 'core', 'shared'] },
    { t: IMAGE_NAME, dockerfile: 'core/Dockerfile' }
  );
  // Non più un messaggio per ogni riga grezza di `docker build` (richiesto
  // dall'utente, "troppo verbose": erano ~80 righe — "Step 12/26", "--->
  // hash", "Using cache" — per un'immagine di 26 passaggi). Chi guarda
  // vuole sapere SE sta andando e SE è fallito, non il log del build:
  // i tre messaggi sopra/sotto restano i soli passaggi mostrati, un errore
  // vero interrompe comunque tutto (buildError sotto).
  let buildError = null;
  await new Promise((resolve, reject) => {
    docker.followProgress(stream, (err, res) => (err ? reject(err) : resolve(res)), (evt) => {
      if (evt.error) { buildError = evt.error; say('Errore: ' + evt.error); }
    });
  });
  if (buildError) throw Object.assign(new Error(buildError), { statusCode: 500 });
  say('Immagine ' + IMAGE_NAME + ' pronta' + (commit ? ' (commit ' + commit + ')' : '') + '.');
  return { commit: commit || null };
}

async function redeployTenant(slug, { env, port }) {
  const name = containerName(slug);
  try {
    const old = docker.getContainer(name);
    await old.stop().catch(() => {});
    await old.remove().catch(() => {});
  } catch (e) { /* container già assente/non trovato — si procede comunque */ }
  const container = await docker.createContainer({
    Image: IMAGE_NAME,
    name,
    Env: env,
    HostConfig: await tenantHostConfig(slug, port),
    ExposedPorts: { '80/tcp': {} },
  });
  await container.start();
  return { id: container.id, name };
}

async function inspectTenant(slug) {
  return docker.getContainer(containerName(slug)).inspect();
}

async function statsTenant(slug) {
  return docker.getContainer(containerName(slug)).stats({ stream: false });
}

// Stessa ricerca label-poi-fallback-nome di nginx-domain-sync.js, spostata pari
// pari (label docker-compose in locale, nome fisso 'platform-nginx' sul NAS
// dove nginx nasce da `docker run` diretto, non da compose).
async function reloadNginx() {
  let containers = await docker.listContainers({
    filters: JSON.stringify({ label: ['com.docker.compose.service=nginx'] }),
  });
  if (containers.length === 0) {
    containers = await docker.listContainers({
      filters: JSON.stringify({ name: ['platform-nginx'] }),
    });
  }
  if (containers.length === 0) {
    throw Object.assign(new Error('nginx container non trovato'), { statusCode: 404 });
  }
  await docker.getContainer(containers[0].Id).kill({ signal: 'SIGHUP' });
}

// `ref` è 'latest' o 'previous' — sempre nel repo fisso IMAGE_REPO, mai un repo
// scelto dal chiamante (stessa protezione di containerName sopra, qui per le
// immagini: non si può ispezionare/taggare un'immagine arbitraria del host).
function refToImage(ref) {
  if (ref !== 'latest' && ref !== 'previous') {
    throw Object.assign(new Error('ref immagine non valido: ' + ref), { statusCode: 400 });
  }
  return IMAGE_REPO + ':' + ref;
}

async function inspectImage(ref) {
  return docker.getImage(refToImage(ref)).inspect();
}

// `source` può essere un id/digest grezzo (es. il vecchio last_seen_image_id
// preservato come :previous) o un ref appena caricato da /images/import — mai
// un repo scelto dal chiamante: il tag di destinazione resta sempre dentro
// IMAGE_REPO, deciso qui, non dal body della richiesta.
async function tagImage(source, tag) {
  if (tag !== 'latest' && tag !== 'previous') {
    throw Object.assign(new Error('tag non valido: ' + tag), { statusCode: 400 });
  }
  await docker.getImage(source).tag({ repo: IMAGE_REPO, tag });
}

function exportImageStream(cb) {
  docker.getImage(IMAGE_NAME).get(cb);
}

function loadImage(stream, cb) {
  docker.loadImage(stream, {}, cb);
}

module.exports = {
  createTenantContainer,
  stopTenant,
  startTenant,
  removeTenant,
  buildCoreImage,
  redeployTenant,
  inspectTenant,
  statsTenant,
  reloadNginx,
  inspectImage,
  tagImage,
  exportImageStream,
  loadImage,
};
