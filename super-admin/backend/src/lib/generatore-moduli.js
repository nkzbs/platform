'use strict';
// GENERATORE DI MODULI: dai processi di un'analisi ai moduli che la Libreria non ha. L'AI PROPONE, il codice controlla tutto:
//   1. pianifica: quali moduli nuovi servono (nome, scopo, collegamenti), senza duplicare quelli della Libreria;
//   2. generaModulo: per ognuno, una bozza di schema nel linguaggio del Builder (campi, relazioni, stati e passaggi, requisiti, allegati, automazioni, documenti, calendario);
//      la bozza si ripulisce (solo blocchi e proprietà noti, chiavi valide, un solo stato iniziale), si controlla con shared/verifica-moduli.js — lo stesso controllo di «Controlla il
//      tenant» — e se ci sono problemi si rimanda al modello con l'elenco, fino a 3 tentativi;
//   3. nulla viene scritto in un tenant da qui: chi chiama installa solo ciò che chi ha l'analisi ha approvato.
// Il modello vede solo il racconto ripulito dai dati personali, i processi e i nomi dei moduli: nessun dato di altri tenant. Nessun nome di settore nel codice.
const { redact } = require('./ai-redact');
const { parseJsonResponse } = require('./ai');
const providers = require('./ai-providers');
const { controllaModuli } = require('../../../../shared/verifica-moduli.js');

const AI_PROVIDER = process.env.AI_PROVIDER || 'mistral';
const MAX_TENTATIVI = 3;
const MAX_MODULI = 12;
const deps = { callAI: (...a) => providers.callAI(...a), isConfigured: () => providers.isProviderConfigured(AI_PROVIDER) };

const t = (v, n) => String(v == null ? '' : v).replace(/[\r\n]+/g, ' ').trim().slice(0, n);
const IDENT = /^[a-z][a-z0-9_]{0,39}$/;
const slugDa = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^[0-9]+/, '').slice(0, 40);
const TIPI_CAMPO = ['text', 'number', 'currency', 'date', 'datetime', 'time', 'select', 'multiselect', 'checkbox', 'textarea', 'email', 'phone', 'url', 'computed'];
const VALIDAZIONI = ['codice_fiscale_it', 'partita_iva_it', 'codice_fiscale_o_piva_it'];
const COLORI = ['#2563EB', '#10B981', '#F59E0B', '#6366F1', '#EC4899', '#7C3AED', '#F87171', '#FFB84D'];
const ICONE = ['home', 'users', 'box', 'store', 'tool', 'plug', 'zap', 'user', 'file', 'credit-card', 'bar-chart', 'grid', 'link', 'git-branch', 'cpu', 'settings'];
const AZIONI_AMMESSE = ['crea_record', 'aggiorna_record', 'notifica_interna'];

// ── pulizia di ciò che arriva dal modello ──
function sanitizzaSchema(raw, slug) {
  const src = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.steps) ? raw.steps : []);
  const out = []; let n = 0; const id = () => 'blk_' + (++n);
  const chiavi = new Set();
  const chiaveValida = (k) => { const x = slugDa(k); return IDENT.test(x) ? x : ''; };
  const prima = (tipo) => src.filter((b) => b && b.block_type === tipo);

  for (const b of prima('field')) {
    const key = chiaveValida(b.key || b.label); if (!key || chiavi.has(key)) continue; chiavi.add(key);
    const tipo = TIPI_CAMPO.includes(b.type) ? b.type : 'text';
    const f = { id: id(), block_type: 'field', key, label: t(b.label, 80) || key, type: tipo };
    if (b.required === true) f.required = true;
    if (b.dato_chiave === true) f.dato_chiave = true;
    if (typeof b.sezione === 'string' && b.sezione.trim()) f.sezione = t(b.sezione, 60);
    if (VALIDAZIONI.includes(b.validazione)) f.validazione = b.validazione;
    if (tipo === 'select' || tipo === 'multiselect') { const o = (Array.isArray(b.options) ? b.options : []).map((x) => t(typeof x === 'object' && x ? x.label || x.value : x, 60)).filter(Boolean); f.options = [...new Set(o)].slice(0, 30); if (!f.options.length) f.type = 'text'; }
    if (tipo === 'computed') { if (typeof b.expr === 'string' && b.expr.trim()) f.expr = t(b.expr, 300); else f.type = 'number'; }
    out.push(f);
  }
  for (const b of prima('relation')) {
    const key = chiaveValida(b.key || b.label); if (!key || chiavi.has(key)) continue; const target = chiaveValida(b.target_module); if (!target) continue; chiavi.add(key);
    out.push({ id: id(), block_type: 'relation', key, label: t(b.label, 80) || key, type: 'many_to_one', target_module: target, display_field: chiaveValida(b.display_field) || 'nome' });
  }
  // flusso: un solo stato iniziale, passaggi solo tra stati che esistono
  const stati = []; for (const b of prima('workflow_state')) { const key = chiaveValida(b.key || b.label); if (key && !stati.some((s) => s.key === key)) stati.push({ id: id(), block_type: 'workflow_state', key, label: t(b.label, 60) || key, ...(b.initial === true ? { initial: true } : {}) }); }
  if (stati.length) { const iniz = stati.filter((s) => s.initial); stati.forEach((s) => { delete s.initial; }); (iniz[0] || stati[0]).initial = true; }
  out.push(...stati);
  const chiaviStati = new Set(stati.map((s) => s.key)); const visti = new Set();
  for (const b of prima('workflow_transition')) { const from = chiaveValida(b.from), to = chiaveValida(b.to); if (!chiaviStati.has(from) || !chiaviStati.has(to) || from === to || visti.has(from + '>' + to)) continue; visti.add(from + '>' + to); out.push({ id: id(), block_type: 'workflow_transition', from, to, label: t(b.label, 80) || stati.find((s) => s.key === to).label }); }
  const tipiAllegato = new Set();
  for (const b of prima('allegati')) { const types = (Array.isArray(b.types) ? b.types : []).map((x) => t(x, 80)).filter(Boolean).slice(0, 20); types.forEach((x) => tipiAllegato.add(x)); if (types.length) out.push({ id: id(), block_type: 'allegati', label: t(b.label, 60) || 'Allegati', types }); }
  for (const b of prima('state_requirements')) {
    const stato = chiaveValida(b.stato); if (!chiaviStati.has(stato)) continue;
    const requisiti = (Array.isArray(b.requisiti) ? b.requisiti : []).map((r) => {
      if (!r || !r.label) return null; const label = t(r.label, 80);
      if (r.tipo === 'allegato' && r.valore) return { label, tipo: 'allegato', valore: t(r.valore, 80) };
      if (r.tipo === 'uno_di' && Array.isArray(r.campi)) return { label, tipo: 'uno_di', campi: r.campi.map(chiaveValida).filter(Boolean).slice(0, 6) };
      if (r.campo) return { label, tipo: 'campo', campo: String(r.campo).split('.').map(chiaveValida).filter(Boolean).join('.') };
      return null;
    }).filter(Boolean).slice(0, 10);
    if (requisiti.length) out.push({ id: id(), block_type: 'state_requirements', stato, bloccante: b.bloccante === true, requisiti });
  }
  for (const b of prima('automation')) {
    const tr = b.trigger || {}; if (tr.evento !== 'cambio_stato' || !chiaviStati.has(chiaveValida(tr.stato))) continue;
    const azioni = (Array.isArray(b.azioni) ? b.azioni : []).filter((a) => a && AZIONI_AMMESSE.includes(a.azione)).slice(0, 5).map((a) => {
      const c = a.config && typeof a.config === 'object' ? a.config : {};
      if (a.azione === 'notifica_interna') return { target: '__interno__', azione: 'notifica_interna', config: { message: t(c.message, 300) || 'Aggiornamento', roles: [] } };
      const modulo = chiaveValida(c.modulo); if (!modulo) return null;
      if (a.azione === 'crea_record') { const dati = {}; for (const [k, v] of Object.entries(c.dati && typeof c.dati === 'object' ? c.dati : {})) { const kk = k.startsWith('_') ? k : chiaveValida(k); if (kk && (typeof v === 'string' || typeof v === 'number')) dati[kk] = typeof v === 'string' ? t(v, 120) : v; } return { target: '__interno__', azione: 'crea_record', config: { modulo, dati } }; }
      const campo = chiaveValida(c.campo); return campo ? { target: '__interno__', azione: 'aggiorna_record', config: { modulo, id_field: t(c.id_field, 60) || '__self__', campo, valore: t(c.valore, 120) } } : null;
    }).filter(Boolean);
    if (azioni.length) out.push({ id: id(), block_type: 'automation', label: t(b.label, 80) || 'Automazione', trigger: { evento: 'cambio_stato', stato: chiaveValida(tr.stato) }, azioni });
  }
  for (const b of prima('document_action')) {
    const key = chiaveValida(b.key || b.label); if (!key || !b.body) continue;
    out.push({ id: id(), block_type: 'document_action', key, label: t(b.label, 60) || key, icon: 'mail', subject: t(b.subject, 160) || t(b.label, 60), body: String(b.body).slice(0, 4000), ...(b.recipient ? { recipient: String(b.recipient).split('.').map(chiaveValida).filter(Boolean).join('.') } : {}) });
  }
  for (const b of prima('calendar_view')) { const d = chiaveValida(b.date_field); if (d) out.push({ id: id(), block_type: 'calendar_view', key: chiaveValida(b.key) || 'calendario', label: t(b.label, 60) || 'Calendario', date_field: d, title_field: chiaveValida(b.title_field) || undefined }); }
  return { version: 3, steps: out };
}

// ── controllo: la bozza insieme agli altri moduli (quelli della Libreria che si installeranno e le altre bozze) ──
// `esistenti`: [{ slug, nome, steps }]. Ritorna i problemi della sola bozza, in italiano.
function controllaBozza(slug, nome, schema, esistenti) {
  const mods = {}; for (const e of (esistenti || [])) if (e.slug !== slug) mods[e.slug] = { slug: e.slug, nome: e.nome, steps: e.steps };
  mods[slug] = { slug, nome, steps: schema.steps };
  const { righe } = controllaModuli(mods, { ruoli: new Set(['admin']), soloModuli: [slug] });
  const problemi = righe.filter((r) => !r.ok).map((r) => r.blocco + ': ' + r.messaggio);
  if (!schema.steps.some((b) => b.block_type === 'field')) problemi.push('Il modulo non ha nessun campo.');
  return problemi;
}

// ── prompt ──
const CATALOGO = `Linguaggio dei blocchi (ognuno è un oggetto JSON dentro "steps"):
- {"block_type":"field","key":"identificatore_minuscolo","label":"Etichetta","type":"text|number|currency|date|datetime|time|select|multiselect|checkbox|textarea|email|phone|url|computed","required":true,"dato_chiave":true,"sezione":"Nome sezione","options":["solo per select"],"validazione":"codice_fiscale_it|partita_iva_it|codice_fiscale_o_piva_it","expr":"solo per computed"}
- {"block_type":"relation","key":"cliente","label":"Cliente","type":"many_to_one","target_module":"slug_di_un_altro_modulo","display_field":"campo_da_mostrare_di_quel_modulo"}
- {"block_type":"workflow_state","key":"aperta","label":"Aperta","initial":true}  e  {"block_type":"workflow_transition","from":"aperta","to":"chiusa","label":"Chiudi"}
- {"block_type":"state_requirements","stato":"chiusa","bloccante":true,"requisiti":[{"label":"Importo","tipo":"campo","campo":"importo"},{"label":"Contratto","tipo":"allegato","valore":"Contratto"}]}  (cosa serve per ARRIVARE a quello stato)
- {"block_type":"allegati","label":"Allegati","types":["Contratto","Documento di identità"]}
- {"block_type":"automation","label":"...","trigger":{"evento":"cambio_stato","stato":"firmata"},"azioni":[{"target":"__interno__","azione":"crea_record","config":{"modulo":"slug_altro_modulo","dati":{"campo_altro":"campo:campo_di_questo_modulo","_stato":"stato_iniziale_altro"}}},{"target":"__interno__","azione":"notifica_interna","config":{"message":"testo","roles":[]}}]}
- {"block_type":"document_action","key":"lettera","label":"Lettera","subject":"Oggetto {{campo}}","body":"Testo con {{campo}} e {{relazione.campo}}","recipient":"campo_email"}
- {"block_type":"calendar_view","key":"calendario","label":"Calendario","date_field":"campo_data","title_field":"campo_titolo"}`;

const REGOLE = `Regole:
- Rispondi SOLO con un oggetto JSON, senza testo prima o dopo e senza blocchi markdown.
- Tutte le chiavi (key, stati, slug) in minuscolo con lettere, numeri e underscore, che iniziano con una lettera.
- Ogni modulo ha un campo "titolo" o "nome" come primo campo, da 6 a 18 campi in tutto, divisi in 2-4 "sezione", e i dati che servono davvero a quel processo: non campi generici.
- Se ci sono stati, uno solo ha "initial":true, e ogni passaggio collega due stati che hai definito; gli stati devono essere raggiungibili dal primo.
- Una relazione deve puntare a un modulo dell'elenco "Altri moduli" e "display_field" deve essere un campo di quel modulo.
- Usa requisiti, allegati, automazioni e documenti solo dove il processo li richiede davvero: non riempire per riempire.
- I testi dei documenti possono usare solo campi che esistono nel modulo o nei moduli collegati.
- In italiano.`;

const PIANO_SPEC = `Sei un analista software. Ti do i processi di un'attività e l'elenco dei moduli già disponibili. Indica quali MODULI NUOVI servono per gestire i processi, quando nessun modulo dell'elenco li copre.

Rispondi SOLO con un oggetto JSON in questa forma esatta, senza testo prima o dopo e senza blocchi markdown:
{"moduli":[{"slug":"identificatore_minuscolo","nome":"Nome breve","scopo":"una frase","collegato_a":["slug di altri moduli (nuovi o già disponibili)"],"processi":[numero dei processi che lo usano]}]}

Regole:
- Un modulo per ogni "cosa" che l'attività tiene in elenco (pratiche, ordini, pazienti, attrezzature…): non uno per ogni passaggio.
- NON proporre un modulo se uno dell'elenco già disponibile lo copre: usalo come collegamento.
- Al massimo ${MAX_MODULI} moduli, solo quelli che servono davvero. Nessun elenco se non manca niente: {"moduli":[]}.`;

const MODULO_SPEC = `Sei un analista software che progetta UN modulo di gestione per un'attività, nel linguaggio dei blocchi di un form builder.

${CATALOGO}

${REGOLE}

Rispondi con: {"nome":"Nome del modulo","icona":"una tra ${ICONE.join(', ')}","steps":[ ...blocchi... ]}`;

const riassuntoModulo = (m) => '- ' + m.slug + ' («' + m.nome + '»)' + (m.campi && m.campi.length ? ': campi ' + m.campi.slice(0, 14).join(', ') : '');
const campiDi = (steps) => (steps || []).filter((b) => b.block_type === 'field' && b.key).map((b) => b.key);
const riassuntoProcesso = (p, i) => (i + 1) + '. ' + redact(t(p.nome, 80)) + (p.scopo ? ' — ' + redact(t(p.scopo, 200)) : '') + (p.passaggi && p.passaggi.length ? '\n   passi: ' + p.passaggi.slice(0, 8).map((s) => redact(t(s.titolo, 60)) + (s.ruolo ? ' (' + redact(t(s.ruolo, 40)) + ')' : '')).join(' → ') : '') + (p.input ? '\n   serve: ' + redact(t(p.input, 160)) : '') + (p.output ? '\n   produce: ' + redact(t(p.output, 160)) : '') + (p.eccezioni && p.eccezioni.length ? '\n   eccezioni: ' + p.eccezioni.slice(0, 4).map((x) => redact(t(x, 100))).join('; ') : '') + (p.documenti_collegati && p.documenti_collegati.length ? '\n   documenti: ' + p.documenti_collegati.slice(0, 5).map((x) => redact(t(x, 80))).join(', ') : '') + (p.manca && p.manca.length ? '\n   da costruire: ' + p.manca.map((x) => redact(t(x, 120))).join('; ') : '');

async function chiedi(system, user, maxTokens) {
  if (!deps.isConfigured()) throw Object.assign(new Error('Nessuna chiave AI di Super Admin: inseriscila in Impostazioni → Chiavi AI.'), { status: 503, code: 'ai_not_configured' });
  const text = await deps.callAI(AI_PROVIDER, { system, user, maxTokens, timeoutMs: 90000 });
  try { return parseJsonResponse(text); } catch (e) { throw Object.assign(new Error('Il modello non ha restituito un JSON valido'), { status: 502 }); }
}

// 1. quali moduli nuovi servono. `disponibili`: [{ slug, nome }] (la Libreria).
async function pianifica({ nomeAttivita, descrizione, processi, disponibili }) {
  const lib = (disponibili || []).map((m) => '- ' + m.slug + ' («' + m.nome + '»)').join('\n') || '(nessuno)';
  const out = await chiedi(PIANO_SPEC, 'Attività: ' + redact(t(nomeAttivita, 80)) + (descrizione ? '\nRacconto: ' + redact(t(descrizione, 1800)) : '') + '\n\nProcessi:\n' + (processi || []).map(riassuntoProcesso).join('\n') + '\n\nModuli già disponibili:\n' + lib, 2500);
  const noti = new Set((disponibili || []).map((m) => m.slug)); const visti = new Set(); const moduli = [];
  for (const m of (Array.isArray(out && out.moduli) ? out.moduli : []).slice(0, MAX_MODULI)) {
    const slug = slugDa(m && (m.slug || m.nome)); const nome = t(m && m.nome, 60);
    if (!IDENT.test(slug) || !nome || visti.has(slug) || noti.has(slug)) continue; visti.add(slug);
    moduli.push({ slug, nome, scopo: t(m.scopo, 200), collegato_a: [...new Set((Array.isArray(m.collegato_a) ? m.collegato_a : []).map(slugDa).filter((x) => x && x !== slug))].slice(0, 6), processi: (Array.isArray(m.processi) ? m.processi : []).map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 10) });
  }
  return moduli;
}

// 2. la bozza di UN modulo, con ciclo di correzione. `altri`: [{ slug, nome, steps }] già noti (Libreria e bozze fatte).
async function generaModulo({ voce, nomeAttivita, processi, altri }) {
  const elencoAltri = (altri || []).map((m) => riassuntoModulo({ slug: m.slug, nome: m.nome, campi: campiDi(m.steps) })).join('\n') || '(nessuno)';
  const usati = (voce.processi && voce.processi.length ? voce.processi : (processi || []).map((_, i) => i + 1)).map((n) => (processi || [])[n - 1]).filter(Boolean);
  const base = 'Attività: ' + redact(t(nomeAttivita, 80)) + '\nModulo da progettare: «' + voce.nome + '» (slug «' + voce.slug + '») — ' + redact(t(voce.scopo, 200)) + (voce.collegato_a && voce.collegato_a.length ? '\nDeve collegarsi a: ' + voce.collegato_a.join(', ') : '') + '\n\nProcessi che lo usano:\n' + (usati.map((p, i) => riassuntoProcesso(p, i)).join('\n') || '(nessuno in particolare)') + '\n\nAltri moduli (puoi collegarti solo a questi):\n' + elencoAltri;
  let precedente = null, problemi = [], schema = null, nome = voce.nome, icona = 'box';
  for (let tentativo = 1; tentativo <= MAX_TENTATIVI; tentativo++) {
    const richiesta = base + (precedente ? '\n\nLa bozza precedente ha questi problemi, correggili tutti e rimanda il modulo COMPLETO:\n' + problemi.slice(0, 14).map((p) => '- ' + p).join('\n') + '\n\nBozza precedente:\n' + JSON.stringify(precedente).slice(0, 7000) : '');
    const out = await chiedi(MODULO_SPEC, richiesta, 5000);
    schema = sanitizzaSchema(out, voce.slug); nome = t(out && out.nome, 60) || voce.nome; icona = ICONE.includes(out && out.icona) ? out.icona : 'box';
    problemi = controllaBozza(voce.slug, nome, schema, altri);
    if (!problemi.length) return { slug: voce.slug, name: nome, icon: icona, color: COLORI[Math.abs([...voce.slug].reduce((a, c) => a + c.charCodeAt(0), 0)) % COLORI.length], schema, problemi: [], tentativi: tentativo };
    precedente = { nome, steps: schema.steps };
  }
  return { slug: voce.slug, name: nome, icon: icona, color: COLORI[Math.abs([...voce.slug].reduce((a, c) => a + c.charCodeAt(0), 0)) % COLORI.length], schema, problemi, tentativi: MAX_TENTATIVI };
}

// 3. tutto insieme: le bozze si fanno in ordine (chi non dipende da nessuno prima), ognuna vede le precedenti; alla fine si ricontrolla il gruppo intero.
async function costruisci({ nomeAttivita, descrizione, processi, disponibili, esistenti, piano, onModulo }) {
  const voci = piano || await pianifica({ nomeAttivita, descrizione, processi, disponibili });
  const ordinati = [...voci].sort((a, b) => a.collegato_a.filter((x) => voci.some((v) => v.slug === x)).length - b.collegato_a.filter((x) => voci.some((v) => v.slug === x)).length);
  const fatti = []; const altri = [...(esistenti || [])];
  for (const v of ordinati) {
    // collegamenti verso bozze non ancora fatte: si passano come moduli «annunciati» con il campo nome, così la relazione regge
    const annunciati = voci.filter((x) => x.slug !== v.slug && !fatti.some((f) => f.slug === x.slug)).map((x) => ({ slug: x.slug, nome: x.nome, steps: [{ block_type: 'field', key: 'nome' }] }));
    const m = await generaModulo({ voce: v, nomeAttivita, processi, altri: [...altri, ...annunciati] });
    fatti.push(m); altri.push({ slug: m.slug, nome: m.name, steps: m.schema.steps });
    if (onModulo) onModulo(m);
  }
  // ricontrollo del gruppo: una relazione verso una bozza fatta dopo può non reggere (campo mostrato diverso)
  const gruppo = {}; for (const e of (esistenti || [])) gruppo[e.slug] = e; for (const m of fatti) gruppo[m.slug] = { slug: m.slug, nome: m.name, steps: m.schema.steps };
  for (const m of fatti) m.problemi = controllaBozza(m.slug, m.name, m.schema, Object.values(gruppo));
  return { piano: voci, moduli: fatti };
}

module.exports = { deps, pianifica, generaModulo, costruisci, sanitizzaSchema, controllaBozza, slugDa };
