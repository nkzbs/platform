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

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

const IMAGE_NAME = 'platform-core:latest';
const IMAGE_REPO = 'platform-core';

// Stesso repo del remote 'origin' di questo checkout — scaricato di nuovo
// (git clone --depth 1, senza node_modules) ad ogni build invece che tenuto
// come volume persistente: niente stato da gestire, il costo è solo qualche
// secondo di clone su un repo di questa dimensione.
const SOURCE_REPO_URL = process.env.SOURCE_REPO_URL || 'https://github.com/nkzbs/platform.git';
const SRC_DIR = '/tmp/platform-core-src';

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 1024 * 1024 * 20 }, (err, stdout, stderr) => {
      if (err) return reject(Object.assign(new Error((stderr || err.message).toString().trim()), { statusCode: 500 }));
      resolve(stdout.toString());
    });
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

// Stessa identica forma di HostConfig/ExposedPorts di tenants.js createContainer/
// redeployTenant — invariata, solo spostata. DATA_VOLUME/TENANT_NETWORK letti
// dall'ambiente DI QUESTO servizio (iniettati da docker-compose.yml), non dal
// chiamante: il chiamante manda solo `env` (l'array di variabili specifiche del
// tenant, che già assembla oggi) e `port`.
function tenantHostConfig(port) {
  return {
    PortBindings: { '80/tcp': [{ HostPort: String(port) }] },
    Binds: [(process.env.DATA_VOLUME || 'platform_platform-data') + ':/data'],
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
    HostConfig: tenantHostConfig(port),
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
// sviluppatore via SSH. onLine(msg) riceve una riga per volta (download, ogni
// step del Dockerfile) per il popup di avanzamento in Super Admin: un build
// può durare oltre un minuto, un singolo "fatto" finale sembrerebbe bloccato.
async function buildCoreImage(onLine) {
  const say = (m) => { try { if (onLine) onLine(m) } catch (e) { /* un log non deve mai far fallire il build */ } };
  say('Scarico il sorgente più recente da ' + SOURCE_REPO_URL + '…');
  await run('rm', ['-rf', SRC_DIR]);
  await run('git', ['clone', '--depth', '1', SOURCE_REPO_URL, SRC_DIR]);
  const rev = (await run('git', ['-C', SRC_DIR, 'rev-parse', '--short', 'HEAD'])).trim();
  say('Sorgente scaricato (commit ' + rev + '). Costruisco l\'immagine…');
  const stream = await docker.buildImage(
    { context: SRC_DIR, src: ['core/Dockerfile', 'core', 'shared'] },
    { t: IMAGE_NAME, dockerfile: 'core/Dockerfile' }
  );
  let buildError = null;
  await new Promise((resolve, reject) => {
    docker.followProgress(stream, (err, res) => (err ? reject(err) : resolve(res)), (evt) => {
      if (evt.stream && evt.stream.trim()) say(evt.stream.replace(/\n$/, ''));
      if (evt.error) { buildError = evt.error; say('Errore: ' + evt.error); }
    });
  });
  if (buildError) throw Object.assign(new Error(buildError), { statusCode: 500 });
  say('Immagine ' + IMAGE_NAME + ' pronta (commit ' + rev + ').');
  return { commit: rev };
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
    HostConfig: tenantHostConfig(port),
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
