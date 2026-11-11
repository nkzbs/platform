'use strict';
// MESSAGGI AI CLIENTI: gli auguri di compleanno (automatici, una volta al giorno) e l'invio di massa (su richiesta), per mail e/o SMS.
//  - Mail: lib/email.js (connessione email_resend del tenant).  SMS: SMS v2 di OpenAPI.it (POST /IT-messages), mittente = alias registrato e approvato nella console di OpenAPI (Impostazioni → «Messaggi ai clienti»).
//  - Regole sempre attive: SOLO a chi ha il consenso alle comunicazioni commerciali (il campo lo dichiara il blocco), un tetto di messaggi al giorno, un registro di tutto ciò che parte (e di ciò che è stato saltato e perché),
//    la mail ha sempre la riga per non ricevere più messaggi. Un canale non disponibile (SMS non abilitato o senza mittente) si salta e lo dice: l'altro canale parte lo stesso.
// Nessun nome di modulo o di campo scritto qui: arrivano dal blocco `external_action` con adapter `messaggio_cliente` (campi: nome, email, telefono, consenso, data_nascita).
const db = require('../db');

db.exec(`CREATE TABLE IF NOT EXISTS messaggi_inviati (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quando TEXT DEFAULT CURRENT_TIMESTAMP,
  tipo TEXT NOT NULL,
  modulo TEXT, record_id INTEGER,
  canale TEXT NOT NULL,
  esito TEXT NOT NULL,
  motivo TEXT,
  utente TEXT
)`);
db.exec('CREATE TABLE IF NOT EXISTS messaggi_impostazioni (chiave TEXT PRIMARY KEY, valore TEXT NOT NULL)');

const PREDEFINITI = {
  sms_mittente: '',
  tetto_giornaliero: 200,
  footer_mail: 'Non vuoi più ricevere questi messaggi? Rispondi a questa mail e ti cancelliamo subito.',
  auguri: { attivi: false, canali: ['mail'], oggetto: 'Tanti auguri, {nome}!', testo: 'Caro {nome}, tanti auguri di buon compleanno da tutti noi!' },
};
const leggi = (k) => { const r = db.prepare('SELECT valore FROM messaggi_impostazioni WHERE chiave = ?').get(k); if (!r) return PREDEFINITI[k]; try { return JSON.parse(r.valore); } catch (e) { return PREDEFINITI[k]; } };
const scrivi = (k, v) => db.prepare('INSERT INTO messaggi_impostazioni (chiave, valore) VALUES (?, ?) ON CONFLICT(chiave) DO UPDATE SET valore = excluded.valore').run(k, JSON.stringify(v));
const impostazioni = () => ({ sms_mittente: leggi('sms_mittente'), tetto_giornaliero: leggi('tetto_giornaliero'), footer_mail: leggi('footer_mail'), auguri: { ...PREDEFINITI.auguri, ...(leggi('auguri') || {}) } });

function salvaImpostazioni(b = {}) {
  if (b.sms_mittente !== undefined) {
    const m = String(b.sms_mittente || '').trim();
    if (m && !/^[A-Za-z0-9 ._&-]{3,11}$/.test(m)) return { errore: 'Il mittente degli SMS ha da 3 a 11 caratteri (lettere, numeri, spazio, punto, trattino) e deve essere già registrato e approvato nella console di OpenAPI.it.' };
    scrivi('sms_mittente', m);
  }
  if (b.tetto_giornaliero !== undefined) {
    const t = Number(b.tetto_giornaliero);
    if (!(t >= 1 && t <= 5000)) return { errore: 'Il tetto di messaggi al giorno è un numero da 1 a 5000.' };
    scrivi('tetto_giornaliero', Math.round(t));
  }
  if (b.footer_mail !== undefined) scrivi('footer_mail', String(b.footer_mail || '').slice(0, 300));
  if (b.auguri !== undefined) {
    const a = b.auguri || {}, att = impostazioni().auguri;
    const canali = (Array.isArray(a.canali) ? a.canali : att.canali).filter((c) => ['mail', 'sms'].includes(c));
    if (a.attivi && !canali.length) return { errore: 'Scegli almeno un canale per gli auguri (mail o SMS).' };
    scrivi('auguri', { attivi: !!a.attivi, canali, oggetto: String(a.oggetto !== undefined ? a.oggetto : att.oggetto).slice(0, 150), testo: String(a.testo !== undefined ? a.testo : att.testo).slice(0, 600) });
  }
  return { ok: true };
}

// {nome} → primo nome, {nome_completo}, {cognome}. Un segnaposto sconosciuto resta com'è (si vede subito nell'anteprima).
function riempi(testo, dati, C) {
  const completo = String((dati && dati[C.nome]) || '').trim();
  const [primo, ...resto] = completo.split(/\s+/);
  return String(testo || '').replace(/\{nome_completo\}/g, completo).replace(/\{nome\}/g, primo || '').replace(/\{cognome\}/g, resto.join(' '));
}

// +39…: 3331234567 / 333 123 4567 / 0039333… / +39 333…  → E.164. Niente numero valido → null (il record si salta, non si indovina).
function numeroE164(raw) {
  let t = String(raw || '').replace(/[\s().-]/g, '');
  if (t.startsWith('00')) t = '+' + t.slice(2);
  if (/^3\d{8,9}$/.test(t)) t = '+39' + t;
  return /^\+\d{9,15}$/.test(t) ? t : null;
}
const haConsenso = (v) => v === true || v === 1 || /^(1|true|s[iì]|yes|on)$/i.test(String(v || '').trim());
const mailValida = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim());

const oggi = () => new Date().toISOString().slice(0, 10);
const inviatiOggi = () => db.prepare("SELECT COUNT(*) n FROM messaggi_inviati WHERE esito = 'inviato' AND substr(quando, 1, 10) = ?").get(oggi()).n;
function registra({ tipo, modulo, record_id, canale, esito, motivo, utente }) {
  db.prepare('INSERT INTO messaggi_inviati (tipo, modulo, record_id, canale, esito, motivo, utente) VALUES (?, ?, ?, ?, ?, ?, ?)').run(tipo, modulo || null, record_id || null, canale, esito, String(motivo || '').slice(0, 300) || null, utente || null);
}

// Quali canali possono partire ORA? mail: SMTP o Resend (Posta in uscita); sms: servizio abilitato + mittente scritto.
async function canaliDisponibili() {
  const mail = require('./email');
  const st = mail.stato();
  const out = { mail: { ok: st.ok, via: st.via, motivo: st.motivo }, sms: { ok: false, motivo: '' } };
  const mitt = impostazioni().sms_mittente;
  if (!mitt) out.sms.motivo = 'Manca il mittente degli SMS (Impostazioni → Messaggi ai clienti): deve essere un alias registrato e approvato nella console di OpenAPI.it.';
  else {
    const a = await require('./openapi-it').servizioAttivo('sms_italia', 'sms', [['POST', '/IT-messages']]);
    out.sms = a.ok ? { ok: true, motivo: null } : { ok: false, motivo: 'Il servizio SMS di OpenAPI.it non è abilitato sulla chiave collegata.' };
  }
  return out;
}

// Prepara (senza spedire) cosa partirebbe per una lista di record: chi sì, chi no e perché, quanti SMS e quanto costano.
async function prepara({ records, config, canali, testoSms }) {
  const C = config.campi || {}; const disp = await canaliDisponibili();
  const sceltiOk = canali.filter((c) => disp[c] && disp[c].ok);
  const saltati = []; const pronti = [];
  for (const r of records) {
    const d = r.data || {};
    if (!haConsenso(d[C.consenso])) { saltati.push({ id: r.id, motivo: 'senza consenso alle comunicazioni commerciali' }); continue; }
    const canaliRec = [];
    if (sceltiOk.includes('mail') && mailValida(d[C.email])) canaliRec.push('mail');
    if (sceltiOk.includes('sms') && numeroE164(d[C.telefono])) canaliRec.push('sms');
    if (!canaliRec.length) { saltati.push({ id: r.id, motivo: 'nessun contatto utilizzabile per i canali scelti' }); continue; }
    pronti.push({ record: r, canali: canaliRec });
  }
  const nSms = pronti.filter((p) => p.canali.includes('sms')).length, nMail = pronti.filter((p) => p.canali.includes('mail')).length;
  const segmenti = Math.max(1, Math.ceil(String(testoSms || '').length / 160));
  const prezzo = require('./openapi-spese').prezzo('sms_italia');
  return { pronti, saltati, canali: { richiesti: canali, disponibili: sceltiOk, non_disponibili: canali.filter((c) => !sceltiOk.includes(c)).map((c) => ({ canale: c, motivo: disp[c] && disp[c].motivo })) },
    mail: nMail, sms: nSms, costo_sms: prezzo === null ? null : Math.round(nSms * segmenti * prezzo * 1000) / 1000, segmenti_sms: segmenti };
}

async function inviaMail({ dati, C, oggetto, testo }) {
  const email = require('./email');
  const corpo = riempi(testo, dati, C);
  const html = email.htmlDaTesto(corpo, { piede: impostazioni().footer_mail || '' });
  return email.invia({ to: String(dati[C.email]).trim(), subject: riempi(oggetto, dati, C), html });
}
async function inviaSms({ dati, C, testo }) {
  const mitt = impostazioni().sms_mittente;
  const spese = require('./openapi-spese');
  const r = await require('./openapi-it').chiama({ dominio: 'sms', metodo: 'POST', percorso: '/IT-messages', corpo: { sender: mitt, recipient: numeroE164(dati[C.telefono]), message: riempi(testo, dati, C) }, scopi: [['POST', '/IT-messages']] });
  const m = (r && r.data) || {};
  spese.registra({ servizio: 'sms_italia', descrizione: 'SMS · ' + String(m.recipient || '').slice(0, 20), costo: Number(m.totalPrice) || (spese.prezzo('sms_italia') || 0) * (m.messageCount || 1), utente: 'messaggi', riferimento: 'sms#' + (m.id || '') });
  return { ok: true };
}

// Spedisce ai `pronti` (da prepara). Rispetta il tetto giornaliero (si ferma, non scarta di nascosto) e registra ogni invio. Un errore su un destinatario non ferma gli altri.
async function spedisci({ pronti, config, tipo, modulo, oggetto, testoMail, testoSms, utente }) {
  const C = config.campi || {}; const tetto = impostazioni().tetto_giornaliero; const esiti = { inviati: 0, falliti: 0, fermati_dal_tetto: 0 };
  for (const p of pronti) {
    const d = p.record.data || {};
    for (const canale of p.canali) {
      if (inviatiOggi() >= tetto) { esiti.fermati_dal_tetto++; registra({ tipo, modulo, record_id: p.record.id, canale, esito: 'fermato', motivo: 'tetto giornaliero di ' + tetto + ' messaggi raggiunto', utente }); continue; }
      try {
        const r = canale === 'mail' ? await inviaMail({ dati: d, C, oggetto, testo: testoMail }) : await inviaSms({ dati: d, C, testo: testoSms });
        if (r.ok) { esiti.inviati++; registra({ tipo, modulo, record_id: p.record.id, canale, esito: 'inviato', utente }); } else { esiti.falliti++; registra({ tipo, modulo, record_id: p.record.id, canale, esito: 'fallito', motivo: r.motivo, utente }); }
      } catch (e) { esiti.falliti++; registra({ tipo, modulo, record_id: p.record.id, canale, esito: 'fallito', motivo: e.message, utente }); }
    }
  }
  return esiti;
}

// Auguri di oggi: i record del modulo con il compleanno oggi (giorno e mese della data di nascita), una sola volta per record per anno (il registro lo ricorda).
const compleannoOggi = (dataNascita, ora = new Date()) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dataNascita || '')); return !!m && Number(m[2]) === ora.getMonth() + 1 && Number(m[3]) === ora.getDate(); };
const giaAuguriQuestAnno = (modulo, id, anno) => !!db.prepare("SELECT 1 FROM messaggi_inviati WHERE tipo = 'auguri' AND modulo = ? AND record_id = ? AND esito = 'inviato' AND substr(quando, 1, 4) = ?").get(modulo, id, String(anno));

async function eseguiAuguri({ ora = new Date() } = {}) {
  const imp = impostazioni().auguri;
  if (!imp.attivi) return { saltato: 'auguri non attivi' };
  const moduli = db.prepare('SELECT slug, schema_json FROM modules WHERE installed = 1 AND active = 1').all();
  const out = [];
  for (const m of moduli) {
    let schema; try { schema = require('../schema-v3').parseSchemaNormalized(m.schema_json); } catch (e) { continue; }
    for (const cfg of (schema.external_actions || []).filter((x) => x.adapter === 'messaggio_cliente' && x.automatico === 'compleanno')) {
      const C = cfg.campi || {};
      const recs = db.prepare('SELECT id, data FROM records WHERE module_slug = ?').all(m.slug).map((r) => ({ id: r.id, data: JSON.parse(r.data || '{}') }))
        .filter((r) => compleannoOggi(r.data[C.data_nascita], ora) && !giaAuguriQuestAnno(m.slug, r.id, ora.getFullYear()));
      if (!recs.length) continue;
      const prep = await prepara({ records: recs, config: cfg, canali: imp.canali, testoSms: riempi(imp.testo, {}, C) });
      for (const s of prep.saltati) registra({ tipo: 'auguri', modulo: m.slug, record_id: s.id, canale: '-', esito: 'saltato', motivo: s.motivo, utente: 'automatico' });
      const e = await spedisci({ pronti: prep.pronti, config: cfg, tipo: 'auguri', modulo: m.slug, oggetto: imp.oggetto, testoMail: imp.testo, testoSms: imp.testo, utente: 'automatico' });
      out.push({ modulo: m.slug, compleanni: recs.length, ...e, saltati: prep.saltati.length });
    }
  }
  return { fatto: out };
}

// Un controllo ogni 30 minuti: dalle 09:00 ora italiana, una sola volta al giorno (il marcatore sta nelle impostazioni).
function avviaAuguri() {
  const tick = async () => {
    try {
      const adesso = new Date();
      const ora = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', hour12: false }).format(adesso)) % 24;
      if (ora < 9 || leggi('ultimo_auguri') === oggi()) return;
      if (!impostazioni().auguri.attivi) return;
      scrivi('ultimo_auguri', oggi());
      const r = await eseguiAuguri({ ora: adesso });
      if (r.fatto && r.fatto.length) console.log('[auguri] ' + JSON.stringify(r.fatto));
    } catch (e) { console.error('[auguri] errore:', e.message); }
  };
  setTimeout(tick, 90 * 1000); setInterval(tick, 30 * 60 * 1000);
  console.log('Auguri di compleanno: controllo ogni 30 minuti, dalle 09:00 (spenti finché non li attivi in Impostazioni → Messaggi ai clienti)');
}

const registroRecente = (limite = 50) => db.prepare('SELECT * FROM messaggi_inviati ORDER BY id DESC LIMIT ?').all(limite);
module.exports = { impostazioni, salvaImpostazioni, riempi, numeroE164, haConsenso, canaliDisponibili, prepara, spedisci, eseguiAuguri, avviaAuguri, compleannoOggi, registroRecente, inviatiOggi, _leggi: leggi };
