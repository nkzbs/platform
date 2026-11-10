'use strict';
// Collegamento di Super Admin a Linode (Akamai Cloud): ogni tenant potrà vivere su un suo Nanode.
// Questo file fa DUE cose sole: custodisce il token (cifrato, mai restituito: si vede solo «configurato» e le ultime 4 cifre) e lo controlla con SOLE LETTURE.
// Non crea, non modifica e non cancella nulla su Linode: la creazione dei server verrà dopo, con il suo riepilogo del costo.
const db = require('../db');
const { encrypt, decrypt } = require('../crypto-secrets');

const API = 'https://api.linode.com/v4';
db.exec('CREATE TABLE IF NOT EXISTS cloud_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
const get = (k) => { const r = db.prepare('SELECT value FROM cloud_settings WHERE key = ?').get(k); return r ? r.value : null; };
const set = (k, v) => db.prepare('INSERT INTO cloud_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, v);

// Valori di partenza: Milano e il Nanode da 1 GB (5 $ al mese + 2 $ di backup). Sono dati, si cambiano da Impostazioni.
const PREDEFINITI = { regione: 'it-mil', tipo: 'g6-nanode-1' };

function token() {
  const v = get('linode_token');
  if (!v) return null;
  const t = decrypt(v);
  return t && !t.startsWith('[errore') ? t : null;
}
function impostazioni() { return { regione: get('regione') || PREDEFINITI.regione, tipo: get('tipo') || PREDEFINITI.tipo }; }
function stato() {
  const t = token();
  return { configurato: !!t, hint: t ? '…' + t.slice(-4) : null, ...impostazioni() };
}
function salvaToken(t) { set('linode_token', encrypt(t)); }
function togliToken() { db.prepare("DELETE FROM cloud_settings WHERE key = 'linode_token'").run(); }
function salvaImpostazioni({ regione, tipo }) {
  if (regione !== undefined) { if (!/^[a-z0-9-]{2,30}$/.test(regione)) throw Object.assign(new Error('Regione non valida.'), { status: 400 }); set('regione', regione); }
  if (tipo !== undefined) { if (!/^[a-z0-9-]{2,40}$/.test(tipo)) throw Object.assign(new Error('Tipo di macchina non valido.'), { status: 400 }); set('tipo', tipo); }
}

async function chiama(percorso, tok) {
  const res = await fetch(API + percorso, { headers: tok ? { Authorization: 'Bearer ' + tok } : {}, signal: AbortSignal.timeout(15000) });
  const dati = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, dati };
}
const motivo = (r) => String((r.dati && r.dati.errors && r.dati.errors[0] && r.dati.errors[0].reason) || ('risposta ' + r.status)).slice(0, 160);

// Controllo: solo GET. Il token si prova con l'elenco dei server (serve il permesso «Linodes»); il saldo è facoltativo (serve «Account», lettura).
// Regione e tipo si leggono dal catalogo pubblico, senza token. Ritorna sempre un quadro, mai un'eccezione per un esito negativo.
async function controlla(tok = token()) {
  if (!tok) return { ok: false, motivo: 'Nessun token: incollalo in Impostazioni → Server (Linode).' };
  const out = { ok: false, token: null, server: [], saldo: null, regione: null, tipo: null, avvisi: [] };
  const { regione, tipo } = impostazioni();
  try {
    const l = await chiama('/linode/instances?page_size=100', tok);
    if (l.status === 401) { out.token = { ok: false, motivo: 'Linode non riconosce il token (scaduto o sbagliato).' }; return out; }
    if (l.status === 403) { out.token = { ok: false, motivo: 'Il token non ha il permesso «Linodes»: ricrealo con Linodes in lettura e scrittura.' }; return out; }
    if (!l.ok) { out.token = { ok: false, motivo: 'Linode ha risposto: ' + motivo(l) }; return out; }
    out.token = { ok: true };
    out.server = ((l.dati && l.dati.data) || []).map((s) => ({ id: s.id, nome: s.label, stato: s.status, regione: s.region, tipo: s.type, ip: (s.ipv4 || [])[0] || null, backup: !!(s.backups && s.backups.enabled) }));
    out.ok = true;
    const a = await chiama('/account', tok).catch(() => null);
    if (a && a.ok && a.dati) out.saldo = { da_pagare: a.dati.balance, uninvoiced: a.dati.balance_uninvoiced };
    else out.avvisi.push('Il saldo non si legge: al token manca «Account» in sola lettura (non è necessario per creare i server).');
    const r = await chiama('/regions/' + encodeURIComponent(regione)).catch(() => null);
    out.regione = r && r.ok ? { id: regione, nome: r.dati.label, paese: r.dati.country } : { id: regione, nome: null, avviso: 'Regione non trovata nel catalogo di Linode.' };
    const t = await chiama('/linode/types/' + encodeURIComponent(tipo)).catch(() => null);
    out.tipo = t && t.ok ? { id: tipo, nome: t.dati.label, ram_mb: t.dati.memory, disco_mb: t.dati.disk, prezzo_mese: t.dati.price && t.dati.price.monthly, backup_mese: t.dati.addons && t.dati.addons.backups && t.dati.addons.backups.price && t.dati.addons.backups.price.monthly } : { id: tipo, nome: null, avviso: 'Tipo di macchina non trovato nel catalogo di Linode.' };
    return out;
  } catch (e) {
    return { ok: false, motivo: 'Non riesco a raggiungere Linode (' + String((e && e.message) || e).slice(0, 80) + ').' };
  }
}

// Prova un token prima di salvarlo: valido solo se l'elenco dei server risponde.
async function validaToken(t) {
  const c = await controlla(t);
  return c.token && c.token.ok ? { ok: true } : { ok: false, reason: (c.token && c.token.motivo) || c.motivo || 'Token non valido.' };
}

module.exports = { stato, salvaToken, togliToken, salvaImpostazioni, controlla, validaToken, impostazioni, PREDEFINITI };
