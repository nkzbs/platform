'use strict';
// "Come sta andando": numeri di un mese (entrate, spese, risparmio, confronti, categorie, anomalie)
// calcolati dal programma sui record dei moduli. L'assistente non calcola niente: riceve questo
// riepilogo (solo totali, mai righe né descrizioni) e lo racconta; ogni numero che scrive viene
// controllato da Super Admin. Quali moduli sono entrate e quali spese è un'impostazione
// (insights_config), con un default pensato per Finance.
const crypto = require('crypto');
const db = require('./db');

const DEFAULT_CONFIG = {
  entrate: { modules: ['entrate'], amount: 'importo', date: 'data', category: 'categoria', exclude_categories: ['Risparmi', 'Fondo'] },
  spese: { modules: ['spese_casa', 'spese_personali'], amount: 'importo', date: 'data', category: 'categoria', status: '_stato', fixed: 'fisso' },
  anomaly: { pct: 25, min_delta_eur: 20, window_months: 6 },
  balance_floor_eur: 300,
};

const SUPER_ADMIN_URL = process.env.SUPER_ADMIN_URL || 'http://super-admin-backend:3000';
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || 'changeme_internal';

function getConfig() {
  let saved = {};
  try { const row = db.prepare('SELECT config FROM insights_config WHERE id = 1').get(); if (row) saved = JSON.parse(row.config || '{}'); } catch (e) { /* default */ }
  const m = (k) => ({ ...DEFAULT_CONFIG[k], ...(saved[k] || {}) });
  return { entrate: m('entrate'), spese: m('spese'), anomaly: m('anomaly'), balance_floor_eur: saved.balance_floor_eur != null ? saved.balance_floor_eur : DEFAULT_CONFIG.balance_floor_eur };
}

function saveConfig(patch) {
  const cur = getConfig();
  const next = { ...cur };
  for (const k of ['entrate', 'spese', 'anomaly']) if (patch && patch[k] && typeof patch[k] === 'object') next[k] = { ...cur[k], ...patch[k] };
  if (patch && Number.isFinite(patch.balance_floor_eur)) next.balance_floor_eur = patch.balance_floor_eur;
  db.prepare('INSERT INTO insights_config (id, config) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET config = excluded.config').run(JSON.stringify(next));
  return next;
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
  const entrate = {}, spese = {};
  const spCat = {}; // mese -> categoria -> totale
  const spFix = {}; // mese -> { fisse, variabili }
  const spStato = {}; // mese -> { pagate, da_pagare }
  const ex = new Set(cfg.entrate.exclude_categories || []);
  for (const slug of installedModules(cfg.entrate.modules)) {
    for (const r of db.prepare('SELECT data FROM records WHERE module_slug = ?').all(slug)) {
      let d; try { d = JSON.parse(r.data); } catch (e) { continue; }
      const m = monthOf(d[cfg.entrate.date]); const a = num(d[cfg.entrate.amount]);
      if (!m || a == null || ex.has(d[cfg.entrate.category])) continue;
      entrate[m] = (entrate[m] || 0) + a;
    }
  }
  for (const slug of installedModules(cfg.spese.modules)) {
    for (const r of db.prepare('SELECT data FROM records WHERE module_slug = ?').all(slug)) {
      let d; try { d = JSON.parse(r.data); } catch (e) { continue; }
      const m = monthOf(d[cfg.spese.date]); const a = num(d[cfg.spese.amount]);
      if (!m || a == null) continue;
      // le righe "da smistare" (bollette appena arrivate da Gmail, importo spesso 0) non sono ancora spese vere
      if (d[cfg.spese.status] === 'da_smistare') continue;
      spese[m] = (spese[m] || 0) + a;
      const cat = d[cfg.spese.category] || 'Altro';
      (spCat[m] = spCat[m] || {})[cat] = ((spCat[m] || {})[cat] || 0) + a;
      const f = (spFix[m] = spFix[m] || { fisse: 0, variabili: 0 });
      if (d[cfg.spese.fixed]) f.fisse += a; else f.variabili += a;
      const st = (spStato[m] = spStato[m] || { pagate: 0, da_pagare: 0 });
      if (d[cfg.spese.status] === 'pagato') st.pagate += a; else st.da_pagare += a;
    }
  }
  return { entrate, spese, spCat, spFix, spStato };
}

const sumRange = (obj, from, to) => { let t = 0; for (let m = from; m <= to; m = addMonths(m, 1)) t += obj[m] || 0; return t; };
const monthsWithData = (obj, from, to) => { let n = 0; for (let m = from; m <= to; m = addMonths(m, 1)) if (obj[m]) n++; return n; };
const pct = (cur, ref) => (ref ? Math.round(((cur - ref) / Math.abs(ref)) * 1000) / 10 : null);

function buildSnapshot(month, now = new Date()) {
  const cfg = getConfig();
  const mods = [...installedModules(cfg.entrate.modules), ...installedModules(cfg.spese.modules)];
  if (!installedModules(cfg.entrate.modules).length || !installedModules(cfg.spese.modules).length) return { available: false, reason: 'Servono almeno un modulo di entrate e uno di spese installati.' };
  month = month && /^\d{4}-\d{2}$/.test(month) ? month : lastClosedMonth(now);
  const { entrate, spese, spCat, spFix, spStato } = collect(cfg);
  const en = entrate[month] || 0, sp = spese[month] || 0;
  const prev = addMonths(month, -1), yearAgo = addMonths(month, -12);
  const w = cfg.anomaly.window_months;
  const win = [addMonths(month, -w), addMonths(month, -1)];
  const avg12 = (obj) => { const from = addMonths(month, -12), to = addMonths(month, -1); const n = monthsWithData(obj, from, to); return n ? sumRange(obj, from, to) / n : null; };
  const e12 = avg12(entrate), s12 = avg12(spese);
  const cur = now.toISOString().slice(0, 7);

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
  const limiti = ['Conta solo ciò che è registrato in Finance (' + [...installedModules(cfg.spese.modules)].join(', ') + ' per le spese): i pagamenti con carta o da altri conti non registrati non compaiono.',
    'Non sono conteggiati come entrate: ' + ((cfg.entrate.exclude_categories || []).join(', ') || 'nessuna categoria esclusa') + '.',
    'Le righe "da smistare" non contano come spese finché non le smisti.'];
  if (month >= cur) limiti.unshift('Mese in corso: i dati sono parziali.');
  if (!en) limiti.unshift('Nessuna entrata registrata in questo mese: il saldo e il risparmio non sono significativi.');

  const st = spStato[month] || { pagate: 0, da_pagare: 0 }, fx = spFix[month] || { fisse: 0, variabili: 0 };
  return {
    available: true, month, in_corso: month >= cur,
    entrate: round2(en), spese: round2(sp), saldo: round2(en - sp),
    risparmio_pct: en > 0 ? Math.round(((en - sp) / en) * 1000) / 10 : null,
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

// L'impronta dei numeri: se cambia (registri una spesa, correggi un importo) la spiegazione salvata è "vecchia".
const snapshotHash = (snap) => crypto.createHash('sha1').update(JSON.stringify({ ...snap, limiti: undefined })).digest('hex');

function cachedExplanation(month, snap) {
  const row = db.prepare('SELECT snapshot_hash, text, created_at FROM insight_explanations WHERE month = ?').get(month);
  if (!row) return null;
  return { text: row.text, created_at: row.created_at, stale: row.snapshot_hash !== snapshotHash(snap) };
}

// Chiede la spiegazione a Super Admin (che controlla i numeri) e la salva. Ritorna { text } o { error, status, code }.
async function explain(snap, { refresh = false } = {}) {
  if (!refresh) { const c = cachedExplanation(snap.month, snap); if (c && !c.stale) return { text: c.text, cached: true }; }
  try {
    const res = await fetch(SUPER_ADMIN_URL + '/api/tenant-ai/explain-insights', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET },
      body: JSON.stringify({ tenant_slug: process.env.TENANT_SLUG, data: { ...snap, limiti: undefined } }),
      signal: AbortSignal.timeout(30000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.text) return { error: body.error || 'Assistente non disponibile', status: res.status || 502, code: body.code };
    db.prepare('INSERT INTO insight_explanations (month, snapshot_hash, text) VALUES (?, ?, ?) ON CONFLICT(month) DO UPDATE SET snapshot_hash = excluded.snapshot_hash, text = excluded.text, created_at = CURRENT_TIMESTAMP').run(snap.month, snapshotHash(snap), body.text);
    return { text: body.text, cached: false };
  } catch (e) {
    return { error: 'Assistente non raggiungibile', status: 502 };
  }
}

module.exports = { getConfig, saveConfig, buildSnapshot, cachedExplanation, explain, lastClosedMonth, addMonths, DEFAULT_CONFIG };
