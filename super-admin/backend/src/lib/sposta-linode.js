'use strict';
// Sposta un tenant dal NAS al suo server Linode, con lo stesso indirizzo. Ordine pensato perché il NAS resti la via di ritorno fino all'ultimo:
//  1) copia di sicurezza (se non riesce non si parte); 2) nasce il server e si prepara tutto SENZA toccare il tenant; 3) solo allora il tenant si ferma sul NAS, il suo database
//  (copia consistente) e gli allegati vanno sul server, il tenant parte là; 4) l'indirizzo passa al nuovo server (senza proxy il tempo del certificato, poi con); 5) si controlla che risponda.
// Se qualcosa non va dopo lo stop: il server nuovo si cancella, l'indirizzo torna al NAS e il tenant si riaccende sul NAS (che non è mai stato modificato).
// A fine lavoro il tenant sul NAS resta FERMO e con tutti i suoi dati: lo cancella una persona, a mano, quando è tranquilla.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const db = require('../db');
const { logAudit } = require('../audit-log');
const { internalSecret } = require('../../../../shared/internal-secret.js');

const PROVISIONER_URL = process.env.PROVISIONER_URL || 'http://docker-provisioner:4000';
const deps = {
  provisioner: async (method, p) => {
    const r = await fetch(PROVISIONER_URL + p, { method, headers: { 'x-internal-secret': internalSecret(), 'Content-Type': 'application/json' } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Operazione sul container del NAS fallita');
    return j;
  },
  backup: (slug, o) => require('../backup-scheduler').runBackupForTenant(slug, o),
  remoto: () => require('./server-remoto'),
  cloudflare: () => require('../cloudflare'),
  copiaDatabaseFermo: (tenant) => { // il tenant è fermo: copia consistente del file, come per i backup
    const tmp = path.join(os.tmpdir(), 'sposta-' + tenant.slug + '-' + crypto.randomBytes(6).toString('hex') + '.db');
    const src = new Database(tenant.db_path, { readonly: true, timeout: 5000 });
    try { src.exec("VACUUM INTO '" + tmp.replace(/'/g, "''") + "'"); } finally { src.close(); }
    return tmp;
  },
  allegati: (tenant) => require('./tenant-export').deps.allegati(tenant.slug, null),
};

const lavori = new Map(); // slug → stato: { fase, passi[], fine, errore, esito }
const stato = (slug) => lavori.get(slug) || null;

function controlli(tenant) {
  if (!tenant) throw Object.assign(new Error('Tenant non trovato.'), { status: 404 });
  if (tenant.host === 'linode') throw Object.assign(new Error('Questo tenant è già su Linode.'), { status: 409 });
  if (tenant.status !== 'active') throw Object.assign(new Error('Il tenant deve essere attivo per essere spostato (adesso è «' + tenant.status + '»).'), { status: 409 });
  if (!tenant.domain) throw Object.assign(new Error('Il tenant non ha un indirizzo (dominio): serve per spostarlo.'), { status: 409 });
  const l = lavori.get(tenant.slug);
  if (l && !l.fine) throw Object.assign(new Error('Uno spostamento di questo tenant è già in corso.'), { status: 409 });
}

// Parte e ritorna subito; si segue con stato(slug). `actor` finisce nel registro attività.
function avvia(slug, { actor = 'system' } = {}) {
  const tenant = db.prepare('SELECT * FROM tenants WHERE slug = ?').get(slug);
  controlli(tenant);
  const st = { slug, fase: 'copia di sicurezza', passi: [], fine: false, errore: null, esito: null, avviato: Date.now() };
  lavori.set(slug, st);
  const say = (m) => { st.fase = m; st.passi.push({ t: Date.now(), m }); };
  logAudit(actor, 'tenant.move_start', slug, { verso: 'linode' });
  lavora(tenant, actor, st, say).then(() => { st.fine = true; }, (e) => { st.fine = true; st.errore = e.message; logAudit(actor, 'tenant.move_failed', slug, { error: String(e.message).slice(0, 400) }); });
  return st;
}

async function lavora(tenant, actor, st, say) {
  const slug = tenant.slug, cf = deps.cloudflare(), remoto = deps.remoto();
  let nasFermato = false, dnsCambiato = false, tmpDb = null;
  say('Copia di sicurezza del tenant…');
  const bk = await deps.backup(slug, { trigger: 'pre-move', actor });
  if (!bk || !bk.ok) throw new Error('La copia di sicurezza non è riuscita: non sposto niente. ' + ((bk && bk.error) || ''));
  db.prepare("UPDATE tenants SET status = 'moving' WHERE slug = ?").run(slug); // stato transitorio: i controlli automatici non lo toccano
  const base = process.env.SUPER_ADMIN_PUBLIC_URL || ('https://admin.' + cf.zoneName());
  try {
    const r = await remoto.crea(tenant, {
      dominio: tenant.domain, superAdminUrl: base, internalSecret: internalSecret(), passwordIniziale: null, say,
      spostamento: true, differisciDns: true,
      prima: async (c, { dir, sh }) => {
        say('Fermo il tenant sul NAS (da qui è fermo fino a fine spostamento)…');
        await deps.provisioner('POST', '/tenants/' + slug + '/stop'); nasFermato = true;
        say('Copio il database dal NAS…');
        tmpDb = deps.copiaDatabaseFermo(tenant);
        const dim = fs.statSync(tmpDb).size;
        await sh('umask 077 && cat > ' + dir + '/data/' + slug + '.db', { stdin: fs.createReadStream(tmpDb) });
        const arrivati = Number((await sh('wc -c < ' + dir + '/data/' + slug + '.db')).stdout.trim());
        if (arrivati !== dim) throw new Error('Il database sul server non ha la dimensione giusta (' + arrivati + ' su ' + dim + ').');
        const tar = deps.allegati(tenant);
        if (tar) { say('Copio gli allegati…'); await sh('umask 077 && mkdir -p ' + dir + '/data/uploads && tar xzf - -C ' + dir + '/data/uploads', { stdin: tar }); }
      },
      dns: (ip) => { dnsCambiato = true; return cf.upsertSubdomain(slug, ip, { proxied: false }); },
      proxy: (v, ip) => cf.upsertSubdomain(slug, ip, { proxied: v }),
      alFallimento: async () => {
        if (dnsCambiato) await cf.upsertSubdomain(slug, undefined, { proxied: true }); // senza ip: torna all'indirizzo del NAS
        if (nasFermato) await deps.provisioner('POST', '/tenants/' + slug + '/start');
        db.prepare("UPDATE tenants SET status = 'active', linode_id = NULL, remote_ip = NULL WHERE slug = ?").run(slug);
      },
    });
    db.prepare("UPDATE tenants SET host = 'linode', status = 'active', linode_id = ?, remote_ip = ?, remote_fingerprint = ? WHERE slug = ?").run(r.linode_id, r.ip, r.fingerprint, slug);
    logAudit(actor, 'tenant.move_done', slug, { verso: 'linode', linode_id: r.linode_id, ip: r.ip });
    st.esito = { ip: r.ip, linode_id: r.linode_id };
    say('Fatto: ' + slug + ' ora vive su Linode. Sul NAS resta fermo, con tutti i suoi dati, finché non lo cancelli tu.');
  } catch (e) {
    db.prepare("UPDATE tenants SET status = 'active' WHERE slug = ? AND status = 'moving'").run(slug);
    throw e;
  } finally { if (tmpDb) { try { fs.unlinkSync(tmpDb); } catch (x) { /* già tolto */ } } }
}

module.exports = { avvia, stato, deps, controlli };
