'use strict';
// La guida all'uso del verticale nato da un'analisi: come si lavora, ruolo per ruolo, processo per processo e modulo per modulo.
// Si costruisce SOLO da ciò che esiste (i processi dell'analisi, gli schemi dei moduli della Libreria, i report e l'AI proposti): nessuna AI, nessun testo
// scritto per un settore. Niente di inventato: se un dato manca, la voce non compare.
const db = require('../db');
const { parseSchemaNormalized } = require('../../../../shared/schema-v3-core.js');
const analysis = require('./analysis');

const TIPI = { text: 'testo', textarea: 'testo lungo', number: 'numero', currency: 'importo', date: 'data', datetime: 'data e ora', select: 'scelta', checkbox: 'sì/no', computed: 'calcolato', relation: 'collegamento' };
const REPORT = { riepilogo_periodo: 'riepilogo di un periodo', coda: 'elenco da trattare', in_ritardo: 'voci in ritardo', ore_periodo: 'ore del periodo', ore_settimana: 'ore e straordinari' };
const AI = { triage: 'propone categoria, importo e scadenza delle righe nuove', explain: 'racconta i numeri del modulo', import: 'legge un PDF o la foto di uno scontrino e propone la riga' };
const uniq = (a) => [...new Set(a)];

function scheda(rm, byslug) {
  let s = {}; try { s = parseSchemaNormalized(rm.schema_json); } catch (e) { /* schema illeggibile: scheda vuota */ }
  const nomeDi = (slug) => (byslug.get(slug) || {}).name || slug;
  return {
    id: rm.id, nome: rm.name, slug: rm.slug, descrizione: rm.description || '', gruppo: rm.group_name || '',
    campi: (s.fields || []).filter((f) => f.label || f.key).slice(0, 40).map((f) => ({ nome: f.label || f.key, tipo: TIPI[f.type] || f.type || 'testo', scelte: f.type === 'select' ? (f.options || []).map((o) => (o && o.label) || o).slice(0, 12) : undefined })),
    stati: ((s.workflow && s.workflow.states) || []).map((x) => x.label || x.key),
    collegamenti: uniq((s.relations || []).map((r) => nomeDi(r.target_module)).filter(Boolean)),
    collegamentiSlug: uniq((s.relations || []).map((r) => r.target_module).filter(Boolean)),
  };
}

function build(a) {
  const processi = a.processi || [];
  const bp = analysis.blueprint(processi);
  const ids = bp.moduli_ids || [];
  const rows = ids.map((id) => db.prepare('SELECT id, name, slug, description, group_name, schema_json FROM registry_modules WHERE id = ?').get(id)).filter(Boolean);
  const tutti = db.prepare('SELECT slug, name FROM registry_modules').all();
  const byslug = new Map(tutti.map((r) => [r.slug, r]));
  const moduli = rows.map((r) => scheda(r, byslug));
  const modDi = (p) => moduli.find((m) => m.id === p.registry_module_id) || null;
  const escludi = new Set((a.scelte && a.scelte.escludi) || []);
  const prop = analysis.proposte(ids);

  // Chi fa cosa: per ogni ruolo di tipo utente, i passaggi in cui compare (per nome del ruolo) e i processi in cui è coinvolto.
  const ruoli = new Map();
  for (const p of processi) for (const r of (p.ruoli_coinvolti || [])) {
    if (r.tipo !== 'utente') continue;
    const k = r.nome.toLowerCase();
    if (!ruoli.has(k)) ruoli.set(k, { nome: r.nome, processi: [], passaggi: [] });
    ruoli.get(k).processi.push(p.nome);
  }
  for (const p of processi) for (const st of (p.passaggi || [])) {
    const r = st.ruolo && ruoli.get(st.ruolo.toLowerCase());
    if (r) r.passaggi.push({ processo: p.nome, titolo: st.titolo, descrizione: st.descrizione });
  }

  return {
    nome: a.name, descrizione: a.descrizione || '', profilo: a.profilo || {},
    moduli,
    processi: processi.map((p) => { const m = modDi(p); return { nome: p.nome, reparto: p.reparto, scopo: p.scopo, quando: p.evento_innesco, serve: p.input, produce: p.output, modulo: m && m.nome, passaggi: p.passaggi || [], eccezioni: p.eccezioni || [], kpi: p.kpi || [], da_costruire: p.copertura === 'da_costruire' }; }),
    ruoli: [...ruoli.values()].map((r) => ({ ...r, processi: uniq(r.processi) })),
    report: prop.report.filter((x) => !escludi.has(x.key)).map((x) => ({ nome: x.nome, tipo: REPORT[x.tipo] || x.tipo, perche: x.perche })),
    ai: prop.ai.filter((x) => !escludi.has(x.key)).map((x) => ({ modulo: x.modulo, cosa: AI[x.feature] || x.feature })),
    da_costruire: bp.da_costruire,
  };
}

module.exports = { build, scheda };
