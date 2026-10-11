'use strict';
// Report su WhatsApp. Tre messaggi, ognuno risponde a una sola domanda e non parte se non c'è niente da dire:
//   pagare    «quanto devo pagare»: ogni 27 (se cade nel fine settimana, il venerdì prima) tutto ciò che è "da pagare" dal giorno del report al 26 del
//             mese dopo, più le voci scadute, con il totale per modulo e, se il progetto lo dichiara, «ultimo stipendio → ti restano».
//   smistare  le righe ancora nello stato "nuovo" (es. bollette da Gmail): ogni sera, finché la coda non è vuota.
//   scadute   le voci "da pagare" con la scadenza passata: una volta a settimana.
// Quali moduli contano, cosa significa "da pagare" o "nuovo", e come si chiamano le righe lo dichiara il modulo (Builder → Avvisi, vedi module-roles.js):
// qui non ci sono nomi di moduli né di campi. Giorno e ora sono quelli italiani. Sostituisce il vecchio «Riepilogo del mattino».
const db = require('./db');
const whatsapp = require('./whatsapp');
const { logAudit } = require('./audit-log');

const TAG = 'scadenza'; // i destinatari con questo tag ricevono i report (lo stesso degli avvisi per riga)
const TZ = 'Europe/Rome';
const LATE_DAYS = 45; // oltre questa soglia una riga "da pagare" è un residuo vecchio, non una scadenza
const KINDS = ['pagare', 'smistare', 'scadute'];
const FINESTRA_ORE = 5; // dopo l'ora scelta il report può ancora partire per 5 ore (utile se il NAS era spento all'ora esatta)
const MAX_PAGARE = 25, MAX_SMISTARE = 8, MAX_SCADUTE = 10;

const DEFAULTS = {
  pagare: { enabled: true, day: 27, hour: 18, stipendio: true },
  smistare: { enabled: true, hour: 19 },
  scadute: { enabled: true, weekday: 1, hour: 19 }, // 1 = lunedì
};

// la tabella report_sent (un report già mandato = una riga kind+key) è creata in db.js

const fmtEur = (n) => Number(n || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const humanize = (v) => { const t = String(v || '').replace(/_/g, ' ').trim(); return t.charAt(0).toUpperCase() + t.slice(1); };
const shortDate = (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7);

function romeParts(now) {
  const p = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false }).formatToParts(now);
  const get = (t) => p.find((x) => x.type === t).value;
  return { date: get('year') + '-' + get('month') + '-' + get('day'), hour: parseInt(get('hour'), 10) % 24 };
}
function addDays(iso, n) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
const weekdayOf = (iso) => new Date(iso + 'T00:00:00Z').getUTCDay(); // 0 domenica … 6 sabato
const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
const pad = (n) => String(n).padStart(2, '0');

// Giorno in cui parte il report «da pagare» per il mese di `iso`: il giorno scelto (27) o, se cade di sabato o domenica, il venerdì prima.
function sendDateFor(iso, day) {
  const d = iso.slice(0, 7) + '-' + pad(day);
  const w = weekdayOf(d);
  return w === 6 ? addDays(d, -1) : w === 0 ? addDays(d, -2) : d;
}
// Fine del periodo: il giorno prima del giorno-paga del mese dopo (27 → 26).
function endOfWindow(iso, day) {
  const y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7));
  const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
  return ny + '-' + pad(nm) + '-' + pad(day - 1);
}

// ── impostazioni (JSON in tenant_settings.report_settings, con i valori di partenza) ────────────────────────────────────
function settings() {
  let saved = {};
  try { const r = db.prepare('SELECT report_settings s FROM tenant_settings WHERE id = 1').get(); saved = r && r.s ? JSON.parse(r.s) : {}; } catch (e) { saved = {}; }
  const out = {};
  for (const k of KINDS) out[k] = { ...DEFAULTS[k], ...(saved[k] || {}) };
  return out;
}
function saveSettings(kind, patch) {
  if (!KINDS.includes(kind)) return { error: 'Report sconosciuto' };
  const cur = settings(), next = { ...cur[kind] };
  const p = patch || {};
  const int = (v, lo, hi) => { const n = parseInt(v, 10); return Number.isInteger(n) && n >= lo && n <= hi ? n : null; };
  if (p.enabled != null) next.enabled = !!p.enabled;
  if (p.hour != null) { const h = int(p.hour, 6, 22); if (h == null) return { error: "L'ora deve essere tra le 6 e le 22." }; next.hour = h; }
  if (kind === 'pagare' && p.day != null) { const d = int(p.day, 2, 28); if (d == null) return { error: 'Il giorno deve essere tra 2 e 28.' }; next.day = d; }
  if (kind === 'pagare' && p.stipendio != null) next.stipendio = !!p.stipendio;
  if (kind === 'scadute' && p.weekday != null) { const w = int(p.weekday, 0, 6); if (w == null) return { error: 'Giorno della settimana non valido.' }; next.weekday = w; }
  cur[kind] = next;
  db.prepare('UPDATE tenant_settings SET report_settings = ? WHERE id = 1').run(JSON.stringify(cur));
  return { settings: cur };
}
// I vecchi avvisi «scadenza» per singola riga (e il report periodico) non devono sommarsi ai report: con almeno un report acceso restano muti.
function isEnabled() { const s = settings(); return KINDS.some((k) => s[k].enabled); }

// ── lettura dei dati, sempre attraverso ciò che i moduli dichiarano ───────────────────────────────────────────────────
function avvisiModules() {
  let declared = [];
  try { declared = require('./module-roles').list({ use: 'avvisi' }); } catch (e) { /* tabella non pronta */ }
  return declared.map((m) => ({ slug: m.module_slug, label: m.avvisi.label || String(m.name || m.module_slug).toLowerCase(), roles: { stato: '_stato', ...m.roles }, states: m.avvisi.states, scadenze: !!m.avvisi.scadenze, nuovo: !!m.avvisi.nuovo, noun_s: m.avvisi.noun_s, noun_p: m.avvisi.noun_p }));
}
function rows(slug) {
  const out = [];
  for (const r of db.prepare('SELECT data FROM records WHERE module_slug = ?').all(slug)) { try { out.push(JSON.parse(r.data)); } catch (e) { /* riga illeggibile */ } }
  return out;
}
// Le righe "da pagare" dei moduli che hanno acceso le scadenze, con la loro scadenza (`scadenza` se c'è, altrimenti `data`).
function daPagare() {
  const items = [];
  for (const m of avvisiModules()) {
    if (!m.scadenze || !m.states.da_fare) continue;
    const R = m.roles;
    for (const d of rows(m.slug)) {
      if (d[R.stato || '_stato'] !== m.states.da_fare) continue;
      const due = d[R.scadenza || 'scadenza'] || d[R.data || 'data'];
      if (!due) continue;
      items.push({ descrizione: String(d[R.descrizione || 'descrizione'] || '(senza descrizione)').trim(), label: m.label, importo: Number(d[R.importo || 'importo']) || 0, due: String(due).slice(0, 10) });
    }
  }
  return items;
}
// Ultimo stipendio: l'entrata più recente in una delle categorie dichiarate come stipendio (Builder → Riepiloghi), nel modulo di tipo entrata.
function ultimoStipendio() {
  let best = null;
  try {
    for (const m of require('./module-roles').list()) {
      const cats = ((m.riepiloghi || {}).salary_categories) || [];
      if (m.kind !== 'entrata' || !cats.length || !m.roles || !m.roles.categoria || !m.roles.importo || !m.roles.data) continue;
      for (const d of rows(m.module_slug)) {
        if (!cats.includes(d[m.roles.categoria])) continue;
        const data = String(d[m.roles.data] || '').slice(0, 10);
        if (data && (!best || data > best.data)) best = { data, importo: Number(d[m.roles.importo]) || 0 };
      }
    }
  } catch (e) { /* tabella non pronta */ }
  return best;
}

// ── i tre messaggi ────────────────────────────────────────────────────────────────────────────────────────────────────
function buildPagare(now = new Date()) {
  const s = settings().pagare, today = romeParts(now).date;
  const fine = endOfWindow(today, s.day), lateFrom = addDays(today, -LATE_DAYS);
  const tutti = daPagare();
  const scadute = tutti.filter((x) => x.due < today && x.due >= lateFrom);
  const nel = tutti.filter((x) => x.due >= today && x.due <= fine);
  const tot = (a) => a.reduce((t, x) => t + x.importo, 0);
  const totale = tot(nel) + tot(scadute);
  const perModulo = {};
  [...nel, ...scadute].forEach((x) => { perModulo[x.label] = (perModulo[x.label] || 0) + x.importo; });
  const parts = ['*💳 Da pagare dal ' + shortDate(today) + ' al ' + shortDate(fine) + '*'];
  if (!nel.length && !scadute.length) { parts.push('Niente da pagare in questo periodo.'); return { text: parts.join('\n\n'), counts: { voci: 0, scadute: 0, totale: 0 } }; }
  const dettaglio = Object.entries(perModulo).map(([l, v]) => l + ' ' + fmtEur(v)).join(' · ');
  parts.push('*Totale: ' + fmtEur(totale) + '*' + (Object.keys(perModulo).length > 1 ? ' (' + dettaglio + ')' : '') + (scadute.length ? '\ndi cui scadute: ' + fmtEur(tot(scadute)) + ' (' + scadute.length + (scadute.length === 1 ? ' voce' : ' voci') + ')' : ''));
  const righe = [...scadute.map((x) => ({ ...x, scad: true })), ...nel].sort((a, b) => a.due.localeCompare(b.due) || b.importo - a.importo);
  const lines = righe.slice(0, MAX_PAGARE).map((x) => shortDate(x.due) + ' ' + x.descrizione + ' — ' + fmtEur(x.importo) + ' (' + x.label + ')' + (x.scad ? ' ⚠' : ''));
  if (righe.length > MAX_PAGARE) lines.push('… e altre ' + (righe.length - MAX_PAGARE));
  parts.push(lines.join('\n'));
  if (s.stipendio) {
    const st = ultimoStipendio();
    if (st) { const resto = st.importo - totale; parts.push('Ultimo stipendio ' + fmtEur(st.importo) + ' (' + shortDate(st.data) + ') → ' + (resto >= 0 ? 'ti restano ' + fmtEur(resto) : 'mancano ' + fmtEur(-resto))); }
  }
  return { text: parts.join('\n\n'), counts: { voci: nel.length, scadute: scadute.length, totale } };
}

function buildSmistare() {
  const righe = []; let nome = null;
  for (const m of avvisiModules()) {
    if (!m.nuovo || !m.states.nuovo) continue;
    const R = m.roles;
    for (const d of rows(m.slug)) {
      if (d[R.stato || '_stato'] !== m.states.nuovo) continue;
      nome = nome || { s: m.noun_s || 'riga', p: m.noun_p || 'righe', stato: m.states.nuovo };
      const imp = Number(d[R.importo || 'importo']) || 0, scad = d[R.scadenza || 'scadenza'] || d[R.data || 'data'];
      righe.push(String(d[R.descrizione || 'descrizione'] || '(senza descrizione)').trim() + ' — ' + (imp > 0 ? fmtEur(imp) : 'importo da verificare') + (scad ? ' · ' + shortDate(String(scad).slice(0, 10)) : ''));
    }
  }
  if (!righe.length) return null;
  const n = righe.length;
  const lines = righe.slice(0, MAX_SMISTARE).map((x) => '• ' + x);
  if (n > MAX_SMISTARE) lines.push('… e altre ' + (n - MAX_SMISTARE));
  return { text: '*📥 Da smistare: ' + n + ' ' + (n === 1 ? nome.s : nome.p) + '*\n\n' + lines.join('\n') + '\n\nApri l\'app per smistarle: finché ce ne sono, ti arriva ogni sera.', counts: { voci: n } };
}

function buildScadute(now = new Date()) {
  const today = romeParts(now).date, lateFrom = addDays(today, -LATE_DAYS);
  const s = daPagare().filter((x) => x.due < today && x.due >= lateFrom).sort((a, b) => a.due.localeCompare(b.due));
  if (!s.length) return null;
  const totale = s.reduce((t, x) => t + x.importo, 0);
  const lines = s.slice(0, MAX_SCADUTE).map((x) => '• ' + x.descrizione + ' (' + x.label + ') ' + fmtEur(x.importo) + ' — da ' + daysBetween(x.due, today) + ' giorni (' + shortDate(x.due) + ')');
  if (s.length > MAX_SCADUTE) lines.push('… e altre ' + (s.length - MAX_SCADUTE));
  return { text: '*⚠ Voci scadute (' + s.length + ') — ' + fmtEur(totale) + '*\n\n' + lines.join('\n') + '\n\nSe le hai già pagate, spuntale nella Checklist e non arrivano più.', counts: { voci: s.length, totale } };
}

const build = (kind, now) => (kind === 'pagare' ? buildPagare(now) : kind === 'smistare' ? buildSmistare(now) : kind === 'scadute' ? buildScadute(now) : null);
const LABEL = { pagare: 'Report: da pagare', smistare: 'Report: da smistare', scadute: 'Report: voci scadute' };

function writeLog(kind, esito, descrizione) {
  try { db.prepare("INSERT INTO automation_logs (module_slug, automation_label, trigger_desc, action_desc, esito) VALUES ('sistema', ?, ?, ?, ?)").run(LABEL[kind], 'pianificato', String(descrizione).slice(0, 400), esito); } catch (e) { /* mai bloccare */ }
}

// Invia un report ora. Ritorna { esito }: 'inviato' | 'parziale' | 'FALLITO' | 'nulla da segnalare' | 'non configurato'.
async function sendReport(kind, { now = new Date(), actor = 'sistema' } = {}) {
  if (!KINDS.includes(kind)) return { esito: 'FALLITO', motivo: 'Report sconosciuto' };
  const row = db.prepare("SELECT credentials FROM connections WHERE integration_id = 'whatsapp_callmebot'").get();
  let creds = null; try { creds = row && row.credentials ? JSON.parse(row.credentials) : null; } catch (e) { /* illeggibili */ }
  if (!creds || !creds.api_key) return { esito: 'non configurato', motivo: 'WhatsApp (CallMeBot) non è collegato' };
  const dest = require('./notification-settings').recipientsForTag(TAG);
  if (!dest.length) return { esito: 'non configurato', motivo: 'Nessun destinatario attivo con il tag "' + TAG + '"' };
  const r = build(kind, now);
  if (!r) { writeLog(kind, 'nulla da segnalare', 'Niente da segnalare'); return { esito: 'nulla da segnalare' }; }
  const out = await whatsapp.sendAll({ destinatari: dest, testo: r.text, apiKey: creds.api_key, kind: 'report' });
  writeLog(kind, out.esito, JSON.stringify(r.counts) + ' — ' + out.dettaglio);
  logAudit(actor, 'report.send.' + kind, null, { esito: out.esito });
  return { esito: out.esito, dettaglio: out.dettaglio, counts: r.counts };
}

// Il report è «dovuto» adesso? Ritorna la chiave che lo identifica (per non mandarlo due volte) oppure null.
function dueKey(kind, s, now) {
  const { date, hour } = romeParts(now);
  const inFinestra = hour >= s.hour && hour < s.hour + FINESTRA_ORE;
  if (kind === 'pagare') {
    const sd = sendDateFor(date, s.day), payday = date.slice(0, 7) + '-' + pad(s.day);
    if (date === sd) return hour >= s.hour ? sd : null;
    return date > sd && date <= payday ? sd : null; // il NAS era spento il giorno stabilito: parte appena torna, fino al giorno-paga
  }
  if (kind === 'smistare') return inFinestra ? date : null;
  if (kind === 'scadute') return weekdayOf(date) === s.weekday && inFinestra ? date : null;
  return null;
}

let running = false;
// Controllo ogni minuto. La chiave si segna PRIMA dell'invio: un errore non deve trasformarsi in un messaggio ogni minuto.
async function tick(now = new Date()) {
  if (running) return { skipped: 'in corso' };
  if (!require('./features').isEnabled('riepilogo_mattino')) return { skipped: 'funzione non attiva' };
  running = true;
  const fatti = [];
  try {
    const all = settings();
    for (const kind of KINDS) {
      const s = all[kind];
      if (!s.enabled) continue;
      const key = dueKey(kind, s, now);
      if (!key) continue;
      if (db.prepare('SELECT 1 FROM report_sent WHERE kind = ? AND key = ?').get(kind, key)) continue;
      if (kind !== 'pagare' && !build(kind, now)) continue; // niente da dire: non si segna, può ancora arrivare qualcosa entro la finestra
      db.prepare('INSERT OR IGNORE INTO report_sent (kind, key) VALUES (?, ?)').run(kind, key);
      fatti.push({ kind, key, ...(await sendReport(kind, { now })) });
    }
  } finally { running = false; }
  return { inviati: fatti };
}

function lastSent() {
  const out = {};
  for (const k of KINDS) { const r = db.prepare('SELECT key, sent_at FROM report_sent WHERE kind = ? ORDER BY sent_at DESC, rowid DESC LIMIT 1').get(k); out[k] = r ? r.sent_at : null; }
  return out;
}

function startReports() {
  const { withLock } = require('./scheduler-lock');
  const guarded = withLock('reports', 55000, tick);
  setInterval(() => { Promise.resolve().then(() => guarded()).catch((e) => console.error('[report]', e.message)); }, 60 * 1000);
  console.log('Report su WhatsApp: controllo ogni minuto (da pagare il 27, da smistare ogni sera, scadute il lunedì)');
}

module.exports = { KINDS, TAG, DEFAULTS, settings, saveSettings, isEnabled, build, buildPagare, buildSmistare, buildScadute, sendReport, tick, dueKey, lastSent, startReports, romeParts, sendDateFor, endOfWindow, addDays, weekdayOf };
