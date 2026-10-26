'use strict';
// Esporta un tenant su un server Linux dell'utente via SSH: una COPIA che continua a funzionare da sola (immagine, database, allegati, segreti, avvio) e non dipende più da Super Admin.
// Non cancella e non ferma niente da questa parte. Due passi: «verifica» (sola lettura: Docker, spazio, porta, architettura, impronta del server) e «avvia» (la copia vera, in background).
// Credenziali SSH: solo in memoria per la durata del lavoro, mai scritte, mai nei log né nello stato. L'impronta del server la conferma chi esporta e poi si FISSA. Destinazioni vietate:
// loopback, link-local (compresi i servizi dei cloud) e, salvo EXPORT_ALLOW_PRIVATE=1, gli indirizzi privati (da qui non si deve poter sondare la rete interna).
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const dns = require('dns').promises;
const crypto = require('crypto');
const zlib = require('zlib');
const { spawn } = require('child_process');
const { Readable } = require('stream');
const Database = require('better-sqlite3');
const db = require('../db');
const { logAudit } = require('../audit-log');

const PROVISIONER_URL = process.env.PROVISIONER_URL || 'http://docker-provisioner:4000';
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || 'changeme_internal';
// Radice del mount di Super Admin sull'intero volume (mai cambiata dal
// 26/10/2026 in poi — solo il CONTENUTO sotto è passato a sottocartelle
// per-tenant, vedi tenantHostConfig in docker-provisioner).
const DATA_ROOT = process.env.DATA_ROOT || '/data';
const MIN_FREE_MB = Number(process.env.EXPORT_MIN_FREE_MB) || 3000;
const ARCH_IMMAGINE = process.env.EXPORT_IMAGE_ARCH || 'x86_64';

// Tutto ciò che tocca il mondo è qui, sostituibile nei test.
const deps = {
  connect: (opts) => require('./ssh-client').connect(opts),
  resolve: async (host) => (net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((r) => r.address)),
  // Il flusso grezzo dell'immagine dal provisioner (tar), già in Node stream.
  imageStream: async () => {
    const r = await fetch(PROVISIONER_URL + '/images/export', { headers: { 'x-internal-secret': INTERNAL_SECRET } });
    if (!r.ok || !r.body) throw new Error('Il provisioner non riesce a esportare l\'immagine (' + r.status + ')');
    return Readable.fromWeb(r.body);
  },
  // Una copia consistente del database in un file temporaneo (VACUUM INTO), come i backup.
  copiaDatabase: (tenant) => {
    const tmp = path.join(os.tmpdir(), 'export-' + tenant.slug + '-' + crypto.randomBytes(6).toString('hex') + '.db');
    const src = new Database(tenant.db_path, { readonly: true, timeout: 5000 });
    try { src.exec("VACUUM INTO '" + tmp.replace(/'/g, "''") + "'"); } finally { src.close(); }
    return tmp;
  },
  // Gli allegati del tenant come tar.gz in streaming, o null se non ce ne sono.
  // Lo stesso albero che il container vede come '/data/uploads/<slug>' sta,
  // da qui (Super Admin, mount intero), a '<DATA_ROOT>/<slug>/uploads/<slug>'.
  allegati: (slug) => {
    const uploadsDir = path.join(DATA_ROOT, slug, 'uploads');
    if (!fs.existsSync(path.join(uploadsDir, slug))) return null;
    const p = spawn('tar', ['czf', '-', '-C', uploadsDir, slug]);
    return p.stdout;
  },
};

// ── destinazione ────────────────────────────────────────────────────────────────────────────────────────────────────
const HOST_RE = /^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$|^[0-9a-fA-F:]+$/;
function vieta(ip) {
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    if (l === '::1' || l === '::' || l.startsWith('fe80')) return 'indirizzo locale';
    if (l.startsWith('::ffff:')) return vieta(l.slice(7));
    if ((l.startsWith('fc') || l.startsWith('fd')) && process.env.EXPORT_ALLOW_PRIVATE !== '1') return 'indirizzo privato';
    return null;
  }
  const [a, b] = ip.split('.').map(Number);
  if (a === 127 || a === 0) return 'indirizzo locale';
  if (a === 169 && b === 254) return 'indirizzo di servizio (link-local)';
  if (a >= 224) return 'indirizzo non valido per un server';
  const privato = a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  if (privato && process.env.EXPORT_ALLOW_PRIVATE !== '1') return 'indirizzo privato';
  return null;
}
async function controllaDestinazione(host, porta) {
  if (!host || !HOST_RE.test(host)) throw erroreUtente('Indirizzo del server non valido.');
  if (!Number.isInteger(porta) || porta < 1 || porta > 65535) throw erroreUtente('Porta SSH non valida.');
  let ips; try { ips = await deps.resolve(host); } catch (e) { throw erroreUtente('Non riesco a trovare «' + host + '».'); }
  if (!ips.length) throw erroreUtente('Non riesco a trovare «' + host + '».');
  for (const ip of ips) { const v = vieta(ip); if (v) throw erroreUtente('Questo indirizzo non è ammesso (' + v + '). Serve un server raggiungibile da fuori' + (process.env.EXPORT_ALLOW_PRIVATE === '1' ? '.' : ' (gli indirizzi privati si abilitano con EXPORT_ALLOW_PRIVATE=1 su Super Admin).')); }
  return ips[0];
}
const erroreUtente = (m) => Object.assign(new Error(m), { status: 400 });

// Ripulisce un messaggio da qualunque segreto della connessione prima di mostrarlo o registrarlo.
const scrub = (msg, server) => {
  let s = String(msg || '');
  for (const k of ['password', 'privateKey', 'passphrase']) { const v = server && server[k]; if (v && String(v).length >= 4) s = s.split(String(v)).join('•••'); }
  return s.slice(0, 400);
};

// ── comandi sul server (ogni valore interpolato è già validato: slug, numero, percorso) ────────────────────────────────────────────
const DIR_RE = /^[A-Za-z0-9_./-]{1,120}$/;
const sq = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";
function leggiOpzioni(tenant, o) {
  const porta = Number(o.porta_web), cartella = String(o.cartella || 'platform-' + tenant.slug).trim();
  if (!Number.isInteger(porta) || porta < 1024 || porta > 65535) throw erroreUtente('La porta web deve essere tra 1024 e 65535.');
  if (!DIR_RE.test(cartella) || cartella.includes('..')) throw erroreUtente('Cartella non valida: solo lettere, numeri, / . _ -');
  return { porta, cartella };
}

async function controlli(c, tenant, { porta, cartella }) {
  const out = [], push = (nome, ok, dettaglio) => out.push({ nome, ok, dettaglio });
  const arch = (await c.run('uname -m')).stdout.trim();
  push('Architettura', arch === ARCH_IMMAGINE, arch === ARCH_IMMAGINE ? arch : 'Il server è ' + (arch || 'sconosciuto') + ', l\'immagine è per ' + ARCH_IMMAGINE + '.');
  const dv = await c.run("docker version --format '{{.Server.Version}}'");
  push('Docker', dv.code === 0, dv.code === 0 ? 'versione ' + dv.stdout.trim() : 'Docker non c\'è o questo utente non può usarlo (serve essere nel gruppo docker, o root).');
  const df = await c.run('df -Pk "$HOME" | tail -1');
  const liberiMb = Math.floor((Number((df.stdout.trim().split(/\s+/)[3]) || 0)) / 1024);
  push('Spazio libero', liberiMb >= MIN_FREE_MB, liberiMb + ' MB liberi' + (liberiMb >= MIN_FREE_MB ? '' : ' (ne servono almeno ' + MIN_FREE_MB + ')'));
  const occ = await c.run('(ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null) | grep -E "[:.]' + porta + '[[:space:]]" | head -1');
  push('Porta ' + porta, !occ.stdout.trim(), occ.stdout.trim() ? 'è già in uso' : 'libera');
  const ex = await c.run("docker ps -a --format '{{.Names}}' 2>/dev/null | grep -x " + sq('platform-' + tenant.slug) + ' | head -1');
  push('Nome del container', !ex.stdout.trim(), ex.stdout.trim() ? 'Esiste già un container «platform-' + tenant.slug + '» su quel server.' : 'libero');
  const cd = await c.run('test -e ' + sq(cartella) + ' && echo esiste');
  push('Cartella ' + cartella, !cd.stdout.includes('esiste'), cd.stdout.includes('esiste') ? 'esiste già: non la tocco' : 'verrà creata');
  return out;
}

// Passo 1, sola lettura. Ritorna { fingerprint, controlli, ok }.
async function verifica(tenant, server, opzioni) {
  const o = leggiOpzioni(tenant, opzioni || {});
  await controllaDestinazione(server.host, server.port);
  let c;
  try {
    c = await deps.connect({ host: server.host, port: server.port, username: server.username, password: server.password, privateKey: server.privateKey, passphrase: server.passphrase });
    const lista = await controlli(c, tenant, o);
    return { fingerprint: c.fingerprint, controlli: lista, ok: lista.every((x) => x.ok), opzioni: o };
  } catch (e) { throw Object.assign(new Error(scrub(e.message, server)), { status: e.status || (e.code === 'fingerprint' ? 409 : 502) }); }
  finally { if (c) c.close(); }
}

// ── il lavoro vero ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const jobs = new Map(); // id → stato SENZA segreti
const FASI = ['connessione', 'controlli', 'dati', 'allegati', 'segreti', 'immagine', 'avvio', 'prova'];

function nuovoStato(tenant, server, o) {
  return { id: crypto.randomBytes(8).toString('hex'), slug: tenant.slug, host: server.host, porta_ssh: server.port, cartella: o.cartella, porta_web: o.porta, fase: 'connessione', passi: [], inizio: Date.now(), fine: null, errore: null, esito: null, byte_immagine: 0 };
}
const inCorso = (slug) => [...jobs.values()].some((j) => j.slug === slug && !j.fine);

async function avvia(tenant, server, fingerprint, opzioni) {
  const o = leggiOpzioni(tenant, opzioni || {});
  if (!fingerprint) throw erroreUtente('Conferma prima l\'impronta del server.');
  if (inCorso(tenant.slug)) throw Object.assign(new Error('Un\'esportazione di questo tenant è già in corso.'), { status: 409 });
  await controllaDestinazione(server.host, server.port);
  const st = nuovoStato(tenant, server, o);
  jobs.set(st.id, st);
  logAudit('tenant:' + tenant.slug, 'tenant.export_start', tenant.slug, { host: server.host, porta_ssh: server.port, cartella: o.cartella, porta_web: o.porta });
  lavora(tenant, { ...server }, fingerprint, o, st); // senza await: la pagina segue l'avanzamento. Le credenziali vivono solo in questa chiusura.
  return { id: st.id };
}

async function lavora(tenant, server, fingerprint, o, st) {
  const fase = (f, dettaglio) => { st.fase = f; st.passi.push({ fase: f, dettaglio: dettaglio || '' }); };
  let c = null, avviato = false, tmpDb = null;
  const sh = async (cmd, opt) => { const r = await c.run(cmd, opt); if (r.code !== 0) throw new Error((r.stderr || r.stdout || 'comando fallito').trim().split('\n').slice(-3).join(' ')); return r; };
  const D = sq(o.cartella);
  try {
    fase('connessione');
    c = await deps.connect({ host: server.host, port: server.port, username: server.username, password: server.password, privateKey: server.privateKey, passphrase: server.passphrase, fingerprint });
    fase('controlli');
    const lista = await controlli(c, tenant, o);
    const ko = lista.filter((x) => !x.ok);
    if (ko.length) throw new Error('Controlli non superati: ' + ko.map((x) => x.nome + ' — ' + x.dettaglio).join('; '));

    fase('dati', 'database');
    await sh('umask 077 && mkdir -p ' + D + '/data/uploads');
    tmpDb = deps.copiaDatabase(tenant);
    const dim = fs.statSync(tmpDb).size;
    await sh('umask 077 && cat > ' + D + '/data/' + tenant.slug + '.db', { stdin: fs.createReadStream(tmpDb) });
    const verificaDim = (await sh('wc -c < ' + D + '/data/' + tenant.slug + '.db')).stdout.trim();
    if (Number(verificaDim) !== dim) throw new Error('Il database copiato non ha la dimensione giusta (' + verificaDim + ' invece di ' + dim + ' byte).');

    fase('allegati');
    const tar = deps.allegati(tenant.slug);
    if (tar) await sh('tar xzf - -C ' + D + '/data/uploads', { stdin: tar }); else st.passi[st.passi.length - 1].dettaglio = 'nessun allegato';

    fase('segreti', 'scritti in un file riservato (solo tuo)');
    const env = [
      'PORT=3000', 'DB_PATH=/data/' + tenant.slug + '.db', 'JWT_SECRET=' + tenant.jwt_secret, 'ENCRYPTION_KEY=' + tenant.encryption_key,
      'TENANT_SLUG=' + tenant.slug, 'TENANT_NAME=' + String(tenant.name).replace(/[\r\n]+/g, ' '),
      'INTERNAL_API_SECRET=' + crypto.randomBytes(24).toString('hex'),
      // Distaccato: niente Super Admin raggiungibile (porta chiusa: le chiamate falliscono subito invece di aspettare)
      'SUPER_ADMIN_URL=http://127.0.0.1:9', 'DETACHED=1',
    ].join('\n') + '\n';
    await sh('umask 077 && cat > ' + D + '/env', { stdin: env });

    fase('immagine', 'è la parte più lunga');
    const gz = (await deps.imageStream()).pipe(zlib.createGzip());
    gz.on('data', (b) => { st.byte_immagine += b.length; });
    const load = await sh('gunzip | docker load', { stdin: gz });
    const ref = (load.stdout.match(/Loaded image(?: ID)?: (\S+)/) || [])[1];
    if (!ref || !/^[A-Za-z0-9_.:/@-]+$/.test(ref)) throw new Error('Immagine caricata ma non riconosco il nome nell\'output.');

    fase('avvio');
    await sh('docker run -d --name ' + sq('platform-' + tenant.slug) + ' --restart unless-stopped -p ' + o.porta + ':80 --env-file ' + D + '/env -v "$(cd ' + D + ' && pwd)/data":/data ' + sq(ref));
    avviato = true;

    fase('prova');
    let ok = false;
    for (let i = 0; i < 30 && !ok; i++) {
      const r = await c.run('docker exec ' + sq('platform-' + tenant.slug) + ' wget -qO- http://127.0.0.1:3000/health');
      if (r.code === 0 && /ok/i.test(r.stdout)) ok = true; else await new Promise((res) => setTimeout(res, deps.attesa == null ? 2000 : deps.attesa));
    }
    if (!ok) throw new Error('Il tenant è partito ma non risponde: guarda i log con «docker logs platform-' + tenant.slug + '».');

    st.esito = { url: 'http://' + server.host + ':' + o.porta, cartella: o.cartella, container: 'platform-' + tenant.slug };
    logAudit('tenant:' + tenant.slug, 'tenant.export_done', tenant.slug, { host: server.host, porta_web: o.porta });
  } catch (e) {
    st.errore = scrub(e.message, server);
    if (c && avviato) { try { await c.run('docker rm -f ' + sq('platform-' + tenant.slug)); st.errore += ' (ho tolto il container avviato a metà; la cartella ' + o.cartella + ' è rimasta)'; } catch (x) { /* niente da fare */ } }
    logAudit('tenant:' + tenant.slug, 'tenant.export_failed', tenant.slug, { host: server.host, fase: st.fase, errore: st.errore });
  } finally {
    if (tmpDb) { try { fs.unlinkSync(tmpDb); } catch (e) { /* già tolto */ } }
    if (c) c.close();
    st.fine = Date.now();
    for (const k of ['password', 'privateKey', 'passphrase']) server[k] = undefined; // le credenziali non servono più
  }
}

function stato(id, slug) {
  const j = jobs.get(id);
  return j && j.slug === slug ? { ...j, passi: j.passi.slice() } : null;
}
// Si tengono solo gli ultimi lavori in memoria.
setInterval(() => { for (const [id, j] of jobs) if (j.fine && Date.now() - j.fine > 3600 * 1000) jobs.delete(id); }, 600 * 1000).unref();

module.exports = { deps, verifica, avvia, stato, vieta, controllaDestinazione, leggiOpzioni, scrub, FASI };
