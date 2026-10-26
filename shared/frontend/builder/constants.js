// ─── BUILDER ──────────────────────────────────────────────────────────────────
const FIELD_TYPES = ['text', 'number', 'currency', 'date', 'datetime', 'time', 'select', 'multiselect', 'checkbox', 'textarea', 'email', 'phone', 'url', 'mappa', 'computed', 'file', 'barcode', 'giacenza', 'encrypted', 'soglia', 'soglia_data', 'scaglioni']

// Icone e colori scelgibili per un modulo — sottoinsieme del set icone esistente, quelle
// più adatte a rappresentare un modulo (escluse quelle puramente funzionali come x/trash/edit)
const MODULE_ICON_CHOICES = ['home', 'users', 'box', 'store', 'tool', 'plug', 'zap', 'user', 'file', 'credit-card', 'bar-chart', 'grid', 'link', 'git-branch', 'cpu', 'settings']

const MODULE_COLOR_CHOICES = ['#2563EB', '#10B981', '#F59E0B', '#6366F1', '#EC4899', '#7C3AED', '#F87171', '#FFB84D']

// Funzioni di aggregazione semplice (un solo riferimento modulo.campo) e condizionale
// (modulo.campo target + modulo.campo filtro + operatore + valore). Tenute separate dalle
// funzioni di controllo pure (round/if/date), che non fanno mai riferimento a un modulo.
const AGG_SIMPLE_FUNCS = ['sum', 'avg', 'count', 'min', 'max']

const AGG_IF_FUNCS = ['sumif', 'avgif', 'countif', 'minif', 'maxif']

const CHILD_FUNCS = ['sum_children', 'avg_children', 'count_children', 'min_children', 'max_children']

const CONTROL_FUNCS = ['round', 'if', 'today', 'diff_days', 'year', 'month', 'day']

// Esempi cliccabili — inseriti così come sono, pensati per essere poi adattati ai moduli reali del tenant
const FORMULA_EXAMPLES = [
  { label: 'Somma campo', expr: 'sum(ordini.totale)' },
  { label: 'Margine (ricavi − costi)', expr: 'sum(ordini.totale) - sum(spese.importo)' },
  { label: 'Media valore', expr: 'avg(ordini.totale)' },
  { label: 'Conteggio record', expr: 'count(ordini)' },
  { label: 'Somma condizionale', expr: "sumif(ordini.totale, ordini.stato, '==', 'pagato')" },
  { label: 'Conteggio condizionale', expr: "countif(ordini.stato, '==', 'in_attesa')" },
  { label: 'Media protetta da zero', expr: 'if(count(ordini) > 0, sum(ordini.totale) / count(ordini), 0)' },
  { label: 'Arrotonda a 2 decimali', expr: 'round(avg(ordini.totale), 2)' },
  { label: 'Giorni tra prima e ultima data', expr: 'diff_days(max(ordini.data_ordine), min(ordini.data_ordine))' },
]

// Esempi per i campi di tipo 'computed' (per-record, usano *_children) — mostrati solo
// quando il FormulaEditor viene usato in quel contesto (vedi prop context)
const FORMULA_EXAMPLES_CHILDREN = [
  { label: 'Totale righe collegate', expr: 'sum_children(righe_ordine.subtotale)' },
  { label: 'Conteggio righe collegate', expr: 'count_children(righe_ordine)' },
]

// Categorie/colori dei passaggi — stesso linguaggio visivo delle card Campo/Relazione
// sopra (bordo colorato a sinistra), coerente con la mappatura di Builder_Integrato_Architettura.md §15.3
const STEP_KINDS = {
  own_field:   { label: 'Campo proprio',            color: '#378ADD', bg: '#378ADD1A', icon: 'edit',        outputType: 'number' },
  get_related: { label: 'Ottieni record collegati', color: '#7F77DD', bg: '#7F77DD1A', icon: 'link',        outputType: 'record_list' },
  // Legge un campo (anche calcolato, ricorsivamente) dal record puntato da UNA relazione
  // N:1 del modulo corrente — es. da "Righe Ordine" leggere il costo del "Prodotto"
  // collegato. Diverso da get_related (che va verso i FIGLI, cioè verso chi ha una
  // relazione N:1 verso di me): questo va in avanti, verso ciò che IO punto.
  related_field: { label: 'Campo da relazione',      color: '#DD7F9E', bg: '#DD7F9E1A', icon: 'corner-down-right', outputType: 'number' },
  aggregate:   { label: 'Aggrega',                  color: '#1D9E75', bg: '#1D9E751A', icon: 'bar-chart',   outputType: 'number' },
  arithmetic:  { label: 'Aritmetica',                color: '#1D9E75', bg: '#1D9E751A', icon: 'cpu',         outputType: 'number' },
  round:       { label: 'Arrotonda',                color: '#1D9E75', bg: '#1D9E751A', icon: 'refresh',     outputType: 'number' },
  // Output booleano — non è "un'allerta", è un tipo di output in più che qualunque campo
  // computed può avere (esattamente come un campo computed può oggi essere un numero).
  // Cosa se ne fa il form a valle (mostrarlo come badge, bloccare un salvataggio, ecc.)
  // è una decisione del renderer generico, non di questo blocco.
  compare:     { label: 'Confronta',                color: '#F59E0B', bg: '#F59E0B1A', icon: 'git-compare', outputType: 'boolean' },
}

export { FIELD_TYPES, MODULE_ICON_CHOICES, MODULE_COLOR_CHOICES, AGG_SIMPLE_FUNCS, AGG_IF_FUNCS, CHILD_FUNCS, CONTROL_FUNCS, FORMULA_EXAMPLES, FORMULA_EXAMPLES_CHILDREN, STEP_KINDS }
