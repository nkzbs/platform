'use strict';
// Collegamento di Super Admin a Cloudflare, per i record DNS dei tenant che vivranno su un loro server Linode.
// Qui: custodia del token (cifrato, mai restituito) e controllo a SOLE LETTURE. I record DNS non si creano ancora: verrà con il driver dei server, con la sua conferma.
// Il token giusto ha un solo permesso, Zone → DNS → Edit, limitato alla zona del dominio (mai la chiave globale).
const db = require('../db');
const { encrypt, decrypt } = require('../crypto-secrets');

const API = 'https://api.cloudflare.com/client/v4';
db.exec('CREATE TABLE IF NOT EXISTS cloud_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
const get = (k) => { const r = db.prepare('SELECT value FROM cloud_settings WHERE key = ?').get(k); return r ? r.value : null; };
const set = (k, v) => db.prepare('INSERT INTO cloud_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, v);

// Un solo collegamento a Cloudflare per tutta Super Admin, e vive qui: token (cifrato), zona, dominio e indirizzo del NAS stanno nel database, in Impostazioni.
// Le vecchie variabili d'ambiente del backend (CLOUDFLARE_API_TOKEN, _ZONE_ID, _ZONE_NAME, _ORIGIN_IP) non si leggono più a ogni richiesta: all'avvio, per ogni voce
// che nelle Impostazioni è ancora vuota, se ne copia il valore UNA volta (il token viene cifrato). Dopo, l'ambiente si può svuotare senza effetti.
function tokenSalvato() {
  const v = get('cloudflare_token');
  if (!v) return null;
  const t = decrypt(v);
  return t && !t.startsWith('[errore') ? t : null;
}
function semina() {
  const E = process.env;
  if (!get('cloudflare_token') && E.CLOUDFLARE_API_TOKEN) set('cloudflare_token', encrypt(E.CLOUDFLARE_API_TOKEN));
  if (!get('cloudflare_zona') && E.CLOUDFLARE_ZONE_ID) set('cloudflare_zona', E.CLOUDFLARE_ZONE_ID);
  if (!get('cloudflare_dominio') && E.CLOUDFLARE_ZONE_NAME) set('cloudflare_dominio', E.CLOUDFLARE_ZONE_NAME);
  if (!get('cloudflare_ip') && E.CLOUDFLARE_ORIGIN_IP) set('cloudflare_ip', E.CLOUDFLARE_ORIGIN_IP);
}
semina();
const token = tokenSalvato;
function impostazioni() { return { zona: get('cloudflare_zona') || '', dominio: get('cloudflare_dominio') || 'platform-core.it', ip: get('cloudflare_ip') || '' }; }
function stato() { const t = tokenSalvato(); return { configurato: !!t, hint: t ? '…' + t.slice(-4) : null, ...impostazioni() }; }
function salvaToken(t) { set('cloudflare_token', encrypt(t)); }
function togliToken() { db.prepare("DELETE FROM cloud_settings WHERE key = 'cloudflare_token'").run(); }
function salvaImpostazioni({ zona, dominio, ip }) {
  if (ip !== undefined) { if (ip !== '' && !/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) throw Object.assign(new Error('L\'indirizzo del NAS è un IPv4, ad esempio 93.45.12.7.'), { status: 400 }); set('cloudflare_ip', ip); }
  if (zona !== undefined) { if (zona !== '' && !/^[a-f0-9]{32}$/i.test(zona)) throw Object.assign(new Error('L\'ID della zona è di 32 caratteri esadecimali (lo trovi nella panoramica del dominio su Cloudflare).'), { status: 400 }); set('cloudflare_zona', zona); }
  if (dominio !== undefined) { if (!/^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(dominio)) throw Object.assign(new Error('Dominio non valido.'), { status: 400 }); set('cloudflare_dominio', dominio.toLowerCase()); }
}

async function chiama(percorso, tok) {
  const res = await fetch(API + percorso, { headers: { Authorization: 'Bearer ' + tok }, signal: AbortSignal.timeout(15000) });
  const dati = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok && !(dati && dati.success === false), dati };
}
const motivo = (r) => String((r.dati && r.dati.errors && r.dati.errors[0] && r.dati.errors[0].message) || ('risposta ' + r.status)).slice(0, 160);

// Controllo: solo GET. Il token si prova con /user/tokens/verify; la zona con /zones/{id}; i record con l'elenco DNS (serve DNS in lettura);
// la modalità SSL si legge se il token lo permette (non è necessario). Ritorna sempre un quadro.
async function controlla(tok = token()) {
  if (!tok) return { ok: false, motivo: 'Nessun token: incollalo in Impostazioni → Server.' };
  const { zona, dominio } = impostazioni();
  const out = { ok: false, token: null, zona: null, record: null, ssl: null, avvisi: [] };
  try {
    const v = await chiama('/user/tokens/verify', tok);
    if (v.status === 401 || v.status === 403 || !v.ok) { out.token = { ok: false, motivo: 'Cloudflare non riconosce il token (' + motivo(v) + ').' }; return out; }
    if (v.dati && v.dati.result && v.dati.result.status && v.dati.result.status !== 'active') { out.token = { ok: false, motivo: 'Il token non è attivo (stato: ' + v.dati.result.status + ').' }; return out; }
    out.token = { ok: true };
    if (!zona) { out.avvisi.push('Manca l\'ID della zona: scrivilo qui sotto (panoramica del dominio su Cloudflare, colonna a destra).'); return out; }
    const z = await chiama('/zones/' + encodeURIComponent(zona), tok);
    if (!z.ok) { out.zona = { ok: false, motivo: z.status === 403 || z.status === 404 ? 'Il token non vede questa zona: controlla l\'ID e che il token sia limitato a quella zona.' : 'Cloudflare ha risposto: ' + motivo(z) }; return out; }
    out.zona = { ok: true, nome: z.dati.result.name, stato: z.dati.result.status };
    if (z.dati.result.name !== dominio) out.avvisi.push('La zona è «' + z.dati.result.name + '» ma il dominio dei tenant è «' + dominio + '».');
    const d = await chiama('/zones/' + encodeURIComponent(zona) + '/dns_records?per_page=100', tok);
    if (d.ok) out.record = { totale: (d.dati.result_info && d.dati.result_info.total_count) || d.dati.result.length, nomi: d.dati.result.map((r) => ({ nome: r.name, tipo: r.type, contenuto: r.content, proxy: !!r.proxied })) };
    else out.avvisi.push('I record DNS non si leggono: al token manca «DNS» in lettura (serve in scrittura per creare i tenant).');
    const s = await chiama('/zones/' + encodeURIComponent(zona) + '/settings/ssl', tok).catch(() => null);
    if (s && s.ok) { out.ssl = s.dati.result.value; if (out.ssl !== 'strict') out.avvisi.push('La modalità SSL è «' + out.ssl + '»: per i server dei tenant serve «strict» (Full strict).'); }
    else out.avvisi.push('La modalità SSL non si legge con questo token (non è necessario): controllala a mano, deve essere Full (strict).');
    out.ok = true;
    return out;
  } catch (e) {
    return { ok: false, motivo: 'Non riesco a raggiungere Cloudflare (' + String((e && e.message) || e).slice(0, 80) + ').' };
  }
}
async function validaToken(t) {
  const c = await controlla(t);
  return c.token && c.token.ok ? { ok: true } : { ok: false, reason: (c.token && c.token.motivo) || c.motivo || 'Token non valido.' };
}

module.exports = { token, stato, salvaToken, togliToken, salvaImpostazioni, controlla, validaToken, impostazioni };
