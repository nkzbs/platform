// ─── SCHEMA v3 — canvas unificato, "stile Comandi Rapidi" ──────────────────────
// UNICO file, condiviso davvero (non duplicato) tra backend (Node/CommonJS) e
// frontend (Vite/ESM) — vive fuori da entrambi, in core/shared/, con un package.json
// {"type":"module"} accanto che lo marca come ESM. Il backend lo consuma con
// `require()` grazie al supporto nativo di Node a require() di moduli ESM
// sincroni (Node 22+); il frontend lo importa nativamente via Vite. Il Dockerfile
// copia questa cartella in entrambi gli stage di build (frontend-builder e
// l'immagine finale) sempre allo stesso path assoluto /shared, così i percorsi
// relativi usati qui e nei due file "ponte" (core/backend/src/schema-v3.js e
// core/frontend/src/lib/schema-v3-frontend.js) restano identici in locale e in
// Docker. Prima di questo file, backend e frontend avevano DUE COPIE a mano di
// tutta questa logica, tenute sincronizzate manualmente a ogni modifica — fonte
// reale di bug in questa stessa sessione. Ora la fonte di verità è una sola.
//
// v2 (invariato dalle sessioni precedenti) rappresenta un modulo con chiavi
// separate: fields[], relations[], workflow{states,transitions}, scope{}, ecc.
// v3 le unifica in un UNICO array ordinato `steps[]`, dove ogni elemento porta
// `id` + `block_type` + le proprietà specifiche di quel tipo.
//
// Compatibilità: v2 resta leggibile. Un modulo esistente si converte in memoria a
// v3 solo quando serve — non è mai riscritto sul disco finché qualcuno non lo
// pubblica esplicitamente in v3. isV3()/isV2() permettono al resto del codice di
// capire con cosa ha a che fare.
//
// La conversione è pensata per essere un ROUND-TRIP fedele: v2->v3->v2 deve produrre
// uno schema equivalente all'originale — verificato dai test in schema-v3.test.js
// (backend), non solo per fiducia.

export const STEP_TYPES_V3 = [
  'field', 'relation', 'workflow_state', 'workflow_transition',
  'scope', 'permissions', 'validazione_creazione', 'computed', 'report_aggregate', 'condition', 'automation',
  'connection_required', 'branch_create', 'period_view', 'parent_children_view',
  'yearly_breakdown', 'category_pivot', 'weekly_breakdown', 'view_tabs',
]

export function genId(prefix) {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

export function isV3(schema) {
  return !!schema && schema.version === 3 && Array.isArray(schema.steps)
}

// Uno schema è "v2" se ha almeno una delle chiavi storiche, o è vuoto/nuovo (nessuna
// versione marcata -> si assume v2, comportamento invariato per compatibilità).
export function isV2(schema) {
  return !isV3(schema)
}

// ─── v2 -> v3 ────────────────────────────────────────────────────────────────
// Ordine di conversione deliberatamente identico all'ordine di rendering storico
// (fields, poi relations, poi workflow.states, poi workflow.transitions, poi
// scope, poi aggregati) — così un modulo appena convertito, prima che qualcuno lo
// riordini a mano, appare visivamente IDENTICO a come appariva in v2.
export function toV3(schemaV2) {
  const s = schemaV2 || {}
  const steps = []

  ;(s.fields || []).forEach((f) => steps.push({ id: genId('fld'), block_type: 'field', ...f }))
  ;(s.relations || []).forEach((r) => steps.push({ id: genId('rel'), block_type: 'relation', ...r }))

  if (s.workflow) {
    ;(s.workflow.states || []).forEach((st) => steps.push({ id: genId('wst'), block_type: 'workflow_state', ...st }))
    ;(s.workflow.transitions || []).forEach((tr) => steps.push({ id: genId('wtr'), block_type: 'workflow_transition', ...tr }))
  }

  if (s.scope) steps.push({ id: genId('scp'), block_type: 'scope', ...s.scope })
  if (s.permissions) steps.push({ id: genId('prm'), block_type: 'permissions', ...s.permissions })
  if (s.view_tabs) steps.push({ id: genId('vtb'), block_type: 'view_tabs', ...s.view_tabs })
  if (s.validazione_creazione) steps.push({ id: genId('vcr'), block_type: 'validazione_creazione', ...s.validazione_creazione })
  if (s.allegati) steps.push({ id: genId('alg'), block_type: 'allegati', ...s.allegati })
  ;(s.aggregati || []).forEach((a) => steps.push({ id: genId('agg'), block_type: 'report_aggregate', ...a }))
  ;(s.branch_creates || []).forEach((bc) => steps.push({ id: genId('brc'), block_type: 'branch_create', ...bc }))
  ;(s.period_views || []).forEach((pv) => steps.push({ id: genId('pvw'), block_type: 'period_view', ...pv }))
  ;(s.parent_children_views || []).forEach((pc) => steps.push({ id: genId('pcv'), block_type: 'parent_children_view', ...pc }))
  ;(s.yearly_breakdowns || []).forEach((yb) => steps.push({ id: genId('ybk'), block_type: 'yearly_breakdown', ...yb }))
  ;(s.category_pivots || []).forEach((cp) => steps.push({ id: genId('cpv'), block_type: 'category_pivot', ...cp }))
  ;(s.weekly_breakdowns || []).forEach((wb) => steps.push({ id: genId('wbk'), block_type: 'weekly_breakdown', ...wb }))
  if (s.requires_connection) steps.push({ id: genId('con'), block_type: 'connection_required', integration_id: s.requires_connection })

  // Blocchi v3-only (automation, condition) che toV2Lenient
  // mette da parte quando appiattisce a v2 — sono già step v3 completi (id +
  // block_type inclusi), vanno solo riaccodati così come sono. SENZA questo,
  // riaprire il Builder su un modulo esistente e ripubblicare cancellava
  // silenziosamente tutte le sue automazioni.
  ;(s._v3_unsupported || []).forEach((step) => steps.push(step))

  return { version: 3, steps }
}

// ─── v3 -> v2 (stretta) ────────────────────────────────────────────────────────
// Un modulo che contiene un blocco senza equivalente v2 (condition, automation, branch_create...) non può fare la conversione inversa senza
// perdita: lancia un errore esplicito invece di scartare silenziosamente il
// blocco, così l'eventuale downgrade è una scelta consapevole di chi pubblica.
export function toV2(schemaV3) {
  const steps = (schemaV3 && schemaV3.steps) || []
  const out = { fields: [], relations: [], workflow: null, scope: null, permissions: null, validazione_creazione: null, aggregati: [] }
  const states = []
  const transitions = []

  steps.forEach((step) => {
    const { id, block_type, ...rest } = step
    if (block_type === 'field' || block_type === 'computed') out.fields.push(rest)
    else if (block_type === 'relation') out.relations.push(rest)
    else if (block_type === 'workflow_state') states.push(rest)
    else if (block_type === 'workflow_transition') transitions.push(rest)
    else if (block_type === 'scope') out.scope = rest
    else if (block_type === 'permissions') out.permissions = rest
    else if (block_type === 'validazione_creazione') out.validazione_creazione = rest
    else if (block_type === 'report_aggregate') out.aggregati.push(rest)
    else if (block_type === 'condition') throw new Error('Impossibile convertire a v2: contiene un blocco "condition" senza equivalente nello schema v2. Questo modulo può restare solo in v3.')
    else if (block_type === 'automation') throw new Error('Impossibile convertire a v2: contiene un blocco "automation" senza equivalente nello schema v2. Questo modulo può restare solo in v3.')
    else if (block_type === 'branch_create') throw new Error('Impossibile convertire a v2: contiene un blocco "branch_create" senza equivalente nello schema v2. Questo modulo può restare solo in v3.')
    else if (block_type === 'period_view') throw new Error('Impossibile convertire a v2: contiene un blocco "period_view" senza equivalente nello schema v2. Questo modulo può restare solo in v3.')
    else if (block_type === 'parent_children_view') throw new Error('Impossibile convertire a v2: contiene un blocco "parent_children_view" senza equivalente nello schema v2. Questo modulo può restare solo in v3.')
    else if (block_type === 'yearly_breakdown') throw new Error('Impossibile convertire a v2: contiene un blocco "yearly_breakdown" senza equivalente nello schema v2. Questo modulo può restare solo in v3.')
    else if (block_type === 'category_pivot') throw new Error('Impossibile convertire a v2: contiene un blocco "category_pivot" senza equivalente nello schema v2. Questo modulo può restare solo in v3.')
    else if (block_type === 'weekly_breakdown') throw new Error('Impossibile convertire a v2: contiene un blocco "weekly_breakdown" senza equivalente nello schema v2. Questo modulo può restare solo in v3.')
    else if (block_type === 'view_tabs') throw new Error('Impossibile convertire a v2: contiene un blocco "view_tabs" senza equivalente nello schema v2. Questo modulo può restare solo in v3.')
    else throw new Error('Tipo di blocco v3 sconosciuto: "' + block_type + '"')
  })

  if (states.length > 0 || transitions.length > 0) out.workflow = { states, transitions }
  return out
}

// Variante tollerante di toV2, usata per la lettura runtime (non per pubblicazione/
// downgrade esplicito). A differenza di toV2() sopra, un blocco senza equivalente
// v2 viene semplicemente messo da parte in _v3_unsupported invece di far fallire
// l'intera conversione — un modulo con un blocco 'automation' non deve perdere
// tutti i propri campi solo perché li contiene.
export function toV2Lenient(schemaV3) {
  const steps = (schemaV3 && schemaV3.steps) || []
  const out = { fields: [], relations: [], workflow: null, scope: null, permissions: null, validazione_creazione: null, aggregati: [], allegati: null,  branch_creates: [],    period_views: [], parent_children_views: [], yearly_breakdowns: [], category_pivots: [], weekly_breakdowns: [], view_tabs: null, requires_connection: null, _v3_unsupported: [] }
  const states = []
  const transitions = []

  steps.forEach((step) => {
    const { id, block_type, ...rest } = step
    if (block_type === 'field' || block_type === 'computed') out.fields.push(rest)
    else if (block_type === 'relation') out.relations.push(rest)
    else if (block_type === 'workflow_state') states.push(rest)
    else if (block_type === 'workflow_transition') transitions.push(rest)
    else if (block_type === 'scope') out.scope = rest
    else if (block_type === 'permissions') out.permissions = rest
    else if (block_type === 'validazione_creazione') out.validazione_creazione = rest
    else if (block_type === 'allegati') out.allegati = rest
    else if (block_type === 'report_aggregate') out.aggregati.push(rest)
    else if (block_type === 'branch_create') out.branch_creates.push(rest)
    else if (block_type === 'period_view') out.period_views.push(rest)
    else if (block_type === 'parent_children_view') out.parent_children_views.push(rest)
    else if (block_type === 'yearly_breakdown') out.yearly_breakdowns.push(rest)
    else if (block_type === 'category_pivot') out.category_pivots.push(rest)
    else if (block_type === 'weekly_breakdown') out.weekly_breakdowns.push(rest)
    else if (block_type === 'view_tabs') out.view_tabs = rest
    else if (block_type === 'connection_required') out.requires_connection = rest.integration_id
    else if (block_type === 'condition' || block_type === 'automation') out._v3_unsupported.push(step)
    // Tipo sconosciuto: ignorato silenziosamente qui (a differenza di toV2 strict) —
    // la lettura runtime deve essere permissiva, la validazione rigorosa resta a
    // carico di publish/validate nel Builder.
  })

  if (states.length > 0 || transitions.length > 0) out.workflow = { states, transitions }
  return out
}

// Punto unico di lettura per qualunque pagina/route che fa JSON.parse(schema_json)
// per leggere fields/relations/ecc di un modulo — se lo schema è v3 lo converte al
// volo a v2 (variante tollerante), altrimenti lo restituisce così com'è.
export function parseSchemaNormalized(jsonString) {
  let schema
  try { schema = JSON.parse(jsonString || '{}') } catch (e) { return {} }
  return isV3(schema) ? toV2Lenient(schema) : schema
}

// Estrae i blocchi 'automation' definiti nello schema pubblicato di un modulo —
// punto unico usato dal motore automazioni per non duplicare il parsing v3 altrove.
//
// Bug reale trovato il 2026-08-10: guardava SOLO schema.steps sotto isV3(schema) —
// ma un modulo ripubblicato via chiamata diretta all'API (com'è ogni applicazione
// di un primitivo Builder fatta in questa sessione, mai attraverso il vero editor
// v3) viene salvato in forma v2-lenient: campi nativi v2 (fields/relations/ecc.)
// più un array `_v3_unsupported` che contiene ESATTAMENTE gli step v3-only
// (automation/condition) così come sono — vedi toV2Lenient()
// sopra. Con `isV3(schema)` falso su quella forma, getAutomationSteps tornava
// sempre [], e fireTrigger() (automation-engine.js) non trovava mai nessuna
// automazione da eseguire — silenziosamente, il record veniva comunque salvato.
// Trovato applicando branch_create a Spese/Debiti: "Crea piano rateale alla
// creazione" non generava più le rate, nonostante l'automazione fosse ancora lì
// nello schema (dentro _v3_unsupported, mai persa — solo mai più letta).
export function getAutomationSteps(jsonString) {
  let schema
  try { schema = JSON.parse(jsonString || '{}') } catch (e) { return [] }
  if (isV3(schema)) return (schema.steps || []).filter((s) => s.block_type === 'automation')
  return (schema._v3_unsupported || []).filter((s) => s.block_type === 'automation')
}


// ─── Azioni "interne" dell'motore automazioni ──────────────────────────────────
// Fonte UNICA di verità per: (a) l'etichetta mostrata nell'editor Automazioni del
// Builder per ogni azione target:'__interno__', e (b) quali di queste azioni in
// realtà chiamano un connettore esterno "di nascosto" (connector_id) — es.
// 'invia_notifica' manda un WhatsApp via CallMeBot pur essendo un'azione
// nominalmente interna (vedi automation-engine.js, che la esegue davvero).
// Se domani si aggiunge una nuova azione interna che chiama un servizio esterno,
// va dichiarata QUI (una volta sola, non in tre punti separati come accadeva
// prima) — il Builder la disattiverà finché il connettore non è collegato e
// getRequiredConnectors la rileverà automaticamente su ogni modulo che la usa.
// L'unica cosa che resta da tenere a mente separatamente è che l'IMPLEMENTAZIONE
// reale (l'if/else che esegue l'azione) vive in automation-engine.js: questo
// registro descrive "cosa c'è", non "come funziona".
export const INTERNAL_ACTIONS = {
  crea_record: { label: 'Crea record in modulo' },
  crea_record_n_volte: { label: 'Crea N record (piani rateali / ricorrenti)' },
  notifica_interna: { label: 'Notifica interna (campanella)' },
  invia_notifica: { label: 'Invia notifica (WhatsApp — CallMeBot)', connector_id: 'whatsapp_callmebot' },
  invia_report_periodico: { label: 'Invia report periodico (WhatsApp — CallMeBot)', connector_id: 'whatsapp_callmebot' },
  aggiorna_record: { label: 'Aggiorna un campo di un record' },
}

// Derivata da INTERNAL_ACTIONS — non più una lista scritta a mano a parte.
export const HIDDEN_CONNECTOR_ACTIONS = Object.fromEntries(
  Object.entries(INTERNAL_ACTIONS).filter(([, v]) => v.connector_id).map(([k, v]) => [k, v.connector_id])
)

// Segue i rami se/altrimenti (stessa ricorsione di runAzioni in automation-engine.js)
// per non perdere azioni annidate dentro una condizione.
function flattenAzioni(azioni) {
  const out = []
  ;(azioni || []).forEach((az) => {
    if (az && az.kind === 'condition') {
      out.push(...flattenAzioni(az.then))
      out.push(...flattenAzioni(az.otherwise))
    } else if (az) {
      out.push(az)
    }
  })
  return out
}

// Connettori di cui un modulo ha davvero bisogno — niente da dichiarare a mano ogni
// volta che si costruisce un'automazione: si deduce da cosa il modulo FA davvero.
// Due fonti, unite:
// 1) blocchi 'connection_required' espliciti — per dipendenze strutturali FUORI dal
//    motore automazioni (es. il poller Gmail dedicato di 'gmail_regole', che non è
//    un'azione ma codice a parte);
// 2) azioni delle automazioni pubblicate che chiamano un connettore — target diretto
//    (qualunque cosa diversa da '__interno__') o un'azione interna che lo fa di
//    nascosto (HIDDEN_CONNECTOR_ACTIONS sopra, derivata da INTERNAL_ACTIONS).
// Stesso bug/fix di getAutomationSteps (vedi sopra): su uno schema v2-lenient
// (fields/relations nativi v2 + _v3_unsupported per gli step v3-only) tornava
// sempre [] — nessun modulo ripubblicato via API diretta risultava mai avere
// bisogno di un connettore, anche se le sue automazioni ne chiamavano uno
// davvero. Riusa getAutomationSteps (già corretto) invece di duplicare la
// lettura degli step v3-only.
export function getRequiredConnectors(jsonString) {
  let schema
  try { schema = JSON.parse(jsonString || '{}') } catch (e) { return [] }
  const ids = new Set()
  if (isV3(schema)) {
    (schema.steps || []).filter((s) => s.block_type === 'connection_required' && s.integration_id).forEach((s) => ids.add(s.integration_id))
  } else if (schema.requires_connection) {
    ids.add(schema.requires_connection)
  }
  getAutomationSteps(jsonString).forEach((s) => {
    flattenAzioni(s.azioni).forEach((az) => {
      if (HIDDEN_CONNECTOR_ACTIONS[az.azione]) ids.add(HIDDEN_CONNECTOR_ACTIONS[az.azione])
      else if (az.target && az.target !== '__interno__') ids.add(az.target)
    })
  })
  return Array.from(ids)
}
