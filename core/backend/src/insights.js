'use strict';
// "Come sta andando": numeri di un mese (entrate, spese, risparmio, confronti, categorie, anomalie)
// calcolati dal programma sui record dei moduli. L'assistente non calcola niente: riceve questo
// riepilogo (solo totali, mai righe né descrizioni) e lo racconta; ogni numero che scrive viene
// controllato da Super Admin. Quali moduli sono entrate e quali spese è un'impostazione
// (insights_config), con un default pensato per Finance.
const crypto = require('crypto');
const db = require('./db');

// La vista è quella PERSONALE ("io"): stipendi meno spese personali (comprese le quote versate alla casa,
// categoria 'Contributo Casa'). Le spese di casa e i contributi alla casa registrati come entrate stanno nel
// registro della casa, in parte pagate da altri (es. l'affitto): non sono una spesa personale.
// Accantonamento (es. il 10% del lordo trattenuto in busta e versato in un fondo): non arriva sul conto, ma è
// risparmio vero. Si legge dalle righe delle categorie `savings_categories` e dal campo `savings_field` delle
// righe di stipendio; dove manca si stima dal rapporto con il netto degli altri mesi (e lo si dice).
// Valori di partenza neutri: nessun modulo e nessun criterio. Moduli, campi e criteri li dichiara ogni modulo (Builder → Ruoli del modulo
// e Criteri dei riepiloghi, vedi module-roles.js); qui restano solo i nomi di campo più comuni, usati se il modulo non ne indica altri.
const DEFAULT_CONFIG = {
  entrate: { modules: [], amount: 'importo', date: 'data', category: 'categoria', group: 'gruppo',
    exclude_categories: [], exclude_groups: [], exclude_descriptions: [], salary_categories: [], savings_categories: [], savings_field: '' },
  spese: { modules: [], amount: 'importo', date: 'data', category: 'categoria', status: '_stato', fixed: 'fisso' },
  anomaly: { pct: 25, min_delta_eur: 20, window_months: 6 },
  balance_floor_eur: 300,
};

const SUPER_ADMIN_URL = process.env.SUPER_ADMIN_URL || 'http://super-admin-backend:3000';
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || 'changeme_internal';

// Valori di partenza dai ruoli dichiarati nel Builder (module-roles.js): i moduli di entrate e di spese che entrano nei riepiloghi
// e quali loro campi sono importo, data, categoria... Dove non c'è nessuna dichiarazione restano i valori scritti sopra.
function fromRoles() {
  let roles; try { roles = require('./module-roles'); } catch (e) { return {}; }
  const out = {};
  for (const [key, kind] of [['entrate', 'entrata'], ['spese', 'spesa']]) {
    let mods = []; try { mods = roles.list({ kind, use: 'riepiloghi' }); } catch (e) { /* tabella non pronta */ }
    if (!mods.length) continue;
    const r = mods[0].roles;
    const cfg = { modules: mods.map((x) => x.module_slug) };
    if (r.importo) cfg.amount = r.importo;
    if (r.data) cfg.date = r.data;
    if (r.categoria) cfg.category = r.categoria;
    if (key === 'entrate' && r.gruppo) cfg.group = r.gruppo;
    if (key === 'entrate') Object.assign(cfg, mods[0].riepiloghi); // criteri dichiarati dal modulo (anche vuoti: nessuna esclusione)
    if (key === 'spese') { if (r.stato) cfg.status = r.stato; if (r.fisso) cfg.fixed = r.fisso; }
    out[key] = cfg;
  }
  return out;
}

function getConfig(view) {
  let saved = {};
  try { const row = db.prepare('SELECT config FROM insights_config WHERE id = 1').get(); if (row) saved = JSON.parse(row.config || '{}'); } catch (e) { /* default */ }
  const derived = fromRoles();
  // `view`: la vista di un widget (viene da viewFromWidget): quali moduli di spese, quali gruppi di entrate, se conta l'accantonamento
  const m = (k) => ({ ...DEFAULT_CONFIG[k], ...(derived[k] || {}), ...(saved[k] || {}), ...((view && view[k]) || {}) });
  return { entrate: m('entrate'), spese: m('spese'), anomaly: m('anomaly'), balance_floor_eur: saved.balance_floor_eur != null ? saved.balance_floor_eur : DEFAULT_CONFIG.balance_floor_eur };
}

// La vista di un widget "Come sta andando": lo stesso calcolo, ma su altri moduli o altri gruppi (es. spese di casa e contributi alla casa
// al posto delle spese personali). Configurazione del widget, mai fidarsi di cosa arriva dal browser: si legge dal widget salvato.
function viewFromWidget(widget) {
  let cfg = widget && widget.config; if (typeof cfg === 'string') { try { cfg = JSON.parse(cfg); } catch (e) { cfg = {}; } }
  cfg = cfg || {};
  const list = (v) => (Array.isArray(v) ? v : []).map((x) => String(x).trim()).filter(Boolean).slice(0, 30);
  const view = { id: widget && widget.id };
  const sp = list(cfg.spese_modules); if (sp.length) view.spese = { modules: sp };
  const en = {};
  const inc = list(cfg.entrate_include_groups); if (inc.length) en.include_groups = inc;
  if (Array.isArray(cfg.entrate_exclude_groups)) en.exclude_groups = list(cfg.entrate_exclude_groups);
  if (cfg.accantonamento === false) { en.savings_categories = []; en.salary_categories = []; en.savings_field = ''; }
  if (Object.keys(en).length) view.entrate = en;
  return view;
}
const viewKey = (view) => (view && view.id ? '@w' + view.id : '');

function saveConfig(patch) {
  // Si salva solo ciò che è stato cambiato a mano: il resto continua a seguire i ruoli dei moduli.
  let saved = {};
  try { const row = db.prepare('SELECT config FROM insights_config WHERE id = 1').get(); if (row) saved = JSON.parse(row.config || '{}'); } catch (e) { /* vuoto */ }
  for (const k of ['entrate', 'spese', 'anomaly']) if (patch && patch[k] && typeof patch[k] === 'object') saved[k] = { ...(saved[k] || {}), ...patch[k] };
  if (patch && Number.isFinite(patch.balance_floor_eur)) saved.balance_floor_eur = patch.balance_floor_eur;
  db.prepare('INSERT INTO insights_config (id, config) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET config = excluded.config').run(JSON.stringify(saved));
  return getConfig();
}

const round2 = (n) => Math.round(n * 100) / 100;
const num = (v) => { const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };
const monthOf = (d) => (typeof d === 'string' && /^\d{4}-\d{2}/.test(d) ? d.slice(0, 7) : null);

function addMonths(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const t = y * 12 + (m - 1) + delta;
  return Math.floor(t / 12) + '-' + String((t % 12) + 1).padStart(2, '0');
}

// Ultimo mese concluso (il mese in corso è parziale).
function lastClosedMonth(now = new Date()) {
  return addMonths(now.toISOString().slice(0, 7), -1);
}

function installedModules(slugs) {
  if (!slugs.length) return [];
  const rows = db.prepare('SELECT slug FROM modules WHERE installed = 1').all().map((r) => r.slug);
  return slugs.filter((s) => rows.includes(s));
}

// Legge i record una volta sola e li raggruppa per mese.
function collect(cfg) {
  const entrate = {}, spese = {}, stipendi = {}, accantonato = {};
  const senzaData = { n: 0, totale: 0 }; // righe la cui data vera è andata persa (campo data_incerta): fuori dai conti mensili
  const spCat = {}; // mese -> categoria -> totale
  const spFix = {}; // mese -> { fisse, variabili }
  const spKind = {}; // mese -> { rate, fisse, variabili } (rata = collegata a un debito o categoria Rata; poi fisse; il resto variabili)
  const spStato = {}; // mese -> { pagate, da_pagare }
  const E = cfg.entrate;
  const incGrp = new Set(E.include_groups || []);
  const exCat = new Set(E.exclude_categories || []), exGrp = new Set((E.exclude_groups || []).filter((g) => !incGrp.has(g))); // un gruppo scelto per questa vista non può essere anche escluso
  const exDesc = (E.exclude_descriptions || []).map((x) => String(x).trim().toLowerCase());
  const sav = new Set(E.savings_categories || []), sal = new Set(E.salary_categories || []);
  for (const slug of installedModules(E.modules)) {
    for (const r of db.prepare('SELECT data FROM records WHERE module_slug = ?').all(slug)) {
      let d; try { d = JSON.parse(r.data); } catch (e) { continue; }
      const m = monthOf(d[E.date]); const a = num(d[E.amount]);
      if (!m || a == null) continue;
      if (exGrp.has(d[E.group])) continue; // registro della casa, non entrate personali
      if (incGrp.size && !incGrp.has(d[E.group])) continue; // vista di un widget: solo questi gruppi
      if (exDesc.includes(String(d.descrizione || '').trim().toLowerCase())) continue; // es. riporto di saldo
      // l'accantonamento trattenuto in busta: righe di categoria "fondo" oppure il campo sulla riga dello stipendio
      if (sav.has(d[E.category])) accantonato[m] = (accantonato[m] || 0) + a;
      else if (sal.has(d[E.category]) && (num(d[E.savings_field]) || 0) > 0) accantonato[m] = (accantonato[m] || 0) + num(d[E.savings_field]);
      if (exCat.has(d[E.category])) continue;
      entrate[m] = (entrate[m] || 0) + a;
      if (sal.has(d[E.category])) stipendi[m] = (stipendi[m] || 0) + a;
    }
  }
  for (const slug of installedModules(cfg.spese.modules)) {
    for (const r of db.prepare('SELECT data FROM records WHERE module_slug = ?').all(slug)) {
      let d; try { d = JSON.parse(r.data); } catch (e) { continue; }
      const m = monthOf(d[cfg.spese.date]); const a = num(d[cfg.spese.amount]);
      if (!m || a == null) continue;
      if (d.data_incerta) { senzaData.n++; senzaData.totale += a; continue; }
      // le righe "da smistare" (bollette appena arrivate da Gmail, importo spesso 0) non sono ancora spese vere
      if (d[cfg.spese.status] === 'da_smistare') continue;
      spese[m] = (spese[m] || 0) + a;
      const cat = d[cfg.spese.category] || 'Altro';
      (spCat[m] = spCat[m] || {})[cat] = ((spCat[m] || {})[cat] || 0) + a;
      const kd = (spKind[m] = spKind[m] || { rate: 0, fisse: 0, variabili: 0 });
      if (d.debito || cat === 'Rata') kd.rate += a; else if (d[cfg.spese.fixed]) kd.fisse += a; else kd.variabili += a;
      const f = (spFix[m] = spFix[m] || { fisse: 0, variabili: 0 });
      if (d[cfg.spese.fixed]) f.fisse += a; else f.variabili += a;
      const st = (spStato[m] = spStato[m] || { pagate: 0, da_pagare: 0 });
      if (d[cfg.spese.status] === 'pagato') st.pagate += a; else st.da_pagare += a;
    }
  }
  return { entrate, spese, spCat, spFix, spStato, spKind, stipendi, accantonato, senzaData };
}

// Accantonamento per mese: quello registrato; dove manca (da quando è cominciato) si stima con il rapporto
// mediano tra accantonato e stipendio netto dei mesi che hanno entrambi. Ritorna { valore, stimato }.
function accantonamentoMese(month, { stipendi, accantonato }) {
  const first = Object.keys(accantonato).sort()[0];
  if (!first || month < first) return { valore: 0, stimato: false };
  if (accantonato[month]) return { valore: round2(accantonato[month]), stimato: false };
  const net = stipendi[month];
  if (!net) return { valore: 0, stimato: false };
  const ratios = Object.keys(accantonato).filter((m) => stipendi[m] > 0).map((m) => accantonato[m] / stipendi[m]).sort((a, b) => a - b);
  if (!ratios.length) return { valore: 0, stimato: false };
  const mid = Math.floor(ratios.length / 2);
  const median = ratios.length % 2 ? ratios[mid] : (ratios[mid - 1] + ratios[mid]) / 2;
  return { valore: round2(net * median), stimato: true };
}

const sumRange = (obj, from, to) => { let t = 0; for (let m = from; m <= to; m = addMonths(m, 1)) t += obj[m] || 0; return t; };
const monthsWithData = (obj, from, to) => { let n = 0; for (let m = from; m <= to; m = addMonths(m, 1)) if (obj[m]) n++; return n; };
const pct = (cur, ref) => (ref ? Math.round(((cur - ref) / Math.abs(ref)) * 1000) / 10 : null);

function buildSnapshot(month, now = new Date(), view = null) {
  const cfg = getConfig(view);
  const mods = [...installedModules(cfg.entrate.modules), ...installedModules(cfg.spese.modules)];
  if (!installedModules(cfg.entrate.modules).length || !installedModules(cfg.spese.modules).length) return { available: false, reason: 'Servono almeno un modulo di entrate e uno di spese installati.' };
  month = month && /^\d{4}-\d{2}$/.test(month) ? month : lastClosedMonth(now);
  const col = collect(cfg);
  const { entrate, spese, spCat, spFix, spStato } = col;
  const en = entrate[month] || 0, sp = spese[month] || 0;
  const prev = addMonths(month, -1), yearAgo = addMonths(month, -12);
  const w = cfg.anomaly.window_months;
  const win = [addMonths(month, -w), addMonths(month, -1)];
  const avg12 = (obj) => { const from = addMonths(month, -12), to = addMonths(month, -1); const n = monthsWithData(obj, from, to); return n ? sumRange(obj, from, to) / n : null; };
  const e12 = avg12(entrate), s12 = avg12(spese);
  const cur = now.toISOString().slice(0, 7);
  const acc = accantonamentoMese(month, col);

  // La media si fa solo sui mesi della finestra in cui ci sono spese: un mese senza dati (storico
  // che non è ancora cominciato) non vale zero, altrimenti ogni variazione risulterebbe gonfiata.
  const nWin = monthsWithData(spese, win[0], win[1]);
  const cats = Object.entries(spCat[month] || {}).sort((a, b) => b[1] - a[1]).map(([nome, valore]) => {
    let t = 0; for (let m = win[0]; m <= win[1]; m = addMonths(m, 1)) t += (spCat[m] || {})[nome] || 0;
    const media = nWin ? round2(t / nWin) : 0;
    return { nome, valore: round2(valore), media_6m: media, variazione_pct: media > 0 ? pct(valore, media) : null };
  });
  const anomalie = [];
  for (const c of cats) {
    const delta = c.valore - c.media_6m;
    if (c.media_6m >= cfg.anomaly.min_delta_eur && c.variazione_pct != null && c.variazione_pct >= cfg.anomaly.pct && delta >= cfg.anomaly.min_delta_eur) anomalie.push({ tipo: 'sopra_la_media', ...c });
    else if (c.media_6m === 0 && c.valore >= 50) anomalie.push({ tipo: 'categoria_nuova', ...c });
  }
  const limiti = ['Vista personale: conta ciò che è registrato in Finance (' + [...installedModules(cfg.spese.modules)].join(', ') + ' per le spese). Le spese di casa (affitto, bollette) non sono incluse: contano solo le quote che versi tu alla casa, se registrate come "Contributo Casa". I pagamenti con carta o da altri conti non registrati non compaiono.',
    'Non sono conteggiati come entrate: ' + ((cfg.entrate.exclude_categories || []).join(', ') || 'nessuna categoria esclusa') + ', i contributi alla casa e i riporti di saldo.',
    'Le righe "da smistare" non contano come spese finché non le smisti.'];
  if (col.senzaData.n) limiti.push('Non contate in nessun mese: ' + col.senzaData.n + ' spese (circa ' + Math.round(col.senzaData.totale) + ' €) la cui data vera è andata persa nell\'importazione.');
  if (acc.valore) limiti.push('L\'accantonamento (fondo o azioni, trattenuto in busta paga) non arriva sul conto: è contato come risparmio.' + (acc.stimato ? ' Per questo mese è una stima (circa ' + Math.round((acc.valore / (col.stipendi[month] || 1)) * 100) + '% del netto, come negli altri mesi): manca la riga con l\'importo vero.' : ''));
  if (month >= cur) limiti.unshift('Mese in corso: i dati sono parziali.');
  if (!en) limiti.unshift('Nessuna entrata registrata in questo mese: il saldo e il risparmio non sono significativi.');

  // Se ci sono movimenti bancari per questo mese, il riepilogo di ciò che è successo davvero sul conto.
  let banca = null;
  if (!view) { try { banca = require('./bank-import').monthSummary(month); } catch (e) { /* senza movimenti bancari */ } } // il conto è uno solo: solo nella vista generale
  const st = spStato[month] || { pagate: 0, da_pagare: 0 }, fx = spFix[month] || { fisse: 0, variabili: 0 };
  return {
    available: true, key: month + viewKey(view), month, in_corso: month >= cur, banca,
    entrate: round2(en), spese: round2(sp), saldo: round2(en - sp),
    risparmio_pct: en > 0 ? Math.round(((en - sp) / en) * 1000) / 10 : null,
    accantonato: acc.valore, accantonato_stimato: acc.stimato,
    // risparmio vero: quello che resta sul conto più quello trattenuto in busta, sul totale guadagnato
    risparmio_vero_pct: en + acc.valore > 0 ? Math.round(((en - sp + acc.valore) / (en + acc.valore)) * 1000) / 10 : null,
    spese_pagate: round2(st.pagate), spese_da_pagare: round2(st.da_pagare),
    spese_fisse: round2(fx.fisse), spese_variabili: round2(fx.variabili),
    confronti: {
      mese_precedente: { mese: prev, entrate: round2(entrate[prev] || 0), spese: round2(spese[prev] || 0), spese_variazione_pct: pct(sp, spese[prev] || 0) },
      anno_precedente: { mese: yearAgo, entrate: round2(entrate[yearAgo] || 0), spese: round2(spese[yearAgo] || 0), spese_variazione_pct: pct(sp, spese[yearAgo] || 0) },
      media_12_mesi: { entrate: e12 == null ? null : round2(e12), spese: s12 == null ? null : round2(s12), spese_variazione_pct: s12 ? pct(sp, s12) : null },
    },
    categorie: cats.slice(0, 8),
    anomalie,
    limiti,
  };
}

function monthsBetween(from, to) { const out = []; for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m); return out; }

// Da inizio anno (fino all'ultimo mese concluso; un anno passato fino a dicembre), con il confronto con lo stesso periodo dell'anno prima.
function buildYearSnapshot(year, now = new Date(), view = null) {
  const cfg = getConfig(view);
  if (!installedModules(cfg.entrate.modules).length || !installedModules(cfg.spese.modules).length) return { available: false, reason: 'Servono almeno un modulo di entrate e uno di spese installati.' };
  const cur = now.toISOString().slice(0, 7);
  const y = /^\d{4}$/.test(String(year || '')) ? String(year) : cur.slice(0, 4);
  let to = y + '-12';
  if (y === cur.slice(0, 4)) { const lc = lastClosedMonth(now); to = lc.startsWith(y) ? lc : null; }
  if (y > cur.slice(0, 4)) to = null;
  if (!to) return { available: true, key: 'anno-' + y, period: 'anno', year: y, vuoto: true, limiti: ['Nessun mese concluso in questo anno.'] };
  const months = monthsBetween(y + '-01', to);
  const prevYear = String(Number(y) - 1), prevMonths = months.map((m) => prevYear + m.slice(4));
  const col = collect(cfg);
  const sum = (obj, ms) => ms.reduce((t, m) => t + (obj[m] || 0), 0);
  const acc = (ms) => { let v = 0, st = false; for (const m of ms) { const a = accantonamentoMese(m, col); v += a.valore; if (a.stimato) st = true; } return { valore: round2(v), stimato: st }; };
  const en = sum(col.entrate, months), sp = sum(col.spese, months), enP = sum(col.entrate, prevMonths), spP = sum(col.spese, prevMonths);
  const ac = acc(months), acP = acc(prevMonths);
  const kind = (k) => round2(months.reduce((t, m) => t + ((col.spKind[m] || {})[k] || 0), 0));
  const catTot = (ms) => { const o = {}; for (const m of ms) for (const [c, v] of Object.entries(col.spCat[m] || {})) o[c] = (o[c] || 0) + v; return o; };
  const cn = catTot(months), cp = catTot(prevMonths);
  const categorie = Object.entries(cn).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([nome, valore]) => ({ nome, valore: round2(valore), anno_prec: round2(cp[nome] || 0), variazione_pct: cp[nome] > 0 ? pct(valore, cp[nome]) : null }));
  const limiti = ['Vista personale: conta ciò che è registrato in Finance (' + [...installedModules(cfg.spese.modules)].join(', ') + ' per le spese). Le spese di casa non sono incluse: contano solo le quote che versi tu alla casa, se registrate come "Contributo Casa".',
    'Non sono conteggiati come entrate: ' + ((cfg.entrate.exclude_categories || []).join(', ') || 'nessuna categoria esclusa') + ', i contributi alla casa e i riporti di saldo.'];
  if (col.senzaData.n) limiti.push('Non contate in nessun mese: ' + col.senzaData.n + ' spese (circa ' + Math.round(col.senzaData.totale) + ' €) la cui data vera è andata persa nell\'importazione.');
  if (ac.valore) limiti.push('L\'accantonamento (fondo o azioni, trattenuto in busta paga) non arriva sul conto: è contato come risparmio.' + (ac.stimato ? ' Per alcuni mesi è una stima: manca la riga con l\'importo vero.' : ''));
  if (acP.valore === 0 && ac.valore > 0) limiti.push('L\'anno scorso non c\'era ancora l\'accantonamento: il confronto del risparmio non è alla pari.');
  const mesiConEntrate = months.filter((m) => col.entrate[m]).length;
  if (mesiConEntrate < months.length) limiti.unshift('In ' + (months.length - mesiConEntrate) + ' mesi non risulta nessuna entrata registrata.');
  return {
    available: true, key: 'anno-' + y + viewKey(view), period: 'anno', year: y, fino_a: to, mesi: months.length,
    entrate: round2(en), spese: round2(sp), saldo: round2(en - sp),
    risparmio_pct: en > 0 ? Math.round(((en - sp) / en) * 1000) / 10 : null,
    accantonato: ac.valore, accantonato_stimato: ac.stimato,
    risparmio_vero_pct: en + ac.valore > 0 ? Math.round(((en - sp + ac.valore) / (en + ac.valore)) * 1000) / 10 : null,
    spese_rate: kind('rate'), spese_fisse: kind('fisse'), spese_variabili: kind('variabili'),
    confronti: { anno_precedente: { anno: prevYear, entrate: round2(enP), spese: round2(spP), saldo: round2(enP - spP), entrate_variazione_pct: pct(en, enP), spese_variazione_pct: pct(sp, spP) } },
    categorie, limiti,
  };
}

// L'impronta dei numeri: se cambia (registri una spesa, correggi un importo) la spiegazione salvata è "vecchia".
const snapshotHash = (snap) => crypto.createHash('sha1').update(JSON.stringify({ ...snap, limiti: undefined })).digest('hex');

function cachedExplanation(key, snap) {
  const row = db.prepare('SELECT snapshot_hash, text, created_at FROM insight_explanations WHERE month = ?').get(key);
  if (!row) return null;
  return { text: row.text, created_at: row.created_at, stale: row.snapshot_hash !== snapshotHash(snap) };
}

// Chiede la spiegazione a Super Admin (che controlla i numeri) e la salva. Ritorna { text } o { error, status, code }.
async function explain(snap, { refresh = false } = {}) {
  const key = snap.key || snap.month;
  if (!refresh) { const c = cachedExplanation(key, snap); if (c && !c.stale) return { text: c.text, cached: true }; }
  try {
    const res = await fetch(SUPER_ADMIN_URL + '/api/tenant-ai/explain-insights', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET },
      body: JSON.stringify({ tenant_slug: process.env.TENANT_SLUG, data: { ...snap, limiti: undefined } }),
      signal: AbortSignal.timeout(30000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.text) return { error: body.error || 'Assistente non disponibile', status: res.status || 502, code: body.code };
    db.prepare('INSERT INTO insight_explanations (month, snapshot_hash, text) VALUES (?, ?, ?) ON CONFLICT(month) DO UPDATE SET snapshot_hash = excluded.snapshot_hash, text = excluded.text, created_at = CURRENT_TIMESTAMP').run(key, snapshotHash(snap), body.text);
    return { text: body.text, cached: false };
  } catch (e) {
    return { error: 'Assistente non raggiungibile', status: 502 };
  }
}

module.exports = { viewFromWidget, getConfig, saveConfig, buildSnapshot, buildYearSnapshot, cachedExplanation, explain, lastClosedMonth, addMonths, DEFAULT_CONFIG };
