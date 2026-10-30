'use strict';
// Suggerimenti di miglioramento: il tenant osserva COME vengono usati i suoi moduli e segnala ciò che si può semplificare o sbloccare. Tutto si calcola QUI, in locale, senza AI e senza
// mandare niente fuori: sono osservazioni sui numeri («questo campo non è mai stato compilato»), non giudizi. L'AI interviene solo se la chiedi su una singola osservazione (routes/suggestions.js
// → Super Admin), e riceve la struttura del modulo e i conteggi, mai i valori delle righe. Nessun nome di modulo o di campo nel codice: valgono per qualunque progetto.
// Regole: campo poco usato / mai compilato; campo di testo con pochi valori ripetuti (sarebbe una scelta); righe ferme in uno stato da troppo tempo; passaggio del flusso mai raggiunto.
const db = require('./db');
const { parseSchemaNormalized } = require('./schema-v3');

const MAX_RIGHE = 5000;
const SOGLIE = { minRighe: 20, poco_usato_pct: 5, minRigheTesto: 30, maxValoriDistinti: 8, coperturaPct: 90, giorniFerme: 14, minFerme: 3 };
const NON_VALUTABILI = new Set(['computed', 'relation', 'checkbox', 'file', 'encrypted', 'giacenza', 'mappa']);
const vuoto = (v) => v == null || v === '' || (Array.isArray(v) && v.length === 0);

// Le osservazioni per UN modulo, a partire dallo schema e dalle righe. Funzione pura (si prova senza database).
// righe: [{ data: {...}, updated_at: 'AAAA-MM-GG hh:mm:ss' }]; storico: elenco degli stati in cui una riga è entrata (da record_history).
function osservaModulo({ name, fields, workflow }, righe, statiRaggiunti, oggi = new Date()) {
  const out = [];
  const n = righe.length;
  if (n >= SOGLIE.minRighe) {
    for (const f of fields || []) {
      if (NON_VALUTABILI.has(f.type) || f.required) continue;
      const compilate = righe.filter((r) => !vuoto(r.data[f.key])).length;
      const pct = (compilate / n) * 100;
      if (compilate === 0) out.push({ rule_key: 'campo_poco_usato', target: f.key, title: '«' + (f.label || f.key) + '» in «' + name + '» non è mai stato compilato (' + n + ' righe)', data: { compilate, totale: n, mai: true } });
      else if (pct <= SOGLIE.poco_usato_pct && n >= 50) out.push({ rule_key: 'campo_poco_usato', target: f.key, title: '«' + (f.label || f.key) + '» in «' + name + '» è compilato solo in ' + compilate + ' righe su ' + n, data: { compilate, totale: n, mai: false } });
    }
  }
  // un campo di testo breve che ripete sempre gli stessi pochi valori è, di fatto, una scelta
  for (const f of fields || []) {
    if (f.type !== 'text') continue;
    const valori = righe.map((r) => r.data[f.key]).filter((v) => typeof v === 'string' && v.trim() !== '');
    if (valori.length < SOGLIE.minRigheTesto) continue;
    const conta = new Map(); valori.forEach((v) => conta.set(v.trim().toLowerCase(), (conta.get(v.trim().toLowerCase()) || 0) + 1));
    if (conta.size > SOGLIE.maxValoriDistinti || conta.size < 2) continue;
    const coperti = [...conta.values()].sort((a, b) => b - a).slice(0, SOGLIE.maxValoriDistinti).reduce((s, x) => s + x, 0);
    if ((coperti / valori.length) * 100 >= SOGLIE.coperturaPct) out.push({ rule_key: 'testo_da_strutturare', target: f.key, title: '«' + (f.label || f.key) + '» in «' + name + '» ripete sempre gli stessi ' + conta.size + ' valori: potrebbe essere una scelta', data: { distinti: conta.size, compilate: valori.length } });
  }
  const stati = (workflow && workflow.states) || [], trans = (workflow && workflow.transitions) || [];
  if (stati.length && trans.length) {
    const conUscita = new Set(trans.map((t) => t.from));
    const nomeStato = (k) => (stati.find((s) => s.key === k) || {}).label || k;
    const soglia = new Date(oggi.getTime() - SOGLIE.giorniFerme * 86400000).toISOString().slice(0, 19).replace('T', ' ');
    for (const s of stati) {
      if (!conUscita.has(s.key)) continue; // uno stato finale non è «fermo»
      const ferme = righe.filter((r) => r.data._stato === s.key && String(r.updated_at || '') < soglia).length;
      if (ferme >= SOGLIE.minFerme) out.push({ rule_key: 'righe_ferme', target: s.key, title: ferme + ' righe di «' + name + '» sono ferme in «' + nomeStato(s.key) + '» da oltre ' + SOGLIE.giorniFerme + ' giorni', data: { ferme, giorni: SOGLIE.giorniFerme } });
    }
    if (n >= SOGLIE.minRighe) {
      for (const s of stati) {
        if (s.initial) continue;
        const adesso = righe.some((r) => r.data._stato === s.key);
        if (!adesso && !(statiRaggiunti && statiRaggiunti.has(s.key))) out.push({ rule_key: 'stato_mai_usato', target: s.key, title: 'Nessuna riga di «' + name + '» è mai arrivata allo stato «' + nomeStato(s.key) + '»', data: { totale: n } });
      }
    }
  }
  return out;
}

function righeDi(slug) {
  return db.prepare('SELECT data, updated_at FROM records WHERE module_slug = ? ORDER BY id DESC LIMIT ?').all(slug, MAX_RIGHE).map((r) => { try { return { data: JSON.parse(r.data), updated_at: r.updated_at }; } catch (e) { return null; } }).filter(Boolean);
}
function statiRaggiuntiDi(slug) {
  const s = new Set();
  try { for (const r of db.prepare('SELECT after_data FROM record_history WHERE module_slug = ? ORDER BY id DESC LIMIT ?').all(slug, MAX_RIGHE)) { try { const d = JSON.parse(r.after_data || '{}'); if (d && d._stato) s.add(d._stato); } catch (e) { /* riga non leggibile */ } } } catch (e) { /* tabella non pronta */ }
  return s;
}

// Scansione completa: aggiunge o aggiorna le osservazioni aperte, chiude da sole quelle non più vere, e non riapre mai ciò che è stato ignorato.
function scansiona(oggi = new Date()) {
  const trovate = [];
  for (const m of db.prepare("SELECT slug, name, schema_json FROM modules WHERE installed = 1 AND COALESCE(is_system, 0) = 0").all()) {
    let schema; try { schema = parseSchemaNormalized(m.schema_json); } catch (e) { continue; }
    for (const o of osservaModulo({ name: m.name, fields: schema.fields, workflow: schema.workflow }, righeDi(m.slug), statiRaggiuntiDi(m.slug), oggi)) trovate.push({ ...o, module_slug: m.slug });
  }
  const chiave = (x) => x.rule_key + '|' + x.module_slug + '|' + x.target;
  const viste = new Set(trovate.map(chiave));
  let nuove = 0, risolte = 0;
  db.transaction(() => {
    const cerca = db.prepare('SELECT id, status FROM suggestions WHERE rule_key = ? AND module_slug = ? AND target = ?');
    for (const x of trovate) {
      const e = cerca.get(x.rule_key, x.module_slug, x.target);
      if (!e) { db.prepare('INSERT INTO suggestions (rule_key, module_slug, target, title, data) VALUES (?, ?, ?, ?, ?)').run(x.rule_key, x.module_slug, x.target, x.title, JSON.stringify(x.data)); nuove++; }
      else if (e.status === 'resolved') db.prepare("UPDATE suggestions SET status = 'open', resolved_at = NULL, title = ?, data = ?, last_seen = CURRENT_TIMESTAMP WHERE id = ?").run(x.title, JSON.stringify(x.data), e.id);
      else db.prepare('UPDATE suggestions SET title = ?, data = ?, last_seen = CURRENT_TIMESTAMP WHERE id = ?').run(x.title, JSON.stringify(x.data), e.id); // anche «ignorata»: si aggiorna ma non si riapre
    }
    // rule_key 'modulo_mancante' non è di questa scansione (la gestisce module-gap.js, una volta alla settimana): non va mai chiuso da qui.
    for (const e of db.prepare("SELECT id, rule_key, module_slug, target FROM suggestions WHERE status = 'open' AND rule_key != 'modulo_mancante'").all()) {
      if (!viste.has(chiave(e))) { db.prepare("UPDATE suggestions SET status = 'resolved', resolved_at = CURRENT_TIMESTAMP WHERE id = ?").run(e.id); risolte++; }
    }
  })();
  return { nuove, risolte, aperte: db.prepare("SELECT COUNT(*) c FROM suggestions WHERE status = 'open'").get().c };
}

const elenco = () => db.prepare("SELECT s.*, m.name AS module_name FROM suggestions s LEFT JOIN modules m ON m.slug = s.module_slug WHERE s.status IN ('open', 'dismissed') ORDER BY (s.status = 'open') DESC, s.last_seen DESC, s.id DESC").all()
  .map((r) => ({ ...r, data: (() => { try { return JSON.parse(r.data); } catch (e) { return {}; } })(), ai: (() => { try { return r.ai ? JSON.parse(r.ai) : null; } catch (e) { return null; } })() }));

// Un promemoria in-app agli admin, al massimo ogni 7 giorni e solo se c'è qualcosa di aperto (mai una notifica a ogni scansione).
const NOTIFICA = { categoria: 'suggerimenti', giorni: 7 };
function notifica(oggi = new Date()) {
  const aperte = db.prepare("SELECT COUNT(*) c FROM suggestions WHERE status = 'open'").get().c;
  if (!aperte) return false;
  const ultima = db.prepare('SELECT created_at FROM notifications WHERE category = ? ORDER BY created_at DESC LIMIT 1').get(NOTIFICA.categoria);
  if (ultima && (oggi.getTime() - new Date(String(ultima.created_at).replace(' ', 'T') + 'Z').getTime()) / 86400000 < NOTIFICA.giorni) return false;
  db.prepare("INSERT INTO notifications (message, roles, category) VALUES (?, '[\"admin\"]', ?)").run(aperte === 1 ? 'C\'è un suggerimento per migliorare i tuoi moduli: lo trovi in Impostazioni → Suggerimenti.' : 'Ci sono ' + aperte + ' suggerimenti per migliorare i tuoi moduli: li trovi in Impostazioni → Suggerimenti.', NOTIFICA.categoria);
  return true;
}

let running = false;
function tick(oggi = new Date()) {
  if (running || !require('./features').isEnabled('suggerimenti')) return null;
  running = true;
  try { const r = scansiona(oggi); notifica(oggi); return r; } finally { running = false; }
}
function startSuggestions() {
  const { withLock } = require('./scheduler-lock');
  const guarded = withLock('suggestions', 30 * 60 * 1000, async () => tick());
  // una volta al giorno (i modi d'uso cambiano piano): un controllo ogni ora decide se è il momento (la scansione stessa è leggera)
  let ultimo = 0;
  setInterval(() => { if (Date.now() - ultimo < 23 * 3600 * 1000) return; ultimo = Date.now(); Promise.resolve().then(() => guarded()).catch((e) => console.error('[suggerimenti]', e.message)); }, 3600 * 1000).unref();
  setTimeout(() => { ultimo = Date.now(); Promise.resolve().then(() => guarded()).catch(() => {}); }, 2 * 60 * 1000).unref();
}

module.exports = { osservaModulo, scansiona, elenco, notifica, tick, startSuggestions, SOGLIE };
