'use strict';
// Un tenant su un SUO server Linode (un Nanode). Super Admin crea il server con l'API di Linode, ci entra con una chiave sua (mai password), installa Docker e Caddy,
// ci porta l'immagine del core dal NAS (lo stesso flusso dell'esportazione: docker save → docker load), avvia il container con i segreti del tenant e mette Caddy davanti
// (HTTPS con certificato vero, Cloudflare in Full strict). Poi lo gestisce a distanza: avvia, ferma, aggiorna, cancella.
// Ogni passo rimette a posto se fallisce: il server creato a metà si cancella (non resta a costare). Tutto ciò che tocca il mondo sta in `deps`, sostituibile nei test.
const crypto = require('crypto');
const zlib = require('zlib');
const { Readable } = require('stream');
const { utils } = require('ssh2');
const db = require('../db');
const { encrypt, decrypt } = require('../crypto-secrets');
const linode = require('./linode');

const PROVISIONER_URL = process.env.PROVISIONER_URL || 'http://docker-provisioner:4000';
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || 'changeme_internal';

const deps = {
  linode,
  connect: (opts) => require('./ssh-client').connect(opts),
  imageStream: async () => {
    const r = await fetch(PROVISIONER_URL + '/images/export', { headers: { 'x-internal-secret': INTERNAL_SECRET } });
    if (!r.ok || !r.body) throw new Error('Il provisioner non riesce a esportare l\'immagine (' + r.status + ')');
    return Readable.fromWeb(r.body);
  },
  attesa: (ms) => new Promise((r) => setTimeout(r, ms)),
  tentativiSsh: 40, passoSsh: 5000, tentativiAvvio: 60, passoAvvio: 3000,
  proveHttps: async (url) => { try { const r = await fetch(url, { signal: AbortSignal.timeout(8000) }); return r.ok; } catch (e) { return false; } },
};

// ── la chiave di Super Admin ──────────────────────────────────────────────────────────────────────────────────────────────────────────
function chiave() {
  const get = (k) => { const r = db.prepare('SELECT value FROM cloud_settings WHERE key = ?').get(k); return r ? r.value : null; };
  let pub = get('ssh_pubblica'), priv = get('ssh_privata');
  if (!pub || !priv) {
    const k = utils.generateKeyPairSync('ed25519');
    pub = k.public.trim() + ' super-admin'; priv = encrypt(k.private);
    const set = db.prepare('INSERT INTO cloud_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    set.run('ssh_pubblica', pub); set.run('ssh_privata', priv);
  }
  return { pubblica: pub, privata: decrypt(priv) };
}

const sq = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;
const DOM_RE = /^([a-z0-9-]+\.)+[a-z]{2,}$/;
const DIR = (slug) => '/srv/platform/' + slug;
const nomeContenitore = (slug) => 'platform-' + slug;
const nomeServer = (slug) => 'tenant-' + slug; // non 'plt-…': "plt-test" era la macchina di prova fatta a mano

async function entra(tenant, { impronta = tenant.remote_fingerprint } = {}) {
  const k = chiave();
  return deps.connect({ host: tenant.remote_ip, port: 22, username: 'root', privateKey: k.privata, fingerprint: impronta || undefined });
}
async function sh(c, cmd, opt) {
  const r = await c.run(cmd, opt);
  if (r.code !== 0) throw new Error((r.stderr || r.stdout || 'comando fallito').trim().split('\n').slice(-3).join(' '));
  return r;
}

// L'ambiente del container: gli stessi segreti del NAS, ma raggiungibile da fuori (Super Admin per nome pubblico, niente Redis del NAS: i contatori restano in memoria).
function ambiente(tenant, { superAdminUrl, internalSecret, passwordIniziale }) {
  return [
    'PORT=3000', 'DB_PATH=/data/' + tenant.slug + '.db', 'JWT_SECRET=' + tenant.jwt_secret, 'ENCRYPTION_KEY=' + tenant.encryption_key,
    'TENANT_SLUG=' + tenant.slug, 'TENANT_NAME=' + String(tenant.name).replace(/[\r\n]+/g, ' '),
    'REDIS_URL=redis://redis:6379', 'INTERNAL_API_SECRET=' + internalSecret, 'SUPER_ADMIN_URL=' + superAdminUrl,
    ...(passwordIniziale ? ['INITIAL_ADMIN_PASSWORD=' + passwordIniziale] : []),
  ].join('\n') + '\n';
}

const SCRIPT_SETUP = [
  'set -e', 'export DEBIAN_FRONTEND=noninteractive',
  // un po' di respiro per 1 GB di RAM
  'if [ ! -f /swapfile ]; then fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile && echo "/swapfile none swap sw 0 0" >> /etc/fstab; fi',
  'apt-get update -qq', 'apt-get install -y -qq docker.io caddy >/dev/null', 'systemctl enable --now docker >/dev/null 2>&1',
].join(' && ');

// Caddy davanti al container: il dominio del tenant, HTTPS automatico, il resto sulla porta locale. Il container non è mai esposto direttamente.
// Cloudflare qui porta il traffico dei tenant sulla porta 4000 (regola di destinazione della zona): il server risponde sia su 443 sia su 4000, stesso certificato.
const caddyfile = (dominio) => dominio + ', ' + dominio + ':4000 {\n  encode gzip\n  reverse_proxy 127.0.0.1:8080\n}\n';

async function caricaImmagine(c, say) {
  say('Porto l\'immagine del programma sul server (è la parte più lunga)…');
  const gz = (await deps.imageStream()).pipe(zlib.createGzip());
  const r = await sh(c, 'gunzip | docker load', { stdin: gz });
  const ref = (r.stdout.match(/Loaded image(?: ID)?: (\S+)/) || [])[1];
  if (!ref || !/^[A-Za-z0-9_.:/@-]+$/.test(ref)) throw new Error('Immagine caricata ma non riconosco il nome nell\'output.');
  return ref;
}
// Il core in produzione pretende Redis (contatori condivisi): ne basta uno piccolo sul server, su una rete interna, mai esposto fuori.
const PREPARA_REDIS = 'docker network inspect platform-net >/dev/null 2>&1 || docker network create platform-net >/dev/null; docker inspect -f "{{.State.Running}}" redis 2>/dev/null | grep -q true || { docker rm -f redis >/dev/null 2>&1; docker run -d --name redis --restart unless-stopped --network platform-net redis:7-alpine >/dev/null; }; ';
const avviaContenitore = (c, slug, ref) => sh(c, PREPARA_REDIS + 'docker rm -f ' + sq(nomeContenitore(slug)) + ' >/dev/null 2>&1 || true; docker run -d --name ' + sq(nomeContenitore(slug)) + ' --restart unless-stopped --network platform-net -p 127.0.0.1:8080:80 --env-file ' + DIR(slug) + '/env -v ' + DIR(slug) + '/data:/data ' + sq(ref));

// Cosa vede il server stesso quando il tenant non risponde da fuori: serve a capire se manca il container, Caddy o il certificato. Solo letture, testo corto.
async function diagnosi(c, slug, dominio) {
  const cmd = ['echo "[log tenant]"; docker logs --tail 15 ' + nomeContenitore(slug) + ' 2>&1 | cut -c1-220',
    'echo "[container]"; docker ps -a --format "{{.Names}} {{.Status}}" | head -3',
    'echo "[locale]"; curl -s -m 8 -o /dev/null -w "%{http_code}" http://127.0.0.1:8080/api/tenant-info',
    'echo; echo "[caddy]"; systemctl is-active caddy; journalctl -u caddy --no-pager -n 6 2>&1 | cut -c60-300',
    'echo "[https locale]"; curl -sk -m 8 -o /dev/null -w "%{http_code}" --resolve ' + dominio + ':443:127.0.0.1 https://' + dominio + '/api/tenant-info',
    'true'].join('; ');
  const r = await sh(c, cmd);
  return String(r && r.stdout !== undefined ? r.stdout : r).slice(0, 3000);
}

// Crea il server e ci mette il tenant. `tenant` è la riga di Super Admin (con segreti); `opz`: { dominio, superAdminUrl, internalSecret, passwordIniziale, say, dns(ip) }.
// Ritorna { linode_id, ip, fingerprint }. Se qualcosa fallisce, cancella il server appena creato e rilancia l'errore.
async function crea(tenant, opz) {
  const say = opz.say || (() => {});
  if (!SLUG_RE.test(tenant.slug)) throw Object.assign(new Error('Slug non valido.'), { status: 400 });
  if (!DOM_RE.test(String(opz.dominio || ''))) throw Object.assign(new Error('Un tenant su Linode ha bisogno di un dominio.'), { status: 400 });
  const k = chiave();
  say('Creo il server su Linode (' + nomeServer(tenant.slug) + ')…');
  const s = await deps.linode.creaServer({ nome: nomeServer(tenant.slug), chiavi: [k.pubblica], tags: ['platform', 'tenant'] });
  db.prepare("UPDATE tenants SET host = 'linode', linode_id = ?, remote_ip = ? WHERE slug = ?").run(s.id, s.ip, tenant.slug); // subito: se fallisce, si sa cosa cancellare
  let c = null;
  try {
    if (opz.dns) { say('Preparo l\'indirizzo ' + opz.dominio + '…'); await opz.dns(s.ip); }
    say('Aspetto che il server si accenda…');
    let imp = null;
    for (let i = 0; i < deps.tentativiSsh && !c; i++) {
      try { c = await deps.connect({ host: s.ip, port: 22, username: 'root', privateKey: k.privata }); imp = c.fingerprint; }
      catch (e) { await deps.attesa(deps.passoSsh); }
    }
    if (!c) throw new Error('Il server non si è acceso in tempo (nessun accesso SSH).');
    db.prepare('UPDATE tenants SET remote_fingerprint = ? WHERE slug = ?').run(imp, tenant.slug); // da ora l'impronta è fissata
    say('Preparo il server (Docker e Caddy)…');
    await sh(c, SCRIPT_SETUP);
    const ref = await caricaImmagine(c, say);
    say('Scrivo i segreti e avvio il tenant…');
    await sh(c, 'umask 077 && mkdir -p ' + DIR(tenant.slug) + '/data');
    await sh(c, 'umask 077 && cat > ' + DIR(tenant.slug) + '/env', { stdin: ambiente(tenant, opz) });
    await avviaContenitore(c, tenant.slug, ref);
    await sh(c, 'cat > /etc/caddy/Caddyfile', { stdin: caddyfile(opz.dominio) });
    await sh(c, 'systemctl reload caddy || systemctl restart caddy');
    say('Aspetto che il tenant risponda (il certificato HTTPS può volere un minuto)…');
    let su = false;
    for (let i = 0; i < deps.tentativiAvvio && !su; i++) { su = await deps.proveHttps('https://' + opz.dominio + '/api/tenant-info'); if (!su) await deps.attesa(deps.passoAvvio); }
    if (su && opz.proxy) { say('Certificato ottenuto: accendo la protezione di Cloudflare…'); await opz.proxy(true, s.ip); }
    if (!su) throw new Error('Il tenant è partito sul server ma non risponde su https://' + opz.dominio + ' (guarda l\'indirizzo su Cloudflare e i log del server).');
    return { linode_id: s.id, ip: s.ip, fingerprint: imp };
  } catch (e) {
    if (c) { try { e.message += ' — DIAGNOSI DAL SERVER: ' + await diagnosi(c, tenant.slug, opz.dominio); } catch (x) { /* la diagnosi è un aiuto, non deve coprire l'errore vero */ } }
    try { await deps.linode.eliminaServer(s.id); db.prepare("UPDATE tenants SET linode_id = NULL, remote_ip = NULL WHERE slug = ?").run(tenant.slug); say('Qualcosa non è andato: ho cancellato il server appena creato, così non costa.'); }
    catch (x) { e.message += ' (ATTENZIONE: il server ' + s.id + ' su Linode non si è cancellato da solo: toglilo a mano da Linode)'; }
    throw e;
  } finally { if (c) c.close(); }
}

async function distruggi(tenant) {
  if (!tenant.linode_id) return { eliminato: false, motivo: 'nessun server collegato' };
  return deps.linode.eliminaServer(tenant.linode_id);
}

async function comando(tenant, azione) {
  if (!['start', 'stop'].includes(azione)) throw new Error('Azione non valida.');
  const c = await entra(tenant);
  try { await sh(c, 'docker ' + azione + ' ' + sq(nomeContenitore(tenant.slug))); } finally { c.close(); }
}

// Aggiorna il programma: porta l'immagine nuova e ricrea il container con gli stessi dati e segreti (il file env resta sul server).
async function aggiorna(tenant, { say = () => {} } = {}) {
  const c = await entra(tenant);
  try {
    const ref = await caricaImmagine(c, say);
    say('Ricreo il container con l\'immagine nuova (stessi dati)…');
    await avviaContenitore(c, tenant.slug, ref);
  } finally { c.close(); }
}

// Una copia consistente del database del tenant, scaricata qui in `destino` (per i backup, la copia di sicurezza prima di cancellare, la copia off-site). Sul server:
// VACUUM INTO dentro il container (stesso motore e stesso file che usa il tenant), poi il file viaggia in SSH e si controlla la dimensione. Mai una copia a metà.
async function scaricaDatabase(tenant, destino) {
  const fs = require('fs');
  const c = await entra(tenant);
  const tmp = '/data/_copia_backup.db', suHost = DIR(tenant.slug) + '/data/_copia_backup.db', nome = nomeContenitore(tenant.slug);
  try {
    await sh(c, 'docker exec ' + sq(nome) + ' rm -f ' + sq(tmp));
    await sh(c, 'docker exec ' + sq(nome) + ' node -e ' + sq("const D=require('better-sqlite3');const d=new D('/data/" + tenant.slug + ".db',{readonly:true,timeout:5000});d.exec(\"VACUUM INTO '" + tmp + "'\");d.close()"));
    const dim = Number((await sh(c, 'wc -c < ' + sq(suHost))).stdout.trim());
    if (!(dim > 0)) throw new Error('La copia del database sul server è vuota.');
    const out = fs.createWriteStream(destino);
    let scritti = 0;
    await new Promise((resolve, reject) => { out.on('error', reject); out.on('finish', resolve); c.run('cat ' + sq(suHost), { onStdout: (d) => { scritti += d.length; out.write(d); } }).then((r) => { if (r.code !== 0) { reject(new Error('Download del database fallito.')); } else out.end(); }, reject); });
    if (fs.statSync(destino).size !== dim) throw new Error('Il database scaricato non ha la dimensione giusta.');
    return { byte: dim };
  } catch (e) { try { fs.unlinkSync(destino); } catch (x) { /* non creato */ } throw e; }
  finally { try { await c.run('rm -f ' + sq(suHost)); } catch (e) { /* pulizia best effort */ } c.close(); }
}

module.exports = { scaricaDatabase, crea, distruggi, comando, aggiorna, chiave, ambiente, caddyfile, nomeServer, deps };
