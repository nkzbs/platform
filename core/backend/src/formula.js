const { create, all } = require('mathjs');
const { parseSchemaNormalized } = require('./schema-v3');

// Istanza mathjs isolata: parto dal set completo (serve per parser/operatori nativi come
// round, confronto, ternario) ma importo sopra solo le funzioni custom che ci servono.
// Non esponiamo funzioni pericolose extra: la whitelist di validazione blocca comunque
// qualsiasi identificatore che non sia uno di quelli elencati in CONTROL_FUNCS.
const math = create(all, {});

const DAY_MS = 86400000;
const toDayCount = (v) => {
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return Math.floor(d.getTime() / DAY_MS);
};

// Confini [dayFrom, dayTo] (in day-count, come toDayCount) di un periodo relativo a OGGI
// (ora del server) — usata da sum_period/count_period. 'N' giorni = ultimi N giorni
// inclusi oggi, stesso significato di "ultimi N giorni" già familiare da altri filtri
// data dell'app.
function periodBounds(period) {
  const now = new Date();
  const todayDay = toDayCount(now);
  if (period === 'mese_corrente') {
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { from: toDayCount(first), to: toDayCount(last) };
  }
  if (period === 'mese_scorso') {
    const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const last = new Date(now.getFullYear(), now.getMonth(), 0);
    return { from: toDayCount(first), to: toDayCount(last) };
  }
  if (period === 'anno_corrente') {
    return { from: toDayCount(new Date(now.getFullYear(), 0, 1)), to: toDayCount(new Date(now.getFullYear(), 11, 31)) };
  }
  if (period === 'settimana_corrente') {
    // Settimana lunedì-domenica (stesso criterio ISO usato altrove, qui in ora locale come
    // il resto di questa funzione) — nata per Timbrature (straordinari = ore oltre 40h/
    // settimana), dove "ultimi 7 giorni" (rolling) darebbe la soglia sbagliata a metà
    // settimana.
    const dow = now.getDay() === 0 ? 7 : now.getDay(); // lunedì=1..domenica=7
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow + 1);
    const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
    return { from: toDayCount(monday), to: toDayCount(sunday) };
  }
  const n = parseInt(period, 10) || 0;
  return { from: todayDay - n + 1, to: todayDay };
}

// Un campo 'time' (input HH:MM) letto in un'espressione aritmetica diventa minuti-da-
// mezzanotte, non NaN — così due campi time nello stesso record si possono sottrarre con
// un normale step 'arithmetic' per ottenere una durata (es. uscita - entrata di una
// timbratura), senza bisogno di una funzione dedicata "durata" nel motore.
function timeToMinutes(raw) {
  if (typeof raw !== 'string') return null;
  const m = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

// Legge il valore numerico di un campo proprio, tenendo conto del tipo dichiarato nello
// schema — usata ovunque un own_field/related_field va convertito in numero per il motore
// formule, così 'time' si comporta come qualunque altro campo numerico senza casi speciali
// sparsi nei vari punti di lettura.
function parseFieldNumeric(raw, fieldType) {
  if (fieldType === 'time') {
    const mins = timeToMinutes(raw);
    return mins === null ? 0 : mins;
  }
  const parsed = parseFloat(raw);
  return isNaN(parsed) ? 0 : parsed;
}

math.import({
  if: function (cond, a, b) { return cond ? a : b; },
  today: function () { return Math.floor(Date.now() / DAY_MS); },
  diff_days: function (a, b) { return a - b; },
  year: function (dayCount) { return new Date(dayCount * DAY_MS).getUTCFullYear(); },
  month: function (dayCount) { return new Date(dayCount * DAY_MS).getUTCMonth() + 1; },
  day: function (dayCount) { return new Date(dayCount * DAY_MS).getUTCDate(); },
}, { override: true });

// round() è già nativo in mathjs — non va reimportato.

const AGG_FUNCS = ['sum', 'avg', 'count', 'min', 'max'];
const AGG_IF_FUNCS = ['sumif', 'avgif', 'minif', 'maxif']; // richiedono campo target + filtro
const COUNTIF = 'countif'; // solo filtro, nessun campo target
const CHILD_FUNCS = ['sum_children', 'avg_children', 'min_children', 'max_children']; // richiedono campo target
const COUNT_CHILDREN = 'count_children'; // solo modulo
// sum_children filtrato per un campo (proprio) dei figli — nato per "residuo = totale -
// Σ(note_credito emesse) - Σ(pagamenti non stornati)": sum_children da solo aggrega TUTTI
// i figli collegati, senza modo di escludere quelli con uno stato/valore specifico.
const CHILD_IF_FUNCS = ['sumif_children', 'avgif_children', 'minif_children', 'maxif_children'];
const COUNTIF_CHILDREN = 'countif_children'; // solo filtro, nessun campo target
// Aggregazioni filtrate per intervallo di tempo — stesso ventaglio delle *_if ma il
// "filtro" è sempre un campo data confrontato con un periodo, non un valore a piacere.
// Nate dal bisogno reale di un "totale del mese" che non sommi anche gli anni precedenti
// (before: sum() sommava sempre TUTTI i record esistenti, senza modo di limitarlo).
const PERIOD_FUNCS = ['sum_period', 'avg_period', 'min_period', 'max_period']; // richiedono campo target
const COUNT_PERIOD = 'count_period'; // solo campo data, nessun target
const PERIOD_MODES = ['mese_corrente', 'mese_scorso', 'anno_corrente', 'settimana_corrente']; // + un numero = "ultimi N giorni"
// Come sum_period/count_period, ma con in più un filtro (stesso modulo) — nato per
// "indice di salute finanziaria" (ReportFinancePage): DTI e %pagato del mese corrente
// richiedono sia il confine di periodo SIA un filtro su categoria/stato, che sum_period
// da solo non copre (nessun modo di restringere a una sola categoria). Filtro sempre sullo
// STESSO modulo del campo target/data (a differenza di sumif, che ammette anche una
// relazione many_to_one) — nessun caso reale finora lo richiede, tenuto semplice finché
// non serve davvero.
const PERIOD_IF_FUNCS = ['sumif_period', 'avgif_period', 'minif_period', 'maxif_period'];
const COUNTIF_PERIOD = 'countif_period'; // solo campo data + filtro, nessun target
const CONTROL_FUNCS = ['round', 'if', 'today', 'diff_days', 'year', 'month', 'day'];
// active_tier(campo_scaglioni, valore): risolve la fascia ATTIVA (non cumulativa) di un
// campo type:'scaglioni' — {soglia,perc}[] — per un dato valore: la fascia con la soglia
// più alta <= valore, o l'ultima (soglia più bassa) se nessuna soglia è <= valore. Diverso
// da 'soglia' (formula-soglia.js), che invece somma il contributo di OGNI fascia
// attraversata (tipo scaglioni IRPEF) — qui si sceglie UNA fascia sola, tipo "provvigione
// al tasso dello scaglione raggiunto". Stessa identica logica già duplicata a mano in 3
// punti (ProvvigioniPage.jsx, ReportisticaPage.jsx, automation-engine.js
// registra_provvigione) — qui diventa un primitivo del motore, riusabile in un computed
// field invece che scritto in JS in una pagina dedicata.
const TIER_FUNCS = ['active_tier'];
// running_sum(campo, campo_data[, 'mese'|'anno']): progressivo cumulato — somma "campo"
// (anche computed) su tutti i record di QUESTO modulo con campo_data <= quello del record
// corrente (spareggio per id, coerente con l'ordine di inserimento), opzionalmente
// azzerato a ogni cambio di mese/anno. Copre "prima nota": nessun equivalente esisteva
// nel motore (sum_children/sum aggregano un insieme, mai in ordine cumulativo) — pattern
// oggi scritto a mano in ContabilitaGeneralePage.jsx (movOrdCronologico.forEach + reduce).
const RUNNING_FUNCS = ['running_sum'];
const COMPARATORS = ['==', '!=', '>=', '<=', '>', '<'];

const IDENT = '[a-zA-Z_][a-zA-Z0-9_]*';
const VALUE = "(?:'[^']*'|-?\\d+(?:\\.\\d+)?)";
const OP = COMPARATORS.map((o) => o.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');

// Estrae sum_period/avg_period/min_period/max_period(modulo.campo, modulo.campo_data,
// 'periodo') e count_period(modulo.campo_data, 'periodo') — 'periodo' è tra apici, uno tra
// PERIOD_MODES ('mese_corrente'/'mese_scorso'/'anno_corrente', validati dopo) oppure un
// numero N senza apici ("ultimi N giorni"), stesso riuso del VALUE già definito sopra per
// countif/sumif — parsing qui, validazione del contenuto in validateFormula. Modulo del
// campo target e modulo del campo data devono coincidere (stesso vincolo delle *if:
// aggregare un campo filtrando per data di un modulo diverso non ha senso, righe non
// correlate).
function extractPeriodRefs(expr) {
  const refs = [];
  const reWithTarget = new RegExp(
    `\\b(${PERIOD_FUNCS.join('|')})\\(\\s*(${IDENT})\\.(${IDENT})\\s*,\\s*(${IDENT})\\.(${IDENT})\\s*,\\s*(${VALUE})\\s*\\)`, 'g'
  );
  let m;
  while ((m = reWithTarget.exec(expr))) {
    refs.push({ kind: 'period', full: m[0], func: m[1], module: m[2], field: m[3], dateModule: m[4], dateField: m[5], period: m[6], index: m.index });
  }
  const reCount = new RegExp(
    `\\b(${COUNT_PERIOD})\\(\\s*(${IDENT})\\.(${IDENT})\\s*,\\s*(${VALUE})\\s*\\)`, 'g'
  );
  while ((m = reCount.exec(expr))) {
    refs.push({ kind: 'period', full: m[0], func: m[1], module: m[2], field: null, dateModule: m[2], dateField: m[3], period: m[4], index: m.index });
  }
  return refs;
}

// Estrae sumif_period/avgif_period/minif_period/maxif_period(modulo.campo, modulo.campo_data,
// 'periodo', modulo.campo_filtro, 'op', valore) e countif_period(modulo.campo_data, 'periodo',
// modulo.campo_filtro, 'op', valore) — sum_period/count_period con in più un filtro, stesso
// modulo del target/data (vedi commento su PERIOD_IF_FUNCS sopra).
function extractPeriodIfRefs(expr) {
  const refs = [];
  const OPQ = `'(${OP})'`;
  const reWithTarget = new RegExp(
    `\\b(${PERIOD_IF_FUNCS.join('|')})\\(\\s*(${IDENT})\\.(${IDENT})\\s*,\\s*(${IDENT})\\.(${IDENT})\\s*,\\s*(${VALUE})\\s*,\\s*(${IDENT})\\.(${IDENT})\\s*,\\s*${OPQ}\\s*,\\s*(${VALUE})\\s*\\)`, 'g'
  );
  let m;
  while ((m = reWithTarget.exec(expr))) {
    refs.push({
      kind: 'period_if', full: m[0], func: m[1],
      module: m[2], field: m[3],
      dateModule: m[4], dateField: m[5], period: m[6],
      filterModule: m[7], filterField: m[8],
      op: m[9], value: m[10], index: m.index,
    });
  }
  const reCount = new RegExp(
    `\\b(${COUNTIF_PERIOD})\\(\\s*(${IDENT})\\.(${IDENT})\\s*,\\s*(${VALUE})\\s*,\\s*(${IDENT})\\.(${IDENT})\\s*,\\s*${OPQ}\\s*,\\s*(${VALUE})\\s*\\)`, 'g'
  );
  while ((m = reCount.exec(expr))) {
    refs.push({
      kind: 'period_if', full: m[0], func: m[1],
      module: m[2], field: null,
      dateModule: m[2], dateField: m[3], period: m[4],
      filterModule: m[5], filterField: m[6],
      op: m[7], value: m[8], index: m.index,
    });
  }
  return refs;
}

// Estrae le chiamate semplici FUNC(modulo.campo) / count(modulo)
function extractSimpleRefs(expr) {
  const refs = [];
  const re = new RegExp(`\\b(${AGG_FUNCS.join('|')})\\(\\s*(${IDENT})(?:\\.(${IDENT}))?\\s*\\)`, 'g');
  let m;
  while ((m = re.exec(expr))) {
    refs.push({ kind: 'simple', full: m[0], func: m[1], module: m[2], field: m[3] || null, index: m.index });
  }
  return refs;
}

// Estrae le chiamate condizionali: sumif/avgif/minif/maxif(modulo.target, modulo.filtro, OP, valore)
// e countif(modulo.filtro, OP, valore)
function extractIfRefs(expr) {
  const refs = [];
  const OPQ = `'(${OP})'`; // l'operatore va scritto tra apici, es. '=='
  const reWithTarget = new RegExp(
    `\\b(${AGG_IF_FUNCS.join('|')})\\(\\s*(${IDENT})\\.(${IDENT})\\s*,\\s*(${IDENT})\\.(${IDENT})\\s*,\\s*${OPQ}\\s*,\\s*(${VALUE})\\s*\\)`, 'g'
  );
  let m;
  while ((m = reWithTarget.exec(expr))) {
    refs.push({
      kind: 'if', full: m[0], func: m[1],
      targetModule: m[2], targetField: m[3],
      filterModule: m[4], filterField: m[5],
      op: m[6], value: m[7], index: m.index,
    });
  }
  const reCountif = new RegExp(
    `\\b(${COUNTIF})\\(\\s*(${IDENT})\\.(${IDENT})\\s*,\\s*${OPQ}\\s*,\\s*(${VALUE})\\s*\\)`, 'g'
  );
  while ((m = reCountif.exec(expr))) {
    refs.push({
      kind: 'if', full: m[0], func: m[1],
      targetModule: m[2], targetField: null,
      filterModule: m[2], filterField: m[3],
      op: m[4], value: m[5], index: m.index,
    });
  }
  return refs;
}

// Estrae le chiamate ai "figli": sum_children(modulo.campo[, via_relazione]) e
// count_children(modulo[, via_relazione]). Il collegamento al record corrente non è mai
// scritto in formula — si deduce dalla relazione many_to_one già dichiarata nel modulo
// figlio verso il modulo corrente (context.currentModule), passata a evaluateFormula.
function extractChildRefs(expr) {
  const refs = [];
  const reWithTarget = new RegExp(
    `\\b(${CHILD_FUNCS.join('|')})\\(\\s*(${IDENT})\\.(${IDENT})(?:\\s*,\\s*(${IDENT}))?\\s*\\)`, 'g'
  );
  let m;
  while ((m = reWithTarget.exec(expr))) {
    refs.push({ kind: 'children', full: m[0], func: m[1], childModule: m[2], field: m[3], via: m[4] || null, index: m.index });
  }
  const reCount = new RegExp(
    `\\b(${COUNT_CHILDREN})\\(\\s*(${IDENT})(?:\\s*,\\s*(${IDENT}))?\\s*\\)`, 'g'
  );
  while ((m = reCount.exec(expr))) {
    refs.push({ kind: 'children', full: m[0], func: m[1], childModule: m[2], field: null, via: m[3] || null, index: m.index });
  }
  return refs;
}

// sumif_children(modulo.campo_target, campo_filtro, 'op', valore[, via_relazione]) —
// stesso sum_children, ma aggrega solo i figli il cui campo_filtro (proprio del figlio,
// non del padre) soddisfa la condizione. countif_children(modulo, campo_filtro, 'op',
// valore[, via]) conta senza bisogno di un campo target.
function extractChildIfRefs(expr) {
  const refs = [];
  const OPQ = `'(${OP})'`;
  const reWithTarget = new RegExp(
    `\\b(${CHILD_IF_FUNCS.join('|')})\\(\\s*(${IDENT})\\.(${IDENT})\\s*,\\s*(${IDENT})\\s*,\\s*${OPQ}\\s*,\\s*(${VALUE})\\s*(?:,\\s*(${IDENT}))?\\s*\\)`, 'g'
  );
  let m;
  while ((m = reWithTarget.exec(expr))) {
    refs.push({ kind: 'child_if', full: m[0], func: m[1], childModule: m[2], field: m[3], filterField: m[4], op: m[5], value: m[6], via: m[7] || null, index: m.index });
  }
  const reCountifChildren = new RegExp(
    `\\b(${COUNTIF_CHILDREN})\\(\\s*(${IDENT})\\.(${IDENT})\\s*,\\s*${OPQ}\\s*,\\s*(${VALUE})\\s*(?:,\\s*(${IDENT}))?\\s*\\)`, 'g'
  );
  while ((m = reCountifChildren.exec(expr))) {
    refs.push({ kind: 'child_if', full: m[0], func: m[1], childModule: m[2], field: null, filterField: m[3], op: m[4], value: m[5], via: m[6] || null, index: m.index });
  }
  return refs;
}

// Riferimenti a campi del RECORD CORRENTE, senza prefisso modulo — es. "quantita" dentro
// una formula di Righe Ordine (subtotale = quantita * prezzo_unitario). A differenza di
// tutte le altre funzioni sopra (che aggregano righe di un modulo intero via query SQL),
// questo caso non aggrega nulla: legge un valore già presente nel record che si sta
// calcolando. Per questo non è una "funzione" nella formula, ma un identificatore nudo —
// va cercato SOLO tra i campi veri del modulo corrente (whitelist esplicita), mai come
// pattern generico, altrimenti qualsiasi parola nella formula verrebbe interpretata come
// nome di campo.
function extractOwnFieldRefs(expr, modMap, context) {
  const refs = [];
  if (!context || !context.currentModule) return refs;
  const fields = (modMap[context.currentModule] || {}).fields || [];
  // Include ANCHE i campi computed — comporre un campo calcolato da altri campi calcolati
  // dello stesso modulo (es. "da_registrare" che referenzia "n_fatture_da_registrare" e
  // "target_raggiunto") è un caso reale, non solo un campo proprio grezzo. La valutazione
  // (sotto) risolve un riferimento a un campo computed rivalutandolo con
  // evaluateFieldForRecord invece di leggerlo grezzo da currentRecordData (che nella
  // catena a running_sum/aggregati non lo conterrebbe mai, essendo mai persistito).
  const keys = fields.map((f) => f.key).filter((k) => !CONTROL_FUNCS.includes(k));
  if (keys.length === 0) return refs;
  const escaped = keys.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`\\b(${escaped.join('|')})\\b(?!\\s*\\()`, 'g');
  let m;
  while ((m = re.exec(expr))) {
    if (expr[m.index - 1] === '.') continue; // fa parte di modulo.campo, gestito altrove
    refs.push({ kind: 'own_field', full: m[0], field: m[1], index: m.index });
  }
  return refs;
}

// Riferimenti ad ALTRI blocchi report_aggregate "a valore singolo" (senza group_by) dello
// STESSO modulo, per nome (key) — permette di comporre una formula su aggregati già
// calcolati altrove invece che su campi-record, es. un "indice di salute" che combina
// pesi diversi di aggregati come dti/pct_pagato già definiti come blocchi a parte. Stesso
// pattern di extractOwnFieldRefs (identificatore nudo, whitelist esplicita) ma scansiona
// gli aggregati del modulo invece dei suoi campi. La ricorsione effettiva (risolvere quegli
// aggregati) è gestita da evaluateModuleAggregate più sotto, con un limite di profondità
// contro riferimenti circolari (A che referenzia B che referenzia A).
function extractOwnAggregateRefs(expr, modMap, context) {
  const refs = [];
  if (!context || !context.currentModule) return refs;
  const aggregates = ((modMap[context.currentModule] || {}).aggregati || []).filter((a) => !a.group_by && a.key);
  const keys = aggregates.map((a) => a.key);
  if (keys.length === 0) return refs;
  const escaped = keys.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`\\b(${escaped.join('|')})\\b(?!\\s*\\()`, 'g');
  let m;
  while ((m = re.exec(expr))) {
    if (expr[m.index - 1] === '.') continue;
    refs.push({ kind: 'agg_ref', full: m[0], aggregateKey: m[1], index: m.index });
  }
  return refs;
}

// active_tier(campo_scaglioni, valore) — valore può essere un numero letterale o il nome
// di un altro campo proprio (anche computed, per comporre con un'aggregazione già
// calcolata altrove, es. active_tier(scaglioni, fatturato_lifetime)).
function extractTierRefs(expr) {
  const refs = [];
  const re = new RegExp(`\\b(${TIER_FUNCS.join('|')})\\(\\s*(${IDENT})\\s*,\\s*(${IDENT}|${VALUE})\\s*\\)`, 'g');
  let m;
  while ((m = re.exec(expr))) {
    refs.push({ kind: 'tier', full: m[0], func: m[1], tierField: m[2], valueRef: m[3], index: m.index });
  }
  return refs;
}

function extractRunningRefs(expr) {
  const refs = [];
  const re = new RegExp(`\\b(${RUNNING_FUNCS.join('|')})\\(\\s*(${IDENT})\\s*,\\s*(${IDENT})\\s*(?:,\\s*'(mese|anno)')?\\s*\\)`, 'g');
  let m;
  while ((m = re.exec(expr))) {
    refs.push({ kind: 'running', full: m[0], func: m[1], metricField: m[2], orderField: m[3], reset: m[4] || null, index: m.index });
  }
  return refs;
}

function extractRefs(expr, modMap, context) {
  const base = [...extractSimpleRefs(expr), ...extractIfRefs(expr), ...extractChildRefs(expr), ...extractChildIfRefs(expr), ...extractTierRefs(expr), ...extractRunningRefs(expr), ...extractPeriodRefs(expr), ...extractPeriodIfRefs(expr)];
  const own = modMap ? [...extractOwnFieldRefs(expr, modMap, context), ...extractOwnAggregateRefs(expr, modMap, context)] : [];
  // Un own_field/agg_ref il cui match cade DENTRO il testo già coperto da un altro
  // riferimento (es. il nome di un campo passato come secondo argomento di active_tier, o
  // come modulo/campo di una chiamata a più argomenti) non va duplicato — altrimenti la
  // sostituzione finale in evaluateFormula romperebbe il testo del riferimento più esterno
  // prima di poterlo sostituire lui stesso. Puro filtro protettivo, non cambia nulla per le
  // forme esistenti (sum_children ecc.), che non avevano mai questa sovrapposizione.
  const ownFiltered = own.filter((o) => !base.some((b) => o.index >= b.index && o.index < b.index + b.full.length));
  return [...base, ...ownFiltered].sort((a, b) => a.index - b.index);
}

function parseValueLiteral(raw) {
  if (raw.startsWith("'")) return raw.slice(1, -1).replace(/\\(.)/g, '$1');
  return parseFloat(raw);
}

function compareValues(fieldValue, op, literal) {
  let a = fieldValue, b = literal;
  // Un campo checkbox/boolean è salvato come booleano JS vero (true/false), mai come
  // stringa — ma il letterale di un filtro (formula testuale o altre viste) arriva
  // sempre come stringa o numero (VALUE non ammette un token booleano nudo). Senza
  // questa coercizione 'false' (stringa) == false (booleano) risulta FALSE in JS
  // (ToNumber("false") è NaN), quindi ogni filtro su un campo checkbox fallirebbe
  // sempre in modo silenzioso — trovato migrando Provvigioni (filtro su
  // provvigione_registrata).
  if (typeof a === 'boolean') {
    if (typeof b === 'string') b = b.toLowerCase() === 'true' || b === '1';
    else if (typeof b === 'number') b = b !== 0;
  } else {
    const bothNumeric = !isNaN(parseFloat(a)) && typeof b === 'number';
    if (bothNumeric) { a = parseFloat(a); }
  }
  switch (op) {
    case '==': return a == b;
    case '!=': return a != b;
    case '>': return a > b;
    case '<': return a < b;
    case '>=': return a >= b;
    case '<=': return a <= b;
    default: return false;
  }
}

function getModuleRows(db, moduleSlug) {
  return db.prepare('SELECT data FROM records WHERE module_slug = ?').all(moduleSlug)
    .map((r) => { try { return JSON.parse(r.data); } catch (e) { return {}; } });
}

function aggregateValues(rows, field, func, fieldType) {
  if (func === 'count' && !field) return rows.length;
  const isDate = fieldType === 'date' || fieldType === 'datetime';
  const raw = rows.map((r) => r[field]);

  if (func === 'count') {
    return raw.filter((v) => v !== undefined && v !== null && v !== '').length;
  }
  if (isDate) {
    const days = raw.map(toDayCount).filter((v) => v !== null);
    if (days.length === 0) return 0;
    return func === 'min' ? Math.min(...days) : Math.max(...days);
  }
  const nums = raw.map((v) => parseFloat(v)).filter((v) => !isNaN(v));
  if (nums.length === 0) return 0;
  switch (func) {
    case 'sum': return nums.reduce((a, b) => a + b, 0);
    case 'avg': return nums.reduce((a, b) => a + b, 0) / nums.length;
    case 'min': return Math.min(...nums);
    case 'max': return Math.max(...nums);
    default: return 0;
  }
}

function computeAggregate(db, moduleSlug, field, func, fieldType) {
  const rows = getModuleRows(db, moduleSlug);
  return aggregateValues(rows, field, func, fieldType);
}

// filterModule normalmente coincide con targetModule (filtro su un campo proprio, caso
// originale). Se invece filterModule è il nome di una relazione many_to_one DI
// targetModule verso un altro modulo (es. sumif(movimenti_righe.dare, conto.tipo, '==',
// 'Ricavo')), risolve il filtro attraverso quella relazione — stesso bisogno reale già
// affrontato per sum_children→sumif_children, qui per sumif verso un campo del modulo
// COLLEGATO invece che dei figli.
function computeAggregateIf(db, ref, targetType, modMap) {
  const baseFunc = ref.func.replace(/if$/, ''); // sumif -> sum, countif -> count
  const literal = parseValueLiteral(ref.value);
  if (ref.filterModule === ref.targetModule) {
    const rows = getModuleRows(db, ref.filterModule);
    const matching = rows.filter((r) => compareValues(r[ref.filterField], ref.op, literal));
    return aggregateValues(matching, ref.targetField, baseFunc, targetType);
  }
  const rel = ((modMap[ref.targetModule] || {}).relations || []).find((r) => r.key === ref.filterModule && r.type === 'many_to_one');
  if (!rel) return baseFunc === 'count' ? 0 : 0;
  const rows = getModuleRows(db, ref.targetModule);
  const relatedRows = db.prepare('SELECT id, data FROM records WHERE module_slug = ?').all(rel.target_module);
  const relatedById = {};
  relatedRows.forEach((rr) => { try { relatedById[rr.id] = JSON.parse(rr.data); } catch (e) { relatedById[rr.id] = {}; } });
  const matching = rows.filter((r) => {
    const relId = r[ref.filterModule];
    const relatedData = relId != null ? relatedById[relId] : null;
    const val = relatedData ? relatedData[ref.filterField] : undefined;
    return compareValues(val, ref.op, literal);
  });
  return aggregateValues(matching, ref.targetField, baseFunc, targetType);
}

// Trova, nello schema del modulo figlio, la relazione many_to_one che punta al modulo
// corrente — questo è ciò che rende i "figli" generici e riusabili in ogni fork: nessuna
// configurazione nuova, si riusa la relazione già dichiarata nel Builder (tab Relazioni).
function findChildRelation(modMap, childModuleSlug, parentModuleSlug, viaKey) {
  const rels = ((modMap[childModuleSlug] || {}).relations || [])
    .filter((r) => r.type === 'many_to_one' && r.target_module === parentModuleSlug);
  if (viaKey) return rels.find((r) => r.key === viaKey) || null;
  if (rels.length === 1) return rels[0];
  return null; // 0 o 2+ relazioni candidate: ambiguo, va disambiguato con l'argomento via
}

function describeChildRelationError(modMap, ref, parentModuleSlug) {
  const rels = ((modMap[ref.childModule] || {}).relations || [])
    .filter((r) => r.type === 'many_to_one' && r.target_module === parentModuleSlug);
  if (rels.length === 0) {
    return `Il modulo "${ref.childModule}" non ha nessuna relazione verso "${parentModuleSlug}" — creala prima nel Builder (tab Relazioni)`;
  }
  return `Il modulo "${ref.childModule}" ha più relazioni verso "${parentModuleSlug}" (${rels.map((r) => r.key).join(', ')}) — specifica quale con ${ref.func}(${ref.childModule}.${ref.field || ''}, nome_relazione)`;
}

// Righe del modulo figlio collegate al record corrente, senza aggregarle — estratta da
// computeChildAggregate per essere riusabile dal motore a pipeline (evaluateSteps), dove
// "ottenere le righe collegate" e "aggregarle" sono due passaggi separati, non uno solo.
function getChildRows(db, childModuleSlug, relation, currentRecordId) {
  const rows = getModuleRows(db, childModuleSlug);
  return rows.filter((r) => String(r[relation.key]) === String(currentRecordId));
}

// Come getChildRows, ma preserva l'id di ogni riga (in __id) — serve quando una riga
// figlia va a sua volta usata come "record corrente" per rivalutare un SUO campo
// computed (es. sum_children(ordini.margine_ordine) dove margine_ordine è a sua volta
// un aggregato sui figli di QUELLA riga) o un related_field (che invece non ha bisogno
// dell'id, solo dei dati). aggregateValues ignora __id, quindi è additivo e non rompe
// l'uso esistente.
function getChildRowsWithId(db, childModuleSlug, relation, currentRecordId) {
  const rows = db.prepare('SELECT id, data FROM records WHERE module_slug = ?').all(childModuleSlug)
    .map((r) => { try { return { __id: r.id, ...JSON.parse(r.data || '{}') }; } catch (e) { return { __id: r.id }; } });
  return rows.filter((r) => String(r[relation.key]) === String(currentRecordId));
}

// Stesso filtro {campo, op, valore} già usato da automation-engine.js (trigger
// 'per_record') e scheduler.js — riscritto qui su compareValues (già presente in questo
// file) invece di importare da automation-engine.js, che a sua volta richiede db e
// creerebbe una dipendenza circolare inutile per una funzione di poche righe.
function matchesFiltro(rowData, f) {
  const valore = f.valore === '_oggi_' ? new Date().toISOString().slice(0, 10) : f.valore;
  if (valore === null || valore === undefined || valore === '') {
    const vuoto = rowData[f.campo] === undefined || rowData[f.campo] === null || rowData[f.campo] === '';
    return f.op === '!=' ? !vuoto : vuoto;
  }
  return compareValues(rowData[f.campo], f.op, valore);
}

const MAX_RELATION_DEPTH = 6;

// Rivaluta un campo (anche 'computed') di un record specifico, dato solo il suo modulo,
// id e dati già caricati — cuore della composizione a più livelli: usata sia da
// 'related_field' (per leggere un campo computed sul record puntato da una relazione
// many_to_one) sia da 'aggregate' quando il campo da aggregare è a sua volta un campo
// computed del modulo figlio (equivalente "steps" di ciò che il DSL testuale fa già per
// sum_children, ma qui con supporto pieno a related_field/nidificazione, non solo ai
// campi propri). depth previene ricorsioni infinite su relazioni circolari.
function evaluateFieldForRecord(db, moduleSlug, fieldKey, recordId, recordData, modMap, depth) {
  if (depth > MAX_RELATION_DEPTH) return 0;
  const fields = (modMap[moduleSlug] || {}).fields || [];
  const fieldDef = fields.find((f) => f.key === fieldKey);
  if (!fieldDef) {
    return parseFieldNumeric(recordData ? recordData[fieldKey] : undefined, null);
  }
  if (fieldDef.type === 'computed' && ((fieldDef.steps && fieldDef.steps.length) || fieldDef.expr)) {
    const context = { currentModule: moduleSlug, currentRecordId: recordId, currentRecordData: recordData, __depth: depth };
    const result = (fieldDef.steps && fieldDef.steps.length)
      ? evaluateSteps(fieldDef.steps, db, context)
      : evaluateFormula(fieldDef.expr, db, context);
    // Un campo computed può risultare in un booleano (es. "target_raggiunto = fatturato
    // >= target"), legittimo in un contesto aritmetico (mathjs/JS trattano true/false
    // come 1/0) — senza questa coercizione un campo booleano referenziato per nome da
    // un altro campo computed (own_field ricorsivo, vedi extractOwnFieldRefs) tornava
    // sempre 0 anche a condizione vera, un fallimento silenzioso.
    if (!result.valid) return 0;
    if (typeof result.value === 'number') return result.value;
    if (typeof result.value === 'boolean') return result.value ? 1 : 0;
    return 0;
  }
  return parseFieldNumeric(recordData ? recordData[fieldKey] : undefined, fieldDef.type);
}

function computeChildAggregate(db, ref, relation, targetType, currentRecordId, modMap, depth) {
  const modMapResolved = modMap || loadModuleMap(db);
  const baseFunc = ref.func.replace(/_children$/, ''); // sum_children -> sum, count_children -> count

  // Se il campo target è computed (non persistito nel DB), rivalutarlo per ogni riga
  // figlia con evaluateFieldForRecord — lo stesso motore già usato per own_field/
  // related_field/steps 'aggregate' — invece di sostituire i nomi di campo nel testo e
  // ributtarlo in mathjs. Quella scorciatoia funzionava solo se l'espressione del figlio
  // era aritmetica pura sui SUOI campi propri: falliva silenziosamente (mathjs non
  // riconosce sum_children/sumif_children/ecc come funzioni, quindi l'eval lanciava e si
  // tornava sempre 0) non appena il campo target era a sua volta un'aggregazione, o un
  // campo a steps. Bug reale trovato su agenti.fatturato_lifetime (Coffee): un agente con
  // fatture reali collegate risultava comunque a fatturato zero, a cascata anche
  // provvigione_attuale_perc/target_raggiunto/da_registrare. getChildRowsWithId preserva
  // l'id di riga, necessario a evaluateFieldForRecord per rivalutare correttamente.
  const childSchema = modMapResolved[ref.childModule] || {};
  const computedDef = (childSchema.fields || []).find((f) => f.key === ref.field && f.type === 'computed' && ((f.steps && f.steps.length) || f.expr));
  if (computedDef) {
    const matching = getChildRowsWithId(db, ref.childModule, relation, currentRecordId);
    const withComputed = matching.map((rowData) => ({
      ...rowData,
      [ref.field]: evaluateFieldForRecord(db, ref.childModule, ref.field, rowData.__id, rowData, modMapResolved, (depth || 0) + 1),
    }));
    return aggregateValues(withComputed, ref.field, baseFunc, 'number');
  }

  const matching = getChildRows(db, ref.childModule, relation, currentRecordId);
  return aggregateValues(matching, ref.field, baseFunc, targetType);
}

// Come computeChildAggregate, ma filtra prima i figli per un loro campo proprio
// (ref.filterField/op/value) — stessa gestione dei campi target computed, stesso
// pattern di baseFunc, solo con un filtro applicato prima dell'aggregazione.
function computeChildAggregateIf(db, ref, relation, targetType, currentRecordId, modMap, depth) {
  const modMapResolved = modMap || loadModuleMap(db);
  const rowsWithId = getChildRowsWithId(db, ref.childModule, relation, currentRecordId);
  const literal = parseValueLiteral(ref.value);
  const matching = rowsWithId.filter((r) => compareValues(r[ref.filterField], ref.op, literal));
  const baseFunc = ref.func.replace(/if_children$/, ''); // sumif_children -> sum, countif_children -> count
  if (baseFunc === 'count') return matching.length;

  const childSchema = modMapResolved[ref.childModule] || {};
  const computedDef = (childSchema.fields || []).find((f) => f.key === ref.field && f.type === 'computed' && ((f.steps && f.steps.length) || f.expr));
  if (computedDef) {
    const withComputed = matching.map((rowData) => ({
      ...rowData,
      [ref.field]: evaluateFieldForRecord(db, ref.childModule, ref.field, rowData.__id, rowData, modMapResolved, (depth || 0) + 1),
    }));
    return aggregateValues(withComputed, ref.field, baseFunc, 'number');
  }
  return aggregateValues(matching, ref.field, baseFunc, targetType);
}

function loadModuleMap(db) {
  const installedModules = db.prepare('SELECT slug, schema_json, schema_json_draft FROM modules WHERE installed = 1').all();
  const modMap = {};
  installedModules.forEach((m) => {
    try { modMap[m.slug] = parseSchemaNormalized(m.schema_json_draft || m.schema_json); }
    catch (e) { modMap[m.slug] = {}; }
  });
  return modMap;
}

function fieldTypeOf(modMap, moduleSlug, fieldKey) {
  // _stato è il campo di sistema dello stato workflow — sempre presente a runtime,
  // MAI un blocco 'field' nello schema (stessa eccezione già fatta nel motore a
  // pipeline, vedi evaluateSteps più sotto), quindi va riconosciuto qui esplicitamente
  // o ogni filtro/sumif su di esso ("solo movimenti confermati", "note credito emesse")
  // fallirebbe la validazione con "campo non trovato" pur essendo un caso d'uso reale e
  // comune (partita doppia, scadenzario).
  if (fieldKey === '_stato') return 'select';
  const fields = (modMap[moduleSlug] || {}).fields || [];
  const found = fields.find((f) => f.key === fieldKey);
  if (!found) return null;
  // Un campo computed produce sempre un numero — trattato come 'number' nella
  // validazione delle aggregazioni (sum_children, sum, ecc.) per permettere
  // composizione di formule su più livelli (es. sum_children(righe.totale_riga)).
  return found.type === 'computed' ? 'number' : found.type;
}

function validateFormula(expr, db, context) {
  const errors = [];
  if (!expr || !expr.trim()) return { valid: false, errors: ['Formula vuota'], refs: [] };

  const modMap = loadModuleMap(db);
  const refs = extractRefs(expr, modMap, context);

  if (refs.length === 0) {
    errors.push('Nessun riferimento riconosciuto — usa una funzione di aggregazione (sum, sum_children...) o il nome di un campo di questo modulo');
  }

  refs.forEach((r) => {
    if (r.kind === 'simple') {
      if (!AGG_FUNCS.includes(r.func)) {
        errors.push(`Funzione "${r.func}" non ammessa`); return;
      }
      if (!modMap[r.module]) { errors.push(`Modulo "${r.module}" non installato o inesistente`); return; }
      if (r.func === 'count' && !r.field) return;
      if (!r.field) { errors.push(`${r.func}() richiede un campo: ${r.func}(${r.module}.campo)`); return; }
      const type = fieldTypeOf(modMap, r.module, r.field);
      if (!type) { errors.push(`Campo "${r.field}" non trovato nel modulo "${r.module}"`); return; }
      if (r.func !== 'count') {
        const allowed = (r.func === 'min' || r.func === 'max')
          ? ['number', 'currency', 'date', 'datetime']
          : ['number', 'currency'];
        if (!allowed.includes(type)) {
          errors.push(`Campo "${r.field}" (tipo: ${type}) non valido per ${r.func}()`);
        }
      }
    } else if (r.kind === 'if') {
      const allFuncs = [...AGG_IF_FUNCS, COUNTIF];
      if (!allFuncs.includes(r.func)) { errors.push(`Funzione "${r.func}" non ammessa`); return; }
      if (!modMap[r.targetModule]) { errors.push(`Modulo "${r.targetModule}" non installato o inesistente`); return; }
      // filterModule è o lo stesso targetModule (filtro su un campo proprio) o il nome
      // di una relazione many_to_one di targetModule verso un altro modulo (es.
      // sumif(movimenti_righe.dare, conto.tipo, '==', 'Ricavo')) — stesso principio già
      // usato da sumif_children per filtrare per campo del figlio, qui per filtrare per
      // campo del modulo COLLEGATO.
      let filterModuleSlug = r.filterModule;
      if (r.targetModule !== r.filterModule) {
        const rel = ((modMap[r.targetModule] || {}).relations || []).find((x) => x.key === r.filterModule && x.type === 'many_to_one');
        if (!rel) { errors.push(`${r.func}() richiede che il filtro sia su un campo di "${r.targetModule}" o su una sua relazione many_to_one (trovato: "${r.filterModule}")`); return; }
        filterModuleSlug = rel.target_module;
      }
      if (!modMap[filterModuleSlug]) { errors.push(`Modulo "${filterModuleSlug}" non installato o inesistente`); return; }
      const filterType = fieldTypeOf(modMap, filterModuleSlug, r.filterField);
      if (!filterType) { errors.push(`Campo filtro "${r.filterField}" non trovato nel modulo "${filterModuleSlug}"`); return; }
      const textLike = ['text', 'textarea', 'select', 'email', 'phone', 'url', 'checkbox'];
      if (textLike.includes(filterType) && !['==', '!='].includes(r.op)) {
        errors.push(`Il campo "${r.filterField}" (tipo: ${filterType}) ammette solo == o != come confronto`);
      }
      if (r.func !== COUNTIF) {
        const targetType = fieldTypeOf(modMap, r.targetModule, r.targetField);
        if (!targetType) { errors.push(`Campo target "${r.targetField}" non trovato nel modulo "${r.targetModule}"`); return; }
        const baseFunc = r.func.replace(/if$/, '');
        const allowed = baseFunc === 'min' || baseFunc === 'max'
          ? ['number', 'currency', 'date', 'datetime'] : ['number', 'currency'];
        if (!allowed.includes(targetType)) {
          errors.push(`Campo target "${r.targetField}" (tipo: ${targetType}) non valido per ${r.func}()`);
        }
      }
    } else if (r.kind === 'period') {
      const allFuncs = [...PERIOD_FUNCS, COUNT_PERIOD];
      if (!allFuncs.includes(r.func)) { errors.push(`Funzione "${r.func}" non ammessa`); return; }
      if (!modMap[r.module]) { errors.push(`Modulo "${r.module}" non installato o inesistente`); return; }
      const dateType = fieldTypeOf(modMap, r.dateModule, r.dateField);
      if (!['date', 'datetime'].includes(dateType)) { errors.push(`Campo "${r.dateField}" (tipo: ${dateType || 'inesistente'}) non valido per il filtro periodo — solo data`); return; }
      const isQuoted = r.period.startsWith("'");
      if (isQuoted) {
        const mode = r.period.slice(1, -1);
        if (!PERIOD_MODES.includes(mode)) { errors.push(`Periodo "${mode}" non riconosciuto — usa ${PERIOD_MODES.map((p) => `'${p}'`).join(', ')} o un numero di giorni`); return; }
      } else if (!/^\d+$/.test(r.period)) {
        errors.push(`Periodo "${r.period}" non valido — usa ${PERIOD_MODES.map((p) => `'${p}'`).join(', ')} o un numero di giorni`); return;
      }
      if (r.func !== COUNT_PERIOD) {
        const targetType = fieldTypeOf(modMap, r.module, r.field);
        if (!targetType) { errors.push(`Campo "${r.field}" non trovato nel modulo "${r.module}"`); return; }
        if (!['number', 'currency'].includes(targetType)) {
          errors.push(`Campo "${r.field}" (tipo: ${targetType}) non valido per ${r.func}() — solo numero o valuta`);
        }
      }
    } else if (r.kind === 'period_if') {
      const allFuncs = [...PERIOD_IF_FUNCS, COUNTIF_PERIOD];
      if (!allFuncs.includes(r.func)) { errors.push(`Funzione "${r.func}" non ammessa`); return; }
      if (!modMap[r.module]) { errors.push(`Modulo "${r.module}" non installato o inesistente`); return; }
      const dateType = fieldTypeOf(modMap, r.dateModule, r.dateField);
      if (!['date', 'datetime'].includes(dateType)) { errors.push(`Campo "${r.dateField}" (tipo: ${dateType || 'inesistente'}) non valido per il filtro periodo — solo data`); return; }
      const isQuoted = r.period.startsWith("'");
      if (isQuoted) {
        const mode = r.period.slice(1, -1);
        if (!PERIOD_MODES.includes(mode)) { errors.push(`Periodo "${mode}" non riconosciuto — usa ${PERIOD_MODES.map((p) => `'${p}'`).join(', ')} o un numero di giorni`); return; }
      } else if (!/^\d+$/.test(r.period)) {
        errors.push(`Periodo "${r.period}" non valido — usa ${PERIOD_MODES.map((p) => `'${p}'`).join(', ')} o un numero di giorni`); return;
      }
      if (r.filterModule !== r.module) { errors.push(`${r.func}() richiede che il filtro sia su un campo dello stesso modulo del target`); return; }
      const filterType = fieldTypeOf(modMap, r.filterModule, r.filterField);
      if (!filterType) { errors.push(`Campo filtro "${r.filterField}" non trovato nel modulo "${r.filterModule}"`); return; }
      const textLike = ['text', 'textarea', 'select', 'email', 'phone', 'url', 'checkbox'];
      if (textLike.includes(filterType) && !['==', '!='].includes(r.op)) {
        errors.push(`Il campo "${r.filterField}" (tipo: ${filterType}) ammette solo == o != come confronto`);
      }
      if (r.func !== COUNTIF_PERIOD) {
        const targetType = fieldTypeOf(modMap, r.module, r.field);
        if (!targetType) { errors.push(`Campo "${r.field}" non trovato nel modulo "${r.module}"`); return; }
        if (!['number', 'currency'].includes(targetType)) {
          errors.push(`Campo "${r.field}" (tipo: ${targetType}) non valido per ${r.func}() — solo numero o valuta`);
        }
      }
    } else if (r.kind === 'own_field') {
      const type = fieldTypeOf(modMap, context.currentModule, r.field);
      if (!['number', 'currency', 'time'].includes(type)) {
        errors.push(`Campo "${r.field}" (tipo: ${type}) non utilizzabile in un'espressione aritmetica — solo numero, valuta o orario`);
      }
    } else if (r.kind === 'children') {
      const allFuncs = [...CHILD_FUNCS, COUNT_CHILDREN];
      if (!allFuncs.includes(r.func)) { errors.push(`Funzione "${r.func}" non ammessa`); return; }
      if (!context || !context.currentModule) {
        errors.push(`${r.func}() è utilizzabile solo in un campo calcolato di un modulo`); return;
      }
      if (!modMap[r.childModule]) { errors.push(`Modulo "${r.childModule}" non installato o inesistente`); return; }
      const relation = findChildRelation(modMap, r.childModule, context.currentModule, r.via);
      if (!relation) { errors.push(describeChildRelationError(modMap, r, context.currentModule)); return; }
      if (r.func !== COUNT_CHILDREN) {
        const targetType = fieldTypeOf(modMap, r.childModule, r.field);
        if (!targetType) { errors.push(`Campo "${r.field}" non trovato nel modulo "${r.childModule}"`); return; }
        const baseFunc = r.func.replace(/_children$/, '');
        const allowed = baseFunc === 'min' || baseFunc === 'max'
          ? ['number', 'currency', 'date', 'datetime'] : ['number', 'currency'];
        if (!allowed.includes(targetType)) {
          errors.push(`Campo "${r.field}" (tipo: ${targetType}) non valido per ${r.func}()`);
        }
      }
    } else if (r.kind === 'child_if') {
      const allFuncs = [...CHILD_IF_FUNCS, COUNTIF_CHILDREN];
      if (!allFuncs.includes(r.func)) { errors.push(`Funzione "${r.func}" non ammessa`); return; }
      if (!context || !context.currentModule) {
        errors.push(`${r.func}() è utilizzabile solo in un campo calcolato di un modulo`); return;
      }
      if (!modMap[r.childModule]) { errors.push(`Modulo "${r.childModule}" non installato o inesistente`); return; }
      const relation = findChildRelation(modMap, r.childModule, context.currentModule, r.via);
      if (!relation) { errors.push(describeChildRelationError(modMap, r, context.currentModule)); return; }
      const filterType = fieldTypeOf(modMap, r.childModule, r.filterField);
      if (!filterType) { errors.push(`Campo filtro "${r.filterField}" non trovato nel modulo "${r.childModule}"`); return; }
      const textLike = ['text', 'textarea', 'select', 'email', 'phone', 'url', 'checkbox'];
      if (textLike.includes(filterType) && !['==', '!='].includes(r.op)) {
        errors.push(`Il campo "${r.filterField}" (tipo: ${filterType}) ammette solo == o != come confronto`);
      }
      if (r.func !== COUNTIF_CHILDREN) {
        const targetType = fieldTypeOf(modMap, r.childModule, r.field);
        if (!targetType) { errors.push(`Campo "${r.field}" non trovato nel modulo "${r.childModule}"`); return; }
        const baseFunc = r.func.replace(/if_children$/, '');
        const allowed = baseFunc === 'min' || baseFunc === 'max'
          ? ['number', 'currency', 'date', 'datetime'] : ['number', 'currency'];
        if (!allowed.includes(targetType)) {
          errors.push(`Campo "${r.field}" (tipo: ${targetType}) non valido per ${r.func}()`);
        }
      }
    } else if (r.kind === 'tier') {
      if (!TIER_FUNCS.includes(r.func)) { errors.push(`Funzione "${r.func}" non ammessa`); return; }
      if (!context || !context.currentModule) {
        errors.push(`${r.func}() è utilizzabile solo in un campo calcolato di un modulo`); return;
      }
      const tierType = fieldTypeOf(modMap, context.currentModule, r.tierField);
      if (tierType !== 'scaglioni') { errors.push(`Campo "${r.tierField}" non è di tipo Scaglioni (trovato: ${tierType || 'inesistente'})`); return; }
      const isLiteral = /^-?\d+(\.\d+)?$/.test(r.valueRef);
      if (!isLiteral && !fieldTypeOf(modMap, context.currentModule, r.valueRef)) {
        errors.push(`Campo "${r.valueRef}" non trovato in questo modulo`);
      }
    } else if (r.kind === 'running') {
      if (!RUNNING_FUNCS.includes(r.func)) { errors.push(`Funzione "${r.func}" non ammessa`); return; }
      if (!context || !context.currentModule) {
        errors.push(`${r.func}() è utilizzabile solo in un campo calcolato di un modulo`); return;
      }
      const metricType = fieldTypeOf(modMap, context.currentModule, r.metricField);
      if (!['number', 'currency'].includes(metricType)) {
        errors.push(`Campo "${r.metricField}" (tipo: ${metricType || 'inesistente'}) non valido per ${r.func}() — solo numero, valuta o calcolato`); return;
      }
      const orderType = fieldTypeOf(modMap, context.currentModule, r.orderField);
      if (!['date', 'datetime'].includes(orderType)) {
        errors.push(`Campo "${r.orderField}" (tipo: ${orderType || 'inesistente'}) non valido per l'ordinamento — solo data`);
      }
    } else { // r.kind === 'agg_ref'
      if (!context || !context.currentModule) {
        errors.push('Il riferimento a un altro aggregato è utilizzabile solo dentro un modulo'); return;
      }
      const target = ((modMap[context.currentModule] || {}).aggregati || []).find((a) => a.key === r.aggregateKey);
      if (!target) { errors.push(`Aggregato "${r.aggregateKey}" non trovato in questo modulo`); return; }
      if (target.group_by) { errors.push(`"${r.aggregateKey}" è un aggregato raggruppato — puoi referenziare solo aggregati a valore singolo`); return; }
      if (!target.expr || !target.expr.trim()) { errors.push(`Aggregato "${r.aggregateKey}" non ha ancora una formula`); }
    }
  });

  // Sostituisce tutti i riferimenti (semplici e condizionali) col placeholder '1'. Quello che
  // resta deve essere SOLO: cifre, operatori aritmetici/confronto, parentesi, virgole, e i nomi
  // delle funzioni di controllo note (round/if/today/diff_days/year/month/day) — nessun altro
  // identificatore è ammesso, quindi nessuna funzione mathjs "nascosta" è raggiungibile.
  // Ricostruita per POSIZIONE (r.index/r.full.length), non con .split(full).join('1') sull'intera
  // stringa: quella sostituiva OGNI occorrenza letterale di r.full ovunque comparisse — un campo
  // proprio il cui nome è prefisso del nome di un campo dentro un altro riferimento (es. own_field
  // "totale" dentro sumif_children(note_credito.totale_calcolato, ...)) veniva corrotto PRIMA che
  // il riferimento più lungo potesse essere sostituito, e il testo residuo falliva la validazione
  // anche per formule corrette.
  const uniqueRefs = [...new Map(refs.map((r) => [r.full, r])).values()];
  const sortedRefs = [...refs].sort((a, b) => a.index - b.index);
  let structural = '';
  let cursor = 0;
  sortedRefs.forEach((r) => {
    if (r.index < cursor) return; // già coperto da un riferimento precedente più esteso
    structural += expr.slice(cursor, r.index) + '1';
    cursor = r.index + r.full.length;
  });
  structural += expr.slice(cursor);

  let charsOnly = structural;
  CONTROL_FUNCS.forEach((fn) => { charsOnly = charsOnly.split(new RegExp(`\\b${fn}\\b`, 'g')).join(''); });

  if (!/^[\d\s+\-*/().,=!<>]*$/.test(charsOnly)) {
    errors.push('Sintassi non valida: caratteri o identificatori non ammessi nella formula');
  } else if (structural.trim()) {
    try { math.evaluate(structural); }
    catch (e) { errors.push('Sintassi non valida: ' + e.message); }
  }

  return { valid: errors.length === 0, errors, refs: uniqueRefs };
}

function evaluateFormula(expr, db, context) {
  const check = validateFormula(expr, db, context);
  if (!check.valid) return { valid: false, errors: check.errors, refs: check.refs };

  const modMap = loadModuleMap(db);
  const breakdown = [];
  const valueByFull = {};
  // Errori scoperti solo a runtime (non dalla validazione statica sopra) — finora solo
  // agg_ref quando la ricorsione tra aggregati eccede MAX_AGGREGATE_DEPTH: un ciclo (A
  // referenzia B che referenzia di nuovo A) altrimenti non fallirebbe mai esplicitamente,
  // producendo silenziosamente un numero plausibile ma sbagliato (ogni livello del ciclo
  // sostituirebbe l'anello più profondo con 0 e continuerebbe a sommare) invece di
  // segnalare il problema a chi ha scritto la formula.
  const runtimeErrors = [];

  check.refs.forEach((r) => {
    let value;
    if (r.kind === 'simple') {
      const type = fieldTypeOf(modMap, r.module, r.field);
      value = computeAggregate(db, r.module, r.field, r.func, type);
    } else if (r.kind === 'if') {
      const targetType = r.targetField ? fieldTypeOf(modMap, r.targetModule, r.targetField) : null;
      value = computeAggregateIf(db, r, targetType, modMap);
    } else if (r.kind === 'period') {
      const isQuoted = r.period.startsWith("'");
      const { from, to } = periodBounds(isQuoted ? r.period.slice(1, -1) : r.period);
      const rows = getModuleRows(db, r.module).filter((row) => {
        const day = toDayCount(row[r.dateField]);
        return day !== null && day >= from && day <= to;
      });
      const targetType = r.field ? fieldTypeOf(modMap, r.module, r.field) : null;
      const baseFunc = r.func.replace(/_period$/, ''); // sum_period -> sum, count_period -> count
      value = aggregateValues(rows, r.field, baseFunc, targetType);
    } else if (r.kind === 'period_if') {
      const isQuoted = r.period.startsWith("'");
      const { from, to } = periodBounds(isQuoted ? r.period.slice(1, -1) : r.period);
      const literal = parseValueLiteral(r.value);
      const rows = getModuleRows(db, r.module).filter((row) => {
        const day = toDayCount(row[r.dateField]);
        if (day === null || day < from || day > to) return false;
        return compareValues(row[r.filterField], r.op, literal);
      });
      const targetType = r.field ? fieldTypeOf(modMap, r.module, r.field) : null;
      const baseFunc = r.func === COUNTIF_PERIOD ? 'count' : r.func.replace(/if_period$/, ''); // sumif_period -> sum, countif_period -> count
      value = aggregateValues(rows, r.field, baseFunc, targetType);
    } else if (r.kind === 'own_field') {
      const fieldDef = ((modMap[context.currentModule] || {}).fields || []).find((f) => f.key === r.field);
      const isComputedOwn = fieldDef && fieldDef.type === 'computed' && ((fieldDef.steps && fieldDef.steps.length) || fieldDef.expr);
      // Un campo proprio COMPUTED va rivalutato (non letto da currentRecordData, che non
      // lo contiene mai persistito) — serve currentRecordId per farlo (assente, es., in
      // validazione di creazione prima che il record esista: lì si cade nel fallback,
      // stesso comportamento di sempre). Guardia di profondità già in
      // evaluateFieldForRecord contro cicli (A referenzia B che referenzia A) — silenzia a
      // 0 oltre MAX_RELATION_DEPTH, stesso limite pre-esistente di ogni altra
      // composizione a più livelli qui, non nuovo con questa modifica.
      if (isComputedOwn && context.currentRecordId != null) {
        value = evaluateFieldForRecord(db, context.currentModule, r.field, context.currentRecordId, context.currentRecordData, modMap, (context.__depth || 0) + 1);
      } else {
        const raw = context && context.currentRecordData ? context.currentRecordData[r.field] : undefined;
        value = parseFieldNumeric(raw, fieldTypeOf(modMap, context.currentModule, r.field));
      }
    } else if (r.kind === 'children') {
      const relation = findChildRelation(modMap, r.childModule, context.currentModule, r.via);
      const targetType = r.field ? fieldTypeOf(modMap, r.childModule, r.field) : null;
      value = computeChildAggregate(db, r, relation, targetType, context.currentRecordId, modMap, context.__depth);
    } else if (r.kind === 'child_if') {
      const relation = findChildRelation(modMap, r.childModule, context.currentModule, r.via);
      const targetType = r.field ? fieldTypeOf(modMap, r.childModule, r.field) : null;
      value = computeChildAggregateIf(db, r, relation, targetType, context.currentRecordId, modMap, context.__depth);
    } else if (r.kind === 'tier') {
      const rawScaglioni = context && context.currentRecordData ? context.currentRecordData[r.tierField] : undefined;
      let scaglioni = [];
      try { scaglioni = JSON.parse(rawScaglioni || '[]'); if (!Array.isArray(scaglioni)) scaglioni = []; } catch (e) { scaglioni = []; }
      scaglioni = [...scaglioni].sort((a, b) => (b.soglia || 0) - (a.soglia || 0));
      const isLiteral = /^-?\d+(\.\d+)?$/.test(r.valueRef);
      const target = isLiteral
        ? parseFloat(r.valueRef)
        : parseFieldNumeric(context && context.currentRecordData ? context.currentRecordData[r.valueRef] : undefined, fieldTypeOf(modMap, context.currentModule, r.valueRef));
      const tier = scaglioni.find((s) => target >= (s.soglia || 0)) || scaglioni[scaglioni.length - 1];
      value = tier ? (parseFloat(tier.perc) || 0) : 0;
    } else if (r.kind === 'running') {
      const moduleSlug = context.currentModule;
      const myOrderRaw = context.currentRecordData ? context.currentRecordData[r.orderField] : undefined;
      const myOrderDay = toDayCount(myOrderRaw);
      const myPeriod = r.reset && myOrderRaw ? String(myOrderRaw).slice(0, r.reset === 'mese' ? 7 : 4) : null;
      const metricFieldDef = ((modMap[moduleSlug] || {}).fields || []).find((f) => f.key === r.metricField);
      const isComputedMetric = metricFieldDef && metricFieldDef.type === 'computed';
      let total = 0;
      if (myOrderDay !== null) {
        const rows = db.prepare('SELECT id, data FROM records WHERE module_slug = ?').all(moduleSlug)
          .map((row) => { try { return { __id: row.id, ...JSON.parse(row.data || '{}') }; } catch (e) { return { __id: row.id }; } });
        rows.forEach((row) => {
          const rowOrderDay = toDayCount(row[r.orderField]);
          if (rowOrderDay === null) return;
          if (rowOrderDay > myOrderDay) return;
          if (rowOrderDay === myOrderDay && row.__id > context.currentRecordId) return; // spareggio: stesso giorno, solo fino a questo id incluso
          if (myPeriod) {
            const rowPeriod = String(row[r.orderField]).slice(0, r.reset === 'mese' ? 7 : 4);
            if (rowPeriod !== myPeriod) return;
          }
          total += isComputedMetric
            ? evaluateFieldForRecord(db, moduleSlug, r.metricField, row.__id, row, modMap, (context.__depth || 0) + 1)
            : parseFieldNumeric(row[r.metricField], metricFieldDef && metricFieldDef.type);
        });
      }
      value = total;
    } else { // agg_ref
      const result = evaluateModuleAggregate(db, context.currentModule, r.aggregateKey, modMap, (context.__depth || 0) + 1);
      if (!result.valid) runtimeErrors.push(`Aggregato "${r.aggregateKey}": ${result.errors.join('; ')}`);
      value = result.valid ? result.value : 0;
    }
    const label = r.kind === 'simple'
      ? { module: r.module, field: r.field, func: r.func }
      : r.kind === 'if'
        ? { func: r.func, filter: `${r.filterField} ${r.op} ${r.value}` }
        : r.kind === 'own_field'
          ? { field: r.field }
          : r.kind === 'tier'
            ? { func: r.func, field: r.tierField, on: r.valueRef }
            : r.kind === 'running'
              ? { func: r.func, field: r.metricField, order: r.orderField, reset: r.reset }
              : r.kind === 'period'
                ? { func: r.func, module: r.module, field: r.field, period: r.period }
                : r.kind === 'period_if'
                  ? { func: r.func, module: r.module, field: r.field, period: r.period, filter: `${r.filterField} ${r.op} ${r.value}` }
                  : r.kind === 'agg_ref'
                    ? { field: r.aggregateKey }
                    : { func: r.func, module: r.childModule, field: r.field };
    breakdown.push({ expr: r.full, value, ...label });
    valueByFull[r.full] = value;
  });

  if (runtimeErrors.length > 0) return { valid: false, errors: runtimeErrors, breakdown, refs: check.refs };

  // Sostituzione per POSIZIONE su TUTTE le occorrenze (incluse ripetute) del testo di
  // ogni riferimento — stesso motivo del blocco strutturale in validateFormula sopra:
  // .split(full).join(value) sull'intera stringa corromperebbe un riferimento più corto
  // (es. own_field "totale") ogni volta che il suo testo compare per caso DENTRO il testo
  // di un riferimento più lungo non ancora sostituito (es. "totale_calcolato" dentro un
  // sumif_children) — qui invece si ricostruisce la stringa scorrendo i riferimenti in
  // ordine di posizione nell'espressione originale, mai per ricerca testuale globale.
  const allRefsSorted = [...extractRefs(expr, modMap, context)].sort((a, b) => a.index - b.index);
  let substituted = '';
  let cursor = 0;
  allRefsSorted.forEach((r) => {
    if (r.index < cursor) return;
    substituted += expr.slice(cursor, r.index) + String(valueByFull[r.full]);
    cursor = r.index + r.full.length;
  });
  substituted += expr.slice(cursor);

  try {
    const value = math.evaluate(substituted || '0');
    return { valid: true, errors: [], value, breakdown, refs: check.refs };
  } catch (e) {
    return { valid: false, errors: ['Errore di calcolo: ' + e.message], refs: check.refs };
  }
}

const MAX_AGGREGATE_DEPTH = 4;

// Valuta un blocco report_aggregate "a valore singolo" (senza group_by) di un modulo, per
// key — cuore della composizione richiesta da un "indice" che combina più aggregati già
// definiti a parte (es. dti/pct_pagato/penalita) invece di essere una formula gigante
// unica. depth previene ricorsioni infinite su riferimenti circolari tra aggregati (A che
// referenzia B che referenzia di nuovo A) — stesso principio già usato da
// evaluateFieldForRecord per i campi computed nidificati.
function evaluateModuleAggregate(db, moduleSlug, key, modMap, depth) {
  if (depth > MAX_AGGREGATE_DEPTH) return { valid: false, errors: ['Troppi livelli di riferimento tra aggregati (possibile ciclo)'], value: 0 };
  const aggregates = ((modMap[moduleSlug] || {}).aggregati) || [];
  const agg = aggregates.find((a) => a.key === key);
  if (!agg) return { valid: false, errors: [`Aggregato "${key}" non trovato`], value: 0 };
  if (agg.group_by) return { valid: false, errors: [`"${key}" è un aggregato raggruppato, non un valore singolo`], value: 0 };
  if (!agg.expr) return { valid: false, errors: [`Aggregato "${key}" non ha una formula`], value: 0 };
  return evaluateFormula(agg.expr, db, { currentModule: moduleSlug, __depth: depth });
}

// ─── MOTORE A PIPELINE (catena di blocchi) ─────────────────────────────────────
// Rappresentazione ADDITIVA rispetto al DSL testuale sopra: un campo computed/aggregato
// può avere `expr` (testo) OPPURE `steps` (catena di blocchi) — mai letta insieme, un
// modulo esistente con `expr` continua a funzionare identico, non va migrato. Ogni step
// produce un valore tipizzato ('number' o 'record_list') referenziabile dagli step
// successivi tramite il proprio `id` — mai all'indietro, un riferimento a uno step non
// ancora apparso nell'array è un errore di validazione, non un'ambiguità silenziosa.
//
// Riusa deliberatamente i primitivi già testati sopra (aggregateValues, findChildRelation,
// fieldTypeOf, getChildRows) invece di reimplementare la logica di query/aggregazione —
// la pipeline è un nuovo modo di COMPORRE quei primitivi, non un motore nuovo sotto.

const STEP_TYPES = ['own_field', 'get_related', 'related_field', 'aggregate', 'arithmetic', 'round', 'compare'];
const COMPARE_OPS = ['>', '<', '>=', '<=', '==', '!='];

function stepRefIsLiteral(ref) {
  return ref && typeof ref === 'object' && 'literal' in ref;
}

function validateSteps(steps, db, context) {
  const errors = [];
  if (!Array.isArray(steps) || steps.length === 0) {
    return { valid: false, errors: ['Nessun passaggio nella catena'], stepTypes: {} };
  }

  const modMap = loadModuleMap(db);
  const stepTypes = {};   // id -> 'number' | 'record_list', solo per step già validati (a monte)
  const stepModule = {};  // id -> modulo figlio, solo per step 'get_related'
  const seenIds = new Set();

  // Risolve un riferimento (letterale o id di uno step precedente) al SUO tipo — mai al
  // valore, questa è solo validazione. Un riferimento a uno step non ancora presente in
  // stepTypes (perché non ancora processato, o inesistente) è per costruzione un
  // riferimento in avanti o a un id sbagliato: entrambi vietati allo stesso modo.
  const resolveRefType = (ref, idx, slotName) => {
    if (stepRefIsLiteral(ref)) {
      if (typeof ref.literal !== 'number' || isNaN(ref.literal)) {
        errors.push(`Passaggio ${idx + 1}: valore numerico non valido in "${slotName}"`);
        return null;
      }
      return 'number';
    }
    if (typeof ref !== 'string' || !stepTypes[ref]) {
      errors.push(`Passaggio ${idx + 1}: riferimento "${slotName}" non valido — punta a un passaggio inesistente o non ancora definito a questo punto della catena`);
      return null;
    }
    return stepTypes[ref];
  };

  steps.forEach((s, idx) => {
    if (!s || !s.id) { errors.push(`Passaggio ${idx + 1}: manca un identificativo`); return; }
    if (seenIds.has(s.id)) { errors.push(`Passaggio ${idx + 1}: identificativo "${s.id}" duplicato`); return; }
    seenIds.add(s.id);

    if (!STEP_TYPES.includes(s.type)) {
      errors.push(`Passaggio ${idx + 1}: tipo "${s.type}" sconosciuto`); return;
    }

    if (s.type === 'own_field') {
      if (!context || !context.currentModule) {
        errors.push(`Passaggio ${idx + 1}: "Campo proprio" utilizzabile solo dentro un modulo`); return;
      }
      const type = fieldTypeOf(modMap, context.currentModule, s.field);
      if (!type) { errors.push(`Passaggio ${idx + 1}: campo "${s.field}" non trovato in questo modulo`); return; }
      if (!['number', 'currency', 'time'].includes(type)) {
        errors.push(`Passaggio ${idx + 1}: campo "${s.field}" (tipo: ${type}) non è numerico`); return;
      }
      stepTypes[s.id] = 'number';

    } else if (s.type === 'get_related') {
      if (!context || !context.currentModule) {
        errors.push(`Passaggio ${idx + 1}: "Ottieni record collegati" utilizzabile solo dentro un modulo`); return;
      }
      if (!modMap[s.child_module]) { errors.push(`Passaggio ${idx + 1}: modulo "${s.child_module}" non installato o inesistente`); return; }
      const relation = findChildRelation(modMap, s.child_module, context.currentModule, s.via);
      if (!relation) {
        errors.push(`Passaggio ${idx + 1}: ` + describeChildRelationError(modMap, { childModule: s.child_module }, context.currentModule));
        return;
      }
      stepTypes[s.id] = 'record_list';
      stepModule[s.id] = s.child_module;
      // Filtro opzionale — stessa forma {campo, op, valore} già usata dai trigger
      // schedulati "per ogni record che soddisfa un filtro". campo può essere un campo
      // vero del modulo figlio o '_stato' (sempre presente, non è un blocco 'field').
      (s.filtro || []).forEach((f, fi) => {
        if (!f.campo) { errors.push(`Passaggio ${idx + 1}: filtro ${fi + 1} senza campo`); return; }
        if (f.campo !== '_stato' && !fieldTypeOf(modMap, s.child_module, f.campo)) {
          errors.push(`Passaggio ${idx + 1}: filtro ${fi + 1} — campo "${f.campo}" non trovato in "${s.child_module}"`);
        }
        if (!COMPARE_OPS.includes(f.op)) errors.push(`Passaggio ${idx + 1}: filtro ${fi + 1} — operatore non valido`);
      });

    } else if (s.type === 'related_field') {
      if (!context || !context.currentModule) {
        errors.push(`Passaggio ${idx + 1}: "Campo da relazione" utilizzabile solo dentro un modulo`); return;
      }
      const rel = ((modMap[context.currentModule] || {}).relations || [])
        .find((r) => r.key === s.relation && r.type === 'many_to_one');
      if (!rel) {
        errors.push(`Passaggio ${idx + 1}: relazione "${s.relation}" non trovata (deve essere una relazione N:1 di questo modulo)`); return;
      }
      const targetType = fieldTypeOf(modMap, rel.target_module, s.field);
      if (!targetType) { errors.push(`Passaggio ${idx + 1}: campo "${s.field}" non trovato nel modulo "${rel.target_module}"`); return; }
      if (!['number', 'currency', 'time'].includes(targetType)) {
        errors.push(`Passaggio ${idx + 1}: campo "${s.field}" (tipo: ${targetType}) non è numerico — "Campo da relazione" produce sempre un numero`);
      }
      stepTypes[s.id] = 'number';

    } else if (s.type === 'aggregate') {
      const inputType = resolveRefType(s.input, idx, 'lista');
      if (inputType && inputType !== 'record_list') {
        errors.push(`Passaggio ${idx + 1}: "Aggrega" richiede in ingresso una lista di record collegati, non un numero`);
      }
      if (!AGG_FUNCS.includes(s.func)) { errors.push(`Passaggio ${idx + 1}: funzione "${s.func}" non ammessa`); }
      else if (s.func !== 'count') {
        const childMod = stepModule[s.input];
        const fieldType = childMod ? fieldTypeOf(modMap, childMod, s.field) : null;
        if (!fieldType) { errors.push(`Passaggio ${idx + 1}: campo "${s.field}" non trovato`); }
        else {
          const allowed = (s.func === 'min' || s.func === 'max') ? ['number', 'currency', 'date', 'datetime'] : ['number', 'currency'];
          if (!allowed.includes(fieldType)) errors.push(`Passaggio ${idx + 1}: campo "${s.field}" (tipo: ${fieldType}) non valido per ${s.func}()`);
        }
      }
      stepTypes[s.id] = 'number';

    } else if (s.type === 'arithmetic') {
      const aType = resolveRefType(s.a, idx, 'primo valore');
      const bType = resolveRefType(s.b, idx, 'secondo valore');
      if (aType && aType !== 'number') errors.push(`Passaggio ${idx + 1}: il primo valore deve essere un numero`);
      if (bType && bType !== 'number') errors.push(`Passaggio ${idx + 1}: il secondo valore deve essere un numero`);
      if (!['+', '-', '*', '/'].includes(s.op)) errors.push(`Passaggio ${idx + 1}: operatore "${s.op}" non ammesso`);
      stepTypes[s.id] = 'number';

    } else if (s.type === 'round') {
      const inputType = resolveRefType(s.input, idx, 'valore');
      if (inputType && inputType !== 'number') errors.push(`Passaggio ${idx + 1}: "Arrotonda" richiede un numero`);
      stepTypes[s.id] = 'number';

    } else if (s.type === 'compare') {
      const aType = resolveRefType(s.a, idx, 'primo valore');
      const bType = resolveRefType(s.b, idx, 'secondo valore');
      if (aType && aType !== 'number') errors.push(`Passaggio ${idx + 1}: il primo valore deve essere un numero`);
      if (bType && bType !== 'number') errors.push(`Passaggio ${idx + 1}: il secondo valore deve essere un numero`);
      if (!COMPARE_OPS.includes(s.op)) errors.push(`Passaggio ${idx + 1}: operatore "${s.op}" non ammesso`);
      stepTypes[s.id] = 'boolean';
    }
  });

  const last = steps[steps.length - 1];
  if (last && last.id && stepTypes[last.id] && !['number', 'boolean'].includes(stepTypes[last.id])) {
    errors.push('L\'ultimo passaggio della catena deve produrre un numero o un vero/falso, non una lista di record — aggiungi un passaggio "Aggrega" o "Confronta" in fondo');
  }

  return { valid: errors.length === 0, errors, stepTypes };
}

function evaluateSteps(steps, db, context) {
  const check = validateSteps(steps, db, context);
  if (!check.valid) return { valid: false, errors: check.errors, breakdown: [] };

  const modMap = loadModuleMap(db);
  const values = {}; // id -> valore grezzo (numero o array di record)
  const types = {};  // id -> tipo, serve solo per capire come mostrare il breakdown
  const timeInfo = {}; // id -> { vuoto } per i campi orario letti: due orari si sottraggono come orari (vedi 'arithmetic')
  const breakdown = [];

  const resolveVal = (ref) => (stepRefIsLiteral(ref) ? ref.literal : values[ref]);

  steps.forEach((s) => {
    let value, label;
    if (s.type === 'own_field') {
      const raw = context.currentRecordData ? context.currentRecordData[s.field] : undefined;
      const ft = fieldTypeOf(modMap, context.currentModule, s.field);
      value = parseFieldNumeric(raw, ft);
      // un campo orario ricorda se è vuoto: serve alla differenza tra due orari qui sotto
      if (ft === 'time') timeInfo[s.id] = { vuoto: timeToMinutes(raw) === null };
      label = s.label || s.field;
      types[s.id] = 'number';

    } else if (s.type === 'get_related') {
      const relation = findChildRelation(modMap, s.child_module, context.currentModule, s.via);
      // Fallback generico per record ancora in bozza (nessun currentRecordId, quindi
      // nessuna query FK possibile): se il form passa le righe embedded già in memoria
      // (context.currentChildRows[child_module]), le usa direttamente al posto della
      // query DB — stesso pattern già usato da 'own_field' con currentRecordData, non
      // un motore separato. Se non fornite, comportamento invariato (query DB reale).
      const embedded = context && context.currentChildRows && context.currentChildRows[s.child_module];
      const rowsRaw = embedded ? embedded : getChildRowsWithId(db, s.child_module, relation, context.currentRecordId);
      value = (s.filtro || []).length > 0 ? rowsRaw.filter((r) => s.filtro.every((f) => matchesFiltro(r, f))) : rowsRaw;
      label = s.label || ('Record collegati (' + s.child_module + ')');
      types[s.id] = 'record_list';

    } else if (s.type === 'related_field') {
      const rel = ((modMap[context.currentModule] || {}).relations || []).find((r) => r.key === s.relation && r.type === 'many_to_one');
      const targetId = rel && context.currentRecordData ? context.currentRecordData[rel.key] : null;
      if (!rel || !targetId) {
        value = 0;
      } else {
        const row = db.prepare('SELECT data FROM records WHERE module_slug = ? AND id = ?').get(rel.target_module, targetId);
        let targetData = {};
        try { targetData = row ? JSON.parse(row.data || '{}') : {}; } catch (e) { targetData = {}; }
        value = evaluateFieldForRecord(db, rel.target_module, s.field, targetId, targetData, modMap, (context.__depth || 0) + 1);
      }
      label = s.label || (s.relation + '.' + s.field);
      types[s.id] = 'number';

    } else if (s.type === 'aggregate') {
      const rows = resolveVal(s.input) || [];
      const inputStep = steps.find((x) => x.id === s.input);
      const childMod = inputStep ? inputStep.child_module : null;
      const fieldDef = (childMod && s.func !== 'count') ? ((modMap[childMod] || {}).fields || []).find((f) => f.key === s.field) : null;
      let rowsForAgg = rows;
      // Se il campo da aggregare è a sua volta 'computed' sul modulo figlio, non esiste
      // nei dati grezzi (mai persistito) — va ricalcolato riga per riga, ricorsivamente,
      // usando l'id preservato da getChildRowsWithId. Questo è ciò che rende possibile
      // comporre più livelli (es. clienti -> ordini.margine_ordine -> ordini_righe.margine_riga).
      if (fieldDef && fieldDef.type === 'computed' && ((fieldDef.steps && fieldDef.steps.length) || fieldDef.expr)) {
        rowsForAgg = rows.map((r) => ({ ...r, [s.field]: evaluateFieldForRecord(db, childMod, s.field, r.__id, r, modMap, (context.__depth || 0) + 1) }));
      }
      const fieldType = s.func === 'count' ? null : (fieldDef ? (fieldDef.type === 'computed' ? 'number' : fieldDef.type) : null);
      value = aggregateValues(rowsForAgg, s.field, s.func, fieldType);
      label = s.label || (s.func + '(' + (s.field || '') + ')');
      types[s.id] = 'number';

    } else if (s.type === 'arithmetic') {
      const a = resolveVal(s.a), b = resolveVal(s.b);
      // La differenza tra DUE ORARI è un tempo trascorso: se uno dei due manca (una timbratura ancora aperta) fa 0 invece di un numero negativo, e se il
      // secondo è prima del primo il turno è passato per la mezzanotte (22:00 → 01:00 = 3 ore, non −21). Per i numeri normali la sottrazione resta quella di sempre.
      const ta = timeInfo[s.a], tb = timeInfo[s.b];
      const traOrari = s.op === '-' && ta && tb;
      switch (s.op) {
        case '+': value = a + b; break;
        case '-': value = traOrari ? ((ta.vuoto || tb.vuoto) ? 0 : (a - b < 0 ? a - b + 1440 : a - b)) : a - b; break;
        case '*': value = a * b; break;
        // Divisione per zero -> 0, non Infinity/NaN: coerente con aggregateValues, che
        // già ritorna 0 su insiemi vuoti invece di propagare un valore non numerico in
        // un campo che il resto del sistema (Report, altri computed) assume sempre numerico.
        case '/': value = b === 0 ? 0 : a / b; break;
        default: value = 0;
      }
      label = s.label || ('risultato (' + s.op + ')');
      types[s.id] = 'number';

    } else if (s.type === 'round') {
      value = Math.round(resolveVal(s.input));
      label = s.label || 'arrotondato';
      types[s.id] = 'number';

    } else if (s.type === 'compare') {
      const a = resolveVal(s.a), b = resolveVal(s.b);
      switch (s.op) {
        case '>': value = a > b; break;
        case '<': value = a < b; break;
        case '>=': value = a >= b; break;
        case '<=': value = a <= b; break;
        case '==': value = a === b; break;
        case '!=': value = a !== b; break;
        default: value = false;
      }
      label = s.label || ('confronto (' + s.op + ')');
      types[s.id] = 'boolean';
    }

    values[s.id] = value;
    breakdown.push({
      id: s.id,
      type: s.type,
      label,
      value: types[s.id] === 'record_list' ? (value.length + ' record') : value,
    });
  });

  const lastId = steps[steps.length - 1].id;
  return { valid: true, errors: [], value: values[lastId], breakdown };
}

module.exports = {
  AGG_FUNCS, AGG_IF_FUNCS, COUNTIF, CHILD_FUNCS, COUNT_CHILDREN, CONTROL_FUNCS,
  extractRefs, computeAggregate, findChildRelation, validateFormula, evaluateFormula,
  validateSteps, evaluateSteps, getModuleRows, aggregateValues, loadModuleMap,
  evaluateModuleAggregate, toDayCount, compareValues,
};
