'use strict';
// "Chiedi ai tuoi dati": costruisce il catalogo dei moduli (mai record), rivalida la query che torna da Super Admin e la ESEGUE con il codice del progetto.
// Nessun SQL generato da un modello: la query è un oggetto con un elenco chiuso di calcoli, filtri e raggruppamenti. Rispetta i permessi di chi chiede.
const db = require('./db');
const moduleRoles = require('./module-roles');
const { parseSchemaNormalized } = require('./schema-v3');
const { ruleFor, filterViewable } = require('./permissions');

const CALCOLI = ['somma', 'conteggio', 'media', 'massimo', 'minimo'];
const OPS = ['uguale', 'contiene', 'maggiore', 'minore'];
const RAGGRUPPA = ['mese', 'anno', 'categoria', 'nessuno'];
const RUOLI = ['importo', 'data', 'scadenza', 'categoria', 'descrizione', 'stato', 'gruppo'];
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const round2 = (n) => Math.round(n * 100) / 100;
const num = (v) => { const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };

function categorieOf(slug, campo) {
  const row = db.prepare('SELECT schema_json FROM modules WHERE slug = ?').get(slug);
  if (!row || !campo) return [];
  try {
    const f = (parseSchemaNormalized(row.schema_json).fields || []).find((x) => x.key === campo);
    return f && Array.isArray(f.options) ? f.options.map((o) => (typeof o === 'string' ? o : o.value)).filter(Boolean) : [];
  } catch (e) { return []; }
}

// I moduli interrogabili (hanno dichiarato kind e un importo), con i ruoli e le categorie ammesse. Nessun dato di righe.
function catalogo() {
  return moduleRoles.list({}).filter((m) => m.roles.importo).map((m) => ({
    slug: m.module_slug, name: m.name, kind: m.kind,
    ruoli: RUOLI.filter((r) => m.roles[r]), categorie: categorieOf(m.module_slug, m.roles.categoria),
  }));
}

// Rivalida la query contro il catalogo del progetto (anche se Super Admin l'ha già fatto). Ritorna { query } o { error }.
function validate(q, cat) {
  if (!q || typeof q !== 'object') return { error: 'Query non valida' };
  const mod = cat.find((m) => m.slug === q.modulo);
  if (!mod) return { error: 'Modulo non interrogabile' };
  if (!CALCOLI.includes(q.calcolo) || !RAGGRUPPA.includes(q.raggruppa)) return { error: 'Calcolo o raggruppamento non ammesso' };
  if (q.raggruppa === 'categoria' && !mod.ruoli.includes('categoria')) return { error: 'Il modulo non ha una categoria' };
  if (q.periodo && (!ISO.test(String(q.periodo.da)) || !ISO.test(String(q.periodo.a)) || q.periodo.da > q.periodo.a)) return { error: 'Periodo non valido' };
  const filtri = Array.isArray(q.filtri) ? q.filtri : [];
  if (filtri.length > 4) return { error: 'Troppi filtri' };
  for (const f of filtri) {
    if (!f || !mod.ruoli.includes(f.ruolo) || f.ruolo === 'data' || !OPS.includes(f.op)) return { error: 'Filtro non valido' };
    if (f.ruolo === 'importo' ? !Number.isFinite(Number(f.valore)) : typeof f.valore !== 'string' || !f.valore) return { error: 'Valore del filtro non valido' };
  }
  return { query: { modulo: q.modulo, calcolo: q.calcolo, periodo: q.periodo || null, filtri, raggruppa: q.raggruppa, titolo: String(q.titolo || '').slice(0, 80) } };
}

const monthOf = (v) => { const m = String(v || '').match(/^(\d{4})-(\d{2})/); return m ? m[1] + '-' + m[2] : null; };

// Esegue la query. `user` serve per i permessi del modulo. Le righe nello stato "nuovo" (ancora da smistare) e quelle con data incerta non contano,
// come nelle altre viste dei numeri.
function run(q, user) {
  const decl = moduleRoles.get(q.modulo);
  const R = decl.roles, nuovo = decl.avvisi.states.nuovo;
  const schema = (() => { const m = db.prepare('SELECT schema_json FROM modules WHERE slug = ?').get(q.modulo); try { return parseSchemaNormalized(m.schema_json); } catch (e) { return {}; } })();
  let recs = db.prepare('SELECT id, user_id, data FROM records WHERE module_slug = ?').all(q.modulo).map((r) => ({ ...r, data: JSON.parse(r.data) }));
  recs = filterViewable(recs, ruleFor(schema, user && user.role), user);
  let esclusi = 0;
  const righe = recs.filter((r) => {
    const d = r.data;
    if (nuovo && d[R.stato || '_stato'] === nuovo) { esclusi++; return false; }
    if (d.data_incerta) return false;
    if (q.periodo) { const dt = String(d[R.data] || '').slice(0, 10); if (!(dt >= q.periodo.da && dt <= q.periodo.a)) return false; }
    return q.filtri.every((f) => {
      const v = d[R[f.ruolo]];
      if (f.ruolo === 'importo') { const n = num(v); const t = Number(f.valore); return n != null && (f.op === 'maggiore' ? n > t : f.op === 'minore' ? n < t : n === t); }
      const a = String(v == null ? '' : v).toLowerCase(), b = String(f.valore).toLowerCase();
      return f.op === 'contiene' ? a.includes(b) : a === b;
    });
  });
  const key = (r) => (q.raggruppa === 'mese' ? monthOf(r.data[R.data]) : q.raggruppa === 'anno' ? String(r.data[R.data] || '').slice(0, 4) : q.raggruppa === 'categoria' ? (r.data[R.categoria] || '(senza categoria)') : 'Totale');
  const gruppi = new Map();
  for (const r of righe) {
    const k = key(r); if (!k) continue;
    const g = gruppi.get(k) || { etichetta: k, n: 0, somma: 0, min: null, max: null };
    const n = num(r.data[R.importo]); g.n++;
    if (n != null) { g.somma += n; g.min = g.min == null ? n : Math.min(g.min, n); g.max = g.max == null ? n : Math.max(g.max, n); }
    gruppi.set(k, g);
  }
  const valoreDi = (g) => round2(q.calcolo === 'conteggio' ? g.n : q.calcolo === 'media' ? (g.n ? g.somma / g.n : 0) : q.calcolo === 'massimo' ? (g.max || 0) : q.calcolo === 'minimo' ? (g.min || 0) : g.somma);
  let out = [...gruppi.values()].map((g) => ({ etichetta: g.etichetta, valore: valoreDi(g), n: g.n }));
  out = q.raggruppa === 'categoria' ? out.sort((a, b) => b.valore - a.valore) : out.sort((a, b) => String(a.etichetta).localeCompare(String(b.etichetta)));
  const totaleG = { n: righe.length, somma: [...gruppi.values()].reduce((t, g) => t + g.somma, 0), min: null, max: null };
  for (const g of gruppi.values()) { if (g.min != null) totaleG.min = totaleG.min == null ? g.min : Math.min(totaleG.min, g.min); if (g.max != null) totaleG.max = totaleG.max == null ? g.max : Math.max(totaleG.max, g.max); }
  return { totale: valoreDi(totaleG), righe: out, n_righe: righe.length, esclusi_da_smistare: esclusi };
}

// Il filtro in parole, per mostrare a chi chiede cosa è stato capito (e controllare).
function leggibile(q, nomeModulo) {
  const calc = { somma: 'Somma dell\'importo', conteggio: 'Numero di righe', media: 'Media dell\'importo', massimo: 'Importo massimo', minimo: 'Importo minimo' }[q.calcolo];
  const opTxt = { uguale: '=', contiene: 'contiene', maggiore: '>', minore: '<' };
  const out = ['Modulo: ' + nomeModulo, calc];
  for (const f of q.filtri) out.push(f.ruolo.charAt(0).toUpperCase() + f.ruolo.slice(1) + ' ' + opTxt[f.op] + ' ' + f.valore);
  if (q.periodo) out.push('Dal ' + q.periodo.da.split('-').reverse().join('/') + ' al ' + q.periodo.a.split('-').reverse().join('/'));
  if (q.raggruppa !== 'nessuno') out.push('Per ' + q.raggruppa);
  return out;
}

module.exports = { catalogo, validate, run, leggibile };
