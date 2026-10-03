'use strict';
// Riepilogo del mattino: UN messaggio WhatsApp al giorno con le spese da pagare oggi, domani e in
// ritardo, al posto di un messaggio per ogni riga. Spento di default; quando è acceso sostituisce
// gli avvisi "scadenza oggi" per riga (vedi automation-engine.js).
//
// La data di scadenza di una spesa è `scadenza` se c'è, altrimenti `data`: le righe di Finance usano
// quasi sempre solo `data`. Giorno e ora sono quelli ITALIANI (Europe/Rome), non UTC.
const db = require('./db');
const whatsapp = require('./whatsapp');
const { logAudit } = require('./audit-log');

// Valori di partenza se nessun modulo ha dichiarato di lavorare negli avvisi (vedi module-roles.js).
const FALLBACK_MODULES = [{ slug: 'spese_casa', label: 'casa', roles: {} }, { slug: 'spese_personali', label: 'pers.', roles: {} }];
const SHORT = { spese_casa: 'casa', spese_personali: 'pers.' };
function digestModules() {
  let declared = [];
  try { declared = require('./module-roles').list({ kind: 'spesa', use: 'avvisi' }); } catch (e) { /* tabella non pronta */ }
  if (!declared.length) return FALLBACK_MODULES;
  return declared.map((m) => ({ slug: m.module_slug, label: SHORT[m.module_slug] || String(m.name || m.module_slug).toLowerCase(), roles: m.roles }));
}
const TAG = 'scadenza'; // lo stesso tag degli avvisi per riga: chi li riceveva riceve il riepilogo
const LATE_DAYS = 45; // oltre questa soglia una riga "da pagare" è un residuo vecchio, non un ritardo
const MAX_LINES = 5;
const TZ = 'Europe/Rome';

const fmtEur = (n) => Number(n || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';

// Data e ora in Italia per un istante dato.
function romeParts(now) {
  const p = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false }).formatToParts(now);
  const get = (t) => p.find((x) => x.type === t).value;
  return { date: get('year') + '-' + get('month') + '-' + get('day'), hour: parseInt(get('hour'), 10) % 24 };
}
function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const shortDate = (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7);
function weekdayLabel(iso) {
  const d = new Intl.DateTimeFormat('it-IT', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(iso + 'T00:00:00Z'));
  return d.charAt(0).toUpperCase() + d.slice(1);
}

function settings() {
  const row = db.prepare('SELECT digest_enabled, digest_hour, digest_last_sent FROM tenant_settings WHERE id = 1').get() || {};
  return { enabled: !!row.digest_enabled, hour: Number.isInteger(row.digest_hour) ? row.digest_hour : 8, lastSent: row.digest_last_sent || null };
}
function isEnabled() { return settings().enabled; }
function saveSettings({ enabled, hour }) {
  if (enabled != null) db.prepare('UPDATE tenant_settings SET digest_enabled = ? WHERE id = 1').run(enabled ? 1 : 0);
  if (hour != null) {
    const h = parseInt(hour, 10);
    if (Number.isInteger(h) && h >= 5 && h <= 12) db.prepare('UPDATE tenant_settings SET digest_hour = ? WHERE id = 1').run(h);
  }
  return settings();
}

// Costruisce il messaggio per il giorno di `now`. Ritorna null se non c'è nulla da segnalare.
function buildDigest(now = new Date()) {
  const today = romeParts(now).date;
  const tomorrow = addDays(today, 1);
  const lateFrom = addDays(today, -LATE_DAYS);
  const groups = { oggi: [], domani: [], ritardo: [] };
  let daSmistare = 0;
  for (const { slug, label, roles } of digestModules()) {
    const fStato = roles.stato || '_stato', fScad = roles.scadenza || 'scadenza', fData = roles.data || 'data', fDesc = roles.descrizione || 'descrizione', fImp = roles.importo || 'importo';
    for (const r of db.prepare('SELECT data FROM records WHERE module_slug = ?').all(slug)) {
      let d; try { d = JSON.parse(r.data); } catch (e) { continue; }
      if (d[fStato] === 'da_smistare') { daSmistare++; continue; }
      if (d[fStato] !== 'da_pagare') continue;
      const due = d[fScad] || d[fData];
      if (!due) continue;
      const item = { descrizione: String(d[fDesc] || '(senza descrizione)').trim(), label, importo: Number(d[fImp]) || 0, due };
      if (due === today) groups.oggi.push(item);
      else if (due === tomorrow) groups.domani.push(item);
      else if (due < today && due >= lateFrom) groups.ritardo.push(item);
    }
  }
  if (!groups.oggi.length && !groups.domani.length && !groups.ritardo.length && !daSmistare) return null;

  const block = (title, items, showDate) => {
    if (!items.length) return null;
    const sorted = [...items].sort((a, b) => a.due.localeCompare(b.due) || b.importo - a.importo);
    const total = sorted.reduce((s, x) => s + x.importo, 0);
    const lines = sorted.slice(0, MAX_LINES).map((x) => '• ' + x.descrizione + ' (' + x.label + ') ' + fmtEur(x.importo) + (showDate ? ' dal ' + shortDate(x.due) : ''));
    if (sorted.length > MAX_LINES) lines.push('… e altre ' + (sorted.length - MAX_LINES));
    return '*' + title + ' (' + items.length + ')* — ' + fmtEur(total) + '\n' + lines.join('\n');
  };
  const parts = [
    '*Buongiorno!* ' + weekdayLabel(today),
    block('Oggi', groups.oggi, false),
    block('Domani', groups.domani, false),
    block('In ritardo', groups.ritardo, true),
    daSmistare ? '*Da smistare:* ' + daSmistare + (daSmistare === 1 ? ' bolletta' : ' bollette') : null,
  ].filter(Boolean);
  return { text: parts.join('\n\n'), counts: { oggi: groups.oggi.length, domani: groups.domani.length, ritardo: groups.ritardo.length, daSmistare } };
}

function destinatari() {
  return require('./notification-settings').recipientsForTag(TAG);
}

function writeLog(esito, descrizione) {
  try {
    db.prepare("INSERT INTO automation_logs (module_slug, automation_label, trigger_desc, action_desc, esito) VALUES ('sistema', 'Riepilogo del mattino', 'ogni giorno', ?, ?)").run(String(descrizione).slice(0, 400), esito);
  } catch (e) { /* mai bloccare */ }
}

// Invia il riepilogo ora. Ritorna { esito, ... }: 'inviato' | 'parziale' | 'FALLITO' | 'nulla da segnalare' | 'non configurato'.
async function sendDigest({ now = new Date(), actor = 'sistema' } = {}) {
  const row = db.prepare("SELECT credentials FROM connections WHERE integration_id = 'whatsapp_callmebot'").get();
  let creds = null; try { creds = row && row.credentials ? JSON.parse(row.credentials) : null; } catch (e) { /* illeggibili */ }
  if (!creds || !creds.api_key) return { esito: 'non configurato', motivo: 'WhatsApp (CallMeBot) non è collegato' };
  const dest = destinatari();
  if (!dest.length) return { esito: 'non configurato', motivo: 'Nessun destinatario attivo con il tag "' + TAG + '"' };
  const digest = buildDigest(now);
  if (!digest) { writeLog('nulla da segnalare', 'Nessuna scadenza oggi, domani o in ritardo'); return { esito: 'nulla da segnalare' }; }
  const out = await whatsapp.sendAll({ destinatari: dest, testo: digest.text, apiKey: creds.api_key });
  writeLog(out.esito, 'oggi ' + digest.counts.oggi + ', domani ' + digest.counts.domani + ', in ritardo ' + digest.counts.ritardo + ' — ' + out.dettaglio);
  logAudit(actor, 'digest.send', null, { esito: out.esito });
  return { esito: out.esito, dettaglio: out.dettaglio, counts: digest.counts };
}

let running = false;
// Controllo ogni minuto: se è acceso, l'ora italiana è quella scelta e oggi non è già partito, invia.
// Il giorno è segnato PRIMA dell'invio: un errore non deve trasformarsi in un messaggio ogni minuto.
async function tick(now = new Date()) {
  if (running) return { skipped: 'in corso' };
  if (!require('./features').isEnabled('riepilogo_mattino')) return { skipped: 'funzione non attiva' };
  const s = settings();
  if (!s.enabled) return { skipped: 'spento' };
  const { date, hour } = romeParts(now);
  if (hour !== s.hour) return { skipped: 'non è l\'ora' };
  if (s.lastSent === date) return { skipped: 'già inviato oggi' };
  running = true;
  try {
    db.prepare('UPDATE tenant_settings SET digest_last_sent = ? WHERE id = 1').run(date);
    return await sendDigest({ now });
  } finally { running = false; }
}

function startDailyDigest() {
  const { withLock } = require('./scheduler-lock');
  // withLock restituisce la funzione già protetta dal lock (con Redis) o la funzione stessa
  // (senza): va richiamata, e il risultato può non essere una promessa.
  const guarded = withLock('daily-digest', 55000, tick);
  setInterval(() => { Promise.resolve().then(() => guarded()).catch((e) => console.error('[digest]', e.message)); }, 60 * 1000);
  console.log('Riepilogo del mattino: controllo ogni minuto (spento finché non lo accendi dalle impostazioni)');
}

module.exports = { buildDigest, sendDigest, tick, settings, saveSettings, isEnabled, startDailyDigest, romeParts, TAG };
