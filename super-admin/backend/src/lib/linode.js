'use strict';
// Collegamento di Super Admin a Linode (Akamai Cloud): ogni tenant potrà vivere su un suo Nanode.
// Questo file fa DUE cose sole: custodisce il token (cifrato, mai restituito: si vede solo «configurato» e le ultime 4 cifre) e lo controlla con SOLE LETTURE.
// Non crea, non modifica e non cancella nulla su Linode: la creazione dei server verrà dopo, con il suo riepilogo del costo.
const crypto = require('crypto');
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

async function chiama(percorso, tok, opzioni = {}) {
  const res = await fetch(API + percorso, { method: opzioni.metodo || 'GET', headers: { ...(tok ? { Authorization: 'Bearer ' + tok } : {}), ...(opzioni.corpo ? { 'Content-Type': 'application/json' } : {}) }, body: opzioni.corpo ? JSON.stringify(opzioni.corpo) : undefined, signal: AbortSignal.timeout(30000) });
  const dati = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, dati };
}
const motivo = (r) => String((r.dati && r.dati.errors && r.dati.errors[0] && r.dati.errors[0].reason) || ('risposta ' + r.status)).slice(0, 160);

// Orfano = creato da Platform (etichetta «tenant-…» o tag «platform»), non collegato a nessun tenant, vecchio di almeno 15 minuti
// (un server appena creato non ha ancora il suo tenant: si collega a fine creazione). I server fatti a mano non si toccano mai.
const ETA_MINIMA_ORFANO_MS = 15 * 60 * 1000;
function eOrfano(s, usati) {
  const nostro = /^tenant-/.test(s.label || '') || (s.tags || []).includes('platform');
  if (!nostro || usati.has(Number(s.id))) return false;
  const nato = Date.parse(s.created);
  return Number.isFinite(nato) ? Date.now() - nato >= ETA_MINIMA_ORFANO_MS : false;
}

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
    const usati = new Set(db.prepare('SELECT linode_id FROM tenants WHERE linode_id IS NOT NULL').all().map((r) => Number(r.linode_id)));
    out.server = ((l.dati && l.dati.data) || []).map((s) => ({ id: s.id, nome: s.label, stato: s.status, regione: s.region, tipo: s.type, ip: (s.ipv4 || [])[0] || null, backup: !!(s.backups && s.backups.enabled), orfano: eOrfano(s, usati) }));
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

// ── Scritture: solo il driver dei server le usa, ognuna dietro una conferma del costo ──────────────────────────────────────────────────────────────
const MAX_SERVER_PREDEFINITO = 5; // freno alla spesa: oltre questo numero di server Super Admin non ne crea (si cambia da cloud_settings.max_server)
function maxServer() { const v = Number(get('max_server')); return Number.isInteger(v) && v > 0 ? v : MAX_SERVER_PREDEFINITO; }
function pass() { const c = crypto.randomBytes(24).toString('base64').replace(/[+/=]/g, 'x'); return c + 'aA1!'; } // la password di root non serve a nessuno: si entra solo con la chiave, e questa non si conserva

// Crea un server. `chiavi` = chiavi pubbliche autorizzate. Ritorna { id, ip, stato }. Rifiuta se ci sono già troppi server.
async function creaServer({ nome, chiavi, tags = ['platform'], backup = true }) {
  const tok = token(); if (!tok) throw Object.assign(new Error('Nessun token Linode: salvalo in Impostazioni → Server.'), { status: 503 });
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(nome)) throw Object.assign(new Error('Nome del server non valido.'), { status: 400 });
  const gia = await chiama('/linode/instances?page_size=100', tok);
  if (!gia.ok) throw Object.assign(new Error('Linode non risponde: ' + motivo(gia)), { status: 502 });
  const n = ((gia.dati && gia.dati.data) || []).length;
  if (n >= maxServer()) throw Object.assign(new Error('Ci sono già ' + n + ' server su Linode (il massimo che Super Admin crea da solo è ' + maxServer() + '): se ne servono di più si alza il limite.'), { status: 409 });
  const { regione, tipo } = impostazioni();
  const r = await chiama('/linode/instances', tok, { metodo: 'POST', corpo: { label: nome, region: regione, type: tipo, image: 'linode/ubuntu24.04', root_pass: pass(), authorized_keys: chiavi, backups_enabled: !!backup, booted: true, tags } });
  if (!r.ok) throw Object.assign(new Error('Linode non ha creato il server: ' + motivo(r)), { status: 502 });
  return { id: r.dati.id, ip: (r.dati.ipv4 || [])[0] || null, stato: r.dati.status };
}
async function leggiServer(id) {
  const r = await chiama('/linode/instances/' + Number(id), token());
  if (r.status === 404) return null;
  if (!r.ok) throw Object.assign(new Error('Linode non risponde: ' + motivo(r)), { status: 502 });
  return { id: r.dati.id, stato: r.dati.status, ip: (r.dati.ipv4 || [])[0] || null };
}
async function eliminaServer(id) {
  const r = await chiama('/linode/instances/' + Number(id), token(), { metodo: 'DELETE' });
  if (r.status === 404) return { eliminato: false, motivo: 'non esiste già più' };
  if (!r.ok) throw Object.assign(new Error('Linode non ha cancellato il server: ' + motivo(r)), { status: 502 });
  return { eliminato: true };
}

// Cancella un server SOLO se in questo momento risulta orfano (riletto da Linode, non fidandosi della pagina).
async function eliminaOrfano(id) {
  const c = await controlla();
  if (!c.ok) throw Object.assign(new Error(c.motivo || (c.token && c.token.motivo) || 'Linode non risponde.'), { status: 502 });
  const s = c.server.find((x) => x.id === Number(id));
  if (!s) throw Object.assign(new Error('Questo server non esiste più su Linode.'), { status: 404 });
  if (!s.orfano) throw Object.assign(new Error('Questo server non risulta orfano (è collegato a un tenant, è appena nato o non è stato creato da Platform): non lo tocco.'), { status: 409 });
  return eliminaServer(s.id);
}

module.exports = { eliminaOrfano, creaServer, leggiServer, eliminaServer, maxServer, token, stato, salvaToken, togliToken, salvaImpostazioni, controlla, validaToken, impostazioni, PREDEFINITI };
