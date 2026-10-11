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
const MAX_PAGARE = 8, MAX_SMISTARE = 6, MAX_SCADUTE = 8; // messaggi corti: il resto è «+ altre N»

const DEFAULTS = {
  canali: { whatsapp: true, telegram: true }, // dove arrivano i report; Telegram parte solo se il bot è collegato e ci sono telefoni collegati
  pagare: { enabled: true, day: 27, hour: 18, stipendio: true },
  smistare: { enabled: true, hour: 19 },
  scadute: { enabled: true, weekday: 1, hour: 19 }, // 1 = lunedì
};

// la tabella report_sent (un report già mandato = una riga kind+key) è creata in db.js

const NUM = { useGrouping: 'always' };
const fmtEur = (n) => Number(n || 0).toLocaleString('it-IT', { ...NUM, minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
// nelle righe dei messaggi i centesimi compaiono solo se ci sono: «550 €», «50,58 €»
const fmtCompact = (n) => { const v = Number(n || 0); return v.toLocaleString('it-IT', { ...NUM, minimumFractionDigits: Math.abs(v - Math.round(v)) < 0.005 ? 0 : 2, maximumFractionDigits: 2 }) + ' €'; };
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
  for (const k of [...KINDS, 'canali']) out[k] = { ...DEFAULTS[k], ...(saved[k] || {}) };
  return out;
}
function saveSettings(kind, patch) {
  if (![...KINDS, 'canali'].includes(kind)) return { error: 'Report sconosciuto' };
  const cur = settings(), next = { ...cur[kind] };
  const p = patch || {};
  if (kind === 'canali') {
    if (p.whatsapp != null) next.whatsapp = !!p.whatsapp;
    if (p.telegram != null) next.telegram = !!p.telegram;
    cur.canali = next;
    db.prepare('UPDATE tenant_settings SET report_settings = ? WHERE id = 1').run(JSON.stringify(cur));
    return { settings: cur };
  }
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
function avvisiModules(scope) {
  let declared = [];
  try { declared = require('./module-roles').list({ use: 'avvisi' }); } catch (e) { /* tabella non pronta */ }
  if (scope && scope.slugs) declared = declared.filter((m) => scope.slugs.has(m.module_slug)); // un utente vede solo i moduli che gli sono assegnati
  return declared.map((m) => ({ slug: m.module_slug, label: m.avvisi.label || String(m.name || m.module_slug).toLowerCase(), roles: { stato: '_stato', ...m.roles }, states: m.avvisi.states, scadenze: !!m.avvisi.scadenze, nuovo: !!m.avvisi.nuovo, noun_s: m.avvisi.noun_s, noun_p: m.avvisi.noun_p }));
}
// Righe di un modulo: { id, data }. Con `scope.user` (non admin) solo quelle che quell'utente può vedere (regola «solo propri» compresa).
function rows(slug, scope) {
  let recs = db.prepare('SELECT * FROM records WHERE module_slug = ?').all(slug).map((r) => { try { return { ...r, data: JSON.parse(r.data) }; } catch (e) { return null; } }).filter(Boolean);
  if (scope && scope.user && scope.user.role !== 'admin') {
    try {
      const { parseSchemaNormalized } = require('./schema-v3');
      const { ruleFor, filterViewable } = require('./permissions');
      const m = db.prepare('SELECT schema_json FROM modules WHERE slug = ?').get(slug);
      recs = filterViewable(recs, ruleFor(parseSchemaNormalized(m.schema_json), scope.user.role), scope.user);
    } catch (e) { recs = []; }
  }
  return recs.map((r) => ({ id: r.id, data: r.data }));
}
// Le righe "da pagare" dei moduli che hanno acceso le scadenze, con la loro scadenza (`scadenza` se c'è, altrimenti `data`).
function daPagare(scope) {
  const items = [];
  for (const m of avvisiModules(scope)) {
    if (!m.scadenze || !m.states.da_fare) continue;
    const R = m.roles;
    for (const { id, data: d } of rows(m.slug, scope)) {
      if (d[R.stato || '_stato'] !== m.states.da_fare) continue;
      const due = d[R.scadenza || 'scadenza'] || d[R.data || 'data'];
      if (!due) continue;
      items.push({ slug: m.slug, id, descrizione: String(d[R.descrizione || 'descrizione'] || '(senza descrizione)').trim(), label: m.label, importo: Number(d[R.importo || 'importo']) || 0, due: String(due).slice(0, 10) });
    }
  }
  return items;
}
// Ultimo stipendio: l'entrata più recente in una delle categorie dichiarate come stipendio (Builder → Riepiloghi), nel modulo di tipo entrata.
function ultimoStipendio(scope) {
  let best = null;
  try {
    for (const m of require('./module-roles').list()) {
      const cats = ((m.riepiloghi || {}).salary_categories) || [];
      if (scope && scope.slugs && !scope.slugs.has(m.module_slug)) continue;
      if (m.kind !== 'entrata' || !cats.length || !m.roles || !m.roles.categoria || !m.roles.importo || !m.roles.data) continue;
      for (const { data: d } of rows(m.module_slug, scope)) {
        if (!cats.includes(d[m.roles.categoria])) continue;
        const data = String(d[m.roles.data] || '').slice(0, 10);
        if (data && (!best || data > best.data)) best = { data, importo: Number(d[m.roles.importo]) || 0 };
      }
    }
  } catch (e) { /* tabella non pronta */ }
  return best;
}

// ── i tre messaggi ────────────────────────────────────────────────────────────────────────────────────────────────────
function buildPagare(now = new Date(), scope = null) {
  const cfg = settings(), s = cfg.pagare, today = romeParts(now).date;
  const fine = endOfWindow(today, s.day), lateFrom = addDays(today, -LATE_DAYS);
  const tutti = daPagare(scope);
  const scadute = tutti.filter((x) => x.due < today && x.due >= lateFrom).sort((a, b) => a.due.localeCompare(b.due));
  const nel = tutti.filter((x) => x.due >= today && x.due <= fine).sort((a, b) => a.due.localeCompare(b.due) || b.importo - a.importo);
  const tot = (a) => a.reduce((t, x) => t + x.importo, 0);
  const totale = tot(nel) + tot(scadute);
  const intest = '💳 *Da pagare* · fino al ' + shortDate(fine);
  if (!nel.length && !scadute.length) return { text: intest + '\n\nNiente da pagare in questo periodo.', counts: { voci: 0, scadute: 0, totale: 0 } };
  const perModulo = {};
  [...nel, ...scadute].forEach((x) => { perModulo[x.label] = (perModulo[x.label] || 0) + x.importo; });
  const parts = [intest, '*' + fmtEur(totale) + '*' + (Object.keys(perModulo).length > 1 ? '  (' + Object.entries(perModulo).map(([l, v]) => l + ' ' + fmtCompact(v)).join(' · ') + ')' : '')];
  if (scadute.length) {
    // le scadute le elenca il loro messaggio, se è acceso: qui basta il totale (non si ripetono due volte)
    parts.push('⚠ *Scadute ' + fmtCompact(tot(scadute)) + '* — ' + scadute.length + (scadute.length === 1 ? ' voce' : ' voci') + ' dal ' + shortDate(scadute[0].due)
      + (cfg.scadute.enabled ? '\n→ l\'elenco è nel messaggio «Voci scadute»' : ''));
    if (!cfg.scadute.enabled) parts.push(scadute.slice(0, MAX_PAGARE).map((x) => shortDate(x.due) + '  ' + x.descrizione + ' — ' + fmtCompact(x.importo)).join('\n'));
  }
  if (nel.length) {
    const lines = nel.slice(0, MAX_PAGARE).map((x) => shortDate(x.due) + '  ' + x.descrizione + ' — ' + fmtCompact(x.importo));
    if (nel.length > MAX_PAGARE) lines.push('+ altre ' + (nel.length - MAX_PAGARE));
    parts.push('*In arrivo*\n' + lines.join('\n'));
  }
  if (s.stipendio) {
    const st = ultimoStipendio(scope);
    if (st) { const resto = st.importo - totale; parts.push('💰 Stipendio ' + fmtCompact(st.importo) + ' → ' + (resto >= 0 ? 'restano *' + fmtCompact(resto) + '*' : 'mancano *' + fmtCompact(-resto) + '*')); }
  }
  return { text: parts.join('\n\n'), counts: { voci: nel.length, scadute: scadute.length, totale } };
}

function buildSmistare(now = new Date(), scope = null) {
  const righe = []; let nome = null;
  for (const m of avvisiModules(scope)) {
    if (!m.nuovo || !m.states.nuovo) continue;
    const R = m.roles;
    for (const { data: d } of rows(m.slug, scope)) {
      if (d[R.stato || '_stato'] !== m.states.nuovo) continue;
      nome = nome || { s: m.noun_s || 'riga', p: m.noun_p || 'righe' };
      const imp = Number(d[R.importo || 'importo']) || 0, scad = d[R.scadenza || 'scadenza'] || d[R.data || 'data'];
      righe.push(String(d[R.descrizione || 'descrizione'] || '(senza descrizione)').trim() + ' — ' + (imp > 0 ? fmtCompact(imp) : 'importo da verificare') + (scad ? ' · ' + shortDate(String(scad).slice(0, 10)) : ''));
    }
  }
  if (!righe.length) return null;
  const n = righe.length;
  const lines = righe.slice(0, MAX_SMISTARE).map((x) => '• ' + x);
  if (n > MAX_SMISTARE) lines.push('+ altre ' + (n - MAX_SMISTARE));
  return { text: '📥 *Da smistare* · ' + n + ' ' + (n === 1 ? nome.s : nome.p) + '\n\n' + lines.join('\n') + '\n\nTi ricordo ogni sera finché non le smisti.', counts: { voci: n } };
}

function buildScadute(now = new Date(), scope = null) {
  const today = romeParts(now).date, lateFrom = addDays(today, -LATE_DAYS);
  const s = daPagare(scope).filter((x) => x.due < today && x.due >= lateFrom).sort((a, b) => a.due.localeCompare(b.due));
  if (!s.length) return null;
  const totale = s.reduce((t, x) => t + x.importo, 0);
  const lines = s.slice(0, MAX_SCADUTE).map((x) => '• ' + x.descrizione + ' — ' + fmtCompact(x.importo) + ' · da ' + daysBetween(x.due, today) + ' gg');
  if (s.length > MAX_SCADUTE) lines.push('+ altre ' + (s.length - MAX_SCADUTE));
  return { text: '⚠ *Scadute* · ' + fmtEur(totale) + ' (' + s.length + (s.length === 1 ? ' voce' : ' voci') + ')\n\n' + lines.join('\n') + '\n\nGià pagate? Spuntale nella Checklist.', counts: { voci: s.length, totale }, items: s.slice(0, MAX_SCADUTE) };
}

const build = (kind, now, scope) => (kind === 'pagare' ? buildPagare(now, scope) : kind === 'smistare' ? buildSmistare(now, scope) : kind === 'scadute' ? buildScadute(now, scope) : null);
const LABEL = { pagare: 'Report: da pagare', smistare: 'Report: da smistare', scadute: 'Report: voci scadute' };

function writeLog(kind, esito, descrizione) {
  try { db.prepare("INSERT INTO automation_logs (module_slug, automation_label, trigger_desc, action_desc, esito) VALUES ('sistema', ?, ?, ?, ?)").run(LABEL[kind], 'pianificato', String(descrizione).slice(0, 400), esito); } catch (e) { /* mai bloccare */ }
}

// Invia un report ora, su tutti i canali accesi (WhatsApp e/o Telegram). Ritorna { esito }: 'inviato' | 'parziale' | 'FALLITO' | 'nulla da segnalare' | 'non configurato'.
// WhatsApp riceve il messaggio completo; ogni telefono Telegram riceve la SUA versione (solo i moduli e le righe che quell'utente può vedere), con i bottoni.
async function sendReport(kind, { now = new Date(), actor = 'sistema' } = {}) {
  if (!KINDS.includes(kind)) return { esito: 'FALLITO', motivo: 'Report sconosciuto' };
  const canali = settings().canali;
  const tg = require('./telegram');

  // WhatsApp: collegato e con almeno un destinatario?
  let waCreds = null; let dest = [];
  if (canali.whatsapp) {
    const row = db.prepare("SELECT credentials FROM connections WHERE integration_id = 'whatsapp_callmebot'").get();
    try { waCreds = row && row.credentials ? JSON.parse(row.credentials) : null; } catch (e) { waCreds = null; }
    dest = require('./notification-settings').recipientsForTag(TAG);
  }
  const waOk = !!(canali.whatsapp && waCreds && waCreds.api_key && dest.length);
  const links = canali.telegram && tg.isConfigured() ? tg.listLinks() : [];
  const tgOk = links.length > 0;
  if (!waOk && !tgOk) {
    const motivo = !canali.whatsapp && !canali.telegram ? 'Tutti i canali sono spenti'
      : canali.whatsapp && !(waCreds && waCreds.api_key) ? 'WhatsApp (CallMeBot) non è collegato' + (canali.telegram ? ' e nessun telefono è collegato a Telegram' : '')
      : canali.whatsapp && !dest.length ? 'Nessun destinatario attivo con il tag "' + TAG + '"' : 'Nessun telefono collegato a Telegram';
    return { esito: 'non configurato', motivo };
  }
  const r = build(kind, now);
  if (!r) { writeLog(kind, 'nulla da segnalare', 'Niente da segnalare'); return { esito: 'nulla da segnalare' }; }

  const parti = []; // { canale, ok, dettaglio }
  if (waOk) {
    const out = await whatsapp.sendAll({ destinatari: dest, testo: r.text, apiKey: waCreds.api_key, kind: 'report' });
    parti.push({ canale: 'WhatsApp', ok: out.esito === 'inviato' ? 1 : out.esito === 'parziale' ? 0.5 : 0, dettaglio: out.dettaglio });
  }
  if (tgOk) {
    for (const l of links) {
      const user = tg.linkedUser(l.chat_id);
      if (!user) continue;
      const mio = build(kind, now, tg.scopeFor(user)); // la versione di questo utente
      if (!mio) continue;                               // niente da dire per lui: nessun messaggio
      const o = await tg.sendReportTo(l.chat_id, kind, mio);
      parti.push({ canale: 'Telegram', ok: o.ok ? 1 : 0, dettaglio: (user.display_name || user.username) + (o.ok ? ' ✓' : ' ✗ ' + o.reason) });
    }
  }
  const tot = parti.length, somma = parti.reduce((t, p) => t + p.ok, 0);
  const esito = !tot ? 'nulla da segnalare' : somma === tot ? 'inviato' : somma === 0 ? 'FALLITO' : 'parziale';
  const dettaglio = parti.map((p) => p.canale + ': ' + p.dettaglio).join(' | ');
  writeLog(kind, esito, JSON.stringify(r.counts) + ' — ' + dettaglio);
  logAudit(actor, 'report.send.' + kind, null, { esito });
  return { esito, dettaglio, counts: r.counts };
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

module.exports = { rows, avvisiModules, KINDS, TAG, DEFAULTS, settings, saveSettings, isEnabled, build, buildPagare, buildSmistare, buildScadute, sendReport, tick, dueKey, lastSent, startReports, romeParts, sendDateFor, endOfWindow, addDays, weekdayOf };
