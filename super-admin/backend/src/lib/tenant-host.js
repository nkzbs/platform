'use strict';
// Dove si raggiunge un tenant. Sul NAS: dentro la rete Docker, `http://platform-<slug>:80`. Su Linode: dal suo indirizzo pubblico, `https://<dominio>` (Cloudflare davanti,
// il segreto interno viaggia in HTTPS). Un solo punto, così ogni chiamata di Super Admin verso un tenant va nel posto giusto senza saperlo.
const db = require('../db');

function riga(slug) { return db.prepare('SELECT host, domain FROM tenants WHERE slug = ?').get(slug) || null; }
const remoto = (t) => !!t && t.host === 'linode';

// Indirizzo di base di un tenant (senza barra finale).
function base(slug) {
  const t = riga(slug);
  if (remoto(t)) {
    if (!t.domain) throw Object.assign(new Error('Il tenant «' + slug + '» è su Linode ma non ha un dominio: non si raggiunge.'), { status: 409 });
    return 'https://' + t.domain;
  }
  return 'http://platform-' + slug + ':80';
}
const èRemoto = (slug) => remoto(riga(slug));

module.exports = { base, èRemoto };
