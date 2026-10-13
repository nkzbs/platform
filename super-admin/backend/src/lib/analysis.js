'use strict';
// Analisi dei processi: dal racconto di un'attività ai processi (con ruoli, passaggi, copertura) e da lì ai moduli da installare.
// L'AI PROPONE soltanto: ogni risposta del modello si ripulisce e si valida qui (campi noti, lunghezze, un modulo deve esistere nella Libreria),
// e la scrittura nel tenant avviene solo dopo la conferma di chi ha l'analisi aperta. Il modello vede solo ciò che si scrive nell'analisi
// (ripulito dai dati personali) e l'elenco dei moduli della Libreria (nome e descrizione): nessun dato di altri tenant.
// Costa sulla chiave di Super Admin (lib/ai-key.js), non su quella di un tenant. Nessun nome di settore o di modulo nel codice.
const db = require('../db');
const { redact } = require('./ai-redact');
const { parseJsonResponse } = require('./ai');
const providers = require('./ai-providers');

const AI_PROVIDER = process.env.AI_PROVIDER || 'mistral';
const TIPI_RUOLO = ['utente', 'sistema', 'esterno'];
const TIPI_PASSAGGIO = ['step', 'decisione'];
const TIPI_CALLOUT = ['nota', 'limite', 'lezione'];
const COPERTURE = ['da_valutare', 'coperto', 'da_costruire'];
const MAX_PROCESSI = 40;

// Chi chiama l'AI si può sostituire nei test (nessuna chiamata di rete vera).
const deps = {
  callAI: (...a) => providers.callAI(...a), isConfigured: () => providers.isProviderConfigured(AI_PROVIDER),
  applyConfig: (...a) => require('./tenant-config-from-analysis').applyAnalysisConfigToTenant(...a), // ruoli e stati nel tenant appena creato
  setupTenant: (slug, pacchetto) => require('./tenant-api-client').callTenantAPI(slug, 'POST', '/api/internal-setup/apply', pacchetto), // dichiarazioni dei moduli, report e AI
};

const t = (v, n) => String(v == null ? '' : v).replace(/[\r\n]+/g, ' ').trim().slice(0, n);
const list = (v, n, len) => (Array.isArray(v) ? v : []).map((x) => t(x, len)).filter(Boolean).slice(0, n);

// ── la Libreria vista dall'AI e dalla copertura ──────────────────────────────────────────────────────────────────
// L'ultima versione di ogni modulo (esclusi quelli di supporto): id, nome, descrizione, gruppo.
function libraryModules() {
  return db.prepare(`
    SELECT rm.id, rm.name, rm.description, rm.group_name FROM registry_modules rm
    JOIN (SELECT slug, source_tenant_slug, MAX(version) AS v FROM registry_modules GROUP BY slug, source_tenant_slug) l
      ON l.slug = rm.slug AND l.source_tenant_slug IS rm.source_tenant_slug AND l.v = rm.version
    WHERE rm.support_module = 0 ORDER BY rm.name`).all();
}
const moduleList = (mods) => mods.map((m) => m.id + ': ' + m.name + (m.group_name ? ' [' + m.group_name + ']' : '') + (m.description ? ' — ' + m.description : '')).join('\n');

// ── pulizia di ciò che arriva dal browser o dal modello ──────────────────────────────────────────────────────────
// `validIds`: gli id di modulo che esistono davvero; un id inventato dal modello diventa null.
function sanitizeProcesso(p, validIds) {
  p = p && typeof p === 'object' ? p : {};
  const ids = validIds instanceof Set ? validIds : null;
  const modId = Number.isInteger(Number(p.registry_module_id)) && Number(p.registry_module_id) > 0 ? Number(p.registry_module_id) : null;
  const registry_module_id = modId && (!ids || ids.has(modId)) ? modId : null;
  let copertura = COPERTURE.includes(p.copertura) ? p.copertura : 'da_valutare';
  if (registry_module_id && copertura === 'da_valutare') copertura = 'coperto';
  return {
    codice: t(p.codice, 20), nome: t(p.nome, 80), reparto: t(p.reparto, 60), scopo: t(p.scopo, 300),
    evento_innesco: t(p.evento_innesco, 300), input: t(p.input, 300), output: t(p.output, 300),
    ruoli_coinvolti: (Array.isArray(p.ruoli_coinvolti) ? p.ruoli_coinvolti : []).slice(0, 12).map((r) => ({ nome: t(r && r.nome, 60), tipo: TIPI_RUOLO.includes(r && r.tipo) ? r.tipo : 'utente' })).filter((r) => r.nome),
    passaggi: (Array.isArray(p.passaggi) ? p.passaggi : []).slice(0, 20).map((s) => ({ titolo: t(s && s.titolo, 100), ruolo: t(s && s.ruolo, 60), descrizione: t(s && s.descrizione, 300), tipo: TIPI_PASSAGGIO.includes(s && s.tipo) ? s.tipo : 'step' })).filter((s) => s.titolo || s.descrizione),
    eccezioni: list(p.eccezioni, 12, 200), documenti_collegati: list(p.documenti_collegati, 12, 120), sistemi_coinvolti: list(p.sistemi_coinvolti, 12, 80), kpi: list(p.kpi, 12, 160),
    callout: (Array.isArray(p.callout) ? p.callout : []).slice(0, 12).map((c) => ({ tipo: TIPI_CALLOUT.includes(c && c.tipo) ? c.tipo : 'nota', testo: t(c && c.testo, 300) })).filter((c) => c.testo),
    registry_module_id, registry_module_reasoning: t(p.registry_module_reasoning, 300), copertura,
  };
}
function sanitizeProcessi(arr, validIds) { return (Array.isArray(arr) ? arr : []).slice(0, MAX_PROCESSI).map((p) => sanitizeProcesso(p, validIds)).filter((p) => p.nome); }
function sanitizeProfilo(p) {
  p = p && typeof p === 'object' ? p : {};
  return { settore: t(p.settore, 80), dimensione: t(p.dimensione, 40), numero_dipendenti: Math.max(0, Math.min(100000, parseInt(p.numero_dipendenti, 10) || 0)), numero_sedi: Math.max(0, Math.min(1000, parseInt(p.numero_sedi, 10) || 0)), reparti: list(p.reparti, 20, 60), sistemi_esistenti: list(p.sistemi_esistenti, 20, 80), obiettivi: t(p.obiettivi, 400), criticita: t(p.criticita, 400) };
}

// ── prompt ───────────────────────────────────────────────────────────────────────────────────────────────────────
const PROCESSO_SPEC = `Sei un consulente che aiuta a documentare i processi di un'attività in stile "manuale dei processi", per poi scegliere i moduli software giusti.

Dato il nome di un processo (e opzionalmente il reparto), rispondi SOLO con un oggetto JSON in questa forma esatta, senza testo prima o dopo e senza blocchi markdown:
{
  "scopo": "una frase sullo scopo del processo",
  "evento_innesco": "una frase: cosa lo fa partire",
  "input": "una frase: cosa serve già pronto",
  "output": "una frase: cosa produce quando è completato",
  "ruoli_coinvolti": [{"nome": "Nome ruolo", "tipo": "utente"}],
  "passaggi": [{"titolo": "Titolo breve", "ruolo": "Nome ruolo", "descrizione": "una frase", "tipo": "step"}],
  "sistemi_coinvolti": ["sistema o software usato, se noto"],
  "kpi": ["un indicatore misurabile"],
  "registry_module_id": numero oppure null,
  "registry_module_reasoning": "una frase: perché quel modulo, o perché nessuno è adatto"
}

Regole:
- "tipo" di un ruolo: "utente" (una persona che userà il software: diventa un ruolo con permessi), "sistema" (automazione) o "esterno" (es. commercialista).
- Il "ruolo" di ogni passaggio deve essere uno dei nomi in ruoli_coinvolti.
- Da 2 a 5 passaggi in ordine logico; "tipo" è "step" oppure "decisione" (un bivio vero, es. "Preventivo approvato?").
- "sistemi_coinvolti" e "kpi" possono essere vuoti: non inventare KPI generici senza contesto.
- "registry_module_id" DEVE essere uno degli id dell'elenco dei moduli forniti, oppure null: non inventare mai un id.`;

const MULTI_SPEC = `Sei un consulente che, dalla descrizione di un'attività, elenca i processi più plausibili che gestisce, in stile "manuale dei processi".

Rispondi SOLO con un oggetto JSON in questa forma esatta, senza testo prima o dopo e senza blocchi markdown:
{"processi": [{"nome": "Nome breve", "reparto": "Reparto plausibile", "scopo": "una frase", "registry_module_id": numero oppure null, "registry_module_reasoning": "una frase"}]}

Regole:
- Da 4 a 8 processi, i più concreti per QUESTA attività: non processi generici che andrebbero bene per qualunque attività.
- Non proporre due processi troppo simili.
- "registry_module_id" DEVE essere uno degli id dell'elenco dei moduli forniti, oppure null: non inventare mai un id.`;

async function ask(system, user, maxTokens) {
  if (!deps.isConfigured()) throw Object.assign(new Error('Nessuna chiave AI di Super Admin: inseriscila in Impostazioni → Chiavi AI.'), { status: 503, code: 'ai_not_configured' });
  const text = await deps.callAI(AI_PROVIDER, { system, user, maxTokens, timeoutMs: 60000 });
  try { return parseJsonResponse(text); } catch (e) { throw Object.assign(new Error('Il modello non ha restituito un JSON valido'), { status: 502 }); }
}

// Un processo completo a partire dal nome: una PROPOSTA, mai scritta da sola.
async function suggestProcesso({ nome, reparto }) {
  const mods = libraryModules();
  const out = await ask(PROCESSO_SPEC, 'Processo: ' + redact(t(nome, 80)) + (reparto ? '\nReparto: ' + redact(t(reparto, 60)) : '') + '\n\nModuli disponibili:\n' + (moduleList(mods) || '(nessun modulo disponibile)'), 1800);
  const p = sanitizeProcesso({ ...out, nome }, new Set(mods.map((m) => m.id)));
  return p;
}

// Più processi da una descrizione: bozze «leggere» da accettare una per una.
async function suggestProcessi({ descrizione }) {
  const mods = libraryModules();
  const out = await ask(MULTI_SPEC, 'Descrizione dell\'attività: ' + redact(t(descrizione, 1500)) + '\n\nModuli disponibili:\n' + (moduleList(mods) || '(nessun modulo disponibile)'), 2200);
  return sanitizeProcessi(out && out.processi, new Set(mods.map((m) => m.id)));
}

// ── dipendenze: un modulo con una relazione verso un altro ha bisogno anche di quello (righe → fattura → cliente) ──────────────────────
// Dato un elenco di id di moduli della Libreria, ritorna l'elenco completo con quelli richiesti dalle loro relazioni (a catena), nello stesso ordine + i collegati in coda.
function withDependencies(ids) {
  const { parseSchemaNormalized } = require('../../../../shared/schema-v3-core.js');
  const out = [...new Set(ids)], seen = new Set(out);
  for (let i = 0; i < out.length; i++) {
    const row = db.prepare('SELECT schema_json, source_tenant_slug FROM registry_modules WHERE id = ?').get(out[i]);
    if (!row) continue;
    let rel = []; try { rel = parseSchemaNormalized(row.schema_json).relations || []; } catch (e) { /* schema illeggibile: nessuna dipendenza */ }
    for (const r of rel) {
      const slug = r && r.target_module; if (!slug) continue;
      const dep = db.prepare('SELECT id FROM registry_modules WHERE slug = ? ORDER BY (source_tenant_slug IS ?) DESC, version DESC LIMIT 1').get(slug, row.source_tenant_slug);
      if (dep && !seen.has(dep.id)) { seen.add(dep.id); out.push(dep.id); }
    }
  }
  return out;
}

// ── proposte di report e di AI, dalle dichiarazioni dei moduli scelti (nessun nome di settore: guardano solo i ruoli dichiarati) ───────────────────
const dichiarazione = (r) => { try { return r && r.ruoli ? JSON.parse(r.ruoli) : null; } catch (e) { return null; } };
function moduliDichiarati(ids) {
  return ids.map((id) => db.prepare('SELECT id, name, slug, ruoli FROM registry_modules WHERE id = ?').get(id)).filter(Boolean)
    .map((r) => ({ id: r.id, name: r.name, slug: r.slug, decl: dichiarazione(r) })).filter((m) => m.decl);
}
const elenca = (mm) => mm.map((m) => m.name).join(', ');

// Quali report ha senso proporre e quali potenziamenti AI accendere, per i moduli scelti. Ogni voce ha una chiave stabile (per poterla togliere) e il perché.
function proposte(ids) {
  const mm = moduliDichiarati(ids), report = [], ai = [];
  const av = (m) => m.decl.avvisi || {};
  const conScadenza = mm.filter((m) => av(m).scadenze && av(m).states && av(m).states.da_fare);
  const daPagare = conScadenza.filter((m) => m.decl.kind === 'spesa');
  const coda = mm.filter((m) => av(m).nuovo && av(m).states && av(m).states.nuovo);
  const presenze = mm.filter((m) => m.decl.kind === 'presenze');
  if (daPagare.length) report.push({ key: 'report:riepilogo_periodo', tipo: 'riepilogo_periodo', nome: 'Quanto devo pagare', params: { stato: 'da_fare', giorno: 5, ora: 18, stipendio: false, titolo: 'In scadenza' }, perche: 'Totale di ciò che scade nel mese: ' + elenca(daPagare) + '.' });
  if (conScadenza.length) report.push({ key: 'report:in_ritardo', tipo: 'in_ritardo', nome: 'Voci in ritardo', params: { stato: 'da_fare', freq: 'settimanale', weekday: 1, ora: 9, titolo: 'In ritardo', piede: '' }, perche: 'Ogni lunedì ciò che ha la scadenza passata: ' + elenca(conScadenza) + '.' });
  if (coda.length) report.push({ key: 'report:coda', tipo: 'coda', nome: 'Da trattare', params: { stato: 'nuovo', freq: 'giornaliera', ora: 18, titolo: 'Da trattare', piede: '' }, perche: 'Ogni sera le righe nuove ancora da prendere in carico: ' + elenca(coda) + '.' });
  if (presenze.length) report.push({ key: 'report:ore_settimana', tipo: 'ore_settimana', nome: 'Ore e straordinari', params: { freq: 'settimanale', weekday: 0, ora: 20, soglia_ore: 40 }, perche: 'Ogni domenica sera le ore di ognuno e lo straordinario oltre le 40 ore: ' + elenca(presenze) + '.' });
  for (const m of mm) {
    const R = m.decl.roles || {}, k = m.decl.kind;
    if (k === 'spesa' && R.stato && R.importo && R.categoria && av(m).states && av(m).states.nuovo) ai.push({ key: 'ai:' + m.slug + ':triage', slug: m.slug, modulo: m.name, feature: 'triage', perche: 'Propone categoria, importo e scadenza per le righe da smistare.' });
    if ((k === 'spesa' || k === 'entrata' || k === 'pratica') && R.importo && R.data) ai.push({ key: 'ai:' + m.slug + ':explain', slug: m.slug, modulo: m.name, feature: 'explain', perche: 'Racconta i numeri del modulo.' });
    if (k === 'spesa' && R.importo && R.data) ai.push({ key: 'ai:' + m.slug + ':import', slug: m.slug, modulo: m.name, feature: 'import', perche: 'Legge un PDF o la foto di uno scontrino e propone la riga.' });
  }
  return { report, ai };
}

// Il pacchetto da mandare al tenant appena creato: ruoli dei moduli installati + le proposte NON tolte da chi ha l'analisi.
function pacchettoTenant(ids, escludi) {
  const out = new Set(escludi || []), p = proposte(ids);
  const ai = {};
  p.ai.filter((x) => !out.has(x.key)).forEach((x) => { (ai[x.slug] = ai[x.slug] || []).push(x.feature); });
  return {
    module_roles: moduliDichiarati(ids).map((m) => ({ slug: m.slug, ...m.decl })),
    ai: Object.entries(ai).map(([slug, features]) => ({ slug, features })),
    reports: p.report.filter((x) => !out.has(x.key)).map((x) => ({ tipo: x.tipo, nome: x.nome, params: x.params })),
  };
}

// ── blueprint: cosa copre la Libreria e cosa va costruito (solo conteggi dal contenuto dell'analisi) ─────────────────
function blueprint(processi) {
  const c = { coperto: 0, da_valutare: 0, da_costruire: 0 };
  processi.forEach((p) => { c[p.copertura] = (c[p.copertura] || 0) + 1; });
  const diretti = [...new Set(processi.map((p) => p.registry_module_id).filter(Boolean))];
  const moduliIds = withDependencies(diretti); // più i moduli che quelli richiedono
  const nomi = (ids) => ids.map((id) => (db.prepare('SELECT name FROM registry_modules WHERE id = ?').get(id) || {}).name).filter(Boolean);
  const ruoli = new Set(); processi.forEach((p) => (p.ruoli_coinvolti || []).forEach((r) => { if (r.tipo === 'utente') ruoli.add(r.nome.toLowerCase()); }));
  return { processi: processi.length, ...c, proposte: proposte(moduliIds), moduli_ids: moduliIds, moduli_collegati: nomi(moduliIds.filter((id) => !diretti.includes(id))), ruoli_utente: ruoli.size, da_costruire: processi.filter((p) => p.copertura === 'da_costruire').map((p) => p.nome) };
}

module.exports = { deps, withDependencies, proposte, pacchettoTenant, libraryModules, sanitizeProcesso, sanitizeProcessi, sanitizeProfilo, suggestProcesso, suggestProcessi, blueprint, COPERTURE };
