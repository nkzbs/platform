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
  // subito: se fallisce, si sa cosa cancellare. In uno spostamento (opz.spostamento) il tenant resta «nas» finché non è tutto fatto: chi lo chiama cambia host alla fine.
  if (opz.spostamento) db.prepare('UPDATE tenants SET linode_id = ?, remote_ip = ? WHERE slug = ?').run(s.id, s.ip, tenant.slug);
  else db.prepare("UPDATE tenants SET host = 'linode', linode_id = ?, remote_ip = ? WHERE slug = ?").run(s.id, s.ip, tenant.slug);
  let c = null;
  try {
    if (opz.dns && !opz.differisciDns) { say('Preparo l\'indirizzo ' + opz.dominio + '…'); await opz.dns(s.ip); }
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
    if (opz.prima) await opz.prima(c, { dir: DIR(tenant.slug), sh: (cmd, o) => sh(c, cmd, o) }); // spostamento: qui arrivano i dati, PRIMA che il tenant parta sul server
    await sh(c, 'umask 077 && cat > ' + DIR(tenant.slug) + '/env', { stdin: ambiente(tenant, opz) });
    await avviaContenitore(c, tenant.slug, ref);
    if (opz.dns && opz.differisciDns) { say('Porto l\'indirizzo ' + opz.dominio + ' sul nuovo server…'); await opz.dns(s.ip); }
    await sh(c, 'cat > /etc/caddy/Caddyfile', { stdin: caddyfile(opz.dominio) });
    await sh(c, 'systemctl reload caddy || systemctl restart caddy');
    say('Aspetto che il tenant risponda (il certificato HTTPS può volere un minuto)…');
    let su = false;
    for (let i = 0; i < deps.tentativiAvvio && !su; i++) { su = await deps.proveHttps('https://' + opz.dominio + '/api/tenant-info'); if (!su) await deps.attesa(deps.passoAvvio); }
    if (su && opz.proxy) { say('Certificato ottenuto: accendo la protezione di Cloudflare…'); await opz.proxy(true, s.ip); }
    if (!su) throw new Error('Il tenant è partito sul server ma non risponde su https://' + opz.dominio + ' (guarda l\'indirizzo su Cloudflare e i log del server).');
    return { linode_id: s.id, ip: s.ip, fingerprint: imp };
  } catch (e) {
    if (opz.alFallimento) { try { await opz.alFallimento(); say('Ho rimesso le cose come prima.'); } catch (x) { e.message += ' (ATTENZIONE: non sono riuscito a rimettere tutto com\'era prima: ' + x.message + ')'; } }
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

// Rimette sul server un database preso da un backup. Ordine pensato per non lasciare mai il tenant senza dati:
// 1) il file viaggia in un posto di passaggio e si controlla (dimensione + integrità + ha gli utenti), mentre il tenant continua a girare;
// 2) solo allora si ferma il tenant, il database attuale NON si butta (resta accanto con la data) e si mette quello del backup;
// 3) si riaccende e si aspetta che risponda; se non risponde si rimette il database di prima e si riaccende. Chi chiama ha già fatto la copia di sicurezza.
async function ripristinaDatabase(tenant, file, { say = () => {} } = {}) {
  const fs = require('fs');
  const dim = fs.statSync(file).size;
  if (!(dim > 0)) throw new Error('Il file di backup è vuoto.');
  const c = await entra(tenant);
  const nome = nomeContenitore(tenant.slug), dati = DIR(tenant.slug) + '/data', dbNome = tenant.slug + '.db';
  const passaggio = dati + '/_ripristino.db', attuale = dati + '/' + dbNome, vecchio = dati + '/' + dbNome + '.prima-ripristino-' + Date.now();
  const rimettiAcceso = async () => { try { await c.run('docker start ' + sq(nome)); } catch (e) { /* già acceso */ } };
  try {
    say('Porto il backup sul server…');
    const up = await c.run('cat > ' + sq(passaggio), { stdin: fs.createReadStream(file) });
    if (up.code !== 0) throw new Error('Il caricamento del backup sul server è fallito.');
    const arrivati = Number((await sh(c, 'wc -c < ' + sq(passaggio))).stdout.trim());
    if (arrivati !== dim) throw new Error('Il backup sul server non ha la dimensione giusta (' + arrivati + ' su ' + dim + ').');
    say('Controllo che il backup sia un database sano…');
    const prova = "const D=require('better-sqlite3');const d=new D('/data/_ripristino.db',{readonly:true});const i=d.prepare('PRAGMA integrity_check').get();const u=d.prepare('SELECT COUNT(*) n FROM users').get();d.close();if(i.integrity_check!=='ok'||!(u.n>0)){console.error('integrità '+i.integrity_check+', utenti '+u.n);process.exit(3)}";
    await sh(c, 'docker exec ' + sq(nome) + ' node -e ' + sq(prova));
    say('Fermo il tenant e metto il database del backup…');
    await sh(c, 'docker stop ' + sq(nome));
    await sh(c, 'mv ' + sq(attuale) + ' ' + sq(vecchio) + '; rm -f ' + sq(attuale + '-wal') + ' ' + sq(attuale + '-shm') + '; mv ' + sq(passaggio) + ' ' + sq(attuale));
    await sh(c, 'docker start ' + sq(nome));
    say('Aspetto che il tenant riparta…');
    let su = false;
    for (let i = 0; i < 20 && !su; i++) {
      const r = await c.run('curl -s -m 5 -o /dev/null -w "%{http_code}" http://127.0.0.1:8080/api/tenant-info');
      su = r.stdout.trim() === '200';
      if (!su) await deps.attesa(3000);
    }
    if (!su) {
      say('Il tenant non riparte con questo backup: rimetto il database di prima…');
      await sh(c, 'docker stop ' + sq(nome) + ' || true; rm -f ' + sq(attuale) + ' ' + sq(attuale + '-wal') + ' ' + sq(attuale + '-shm') + '; mv ' + sq(vecchio) + ' ' + sq(attuale));
      await sh(c, 'docker start ' + sq(nome));
      throw new Error('Il tenant non è ripartito con questo backup: ho rimesso il database di prima.');
    }
    return { byte: dim, copia_precedente: vecchio };
  } catch (e) { await rimettiAcceso(); try { await c.run('rm -f ' + sq(passaggio)); } catch (x) { /* pulizia */ } throw e; }
  finally { c.close(); }
}

// Nuova password per l'utente admin del tenant sul suo server. L'hash si calcola qui e viaggia su stdin: la password non compare in nessun comando.
async function reimpostaPasswordAdmin(tenant, hash) {
  const c = await entra(tenant);
  const nome = nomeContenitore(tenant.slug);
  const script = "let h='';process.stdin.on('data',x=>h+=x).on('end',()=>{const D=require('better-sqlite3');const d=new D('/data/" + tenant.slug + ".db',{timeout:5000});h=h.trim();"
    + "const e=d.prepare(\"SELECT id FROM users WHERE username='admin'\").get();"
    + "if(e)d.prepare(\"UPDATE users SET password_hash=? WHERE username='admin'\").run(h);else d.prepare(\"INSERT INTO users (username,password_hash,display_name,role) VALUES ('admin',?,'Admin','admin')\").run(h);d.close();console.log('ok')})";
  try { const r = await c.run('docker exec -i ' + sq(nome) + ' node -e ' + sq(script), { stdin: hash }); if (r.code !== 0 || !/ok/.test(r.stdout)) throw new Error((r.stderr || 'comando fallito').trim().split('\n').slice(-2).join(' ')); }
  finally { c.close(); }
}

// Una query sul database del tenant, eseguita DENTRO il suo container sul server (stesso motore e stesso file del tenant). Il testo SQL lo scrive solo il nostro codice;
// i valori viaggiano come parametri su stdin, mai dentro il comando. { scrivi: true } per UPDATE/INSERT; ritorna le righe (o { changes }).
async function interroga(tenant, { sql, params = [], scrivi = false }) {
  const c = await entra(tenant);
  const nome = nomeContenitore(tenant.slug);
  const script = "let b='';process.stdin.on('data',x=>b+=x).on('end',()=>{try{const q=JSON.parse(b);const D=require('better-sqlite3');const d=new D('/data/" + tenant.slug + ".db',{readonly:!q.scrivi,timeout:5000});"
    + "const st=d.prepare(q.sql);const out=q.scrivi?{changes:st.run(...q.params).changes}:st.all(...q.params);d.close();console.log(JSON.stringify({ok:out}))}catch(e){console.log(JSON.stringify({err:String(e.message)}))}})";
  try {
    // Il client SSH tiene solo gli ultimi 20 KB dell'output: una risposta grande (lo schema di un modulo) si leggeva a metà. Qui si raccoglie tutto.
    const pezzi = [];
    const r = await c.run('docker exec -i ' + sq(nome) + ' node -e ' + sq(script), { stdin: JSON.stringify({ sql, params, scrivi }), onStdout: (d) => pezzi.push(Buffer.from(d)) });
    const riga = Buffer.concat(pezzi).toString('utf8').trim().split('\n').pop();
    let j; try { j = JSON.parse(riga); } catch (e) { throw new Error('Risposta non valida dal server: ' + (r.stderr || riga).slice(0, 160)); }
    if (j.err) throw new Error(j.err);
    return j.ok;
  } finally { c.close(); }
}

// Dimensione del database sul server, in MB.
async function dimensioneDatabaseMb(tenant) {
  const c = await entra(tenant);
  try {
    const r = await sh(c, 'wc -c < ' + sq(DIR(tenant.slug) + '/data/' + tenant.slug + '.db'));
    return Math.round((Number(r.stdout.trim()) / 1024 / 1024) * 100) / 100;
  } finally { c.close(); }
}

// Stato e consumi del container del tenant sul server (docker inspect + docker stats), nella stessa forma che usa la scheda statistiche.
const inMb = (t) => { const m = String(t || '').trim().match(/^([\d.]+)\s*([kKMGT]?i?B)$/); if (!m) return null; const f = { B: 1, kB: 1e3, KiB: 1024, MB: 1e6, MiB: 1048576, GB: 1e9, GiB: 1073741824, TB: 1e12, TiB: 1099511627776 }[m[2]] || 1; return Number(m[1]) * f / 1048576; };
async function statoContainer(tenant) {
  const c = await entra(tenant);
  const nome = sq(nomeContenitore(tenant.slug));
  try {
    const i = await c.run("docker inspect -f '{{.State.Status}}|{{.State.StartedAt}}' " + nome);
    if (i.code !== 0) return { status: 'missing', running: false };
    const [status, started_at] = i.stdout.trim().split('|');
    if (status !== 'running') return { status, running: false, started_at };
    const st = await c.run("docker stats --no-stream --format '{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}|{{.NetIO}}' " + nome);
    const [cpu, mem, memp, net] = st.stdout.trim().split('|');
    const [u, l] = String(mem || '').split('/'); const [rx, tx] = String(net || '').split('/');
    const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100);
    return { status, running: true, started_at, cpu_percent: parseFloat(cpu) || 0, mem_usage_mb: Math.round(inMb(u) || 0), mem_limit_mb: l ? Math.round(inMb(l) || 0) : null, mem_percent: parseFloat(memp) || 0, net_rx_mb: r2(inMb(rx)), net_tx_mb: r2(inMb(tx)) };
  } finally { c.close(); }
}

// Gli allegati del tenant come tar.gz in streaming dal suo server, o null se non ne ha (stessa forma di quelli del NAS, per l'esportazione).
async function flussoAllegati(tenant) {
  const { PassThrough } = require('stream');
  const c = await entra(tenant);
  const dir = DIR(tenant.slug) + '/data/uploads';
  try {
    const e = await c.run('test -d ' + sq(dir + '/' + tenant.slug) + ' && echo si');
    if (!e.stdout.includes('si')) { c.close(); return null; }
  } catch (err) { c.close(); throw err; }
  const pass = new PassThrough();
  c.run('tar czf - -C ' + sq(dir) + ' ' + sq(tenant.slug), { onStdout: (d) => pass.write(d) })
    .then((r) => { c.close(); if (r.code !== 0) pass.destroy(new Error('Lettura degli allegati dal server fallita.')); else pass.end(); }, (err) => { c.close(); pass.destroy(err); });
  return pass;
}

// Rimette gli allegati di un archivio .tar.gz sul server del tenant (non cancella nulla: sovrascrive i file con lo stesso nome).
async function ripristinaAllegati(tenant, file) {
  const c = await entra(tenant);
  try { await sh(c, 'umask 077 && mkdir -p ' + sq(DIR(tenant.slug) + '/data/uploads') + ' && tar xzf - -C ' + sq(DIR(tenant.slug) + '/data/uploads'), { stdin: require('fs').createReadStream(file) }); }
  finally { c.close(); }
}

module.exports = { ripristinaAllegati, flussoAllegati, statoContainer, interroga, dimensioneDatabaseMb, ripristinaDatabase, reimpostaPasswordAdmin, scaricaDatabase, crea, distruggi, comando, aggiorna, chiave, ambiente, caddyfile, nomeServer, deps };
