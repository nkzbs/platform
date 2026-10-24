'use strict';
// Report su WhatsApp e Telegram: DEFINIZIONI configurabili, non tre messaggi fissi. Ogni definizione sceglie un TIPO (una primitiva generica) e i suoi parametri;
// se ne possono avere quante se ne vuole, anche dello stesso tipo, dalle impostazioni. I tipi:
//   riepilogo_periodo  «quanto devo pagare»: le righe nello stato scelto (di solito «da fare») con scadenza dal giorno del report al giorno prima del mese dopo, più
//                      le scadute, con il totale per modulo e, se si vuole, «ultimo stipendio → ti restano». Mensile (se il giorno cade nel weekend, il venerdì prima).
//   coda               le righe in uno stato (di solito «nuovo»: da smistare): giornaliero o settimanale, solo se ce ne sono.
//   in_ritardo         le righe nello stato scelto con la scadenza passata (da quanti giorni): giornaliero o settimanale, solo se ce ne sono.
//   ore_periodo        le ore lavorate dai moduli di timbrature (ruoli data/inizio/fine) in un periodo, per persona. Mensile o settimanale.
//   ore_settimana      il riepilogo ore di una persona: la settimana, il mese in corso e lo straordinario (oltre una soglia settimanale). Di solito la domenica sera.
// Quali moduli contano, cosa significa «da fare» o «nuovo», come si chiamano le righe, e cosa sono le timbrature lo dichiara il modulo (Builder → Ruoli del modulo):
// qui non ci sono nomi di moduli né di campi. Giorno e ora sono quelli italiani. I tre report storici (pagare, smistare, scadute) sono tre definizioni di partenza.
const db = require('./db');
const whatsapp = require('./whatsapp');
const { logAudit } = require('./audit-log');
const oreCalc = require('./ore-calc');

const TAG = 'scadenza'; // i destinatari con questo tag ricevono i report (lo stesso degli avvisi per riga)
const TZ = 'Europe/Rome';
const FINESTRA_ORE = 5; // dopo l'ora scelta il report può ancora partire per 5 ore (utile se il NAS era spento all'ora esatta)
const STATI = ['nuovo', 'da_fare', 'fatto']; // i tre stati che un modulo dichiara (Builder → Avvisi)

// I tipi di report: nome, frequenze ammesse, descrizione e valori di partenza dei parametri.
const TIPI = {
  riepilogo_periodo: {
    nome: 'Totale in un periodo', frequenze: ['mensile'],
    descrizione: 'Tutto ciò che è nello stato scelto dal giorno del report al giorno prima del mese dopo, più le voci scadute: totale, divisione per modulo ed elenco per data.',
    vuoto: 'Niente da pagare in questo periodo.',
    base: { stato: 'da_fare', freq: 'mensile', giorno: 27, ora: 18, weekend: 'venerdi_prima', stipendio: true, include_scadute: true, scadute_max_giorni: 45, max_righe: 8, titolo: 'Da pagare', emoji: '💳', invia_se_vuoto: true },
  },
  coda: {
    nome: 'Righe da trattare', frequenze: ['giornaliera', 'settimanale'],
    descrizione: 'Le righe che sono nello stato scelto (di solito «nuovo», da smistare), finché ce ne sono.',
    vuoto: 'Niente da segnalare: il messaggio non partirebbe.',
    base: { stato: 'nuovo', freq: 'giornaliera', weekday: 1, ora: 19, max_righe: 6, titolo: 'Da smistare', emoji: '📥', piede: 'Ti ricordo ogni sera finché non le smisti.', invia_se_vuoto: false },
  },
  in_ritardo: {
    nome: 'Voci in ritardo', frequenze: ['settimanale', 'giornaliera'],
    descrizione: 'Le righe nello stato scelto con la scadenza passata, con da quanti giorni. Se le hai già chiuse non arrivano più.',
    vuoto: 'Niente in ritardo: il messaggio non partirebbe.',
    base: { stato: 'da_fare', freq: 'settimanale', weekday: 1, ora: 19, scadute_max_giorni: 45, max_righe: 8, titolo: 'Scadute', emoji: '⚠', piede: 'Già pagate? Spuntale nella Checklist.', invia_se_vuoto: false },
  },
  ore_settimana: {
    nome: 'Riepilogo ore e straordinari', frequenze: ['settimanale'],
    descrizione: 'Le ore lavorate nella settimana, il mese finora e lo straordinario (le ore oltre la soglia settimanale), per ogni persona. Ogni telefono Telegram riceve solo le sue.',
    vuoto: 'Nessuna timbratura nella settimana: il messaggio non partirebbe.',
    base: { freq: 'settimanale', weekday: 0, ora: 20, soglia_ore: 40, mese: true, titolo: 'Ore lavorate', emoji: '🕒', invia_se_vuoto: false },
  },
  ore_periodo: {
    nome: 'Ore lavorate', frequenze: ['mensile', 'settimanale'],
    descrizione: 'Le ore lavorate (dai moduli di timbrature) in un periodo, per persona. Ogni telefono Telegram riceve solo le sue.',
    vuoto: 'Nessuna timbratura nel periodo: il messaggio non partirebbe.',
    base: { freq: 'mensile', giorno: 1, weekday: 1, ora: 9, weekend: 'nessuno', periodo: 'mese_scorso', titolo: 'Ore lavorate', emoji: '🕒', invia_se_vuoto: false },
  },
};
const FREQUENZE = ['mensile', 'giornaliera', 'settimanale'];
// A chi arriva (per ogni definizione): `utenti` = gli utenti che li ricevono su Telegram (vuoto = tutti i telefoni collegati), `tag` = il tag dei destinatari WhatsApp.
const DESTINATARI = { utenti: [], tag: 'scadenza' };

// Le definizioni di partenza: i tre report storici (stessi id, così un messaggio già mandato non si ripete dopo l'aggiornamento).
const DEFAULTS = {
  canali: { whatsapp: true, telegram: true }, // dove arrivano i report; Telegram parte solo se il bot è collegato e ci sono telefoni collegati
  definizioni: [
    { id: 'pagare', tipo: 'riepilogo_periodo', nome: 'Quanto devo pagare', enabled: true },
    { id: 'smistare', tipo: 'coda', nome: 'Da smistare', enabled: true },
    { id: 'scadute', tipo: 'in_ritardo', nome: 'Voci scadute', enabled: true },
  ],
};

// la tabella report_sent (un report già mandato = una riga kind+key; kind = id della definizione) è creata in db.js

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

// ── impostazioni (JSON in tenant_settings.report_settings: { canali, definizioni: [...] }) ─────────────────────────────────
const completa = (d) => ({ ...DESTINATARI, ...TIPI[d.tipo].base, ...d }); // una definizione con tutti i parametri (quelli non salvati prendono il valore di partenza del tipo)
const ID = /^[a-z][a-z0-9_]{1,30}$/; // l'id è anche il comando del bot (/id)
function leggi() { try { const r = db.prepare('SELECT report_settings s FROM tenant_settings WHERE id = 1').get(); return r && r.s ? JSON.parse(r.s) : {}; } catch (e) { return {}; } }
function scrivi(obj) { db.prepare('UPDATE tenant_settings SET report_settings = ? WHERE id = 1').run(JSON.stringify(obj)); }
// Impostazioni salvate nella forma vecchia (una chiave per report: { pagare: { day, hour, … } }) → definizioni.
function dalleVecchie(saved) {
  return DEFAULTS.definizioni.map((d) => {
    const v = saved[d.id] || {}, o = { ...d };
    if (v.enabled != null) o.enabled = !!v.enabled;
    if (v.hour != null) o.ora = v.hour;
    if (v.day != null) o.giorno = v.day;
    if (v.weekday != null) o.weekday = v.weekday;
    if (v.stipendio != null) o.stipendio = !!v.stipendio;
    return o;
  });
}
function settings() {
  const saved = leggi();
  const grezze = Array.isArray(saved.definizioni) ? saved.definizioni : dalleVecchie(saved);
  const definizioni = grezze.filter((d) => d && ID.test(String(d.id)) && TIPI[d.tipo]).map(completa);
  const out = { canali: { ...DEFAULTS.canali, ...(saved.canali || {}) }, definizioni };
  definizioni.forEach((d) => { out[d.id] = d; }); // accesso comodo per id (settings().pagare)
  return out;
}
const definizione = (id) => settings().definizioni.find((d) => d.id === id) || null;
const salva = (s) => scrivi({ canali: s.canali, definizioni: s.definizioni.map(({ ...d }) => d) });

const word = (v, n) => String(v == null ? '' : v).replace(/[\r\n*_]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
function saveSettings(id, patch) {
  const cur = settings(), p = patch || {};
  if (id === 'canali') {
    if (p.whatsapp != null) cur.canali.whatsapp = !!p.whatsapp;
    if (p.telegram != null) cur.canali.telegram = !!p.telegram;
    salva(cur);
    return { settings: settings() };
  }
  const d = cur.definizioni.find((x) => x.id === id);
  if (!d) return { error: 'Report sconosciuto' };
  const T = TIPI[d.tipo];
  const int = (v, lo, hi) => { const n = parseInt(v, 10); return Number.isInteger(n) && n >= lo && n <= hi ? n : null; };
  if (p.enabled != null) d.enabled = !!p.enabled;
  const ora = p.ora != null ? p.ora : p.hour; // `hour`, `day`: i nomi della forma vecchia
  if (ora != null) { const h = int(ora, 6, 22); if (h == null) return { error: "L'ora deve essere tra le 6 e le 22." }; d.ora = h; }
  const giorno = p.giorno != null ? p.giorno : p.day;
  if (giorno != null) { const g = int(giorno, d.tipo === 'riepilogo_periodo' ? 2 : 1, 28); if (g == null) return { error: 'Il giorno deve essere tra ' + (d.tipo === 'riepilogo_periodo' ? 2 : 1) + ' e 28.' }; d.giorno = g; }
  if (p.weekday != null) { const w = int(p.weekday, 0, 6); if (w == null) return { error: 'Giorno della settimana non valido.' }; d.weekday = w; }
  if (p.freq != null) { if (!T.frequenze.includes(p.freq)) return { error: 'Questo tipo di report non può essere «' + p.freq + '».' }; d.freq = p.freq; }
  if (p.weekend != null) { if (!['venerdi_prima', 'nessuno'].includes(p.weekend)) return { error: 'Scelta non valida.' }; d.weekend = p.weekend; }
  if (p.stato != null && 'stato' in T.base) { if (!STATI.includes(p.stato)) return { error: 'Stato non valido.' }; d.stato = p.stato; }
  if (p.periodo != null && 'periodo' in T.base) { if (!oreCalc.PERIODI[p.periodo]) return { error: 'Periodo non valido.' }; d.periodo = p.periodo; }
  if (p.max_righe != null) { const n = int(p.max_righe, 1, 30); if (n == null) return { error: 'Le righe mostrate vanno da 1 a 30.' }; d.max_righe = n; }
  if (p.scadute_max_giorni != null) { const n = int(p.scadute_max_giorni, 1, 365); if (n == null) return { error: 'I giorni vanno da 1 a 365.' }; d.scadute_max_giorni = n; }
  if (p.utenti != null) {
    if (!Array.isArray(p.utenti)) return { error: 'Scelta degli utenti non valida.' };
    const ids = [...new Set(p.utenti.map((x) => parseInt(x, 10)).filter((x) => Number.isInteger(x) && x > 0))];
    if (ids.some((x) => !db.prepare('SELECT 1 FROM users WHERE id = ?').get(x))) return { error: 'Utente non trovato.' };
    d.utenti = ids;
  }
  if (p.tag != null) { const t = String(p.tag).trim(); if (!/^[A-Za-z0-9_-]{1,40}$/.test(t)) return { error: 'Il tag può avere lettere, numeri, - e _.' }; d.tag = t; }
  if (p.soglia_ore != null) { const n = int(p.soglia_ore, 1, 100); if (n == null) return { error: 'La soglia va da 1 a 100 ore.' }; d.soglia_ore = n; }
  if (p.mese != null) d.mese = !!p.mese;
  if (p.stipendio != null) d.stipendio = !!p.stipendio;
  if (p.include_scadute != null) d.include_scadute = !!p.include_scadute;
  if (p.invia_se_vuoto != null) d.invia_se_vuoto = !!p.invia_se_vuoto;
  for (const [k, n] of [['nome', 40], ['titolo', 40], ['piede', 120], ['emoji', 8]]) if (p[k] != null) d[k] = word(p[k], n);
  if (!d.nome) d.nome = T.nome;
  salva(cur);
  return { settings: settings() };
}
// Un report nuovo di un tipo, spento finché non lo si accende (non deve partire un messaggio a sorpresa).
function addDefinition(tipo, nome) {
  if (!TIPI[tipo]) return { error: 'Tipo di report sconosciuto' };
  const cur = settings();
  let n = 1; while (cur.definizioni.some((d) => d.id === tipo + '_' + n)) n++;
  const d = { id: tipo + '_' + n, tipo, nome: word(nome, 40) || TIPI[tipo].nome, enabled: false };
  cur.definizioni.push(d); salva(cur);
  return { id: d.id, settings: settings() };
}
function removeDefinition(id) {
  const cur = settings();
  if (!cur.definizioni.some((d) => d.id === id)) return { error: 'Report sconosciuto' };
  cur.definizioni = cur.definizioni.filter((d) => d.id !== id); salva(cur);
  return { settings: settings() };
}
// I vecchi avvisi «scadenza» per singola riga (e il report periodico) non devono sommarsi ai report: con almeno un report acceso restano muti.
function isEnabled() { return settings().definizioni.some((d) => d.enabled); }

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
// Le righe nello stato dichiarato (nuovo / da fare / fatto) dei moduli che hanno acceso gli avvisi giusti (le scadenze per «da fare», la coda per «nuovo»),
// con la loro scadenza (`scadenza` se c'è, altrimenti `data`). Chi chiede `conData` non vuole le righe senza scadenza.
function righeInStato(scope, stato, conData = true) {
  const items = [];
  for (const m of avvisiModules(scope)) {
    if (!m.states[stato]) continue;
    if (stato === 'da_fare' && !m.scadenze) continue;
    if (stato === 'nuovo' && !m.nuovo) continue;
    const R = m.roles;
    for (const { id, data: d } of rows(m.slug, scope)) {
      if (d[R.stato || '_stato'] !== m.states[stato]) continue;
      const due = d[R.scadenza] || d[R.data];
      if (conData && !due) continue;
      items.push({ slug: m.slug, id, descrizione: String(d[R.descrizione] || '(senza descrizione)').trim(), label: m.label, noun_s: m.noun_s, noun_p: m.noun_p, importo: R.importo ? Number(d[R.importo]) || 0 : null, due: due ? String(due).slice(0, 10) : '' }); // importo null = il modulo non ha un campo importo (es. un ticket)
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

// ── i messaggi, uno per tipo ───────────────────────────────────────────────────────────────────────────────────────
const intestazione = (d, resto) => d.emoji + ' *' + d.titolo + '*' + (resto ? ' · ' + resto : '');

function buildRiepilogo(d, now = new Date(), scope = null) {
  const cfg = settings(), today = romeParts(now).date;
  const fine = endOfWindow(today, d.giorno), lateFrom = addDays(today, -d.scadute_max_giorni);
  const tutti = righeInStato(scope, d.stato);
  const scadute = d.include_scadute ? tutti.filter((x) => x.due < today && x.due >= lateFrom).sort((a, b) => a.due.localeCompare(b.due)) : [];
  const nel = tutti.filter((x) => x.due >= today && x.due <= fine).sort((a, b) => a.due.localeCompare(b.due) || b.importo - a.importo);
  const tot = (a) => a.reduce((t, x) => t + (x.importo || 0), 0);
  const totale = tot(nel) + tot(scadute);
  const intest = intestazione(d, 'fino al ' + shortDate(fine));
  if (!nel.length && !scadute.length) return { text: intest + '\n\n' + TIPI.riepilogo_periodo.vuoto, counts: { voci: 0, scadute: 0, totale: 0 } };
  const perModulo = {};
  [...nel, ...scadute].forEach((x) => { perModulo[x.label] = (perModulo[x.label] || 0) + (x.importo || 0); });
  // Una riga per voce, con la data in grassetto come "chiave" (si legge a colpo d'occhio scorrendo
  // l'elenco) e un punto elenco — stessa lettura di buildCoda() qui sotto, non un concetto nuovo.
  const riga = (x) => '• *' + shortDate(x.due) + '*  ' + x.descrizione + (x.importo == null ? '' : ' — ' + fmtCompact(x.importo));
  const parts = [intest, '*' + fmtEur(totale) + '*' + (Object.keys(perModulo).length > 1 ? '  (' + Object.entries(perModulo).map(([l, v]) => l + ' ' + fmtCompact(v)).join(' · ') + ')' : '')];
  if (scadute.length) {
    // le scadute le elenca il report «in ritardo», se ce n'è uno acceso: qui basta il totale (non si ripetono due volte)
    const altro = cfg.definizioni.find((x) => x.tipo === 'in_ritardo' && x.enabled && x.stato === d.stato);
    parts.push('⚠ *Scadute ' + fmtCompact(tot(scadute)) + '* — ' + scadute.length + (scadute.length === 1 ? ' voce' : ' voci') + ' dal ' + shortDate(scadute[0].due)
      + (altro ? '\n→ l\'elenco è nel messaggio «' + altro.nome + '»' : ''));
    if (!altro) parts.push(scadute.slice(0, d.max_righe).map(riga).join('\n'));
  }
  if (nel.length) {
    const lines = nel.slice(0, d.max_righe).map(riga);
    if (nel.length > d.max_righe) lines.push('+ altre ' + (nel.length - d.max_righe));
    parts.push('*In arrivo*\n' + lines.join('\n'));
  }
  if (d.stipendio) {
    const st = ultimoStipendio(scope);
    if (st) { const resto = st.importo - totale; parts.push('💰 Stipendio ' + fmtCompact(st.importo) + ' → ' + (resto >= 0 ? 'restano *' + fmtCompact(resto) + '*' : 'mancano *' + fmtCompact(-resto) + '*')); }
  }
  return { text: parts.join('\n\n'), counts: { voci: nel.length, scadute: scadute.length, totale } };
}

function buildCoda(d, now = new Date(), scope = null) {
  const righe = []; let nome = null;
  for (const x of righeInStato(scope, d.stato, false)) {
    nome = nome || { s: x.noun_s || 'riga', p: x.noun_p || 'righe' };
    righe.push(x.descrizione + (x.importo == null ? '' : ' — ' + (x.importo > 0 ? fmtCompact(x.importo) : 'importo da verificare')) + (x.due ? ' · ' + shortDate(x.due) : ''));
  }
  if (!righe.length) return null;
  const n = righe.length;
  const lines = righe.slice(0, d.max_righe).map((x) => '• ' + x);
  if (n > d.max_righe) lines.push('+ altre ' + (n - d.max_righe));
  return { text: intestazione(d, n + ' ' + (n === 1 ? nome.s : nome.p)) + '\n\n' + lines.join('\n') + (d.piede ? '\n\n' + d.piede : ''), counts: { voci: n } };
}

function buildInRitardo(d, now = new Date(), scope = null) {
  const today = romeParts(now).date, lateFrom = addDays(today, -d.scadute_max_giorni);
  const s = righeInStato(scope, d.stato).filter((x) => x.due < today && x.due >= lateFrom).sort((a, b) => a.due.localeCompare(b.due));
  if (!s.length) return null;
  const totale = s.reduce((t, x) => t + (x.importo || 0), 0), conImporto = s.some((x) => x.importo != null);
  const lines = s.slice(0, d.max_righe).map((x) => '• ' + x.descrizione + (x.importo == null ? '' : ' — ' + fmtCompact(x.importo)) + ' · da ' + daysBetween(x.due, today) + ' gg');
  if (s.length > d.max_righe) lines.push('+ altre ' + (s.length - d.max_righe));
  return { text: intestazione(d, (conImporto ? fmtEur(totale) + ' (' : '(') + s.length + (s.length === 1 ? ' voce' : ' voci') + ')') + '\n\n' + lines.join('\n') + (d.piede ? '\n\n' + d.piede : ''), counts: { voci: s.length, totale }, items: s.slice(0, d.max_righe) };
}

// Ore lavorate per persona. Con `scope.user` (non admin) solo le righe che quell'utente vede; senza scope (WhatsApp) tutte, divise per chi le ha create.
function buildOre(d, now = new Date(), scope = null) {
  const iv = oreCalc.intervallo(d.periodo, romeParts(now).date);
  const persone = new Map(); let aperti = 0;
  for (const m of require('./module-roles').list({ kind: 'presenze' })) {
    if (scope && scope.slugs && !scope.slugs.has(m.module_slug)) continue;
    const R = m.roles; if (!R.data || !R.inizio || !R.fine) continue;
    const owner = new Map(db.prepare('SELECT r.id, COALESCE(u.display_name, u.username) AS nome FROM records r LEFT JOIN users u ON u.id = r.user_id WHERE r.module_slug = ?').all(m.module_slug).map((r) => [r.id, r.nome || '—']));
    const perNome = new Map();
    for (const r of rows(m.module_slug, scope)) { const n = owner.get(r.id) || '—'; (perNome.get(n) || perNome.set(n, []).get(n)).push({ d: r.data }); }
    for (const [n, righe] of perNome) {
      const s = oreCalc.somma(righe, R, iv); aperti += s.aperti;
      if (!s.giorni.size) continue;
      const e = persone.get(n) || { min: 0, giorni: 0 }; e.min += s.totale; e.giorni += s.giorni.size; persone.set(n, e);
    }
  }
  if (!persone.size) return null;
  const lines = [...persone.entries()].sort((a, b) => b[1].min - a[1].min).map(([n, e]) => '• ' + n + ' — *' + oreCalc.durata(e.min) + '* (' + e.giorni + (e.giorni === 1 ? ' giorno' : ' giorni') + ')');
  const tot = [...persone.values()].reduce((t, e) => t + e.min, 0);
  return { text: intestazione(d, iv.titolo) + '\n\n' + lines.join('\n') + (persone.size > 1 ? '\n\nTotale: *' + oreCalc.durata(tot) + '*' : '') + (aperti ? '\n\n_' + aperti + (aperti === 1 ? ' turno è ancora aperto e non è contato.' : ' turni sono ancora aperti e non sono contati.') + '_' : ''), counts: { persone: persone.size, minuti: tot } };
}

// Riepilogo ore + straordinari per persona: la settimana che finisce oggi (o l'ultima conclusa), il mese in corso e lo straordinario di settimana e di mese.
function buildOreSettimana(d, now = new Date(), scope = null) {
  const oggi = romeParts(now).date, lun = oreCalc.lunediDi(oggi), dom = oreCalc.shiftDay(lun, 6), fine = dom > oggi ? oggi : dom;
  const soglia = d.soglia_ore * 60, anno = Number(oggi.slice(0, 4)), mese = Number(oggi.slice(5, 7));
  const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
  const blocchi = []; let aperti = 0;
  for (const m of require('./module-roles').list({ kind: 'presenze' })) {
    if (scope && scope.slugs && !scope.slugs.has(m.module_slug)) continue;
    const R = m.roles; if (!R.data || !R.inizio || !R.fine) continue;
    const owner = new Map(db.prepare('SELECT r.id, COALESCE(u.display_name, u.username) AS nome FROM records r LEFT JOIN users u ON u.id = r.user_id WHERE r.module_slug = ?').all(m.module_slug).map((r) => [r.id, r.nome || '—']));
    const perNome = new Map();
    for (const r of rows(m.module_slug, scope)) { const n = owner.get(r.id) || '—'; (perNome.get(n) || perNome.set(n, []).get(n)).push({ d: r.data }); }
    for (const [nome, righe] of perNome) {
      const sett = oreCalc.somma(righe, R, { da: lun, a: fine }); aperti += sett.aperti;
      if (!sett.giorni.size) continue; // nessuna timbratura questa settimana: niente per questa persona
      const righeG = [...sett.giorni.keys()].sort().map((g) => oreCalc.GIORNI[new Date(g + 'T00:00:00Z').getUTCDay()] + ' ' + oreCalc.durata(sett.giorni.get(g).min));
      const strSett = Math.max(0, sett.totale - soglia);
      const l = ['*' + nome + '*', 'Settimana ' + shortDate(lun) + '–' + shortDate(fine) + ': *' + oreCalc.durata(sett.totale) + '*', righeG.join(' · '),
        strSett ? 'Straordinario della settimana: *' + oreCalc.durata(strSett) + '* (oltre ' + d.soglia_ore + 'h)' : 'Straordinario della settimana: nessuno (soglia ' + d.soglia_ore + 'h)'];
      if (d.mese) {
        const mn = oreCalc.mensile(righe, R, anno, mese, soglia);
        l.push('Mese di ' + MESI[mese - 1] + ' finora: *' + oreCalc.durata(mn.totale) + '* in ' + mn.giorni + (mn.giorni === 1 ? ' giorno' : ' giorni'), 'Straordinario del mese: *' + (mn.straordinario ? oreCalc.durata(mn.straordinario) : 'nessuno') + '*');
      }
      blocchi.push({ nome, min: sett.totale, testo: l.join('\n') });
    }
  }
  if (!blocchi.length) return null;
  blocchi.sort((a, b) => b.min - a.min);
  return { text: intestazione(d, 'settimana ' + shortDate(lun) + '–' + shortDate(fine)) + '\n\n' + blocchi.map((b) => b.testo).join('\n\n') + (aperti ? '\n\n_' + aperti + (aperti === 1 ? ' turno è ancora aperto e non è contato.' : ' turni sono ancora aperti e non sono contati.') + '_' : ''), counts: { persone: blocchi.length } };
}

const BUILDERS = { riepilogo_periodo: buildRiepilogo, coda: buildCoda, in_ritardo: buildInRitardo, ore_periodo: buildOre, ore_settimana: buildOreSettimana };
// Il messaggio di una definizione (un oggetto definizione o il suo id); null se non c'è niente da dire (o la definizione non esiste).
function build(def, now, scope) {
  const d = typeof def === 'string' ? definizione(def) : def;
  return d && BUILDERS[d.tipo] ? BUILDERS[d.tipo](d, now, scope) : null;
}

function writeLog(d, esito, descrizione) {
  try { db.prepare("INSERT INTO automation_logs (module_slug, automation_label, trigger_desc, action_desc, esito) VALUES ('sistema', ?, ?, ?, ?)").run('Report: ' + d.nome, 'pianificato', String(descrizione).slice(0, 400), esito); } catch (e) { /* mai bloccare */ }
}

// Invia un report ora, su tutti i canali accesi (WhatsApp e/o Telegram). Ritorna { esito }: 'inviato' | 'parziale' | 'FALLITO' | 'nulla da segnalare' | 'non configurato'.
// WhatsApp riceve il messaggio completo; ogni telefono Telegram riceve la SUA versione (solo i moduli e le righe che quell'utente può vedere), con i bottoni.
async function sendReport(id, { now = new Date(), actor = 'sistema' } = {}) {
  const d = definizione(id);
  if (!d) return { esito: 'FALLITO', motivo: 'Report sconosciuto' };
  const canali = settings().canali;
  const tg = require('./telegram');

  // WhatsApp: collegato e con almeno un destinatario?
  let waCreds = null; let dest = [];
  if (canali.whatsapp) {
    const row = db.prepare("SELECT credentials FROM connections WHERE integration_id = 'whatsapp_callmebot'").get();
    waCreds = row ? require('./secrets-at-rest').unseal(row.credentials) : null;
    dest = require('./notification-settings').recipientsForTag(d.tag || TAG);
  }
  const waOk = !!(canali.whatsapp && waCreds && waCreds.api_key && dest.length);
  // Telegram: i telefoni collegati, ristretti agli utenti scelti per questo report (nessuna scelta = tutti)
  const links = canali.telegram && tg.isConfigured() ? tg.listLinks().filter((l) => !d.utenti.length || d.utenti.includes(l.user_id)) : [];
  const tgOk = links.length > 0;
  if (!waOk && !tgOk) {
    const motivo = !canali.whatsapp && !canali.telegram ? 'Tutti i canali sono spenti'
      : canali.whatsapp && !(waCreds && waCreds.api_key) ? 'WhatsApp (CallMeBot) non è collegato' + (canali.telegram ? ' e nessun telefono è collegato a Telegram' : '')
      : canali.whatsapp && !dest.length ? 'Nessun destinatario attivo con il tag "' + (d.tag || TAG) + '"' : (d.utenti.length ? 'Nessuno degli utenti scelti ha un telefono collegato a Telegram' : 'Nessun telefono collegato a Telegram');
    return { esito: 'non configurato', motivo };
  }
  const r = build(d, now);
  if (!r) { writeLog(d, 'nulla da segnalare', 'Niente da segnalare'); return { esito: 'nulla da segnalare' }; }

  const parti = []; // { canale, ok, dettaglio }
  if (waOk) {
    const out = await whatsapp.sendAll({ destinatari: dest, testo: r.text, apiKey: waCreds.api_key, kind: 'report' });
    parti.push({ canale: 'WhatsApp', ok: out.esito === 'inviato' ? 1 : out.esito === 'parziale' ? 0.5 : 0, dettaglio: out.dettaglio });
  }
  if (tgOk) {
    for (const l of links) {
      const user = tg.linkedUser(l.chat_id);
      if (!user) continue;
      const mio = build(d, now, tg.scopeFor(user)); // la versione di questo utente
      if (!mio) continue;                               // niente da dire per lui: nessun messaggio
      const o = await tg.sendReportTo(l.chat_id, d.id, mio);
      parti.push({ canale: 'Telegram', ok: o.ok ? 1 : 0, dettaglio: (user.display_name || user.username) + (o.ok ? ' ✓' : ' ✗ ' + o.reason) });
    }
  }
  const tot = parti.length, somma = parti.reduce((t, p) => t + p.ok, 0);
  const esito = !tot ? 'nulla da segnalare' : somma === tot ? 'inviato' : somma === 0 ? 'FALLITO' : 'parziale';
  const dettaglio = parti.map((p) => p.canale + ': ' + p.dettaglio).join(' | ');
  writeLog(d, esito, JSON.stringify(r.counts) + ' — ' + dettaglio);
  logAudit(actor, 'report.send.' + d.id, null, { esito });
  return { esito, dettaglio, counts: r.counts };
}

// Il report è «dovuto» adesso? Ritorna la chiave che lo identifica (per non mandarlo due volte) oppure null.
function dueKey(d, now) {
  const { date, hour } = romeParts(now);
  const inFinestra = hour >= d.ora && hour < d.ora + FINESTRA_ORE;
  if (d.freq === 'mensile') {
    const giornoPaga = date.slice(0, 7) + '-' + pad(d.giorno);
    const sd = d.weekend === 'venerdi_prima' ? sendDateFor(date, d.giorno) : giornoPaga;
    if (date === sd) return hour >= d.ora ? sd : null;
    return date > sd && date <= giornoPaga ? sd : null; // il NAS era spento il giorno stabilito: parte appena torna, fino al giorno-paga
  }
  if (d.freq === 'giornaliera') return inFinestra ? date : null;
  if (d.freq === 'settimanale') return weekdayOf(date) === d.weekday && inFinestra ? date : null;
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
    for (const d of settings().definizioni) {
      if (!d.enabled) continue;
      const key = dueKey(d, now);
      if (!key) continue;
      if (db.prepare('SELECT 1 FROM report_sent WHERE kind = ? AND key = ?').get(d.id, key)) continue;
      if (!d.invia_se_vuoto && !build(d, now)) continue; // niente da dire: non si segna, può ancora arrivare qualcosa entro la finestra
      db.prepare('INSERT OR IGNORE INTO report_sent (kind, key) VALUES (?, ?)').run(d.id, key);
      fatti.push({ kind: d.id, key, ...(await sendReport(d.id, { now })) });
    }
  } finally { running = false; }
  return { inviati: fatti };
}

function lastSent() {
  const out = {};
  for (const d of settings().definizioni) { const r = db.prepare('SELECT key, sent_at FROM report_sent WHERE kind = ? ORDER BY sent_at DESC, rowid DESC LIMIT 1').get(d.id); out[d.id] = r ? r.sent_at : null; }
  return out;
}

function startReports() {
  const { withLock } = require('./scheduler-lock');
  const guarded = withLock('reports', 55000, tick);
  setInterval(() => { Promise.resolve().then(() => guarded()).catch((e) => console.error('[report]', e.message)); }, 60 * 1000);
  console.log('Report: controllo ogni minuto (le definizioni si scelgono in Impostazioni → Report)');
}

module.exports = { rows, avvisiModules, TIPI, STATI, FREQUENZE, TAG, DEFAULTS, settings, definizione, saveSettings, addDefinition, removeDefinition, isEnabled, build, sendReport, tick, dueKey, lastSent, startReports, romeParts, sendDateFor, endOfWindow, addDays, weekdayOf };
