import React, { useState, useEffect, useRef } from 'react'
import Icon from '../../components/Icon'
import Select from '../../components/Select'
import useApi from '../../lib/useApi'
import { genStepId, schemaToV3 } from '../../lib/schema-v3-frontend'
import { FIELD_TYPES, MODULE_ICON_CHOICES, MODULE_COLOR_CHOICES } from './constants'
import { STARTER_TEMPLATES } from './starterTemplates'
import FormulaEditor from './FormulaEditor'
import { newStep, StepChainEditor } from './StepChainEditor'
import AutomationActionsList from '../../../../../shared/frontend/AutomationActionsList.jsx'
import ModelCanvas from './ModelCanvas'
import BottomPanel from './BottomPanel'
import PropertiesPanel from './PropertiesPanel'
import BuilderPreviewPanel from './BuilderPreviewPanel'
import { computeValidations } from './validation'
import { buildFullHtml } from '../../components/PrintModal'

// Mappa statica block_type → categoria, duplicata a livello di modulo (non
// dentro il componente) apposta: serve sia dentro selectModule (definita
// prima di blockCatalog nel corpo del componente, che invece dipende da
// `schema` per i flag "disabled") sia nel render — stessa fonte di verità in
// entrambi i punti, senza il problema per cui una funzione definita prima non
// può chiudere su una const definita dopo nello stesso render.
const BLOCK_TYPE_CATEGORY = {
  field: 'Dati', allegati: 'Dati',
  relation: 'Relazioni',
  workflow_state: 'Workflow', workflow_transition: 'Workflow',
  permissions: 'Permessi', validazione_creazione: 'Permessi',
  report_aggregate: 'Calcolo', financial_statement: 'Calcolo', yearly_breakdown: 'Calcolo', category_pivot: 'Calcolo', weekly_breakdown: 'Calcolo',
  connection_required: 'Automazione', automation: 'Automazione',
  document_template: 'Stampa',
  form_step: 'Layout form', branch_create: 'Layout form', reconciliation: 'Layout form', distance_buckets: 'Layout form', period_view: 'Layout form', parent_children_view: 'Layout form', view_tabs: 'Layout form',
}

// Etichetta leggibile per tipo di blocco — usata solo per la riga di riepilogo
// di una card collassata (canvas a griglia, 2026-08-16). Deliberatamente non
// legge campi specifici per tipo (es. target_module per 'relation'): ogni ramo
// di rendering ha la sua forma di dati, `step.label` è l'unico campo comune a
// (quasi) tutti i tipi — abbastanza per un riepilogo utile senza dover toccare
// i ~20 rami di editing esistenti solo per estrarne un riassunto.
const BLOCK_TYPE_LABEL = {
  field: 'Campo', relation: 'Relazione', workflow_state: 'Stato workflow', workflow_transition: 'Transizione workflow',
  permissions: 'Permessi', validazione_creazione: 'Validazione alla creazione', allegati: 'Allegati',
  connection_required: 'Richiede connessione', automation: 'Automazione', document_template: 'Modello documento',
  form_step: 'Passo form', branch_create: 'Crea in filiale', reconciliation: 'Riconciliazione',
  financial_statement: 'Bilancio', distance_buckets: 'Fasce distanza', period_view: 'Vista periodo',
  parent_children_view: 'Vista padre/figli', yearly_breakdown: 'Riepilogo annuale', category_pivot: 'Pivot categoria',
  weekly_breakdown: 'Riepilogo settimanale', view_tabs: 'Tab di vista', report_aggregate: 'Report aggregato',
}
function summaryForStep(step) {
  const typeLabel = BLOCK_TYPE_LABEL[step.block_type] || step.block_type
  return step.label ? (typeLabel + ' — ' + step.label) : typeLabel
}

// Anteprima dal vivo del documento di stampa mentre lo si scrive — stesso principio del
// FormulaEditor (debounce verso un endpoint server-side che è l'unica fonte di verità,
// mai una simulazione del rendering lato client). Un modulo senza record ancora non può
// avere un'anteprima reale: lo dice esplicitamente invece di mostrare un iframe vuoto o
// rotto. Il record da usare è scelto dall'utente (di default il più recente) perché lo
// stesso template può rendere in modo molto diverso a seconda dei dati — utile controllare
// più di un record prima di fidarsi del layout.
function DocumentTemplatePreview({ slug, api, template }) {
  const [records, setRecords] = useState(null)
  const [selectedId, setSelectedId] = useState('')
  const [preview, setPreview] = useState(null)
  const debounceRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    api.get('/records/' + slug).then((data) => { if (!cancelled) setRecords(data || []) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug])

  useEffect(() => {
    if (!template.contenuto_html || !template.contenuto_html.trim() || !records || records.length === 0) {
      setPreview(null)
      return
    }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      const res = await api.post('/builder/' + slug + '/preview-print', {
        template: { nome: template.nome, formato: template.formato, contenuto_html: template.contenuto_html },
        record_id: selectedId || null,
      })
      setPreview(res.data || null)
    }, 450)
    return () => clearTimeout(debounceRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template.contenuto_html, template.formato, selectedId, records])

  if (records === null) return <div className="text-[11px] text-gray-600 mt-3">Caricamento anteprima…</div>

  if (records.length === 0) {
    return (
      <div className="text-[11px] text-gray-500 mt-3 bg-surface-page border border-dashed border-gray-800 rounded-lg p-3">
        Crea almeno un record in questo modulo per vedere l'anteprima dal vivo del documento.
      </div>
    )
  }

  const recordLabel = (r) => {
    const d = r.data || {}
    return d.numero || d.nome || d.titolo || d.descrizione || ('record #' + r.id)
  }

  return (
    <div className="mt-3">
      <div className="flex items-center gap-2 mb-2">
        <label className="text-[10px] text-gray-500">Anteprima sul record</label>
        <select className="bg-surface-page text-ink px-2 py-1 rounded text-[11px] outline-none border border-gray-700"
          value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
          <option value="">Più recente</option>
          {records.slice(0, 25).map((r) => <option key={r.id} value={r.id}>#{r.id} — {recordLabel(r)}</option>)}
        </select>
        {!preview && (template.contenuto_html || '').trim() && <span className="text-[10px] text-gray-600">Aggiorno…</span>}
      </div>
      {preview && preview.html && (
        <div className="border border-gray-800 rounded-lg overflow-hidden bg-white">
          <iframe title="preview-stampa" srcDoc={buildFullHtml(preview.html, template.formato, template.nome)}
            className="w-full" style={{ height: 280, border: 'none' }} />
        </div>
      )}
    </div>
  )
}

// Anteprima "a vuoto" di un'automazione — stesso spirito di DocumentTemplatePreview sopra
// (server come unica fonte di verità, non una riscrittura lato client della logica), ma
// non dal vivo/debounced: ogni prova esegue per davvero runAzioni in modalità dryRun sul
// backend (letture reali, nessuna scrittura — vedi automation-engine.js), quindi un
// bottone esplicito invece che "ad ogni tasto premuto" ha più senso qui.
function AutomationDryRun({ slug, api, automation }) {
  const [records, setRecords] = useState(null)
  const [selectedId, setSelectedId] = useState('')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)

  const richiedeRecord = !(automation.trigger && automation.trigger.evento === 'schedulato' && automation.trigger.modalita !== 'per_record')

  useEffect(() => {
    if (!richiedeRecord) { setRecords([]); return }
    let cancelled = false
    api.get('/records/' + slug).then((data) => { if (!cancelled) setRecords(data || []) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, richiedeRecord])

  const recordLabel = (r) => {
    const d = r.data || {}
    return d.numero || d.nome || d.titolo || d.descrizione || ('record #' + r.id)
  }

  const prova = async () => {
    setLoading(true)
    setResult(null)
    const res = await api.post('/builder/' + slug + '/automation/dry-run', {
      automation: { trigger: automation.trigger, azioni: automation.azioni, label: automation.label },
      record_id: selectedId || null,
    })
    setLoading(false)
    setResult(res.data || null)
  }

  if ((automation.azioni || []).length === 0) return null

  return (
    <div className="mt-3 pt-3 border-t border-gray-800">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        {richiedeRecord && records && records.length > 0 && (
          <select className="bg-surface-page text-ink px-2 py-1 rounded text-[11px] outline-none border border-gray-700"
            value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
            <option value="">Più recente</option>
            {records.slice(0, 25).map((r) => <option key={r.id} value={r.id}>#{r.id} — {recordLabel(r)}</option>)}
          </select>
        )}
        <button onClick={prova} disabled={loading || (richiedeRecord && records && records.length === 0)}
          className="text-[11px] px-2.5 py-1 rounded-md bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition disabled:opacity-40 flex items-center gap-1.5">
          <Icon name="zap" size={11} />{loading ? 'Provo…' : 'Prova su un record'}
        </button>
        {richiedeRecord && records && records.length === 0 && (
          <span className="text-[10px] text-gray-600">Crea almeno un record in questo modulo per provare l'automazione.</span>
        )}
      </div>
      {result && result.no_records && (
        <div className="text-[11px] text-gray-500">Nessun record trovato.</div>
      )}
      {result && Array.isArray(result.steps) && (
        <div className="bg-surface-page border border-amber-500/30 rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-wide text-amber-400 font-semibold mb-2">
            Anteprima — nessuna scrittura reale, nessun messaggio reale inviato
          </div>
          {result.steps.length === 0
            ? <div className="text-[11px] text-gray-500">Nessuna azione eseguita (condizione non soddisfatta, o nessuna azione configurata).</div>
            : (
              <ul className="space-y-1.5">
                {result.steps.map((s, i) => (
                  <li key={i} className="text-[11px] text-gray-300 flex items-start gap-1.5">
                    <Icon name="chevron-right" size={11} className="text-gray-600 flex-shrink-0 mt-0.5" />
                    {s.desc}
                  </li>
                ))}
              </ul>
            )}
        </div>
      )}
    </div>
  )
}

// Riga di input etichettata — usata nell'editor di validazione delle transizioni
// (confronto con un record collegato via relazione).
function Riga2({ label, placeholder, value, onChange }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-gray-500 w-28 flex-shrink-0">{label}</span>
      <input className="flex-1 bg-surface-card text-ink px-2 py-1.5 rounded-md text-xs outline-none border border-gray-700 placeholder-gray-600" placeholder={placeholder} value={value || ''} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}

// baseUrl: prop opzionale, oggi non usata dall'unico chiamante reale di QUESTO file
// (App.jsx di core/frontend, che gira sempre sulla propria origine e passa sempre
// '/api' relativo). Esiste qui solo per coerenza con la copia separata e sincronizzata
// a mano in super-admin/frontend/src/pages/BuilderPage — quella sì la usa davvero,
// per chiamare l'API del tenant scelto da un'origine diversa (Super Admin). Se questo
// file viene mai risincronizzato là, baseUrl deve restare passata a useApi().
function BuilderPage({ token, baseUrl, allModules, onModulesChanged, preselectSlug, onPreselectHandled, openNewModule, onNewModuleHandled }) {
  const api = useApi(token, baseUrl)
  const [modules, setModules] = useState([])
  const [importingModule, setImportingModule] = useState(false)
  const [selected, setSelected] = useState(null)
  const [schema, setSchema] = useState(null)
  const [tab, setTab] = useState('Tutti')
  // Vista modello (Builder 2.0 fase 2) — mappa di TUTTI i moduli e le loro
  // relazioni, alternativa all'editor di un singolo modulo selezionato.
  const [showCanvas, setShowCanvas] = useState(false)
  const [saved, setSaved] = useState(false)
  const [published, setPublished] = useState(false)
  const [history, setHistory] = useState([])
  const [showPreview, setShowPreview] = useState(false)
  // Card collassate di default (canvas a griglia, 2026-08-16) — mappa id->bool,
  // le card non ancora toccate sono implicitamente collassate (vedi `?? false`
  // nel .map dei blocchi), non serve seminare la mappa all'apertura del modulo.
  const [expandedSteps, setExpandedSteps] = useState({})
  const toggleExpanded = (id) => setExpandedSteps((s) => ({ ...s, [id]: !(s[id] ?? false) }))
  const [bottomTab, setBottomTab] = useState('validazioni')
  const [bottomCollapsed, setBottomCollapsed] = useState(false)
  const [propTab, setPropTab] = useState('proprieta')
  const [moduleSearch, setModuleSearch] = useState('')
  const [newModuleName, setNewModuleName] = useState('')
  const [newModuleIcon, setNewModuleIcon] = useState('box')
  const [newModuleColor, setNewModuleColor] = useState('#2563EB')
  const [newModuleSupport, setNewModuleSupport] = useState(false)
  const [showNewModule, setShowNewModule] = useState(false)
  // Wizard: step 1 = dati base modulo (già esisteva), step 2 = aiuto per la prima
  // relazione, opzionale. Non un modale a sé — stesso showNewModule, solo più passi,
  // così chi non vuole configurare subito una relazione può saltare senza frizioni.
  const [wizardStep, setWizardStep] = useState(1)
  const [newModuleRelation, setNewModuleRelation] = useState({ enabled: false, target_module: '', label: '', cardinality: 'many_to_one' })
  // "Parti da un modulo esistente" — clona campi/relazioni/workflow di un modulo
  // già installato in QUESTO tenant come bozza di partenza. Non dal registro/Store
  // direttamente: GET /modules/registry non include schema_json per design (protegge
  // i moduli a licenza dall'essere copiati senza installarli) — qui invece si clona
  // da `modules` (i moduli locali, già con schema_json reale, nessuna nuova fetch).
  const [cloneFromSlug, setCloneFromSlug] = useState('')
  // Template di partenza curati (2026-09-07) — alternativa a "Parti da un modulo
  // esistente" per quando non hai ancora nulla di simile nel tenant. Mutuamente
  // esclusivo col clone (vedi i due onChange sotto): scegliere l'uno azzera l'altro,
  // non ha senso applicare entrambi.
  const [templateSlug, setTemplateSlug] = useState('')
  const [fieldCache, setFieldCache] = useState([])
  const [showIconPicker, setShowIconPicker] = useState(false)
  // Connessioni disponibili per il blocco Automazione — stessa fonte della pagina
  // Connessioni (globale, per tenant), caricata una volta sola come fieldCache.
  const [connections, setConnections] = useState([])
  // Ruoli disponibili per i selettori "ruoli abilitati" (quick_create, transizioni,
  // permessi) — admin/user built-in + ruoli custom del tenant (tabella roles). Prima
  // questi selettori erano hardcoded su ['admin', 'user'], quindi un ruolo custom come
  // "Agente" non poteva mai essere abilitato/configurato da nessuna parte nel Builder.
  const [allRoles, setAllRoles] = useState([{ name: 'admin', label: 'Admin' }, { name: 'user', label: 'Utente' }])
  const loadRoles = async () => {
    const data = await api.get('/roles')
    if (data) setAllRoles(data.map((r) => ({ name: r.name, label: r.label })))
  }
  // Modalità formula per campo/aggregato: 'testo' (FormulaEditor, il DSL esistente) o
  // 'blocchi' (StepChainEditor, la catena a passaggi). Tenuta in uno stato UI separato
  // (non derivata da expr/steps) perché altrimenti passare a "blocchi" prima di aver
  // aggiunto il primo passaggio tornerebbe visivamente a "testo" — fastidioso da usare.
  const [formulaMode, setFormulaMode] = useState({})
  const getFormulaMode = (key, item) => formulaMode[key] || ((item.steps && item.steps.length) ? 'blocchi' : 'testo')
  // Passare modalità azzera l'altra rappresentazione — expr e steps non convivono mai
  // popolati insieme sullo stesso campo, altrimenti il backend userebbe steps in
  // silenzio ignorando un expr che l'utente pensa ancora attivo (o viceversa).
  const switchFormulaMode = (key, mode, updateFn, idx) => {
    setFormulaMode((p) => ({ ...p, [key]: mode }))
    if (mode === 'blocchi') updateFn(idx, 'expr', '')
    else updateFn(idx, 'steps', [])
  }
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [advancedKeyOpen, setAdvancedKeyOpen] = useState({}) // { [`fields:${idx}`]: true, [`relations:${idx}`]: true }
  const [keyRenameWarning, setKeyRenameWarning] = useState({}) // idx -> messaggio, avviso non bloccante

  // Aggiorna icona/colore di un modulo esistente e riflette subito il cambiamento
  // localmente (senza dover ricaricare tutta la lista moduli)
  const updateModuleIconColor = async (slug, patchBody) => {
    const res = await api.patch('/modules/' + slug, patchBody)
    if (res && res.ok) setModules((p) => p.map((m) => m.slug === slug ? { ...m, ...patchBody } : m))
  }

  const loadModules = async () => {
    const data = await api.get('/modules')
    if (data) setModules(data)
  }

  // Cache moduli/campi per l'autocomplete delle formule — un'unica chiamata all'apertura
  // del Builder, non un round-trip a ogni tasto premuto nell'editor formula
  const loadFieldCache = async () => {
    const data = await api.get('/builder/schema-cache')
    if (data) setFieldCache(data)
  }

  const loadConnections = async () => {
    const data = await api.get('/connections')
    if (data) setConnections(data)
  }

  useEffect(() => { loadModules(); loadFieldCache(); loadConnections(); loadRoles() }, [])

  // Arrivo diretto dallo Store ("Personalizza questo modulo") — preseleziona senza
  // che l'utente debba ricercarlo nella lista a sinistra. onPreselectHandled avvisa
  // App.jsx che può dimenticarsene, così tornando qui più tardi non riparte da capo.
  useEffect(() => {
    if (preselectSlug) {
      selectModule(preselectSlug)
      if (onPreselectHandled) onPreselectHandled()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselectSlug])

  // Arrivo diretto dallo Store ("Crea il tuo gestionale da zero") — stesso
  // pattern di preselectSlug sopra, ma apre subito il wizard "nuovo modulo"
  // invece di selezionarne uno esistente.
  useEffect(() => {
    if (openNewModule) {
      setNewModuleName(''); setNewModuleIcon('box'); setNewModuleColor('#2563EB')
      setNewModuleSupport(false); setWizardStep(1)
      setNewModuleRelation({ enabled: false, target_module: '', label: '', cardinality: 'many_to_one' })
      setCloneFromSlug('')
      setShowNewModule(true)
      if (onNewModuleHandled) onNewModuleHandled()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openNewModule])

  const selectModule = async (slug) => {
    setSelected(slug)
    setSaved(false)
    setPublished(false)
    setTab('Tutti')
    const data = await api.get('/builder/' + slug + '/draft')
    if (data) {
      // Il backend restituisce sempre v2 (normalizzato, vedi schema-v3.js lato server).
      // Qui si converte SUBITO a v3 per l'editing: da questo punto in poi il Builder
      // ragiona SEMPRE in steps[] unico, indipendentemente da come il modulo è salvato
      // sul disco — stesso principio della normalizzazione lato backend, applicato
      // lato client.
      const draft = data.draft || {}
      // 'boolean' è un alias legacy di 'checkbox' (moduli pre-piattaforma, es. Coffee —
      // vedi FieldEditorInput.jsx) accettato ovunque il campo viene mostrato/editato, ma
      // MAI presente nella tendina tipo del Builder (FIELD_TYPES non lo elenca): aprendo
      // uno di questi campi qui il valore restava "boolean", invisibile nella tendina.
      // Si normalizza a 'checkbox' nel momento in cui il modulo viene aperto nel Builder —
      // stesso identificativo, stesso comportamento ovunque, la prossima pubblicazione
      // scrive il tipo canonico senza bisogno di toccare i dati dei record.
      const normalizedFields = (draft.fields || []).map((f) => (f.type === 'boolean' ? { ...f, type: 'checkbox' } : f))
      const v3 = schemaToV3({
        fields: normalizedFields,
        relations: draft.relations || [],
        workflow: draft.workflow || null,
        scope: draft.scope || null,
        permissions: draft.permissions || null,
        validazione_creazione: draft.validazione_creazione || null,
        allegati: draft.allegati || null,
        form_steps: draft.form_steps || [],
        aggregati: draft.aggregati || [],
        // Automazioni/condizioni: il backend le mette da parte qui quando appiattisce
        // a v2 (vedi toV2Lenient) — senza riportarle dentro, si perdevano silenziosamente
        // ogni volta che si riapriva un modulo esistente nel Builder (e una pubblicazione
        // successiva le cancellava per davvero, non solo dalla vista).
        _v3_unsupported: draft._v3_unsupported || [],
      })
      setSchema(v3)
      // Categoria di default all'apertura — MAI "Tutti": l'editor non deve più aprirsi
      // su un'unica sequenza mista di campi/relazioni/workflow/automazioni/permessi.
      // La navigazione primaria è l'albero a sinistra; qui si sceglie solo il punto
      // di partenza (prima categoria con contenuto, altrimenti "Dati" per un modulo
      // ancora vuoto — mai vuoto il tab attivo).
      const presentCats = CATEGORY_ORDER.filter((cat) => v3.steps.some((s) => BLOCK_TYPE_CATEGORY[s.block_type] === cat))
      setTab(presentCats[0] || 'Dati')
      const hist = await api.get('/builder/' + slug + '/history')
      if (hist) setHistory(hist)
    }
  }

  const saveDraft = async () => {
    // Si salva v3 così com'è in memoria — il backend non deve convertire nulla in
    // scrittura (accetta qualunque forma), e chiunque lo rilegga altrove lo
    // normalizza automaticamente a v2 (formula.js, records.js, modules.js).
    await api.put('/builder/' + selected + '/draft', { schema })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
    loadFieldCache()
  }

  const publish = async () => {
    const res = await api.post('/builder/' + selected + '/publish', {})
    if (!res.ok) {
      const details = (res.data && res.data.details) || []
      const msg = details.length > 0
        ? details.map((d) => `${d.label}: ${d.errors.join('; ')}`).join('\n')
        : (res.data && res.data.error) || 'Pubblicazione non riuscita'
      window.alert('Impossibile pubblicare — controlla le formule:\n\n' + msg)
      return
    }
    setPublished(true)
    setTimeout(() => setPublished(false), 2000)
    const hist = await api.get('/builder/' + selected + '/history')
    if (hist) setHistory(hist)
  }

  // Esporta/Carica modulo (2026-08-16) — stesso standard "singolo file JSON" già
  // in uso in Super Admin (Store moduli), qui lato tenant: un admin può portarsi
  // via un modulo che ha costruito e ricaricarlo su un altro tenant a cui ha
  // accesso, senza passare da Core/Store. Nessuna nuova route: GET /modules/:slug
  // e POST /modules/import esistono già (usate anche da Super Admin per lo
  // stesso identico scopo, stesso formato payload — i file sono compatibili
  // in entrambe le direzioni).
  const exportModule = async () => {
    const mod = await api.get('/modules/' + selected)
    if (!mod) return
    const payload = { name: mod.name, icon: mod.icon, color: mod.color, schema_json: mod.schema_json }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'modulo-' + mod.slug + '.json'
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const importModule = (file) => {
    if (!file) return
    setImportingModule(true)
    const reader = new FileReader()
    reader.onload = async () => {
      try {
        const payload = JSON.parse(reader.result)
        const res = await api.post('/modules/import', payload)
        setImportingModule(false)
        if (!res || !res.ok) {
          window.alert('Caricamento non riuscito: ' + ((res && res.data && res.data.error) || 'errore sconosciuto'))
          return
        }
        loadModules()
        if (onModulesChanged) onModulesChanged()
        selectModule(res.data.slug)
      } catch (e) {
        setImportingModule(false)
        window.alert('File non valido: ' + e.message)
      }
    }
    reader.readAsText(file)
  }

  const restoreVersion = async (historyId) => {
    const ok = window.confirm('Ripristinare questa versione come bozza? Dovrai pubblicarla di nuovo per renderla effettiva.')
    if (!ok) return
    const res = await api.post('/builder/' + selected + '/restore/' + historyId, {})
    if (res.ok) {
      selectModule(selected)
    } else {
      window.alert('Ripristino non riuscito')
    }
  }

  const createModule = async () => {
    if (!newModuleName.trim()) return
    const slug = newModuleName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
    await api.post('/modules/create', { name: newModuleName, slug, icon: newModuleIcon, color: newModuleColor, support_module: newModuleSupport })

    // Se al passo 2 del wizard è stata configurata una relazione, il nuovo modulo non
    // parte con schema vuoto — parte già con quel blocco pronto in bozza, da rivedere
    // e pubblicare nel Builder. Evita il giro "crea modulo -> apri Builder -> cerca
    // il pannello -> aggiungi Relazione -> configura da zero" per il caso più comune
    // (un modulo nuovo che si aggancia a uno già esistente).
    if (cloneFromSlug) {
      // Clona come bozza di partenza — campi/relazioni/workflow dell'originale, ma
      // indipendente da lì in poi: nessun legame vivo, la modifichi liberamente.
      const source = modules.find((m) => m.slug === cloneFromSlug)
      if (source) {
        let sourceSchema
        try { sourceSchema = JSON.parse(source.schema_json || '{}') } catch (e) { sourceSchema = {} }
        await api.put('/builder/' + slug + '/draft', { schema: schemaToV3(sourceSchema) })
      }
    } else if (templateSlug) {
      // Template curato (2026-09-07) — stessa logica del clone sopra (bozza di
      // partenza, indipendente da lì in poi), ma la fonte è uno schema statico
      // invece di un modulo reale già presente nel tenant.
      const tpl = STARTER_TEMPLATES.find((t) => t.slug === templateSlug)
      if (tpl) await api.put('/builder/' + slug + '/draft', { schema: tpl.schema })
    } else if (newModuleRelation.enabled && newModuleRelation.target_module) {
      const label = newModuleRelation.label.trim() || (modules.find((m) => m.slug === newModuleRelation.target_module)?.name || newModuleRelation.target_module)
      const key = dedupeKeyGeneric('rel_' + sanitizeFieldKey(label), [])
      const relationStep = {
        id: genStepId('rel'),
        block_type: 'relation',
        key,
        label,
        target_module: newModuleRelation.target_module,
        type: newModuleRelation.cardinality,
        display_field: guessDisplayField(newModuleRelation.target_module),
      }
      await api.put('/builder/' + slug + '/draft', { schema: { version: 3, steps: [relationStep] } })
    }

    setShowNewModule(false)
    setWizardStep(1)
    setNewModuleName('')
    setNewModuleIcon('box')
    setNewModuleColor('#2563EB')
    setNewModuleSupport(false)
    setNewModuleRelation({ enabled: false, target_module: '', label: '', cardinality: 'many_to_one' })
    setCloneFromSlug('')
    setTemplateSlug('')
    loadModules()
    if (onModulesChanged) onModulesChanged()
    selectModule(slug)
  }

  const deleteModule = async (slug, name) => {
    const ok = window.confirm(`Eliminare definitivamente il modulo "${name}"?\n\nVerranno cancellati anche tutti i record e lo storico versioni di questo modulo. Non si può annullare.`)
    if (!ok) return
    const res = await api.del('/modules/' + slug)
    if (!res || !res.ok) {
      window.alert('Eliminazione non riuscita — riprova o controlla la console.')
      return
    }
    if (selected === slug) {
      setSelected(null)
      setSchema(null)
    }
    loadModules()
    if (onModulesChanged) onModulesChanged()
  }

  // Campi
  // Le chiavi campo/relazione devono essere identificatori puri (lettere ASCII/numeri/
  // underscore) — il motore formule si aspetta esattamente questo pattern ovunque.
  const sanitizeFieldKey = (raw) => {
    let s = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '') // à -> a, è -> e, ecc.
    s = s.toLowerCase().replace(/[^a-z0-9_]/g, '_')
    s = s.replace(/^([0-9])/, '_$1') // non può iniziare con una cifra
    return s
  }
  const dedupeKeyGeneric = (base, siblings) => {
    if (!base) return 'campo_' + Date.now()
    let candidate = base, n = 2
    while (siblings.some((item) => item.key === candidate)) { candidate = base + '_' + n; n++ }
    return candidate
  }
  // Prova a indovinare quale campo del modulo target è il "nome leggibile" da mostrare
  // al posto dell'id — evita di lasciare "Seleziona campo..." dimenticato.
  const guessDisplayField = (targetSlug) => {
    const fields = (fieldCache.find((m) => m.slug === targetSlug) || {}).fields || []
    const candidates = ['nome', 'titolo', 'ragione_sociale', 'descrizione', 'name', 'label']
    for (const c of candidates) {
      const hit = fields.find((f) => f.key === c || f.key.includes(c))
      if (hit) return hit.key
    }
    const firstText = fields.find((f) => f.type === 'text')
    return firstText ? firstText.key : ''
  }

  // Funzioni generiche — operano SEMPRE su schema.steps per indice assoluto,
  // indipendentemente dal block_type. Sostituiscono le 15 funzioni add/update/remove
  // separate per categoria che c'erano prima (addField/updateField/removeField,
  // addRelation/..., addState/..., ecc.): stesso principio già usato da StepChainEditor
  // per i singoli passaggi di una formula, esteso a TUTTO il modulo. La specificità di
  // ogni tipo di blocco vive solo nei default che addBlock crea e nei rami key/label di
  // updateStep — non in funzioni separate per categoria.
  const updateStep = (idx, key, val) => setSchema((p) => {
    const steps = [...p.steps]
    const current = steps[idx]
    const siblings = steps.filter((s, i) => i !== idx && s.block_type === current.block_type)
    if (key === 'label' && !current._keyManuallyEdited && (current.block_type === 'field' || current.block_type === 'relation' || current.block_type === 'workflow_state')) {
      const prefix = current.block_type === 'relation' ? 'rel_' : current.block_type === 'workflow_state' ? 'stato_' : ''
      steps[idx] = { ...current, label: val, key: dedupeKeyGeneric(prefix + sanitizeFieldKey(val), siblings) }
    } else if (key === 'key') {
      steps[idx] = { ...current, key: dedupeKeyGeneric(sanitizeFieldKey(val), siblings), _keyManuallyEdited: true }
    } else if (key === 'target_module' && current.block_type === 'relation') {
      steps[idx] = { ...current, target_module: val, display_field: current.display_field || guessDisplayField(val) }
    } else {
      steps[idx] = { ...current, [key]: val }
    }
    return { ...p, steps }
  })

  // Rinominare la chiave di un campo/relazione non avvisava di nessun impatto — se una
  // formula (computed) o un'automazione di QUESTO STESSO modulo la referenzia, restava
  // silenziosamente rotta finché qualcuno non se ne accorgeva a runtime. Scansione solo
  // testuale (JSON.stringify + confine di parola) sugli step già in memoria — nessuna
  // chiamata di rete, nessun bisogno di capire ogni forma possibile di config di
  // automazione. Non blocca il rinominare, solo avvisa prima che sia tardi per
  // accorgersene.
  const findKeyUsages = (currentSchema, oldKey) => {
    if (!oldKey) return []
    const escaped = oldKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const wordRe = new RegExp('\\b' + escaped + '\\b')
    const usages = []
    ;(currentSchema.steps || []).forEach((s) => {
      if (s.block_type === 'field' && s.type === 'computed') {
        const text = s.expr || (s.steps ? JSON.stringify(s.steps) : '')
        if (text && wordRe.test(text)) usages.push(s.label || s.key)
      }
      // Copre sia una chiave campo (dentro le azioni/config) sia una chiave di stato
      // workflow (dentro il trigger cambio_stato) con lo stesso scan testuale.
      if (s.block_type === 'automation') {
        const text = JSON.stringify({ trigger: s.trigger, azioni: s.azioni } || {})
        if (wordRe.test(text)) usages.push(s.label || 'Automazione')
      }
      if (s.block_type === 'workflow_transition' && (s.from === oldKey || s.to === oldKey)) {
        usages.push(s.label || (s.from + ' → ' + s.to))
      }
    })
    return [...new Set(usages)]
  }

  const setRenameWarning = (idx, oldKey, localUsages, crossUsages) => {
    setKeyRenameWarning((p) => {
      const next = { ...p }
      const parts = []
      if (localUsages.length > 0) parts.push(`in questo modulo: ${localUsages.join(', ')}`)
      if (crossUsages && crossUsages.length > 0) {
        parts.push('in altri moduli: ' + crossUsages.map((u) => `${u.module_name} (${u.detail})`).join(', '))
      }
      if (parts.length > 0) next[idx] = `Chiave "${oldKey}" usata — ${parts.join(' · ')} — verifica che restino corrette dopo il rinominare.`
      else delete next[idx]
      return next
    })
  }

  // Il controllo nello STESSO modulo è sincrono (schema già in memoria). L'uso della
  // stessa chiave in un ALTRO modulo (es. sum_children/related_field verso questo, o
  // un'automazione che referenzia questo modulo) richiede lo schema di ogni modulo
  // installato, che il frontend non ha — round-trip server-side dedicato
  // (POST /builder/:slug/key-usage), non bloccante: l'avviso locale appare subito,
  // quello cross-modulo si aggiunge quando la risposta arriva.
  const handleKeyChange = (idx, newVal) => {
    const oldKey = schema.steps[idx].key
    const renaming = oldKey && oldKey !== newVal
    const localUsages = renaming ? findKeyUsages(schema, oldKey) : []
    setRenameWarning(idx, oldKey, localUsages, null)
    updateStep(idx, 'key', newVal)
    if (renaming) {
      api.post('/builder/' + selected + '/key-usage', { key: oldKey }).then((res) => {
        if (res && res.ok) setRenameWarning(idx, oldKey, localUsages, res.data)
      })
    }
  }

  // Conferma prima di eliminare un blocco (2026-09-07) — a differenza di deleteModule
  // e restoreVersion, questa azione non aveva NESSUNA conferma, e questo editor non ha
  // undo/redo: un click sbagliato su un blocco già configurato (campi, workflow,
  // automazioni...) perdeva il lavoro senza modo di recuperarlo se non ricaricando
  // l'ultima bozza salvata. Un blocco appena aggiunto e ancora senza etichetta/chiave
  // non chiede conferma — non c'è ancora nulla da perdere.
  const removeStep = (idx) => setSchema((p) => {
    const step = p.steps[idx]
    const hasContent = !!(step && (step.label || step.key || step.from))
    if (hasContent && !window.confirm(`Eliminare "${step.label || step.key || step.block_type}"? Non c'è undo — se hai già configurato questo blocco, la modifica è persa finché non ricarichi l'ultima bozza salvata.`)) return p
    const steps = [...p.steps]
    steps.splice(idx, 1)
    return { ...p, steps }
  })

  // Riordino drag & drop — ora un unico array (steps), quindi il riordino è libero tra
  // QUALUNQUE tipo di blocco (Campo sopra Relazione, Relazione sopra Workflow, ecc.):
  // prima era vincolato dentro la stessa categoria (dragRef.current.arr === arrName),
  // perché fields/relations/workflow/scope/aggregati erano contenitori separati. Con
  // steps[] unico questo vincolo semplicemente non serve più — non è stato rimosso con
  // una condizione, è sparito perché non c'è più una categoria da confrontare.
  const reorderSteps = (fromIdx, toIdx) => setSchema((p) => {
    if (fromIdx === toIdx || fromIdx == null || toIdx == null) return p
    const steps = [...p.steps]
    const [moved] = steps.splice(fromIdx, 1)
    steps.splice(toIdx, 0, moved)
    return { ...p, steps }
  })

  const [pickerQuery, setPickerQuery] = useState('')
  const dragRef = React.useRef(null)
  // Un drag può portare due cose diverse: il riordino di un blocco già sul canvas
  // (dragRef, indice numerico) oppure un blocco NUOVO trascinato dal pannello a destra
  // (panelDragRef, la entry del catalogo). Il drop su un blocco esistente prova prima
  // il riordino (se dragRef è valorizzato), altrimenti prova ad aggiungere il blocco
  // nuovo all'indice del drop — così trascinare dal pannello sopra un blocco preciso
  // lo inserisce lì, non solo in fondo.
  const panelDragRef = React.useRef(null)
  const insertBlockAt = (entry, atIdx) => {
    // Se il tab attivo è un filtro diverso dalla categoria del blocco appena
    // aggiunto, il blocco sparirebbe subito dietro il filtro — si passa al suo
    // tab così resta visibile immediatamente.
    if (tab !== 'Tutti' && entry.category !== tab) setTab(entry.category)
    setSchema((p) => {
      const steps = [...p.steps]
      const newStep = { id: genStepId(entry.block_type.slice(0, 3)), block_type: entry.block_type, ...entry.defaults }
      const idx = atIdx == null ? steps.length : atIdx
      steps.splice(idx, 0, newStep)
      return { ...p, steps }
    })
  }
  const dragHandlers = (idx) => ({
    draggable: true,
    onDragStart: () => { dragRef.current = idx; panelDragRef.current = null },
    onDragOver: (e) => e.preventDefault(),
    onDrop: (e) => {
      e.preventDefault()
      if (panelDragRef.current) { insertBlockAt(panelDragRef.current, idx); panelDragRef.current = null; return }
      reorderSteps(dragRef.current, idx)
    },
  })
  const canvasDropHandlers = {
    onDragOver: (e) => e.preventDefault(),
    onDrop: (e) => { e.preventDefault(); if (panelDragRef.current) { insertBlockAt(panelDragRef.current, null); panelDragRef.current = null } },
  }

  // Catalogo unico dei blocchi disponibili — prima viveva SOLO dentro il modale di
  // selezione (funzioni "run" inline), ora alimenta anche il pannello persistente a
  // destra e il drag-and-drop dal pannello, quindi va tenuto come dato, non più come
  // callback che chiude un modale che non esiste più.
  const blockCatalog = [
    { label: 'Campo', desc: 'Un valore semplice del record.', icon: 'edit', color: '#2563EB', category: 'Dati', block_type: 'field', defaults: { key: 'campo_' + Date.now(), label: 'Nuovo campo', type: 'text', required: false } },
    { label: 'Relazione', desc: 'Collega a un record di un altro modulo.', icon: 'link', color: '#7C3AED', category: 'Relazioni', block_type: 'relation', defaults: { key: 'rel_' + Date.now(), label: 'Nuova relazione', target_module: '', type: 'many_to_one', display_field: '' } },
    { label: 'Stato workflow', desc: 'Una fase del ciclo di vita del record (es. Bozza, Confermato).', icon: 'git-branch', color: '#10B981', category: 'Workflow', block_type: 'workflow_state', defaults: { key: 'stato_' + Date.now(), label: 'Nuovo stato', color: '#6B7280', initial: false } },
    { label: 'Transizione workflow', desc: 'Passaggio da uno stato a un altro, con ruoli abilitati.', icon: 'git-branch', color: '#10B981', category: 'Workflow', block_type: 'workflow_transition', defaults: { from: '', to: '', label: 'Nuova transizione', roles: ['admin'] } },
    { label: 'Permessi', desc: "Chi può vedere, creare, modificare, eliminare i record — per ruolo.", icon: 'eye', color: '#FFB84D', category: 'Permessi', block_type: 'permissions', defaults: { rules: [] }, disabled: schema && schema.steps.some((s) => s.block_type === 'permissions'), note: 'Già presente su questo modulo' },
    { label: 'Validazione creazione', desc: 'Blocca la creazione di un nuovo record se una condizione non è soddisfatta.', icon: 'shield', color: '#F97316', category: 'Permessi', block_type: 'validazione_creazione', defaults: { expr: '', messaggio: '' }, disabled: schema && schema.steps.some((s) => s.block_type === 'validazione_creazione'), note: 'Già presente su questo modulo' },
    { label: 'Allegati tipizzati', desc: 'Permette di allegare file con tipo (es. Fattura, Prova pagamento) a ogni record.', icon: 'file', color: '#06B6D4', category: 'Dati', block_type: 'allegati', defaults: { types: ['allegato'] }, disabled: schema && schema.steps.some((s) => s.block_type === 'allegati'), note: 'Già presente su questo modulo' },
    { label: 'Richiede connessione', desc: 'Serve SOLO se il modulo dipende da un connettore fuori dalle sue automazioni (es. un poller dedicato come quello Gmail) — se invece è una tua automazione a usare Slack/WhatsApp/ecc, il modulo lo segnala da solo, non serve aggiungere questo blocco a mano.', icon: 'plug', color: '#F59E0B', category: 'Automazione', block_type: 'connection_required', defaults: { integration_id: 'google' }, disabled: schema && schema.steps.some((s) => s.block_type === 'connection_required'), note: 'Già presente su questo modulo' },
    { label: 'Formula / Aggregato', desc: 'Calcolo su relazioni (sum/avg/count…).', icon: 'cpu', color: '#F87171', category: 'Calcolo', block_type: 'report_aggregate', defaults: { key: 'agg_' + Date.now(), label: 'Nuovo aggregato', expr: '', format: 'number' } },
    { label: 'Automazione', desc: 'Quando succede qualcosa in questo modulo, esegui delle azioni (con Se/Altrimenti).', icon: 'zap', color: '#FBBF24', category: 'Automazione', block_type: 'automation', defaults: { label: 'Nuova automazione', enabled: true, trigger: { evento: 'nuovo_record', stato: '', campo: '' }, azioni: [] } },
    { label: 'Documento stampabile', desc: 'Un documento (bolla, fattura, ricevuta) generabile e stampabile da un record di questo modulo.', icon: 'file', color: '#06B6D4', category: 'Stampa', block_type: 'document_template', defaults: { nome: 'Nuovo documento', formato: 'a4', contenuto_html: '' } },
    { label: 'Passo del wizard', desc: 'Con almeno 2 di questi, il form di creazione diventa un wizard multi-step invece di un unico form lungo.', icon: 'list', color: '#A78BFA', category: 'Layout form', block_type: 'form_step', defaults: { titolo: 'Nuovo passo', campi: [], righe_figlio: [] } },
    { label: 'Creazione con scelta', desc: "Un bottone che chiede prima una scelta (es. \"Diretto\" o \"A rate\") e poi mostra campi diversi, creando il record in un modulo diverso a seconda della scelta — es. un pagamento diretto crea una Spesa, un pagamento a rate crea un Debito.", icon: 'git-branch', color: '#EC4899', category: 'Layout form', block_type: 'branch_create', defaults: { label: 'Nuovo', branches: [] } },
    { label: 'Riconciliazione a doppia lista', desc: "Due liste affiancate con abbinamento automatico (stesso importo e direzione, data più vicina) e conferma manuale — es. abbina le transazioni bancarie ai movimenti contabili interni. Sostituisce l'intera vista del modulo.", icon: 'link', color: '#06B6D4', category: 'Layout form', block_type: 'reconciliation', defaults: { key: 'rec_' + Date.now(), label: 'Riconciliazione', source_a: { module: '', amount_field: '', date_field: '', link_field: '' }, source_b: { module: '', metric: '', date_field: '' } }, disabled: schema && schema.steps.some((s) => s.block_type === 'reconciliation'), note: 'Un solo blocco per modulo' },
    { label: 'Bilancio contabile', desc: "Bilancio di Verifica, Conto Economico e Stato Patrimoniale calcolati sulle righe dare/avere di questo modulo, raggruppate per conto — convenzione dare/avere universale (Ricavo/Passivo/Capitale = avere−dare, Costo/Attivo = dare−avere), utile e pareggio calcolati automaticamente. Va messo sul modulo che contiene le righe contabili (dare/avere), es. \"movimenti_righe\".", icon: 'bar-chart', color: '#10B981', category: 'Calcolo', block_type: 'financial_statement', defaults: { key: 'bilancio_' + Date.now(), label: 'Contabilità Generale', righe_module: '', conto_relation: '', tipo_field: '', nome_field: '', codice_field: '', dare_field: '', avere_field: '' } },
    { label: 'Vista per distanza da una data', desc: "Raggruppa i record in bucket per giorni di distanza da oggi rispetto a un campo data (es. scadute/entro 7/entro 30/oltre 30 per una scadenza) — con conteggio e somma opzionale per bucket, filtri opzionali. Sostituisce l'intera vista del modulo.", icon: 'list', color: '#F59E0B', category: 'Layout form', block_type: 'distance_buckets', defaults: { key: 'scadenza_' + Date.now(), label: 'Scadenzario', date_field: '', metric_field: '', metric_format: 'currency', buckets: [{ key: 'scadute', label: 'Scadute', max_days: -1 }, { key: 'entro7', label: 'Entro 7 giorni', max_days: 7 }, { key: 'entro30', label: 'Entro 30 giorni', max_days: 30 }, { key: 'oltre30', label: 'Oltre 30 giorni', max_days: null }], filters: [] }, disabled: schema && schema.steps.some((s) => s.block_type === 'distance_buckets'), note: 'Un solo blocco per modulo' },
    { label: 'Vista per periodo navigabile', desc: "Naviga avanti/indietro per mese o anno (es. spese del mese, entrate/uscite dell'anno) con metriche (somma/conteggio) per il periodo attivo, opzionalmente confrontate col periodo precedente, e lista filtrata sotto. Sostituisce l'intera vista del modulo.", icon: 'calendar', color: '#10B981', category: 'Layout form', block_type: 'period_view', defaults: { key: 'periodo_' + Date.now(), label: 'Vista periodo', granularity: 'mese', date_field: '', compare_previous: false, metrics: [], filters: [] }, disabled: schema && schema.steps.some((s) => s.block_type === 'period_view'), note: 'Un solo blocco per modulo' },
    { label: 'Genitori con figli', desc: "Ogni record di questo modulo con un riepilogo dei suoi record collegati in un altro modulo (es. un Debito con le sue Rate: pallini numerati, progresso, residuo). Sostituisce l'intera vista del modulo.", icon: 'git-branch', color: '#8B5CF6', category: 'Layout form', block_type: 'parent_children_view', defaults: { key: 'figli_' + Date.now(), label: 'Piani', children_module: '', children_relation: '', children_status_field: '_stato', children_status_done_value: '', children_order_field: '', amount_field: '', child_amount_field: '' }, disabled: schema && schema.steps.some((s) => s.block_type === 'parent_children_view'), note: 'Un solo blocco per modulo' },
    { label: 'Riepilogo mensile per anno', desc: "Tabella con tutti i 12 mesi di un anno (navigabile), ciascuno con le sue metriche, opzionalmente confrontato con lo stesso mese dell'anno precedente. Si aggiunge alla vista del modulo, non la sostituisce — se ne possono aggiungere più di uno.", icon: 'bar-chart', color: '#F59E0B', category: 'Calcolo', block_type: 'yearly_breakdown', defaults: { key: 'riepilogo_' + Date.now(), label: 'Riepilogo mensile', source_module: '', date_field: '', compare_previous_year: true, metrics: [], filters: [] } },
    { label: 'Pivot per categoria', desc: "Raggruppa per un campo (es. categoria) su più anni a confronto, con variazione % tra i due più recenti — es. \"anno su anno\" o uno storico pluriennale. Si aggiunge alla vista del modulo, non la sostituisce.", icon: 'grid', color: '#EC4899', category: 'Calcolo', block_type: 'category_pivot', defaults: { key: 'pivot_' + Date.now(), label: 'Per categoria', source_module: '', date_field: '', group_by: '', metric_field: '', metric_func: 'sum', metric_format: 'currency', n_years: 2, filters: [] } },
    { label: 'Ore per settimana', desc: "Barre con le settimane ISO di un mese (navigabile) e il loro totale, con una soglia opzionale (es. straordinari oltre le ore settimanali previste). Si aggiunge alla vista del modulo, non la sostituisce.", icon: 'bar-chart', color: '#2563EB', category: 'Calcolo', block_type: 'weekly_breakdown', defaults: { key: 'settimane_' + Date.now(), label: 'Ore per settimana', source_module: '', date_field: '', metric_field: '', metric_func: 'sum', metric_format: 'number', threshold: '', filters: [] } },
    { label: 'Tab della vista', desc: "Più viste che sostituiscono la tabella, alternabili a tab sullo stesso modulo — es. un tab \"Spese\" (la vista mensile propria) e un tab \"Debiti\" (il progresso di un altro modulo). Ogni tab riusa un blocco già dichiarato altrove (qui o su un altro modulo), non lo ridefinisce.", icon: 'list', color: '#8B5CF6', category: 'Layout form', block_type: 'view_tabs', defaults: { tabs: [] }, disabled: schema && schema.steps.some((s) => s.block_type === 'view_tabs'), note: 'Un solo blocco per modulo' },
  ]
  const CATEGORY_ORDER = ['Dati', 'Relazioni', 'Workflow', 'Permessi', 'Calcolo', 'Automazione', 'Stampa', 'Layout form']
  const CATEGORY_ICON = { Dati: 'list', Relazioni: 'link', Workflow: 'refresh', Permessi: 'eye', Calcolo: 'bar-chart', Automazione: 'zap', Stampa: 'file', 'Layout form': 'grid' }
  const categoryOf = (blockType) => BLOCK_TYPE_CATEGORY[blockType] || (blockCatalog.find((b) => b.block_type === blockType) || {}).category
  const filteredCatalog = blockCatalog.filter((it) => !pickerQuery.trim() || it.label.toLowerCase().includes(pickerQuery.trim().toLowerCase()))
  const catalogByCategory = CATEGORY_ORDER.map((cat) => ({ cat, items: filteredCatalog.filter((it) => it.category === cat) })).filter((g) => g.items.length > 0)

  const otherModules = allModules.filter((m) => m.slug !== selected)

  // Sotto-voci ad albero (Campi/Relazioni/Workflow/.../Permessi) — mostrate SOLO
  // per il modulo selezionato, perché lo schema (necessario per i conteggi) è
  // caricato solo per quello: gli altri moduli in lista non hanno i dati per
  // mostrare un albero corretto senza una chiamata API in più a modulo. Stesso
  // limite del mockup originale, che infatti mostrava un solo modulo espanso.
  const ModuleListItem = ({ m }) => {
    const isSel = selected === m.slug
    const col = m.color || '#2563EB'
    const presentCats = isSel && schema ? CATEGORY_ORDER.filter((cat) => schema.steps.some((s) => categoryOf(s.block_type) === cat)) : []
    return (
      <div key={m.slug}>
        <div className={'group relative w-full flex items-center gap-2.5 pl-2.5 pr-1.5 py-1.5 rounded-lg text-sm transition border-l-2 ' + (isSel ? 'bg-white/[0.06]' : 'border-transparent hover:bg-white/[0.04]')}
          style={isSel ? { borderColor: col } : { borderColor: 'transparent' }}>
          <button onClick={() => { setShowCanvas(false); selectModule(m.slug) }} className="flex-1 min-w-0 flex items-center gap-2.5 text-left">
            <span className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 transition"
              style={{ backgroundColor: col + (isSel ? '2e' : '1a'), color: isSel ? col : '#8B93A1' }}>
              <Icon name={m.icon || 'box'} size={12} />
            </span>
            <span className={'truncate ' + (isSel ? 'text-ink font-medium' : 'text-gray-400 group-hover:text-ink')}>{m.name}</span>
          </button>
          <button onClick={() => deleteModule(m.slug, m.name)}
            title="Elimina modulo"
            className="opacity-0 group-hover:opacity-100 text-red-400/60 hover:text-red-400 transition flex-shrink-0 p-1">
            <Icon name="trash" size={12} />
          </button>
        </div>
        {isSel && schema && !showCanvas && (
          <div className="pl-4 mt-0.5 mb-1 space-y-0.5 border-l border-gray-800 ml-4">
            {CATEGORY_ORDER.map((cat) => {
              const count = schema.steps.filter((s) => categoryOf(s.block_type) === cat).length
              const active = tab === cat
              return (
                <button key={cat} onClick={() => setTab(cat)}
                  className={'w-full flex items-center gap-2 pl-2.5 pr-1.5 py-1 rounded-md text-xs transition ' + (active ? 'bg-accent/15 text-accent' : 'text-gray-500 hover:text-gray-300 hover:bg-white/[0.03]')}>
                  <Icon name={CATEGORY_ICON[cat]} size={11} className="flex-shrink-0" />
                  <span className="flex-1 text-left truncate">{cat}</span>
                  <span className="opacity-60">{count}</span>
                </button>
              )
            })}
            {tab !== 'Tutti' && (
              <button onClick={() => setTab('Tutti')}
                className="w-full flex items-center gap-2 pl-2.5 pr-1.5 py-1 rounded-md text-[11px] text-gray-600 hover:text-gray-400 transition">
                <span className="flex-1 text-left">Tutti i blocchi</span>
              </button>
            )}
          </div>
        )}
      </div>
    )
  }
  // Solo moduli davvero installati — GET /modules (loadModules sopra) restituisce
  // l'intero catalogo, incluse righe disinstallate (0 = tolto dallo Store, la riga
  // resta per ricordare configurazione/licenza). Segnalato dall'utente: un modulo
  // non installato non deve essere modificabile qui, sarebbe editare qualcosa che
  // il tenant non vede/usa più.
  const builderModules = modules.filter((m) => !['dashboard'].includes(m.slug) && m.installed)
  const primaryModules = builderModules.filter((m) => !m.support_module)
  const supportModulesList = builderModules.filter((m) => m.support_module)

  return (
    <>
      {/* Editor a 3 colonne fisse (moduli / campi / "Aggiungi blocco") pensato per
          schermo largo — su mobile collassava in una colonna larga pochi pixel con
          ogni parola a capo da sola (altezza pagina a 16000px+). Non è un fix di
          adattamento: si nasconde e basta, un messaggio onesto al suo posto —
          nessuno edita seriamente schema/workflow/formule da telefono. */}
      <div className="md:hidden flex flex-col items-center justify-center text-center py-16 px-6">
        <Icon name="tool" size={28} className="text-gray-600 mb-3" />
        <div className="text-sm text-ink font-medium mb-1">Il Builder richiede uno schermo più grande</div>
        <div className="text-xs text-gray-500 max-w-xs">Apri questa pagina da un computer o un tablet per modificare campi, relazioni, workflow e automazioni.</div>
      </div>
      <div className="hidden md:flex gap-6">
      {/* sticky + scroll proprio sull'intera colonna (non spezzato in più
          scroll interni annidati, fastidiosi con la rotellina) — così su un
          tenant con molti moduli la palette primitive resta raggiungibile
          scorrendo questa colonna, indipendentemente da quanto si è scesi
          nel canvas centrale. Stesso pattern "sticky top-4" già usato dal
          pannello Proprietà a destra. */}
      <div className="w-60 flex-shrink-0 sticky top-4 self-start max-h-[calc(100vh-2rem)] overflow-y-auto pr-0.5">
        <div className="flex items-center justify-between mb-2.5 px-0.5">
          <div className="text-[11px] text-gray-500 uppercase tracking-wider font-semibold">Struttura</div>
          <div className="flex items-center gap-1">
            <button onClick={() => setShowCanvas((s) => !s)}
              title="Mappa dei moduli"
              className={'w-6 h-6 rounded-md flex items-center justify-center transition ' + (showCanvas ? 'text-accent bg-accent/20' : 'text-gray-500 hover:text-white hover:bg-white/5')}>
              <Icon name="grid" size={14} />
            </button>
            <button onClick={() => { setShowCanvas(false); setWizardStep(1); setNewModuleRelation({ enabled: false, target_module: '', label: '', cardinality: 'many_to_one' }); setShowNewModule(true) }}
              title="Nuovo modulo"
              className="w-6 h-6 rounded-md flex items-center justify-center text-accent hover:text-white hover:bg-accent/20 transition"><Icon name="plus" size={14} /></button>
            <label title="Carica modulo da un file esportato (da questo o un altro tenant)"
              className={'w-6 h-6 rounded-md flex items-center justify-center transition cursor-pointer ' + (importingModule ? 'text-gray-600' : 'text-gray-500 hover:text-white hover:bg-white/5')}>
              <Icon name="upload" size={14} />
              <input type="file" accept="application/json" className="hidden" disabled={importingModule}
                onChange={(e) => { importModule(e.target.files[0]); e.target.value = '' }} />
            </label>
          </div>
        </div>
        <div className="relative mb-2.5">
          <div className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-600 pointer-events-none"><Icon name="search" size={11} /></div>
          <input value={moduleSearch} onChange={(e) => setModuleSearch(e.target.value)} placeholder="Cerca moduli..."
            className="w-full bg-surface-page text-ink pl-7 pr-2 py-1.5 rounded-lg text-xs outline-none border border-gray-800 focus:border-accent transition" />
        </div>

        {/* Palette primitive — subito in cima, appena sotto la ricerca moduli,
            SEMPRE visibile a colpo d'occhio quando un modulo è aperto. Prima
            viveva in fondo a tutta la colonna (irraggiungibile su una lista
            lunga), poi dentro l'albero sotto le 8 categorie del modulo
            (ancora troppo in basso, segnalato dall'utente: "la vedo ma è in
            basso, va spostata") — ora non dipende più né da quanti moduli ci
            sono né da quante categorie ha il modulo aperto. */}
        {selected && schema && !showCanvas && (
          <div className="mb-4 pb-4 border-b border-gray-800">
            <div className="text-[11px] text-gray-500 uppercase tracking-wider font-semibold mb-2 px-0.5">Aggiungi blocco</div>
            <div className="relative mb-2">
              <div className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-600 pointer-events-none"><Icon name="search" size={11} /></div>
              <input value={pickerQuery} onChange={(e) => setPickerQuery(e.target.value)} placeholder="Cerca primitive..."
                className="w-full bg-surface-page text-ink pl-7 pr-2 py-1.5 rounded-lg text-xs outline-none border border-gray-800 focus:border-accent transition" />
            </div>
            <div className="max-h-[40vh] overflow-y-auto space-y-3 pr-0.5">
              {catalogByCategory.map(({ cat, items }) => (
                <div key={cat}>
                  <div className="text-[10px] font-semibold text-gray-600 uppercase tracking-wider mb-1 px-0.5">{cat}</div>
                  <div className="space-y-1">
                    {items.map((it) => (
                      <div key={it.label}
                        draggable={!it.disabled}
                        onDragStart={() => { panelDragRef.current = it; dragRef.current = null }}
                        onClick={it.disabled ? undefined : () => insertBlockAt(it, null)}
                        title={it.disabled ? it.note : it.desc}
                        className={'group flex items-center gap-2 px-2 py-1.5 rounded-lg border transition ' + (it.disabled ? 'opacity-40 cursor-not-allowed border-transparent' : 'cursor-grab active:cursor-grabbing border-gray-800/80 bg-surface-page hover:border-gray-700 hover:bg-surface-hover')}
                        style={!it.disabled ? { borderLeftColor: it.color, borderLeftWidth: '3px' } : {}}>
                        <Icon name={it.icon} size={12} style={{ color: it.color }} className="flex-shrink-0" />
                        <span className="text-[11px] text-gray-300 truncate">{it.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {filteredCatalog.length === 0 && <div className="text-[11px] text-gray-600 text-center py-4">Nessuna primitiva trovata.</div>}
            </div>
          </div>
        )}

        {/* Altezza limitata con scroll proprio — su un tenant con molti moduli
            (es. Finance, 12+) una lista piatta lunga spingeva la palette
            primitive e l'albero categorie fuori dallo schermo, rendendoli
            irraggiungibili senza scorrere parecchio. Raggruppati per
            group_name, stessa identica logica già in uso nella Sidebar
            principale dell'app — stessa organizzazione che l'utente vede già
            nel menu reale, non una tassonomia nuova da imparare. */}
        <div className="space-y-0.5">
          {(() => {
            const filtered = primaryModules.filter((m) => m.name.toLowerCase().includes(moduleSearch.trim().toLowerCase()))
            const senzaGruppo = filtered.filter((m) => !m.group_name)
            const conGruppo = filtered.filter((m) => m.group_name)
            const gruppi = []
            conGruppo.forEach((m) => { if (!gruppi.includes(m.group_name)) gruppi.push(m.group_name) })
            return (
              <>
                {senzaGruppo.map((m) => <ModuleListItem key={m.slug} m={m} />)}
                {gruppi.map((g) => (
                  <div key={g} className="mt-2">
                    <div className="px-1 pt-1.5 pb-1 text-[9.5px] font-semibold text-gray-600 uppercase tracking-wider">{g}</div>
                    <div className="space-y-0.5">
                      {conGruppo.filter((m) => m.group_name === g).map((m) => <ModuleListItem key={m.slug} m={m} />)}
                    </div>
                  </div>
                ))}
              </>
            )
          })()}
        </div>
        {supportModulesList.filter((m) => m.name.toLowerCase().includes(moduleSearch.trim().toLowerCase())).length > 0 && (
          <>
            <div className="text-[10px] text-gray-600 uppercase tracking-wider font-semibold mt-3 mb-1.5 px-1 flex items-center gap-1.5">
              <span className="w-3 h-px bg-gray-700" />Supporto
            </div>
            <div className="space-y-0.5">
              {supportModulesList.filter((m) => m.name.toLowerCase().includes(moduleSearch.trim().toLowerCase())).map((m) => <ModuleListItem key={m.slug} m={m} />)}
            </div>
          </>
        )}
      </div>

      <div className="flex-1 min-w-0">
        {showCanvas ? (
          <ModelCanvas modules={modules} fieldCache={fieldCache} onSelectModule={(slug) => { setShowCanvas(false); selectModule(slug) }} />
        ) : !selected ? (
          <div className="flex items-center justify-center h-64 text-gray-600">Seleziona un modulo per iniziare</div>
        ) : !schema ? (
          <div className="text-gray-500">Caricamento...</div>
        ) : (
          <div>
            <div className="flex items-center justify-between flex-wrap gap-y-2 mb-4">
              <div className="flex items-center gap-3 flex-wrap gap-y-2 relative">
                <span className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: (modules.find((m) => m.slug === selected)?.color || '#2563EB') + '22', color: modules.find((m) => m.slug === selected)?.color || '#2563EB' }}>
                  <Icon name={modules.find((m) => m.slug === selected)?.icon || 'box'} size={16} />
                </span>
                {editingName ? (
                  <input autoFocus value={nameDraft} onChange={(e) => setNameDraft(e.target.value)}
                    onBlur={() => { setEditingName(false); if (nameDraft.trim() && nameDraft.trim() !== modules.find((m) => m.slug === selected)?.name) updateModuleIconColor(selected, { name: nameDraft.trim() }) }}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setEditingName(false) }}
                    className="text-xl font-bold text-ink bg-surface-page border border-accent rounded-lg px-2 py-0.5 outline-none" />
                ) : (
                  <h2 className="text-xl font-bold text-ink cursor-pointer hover:opacity-80 transition flex items-center gap-1.5 group"
                    onClick={() => { setNameDraft(modules.find((m) => m.slug === selected)?.name || selected); setEditingName(true) }}>
                    {modules.find((m) => m.slug === selected)?.name || selected}
                    <Icon name="edit" size={13} />
                  </h2>
                )}
                {modules.find((m) => m.slug === selected)?.support_module && <span className="text-xs bg-cp-purple/20 text-cp-purple px-2 py-1 rounded">Supporto</span>}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setPropTab('cronologia')} className="text-xs text-gray-500 hover:text-ink transition flex items-center gap-1"><Icon name="refresh" size={12} />Cronologia</button>
                <button onClick={() => setShowPreview(!showPreview)} className="text-xs text-gray-500 hover:text-ink transition flex items-center gap-1"><Icon name="eye" size={12} />Anteprima</button>
                <button onClick={exportModule} title="Scarica questo modulo come file, per caricarlo su un altro tenant" className="text-xs text-gray-500 hover:text-ink transition flex items-center gap-1"><Icon name="download" size={12} />Esporta</button>
                {(() => {
                  const { errors, warnings } = computeValidations(schema, fieldCache, allRoles)
                  const n = errors.length + warnings.length
                  return (
                    <button onClick={() => { setBottomTab('validazioni'); setBottomCollapsed(false) }}
                      className="text-xs text-gray-500 hover:text-ink transition flex items-center gap-1.5">
                      <Icon name="shield" size={12} />Valida
                      {n > 0 && <span className={'text-[10px] px-1.5 py-0.5 rounded-full ' + (errors.length > 0 ? 'bg-red-900/40 text-red-400' : 'bg-amber-900/40 text-amber-400')}>{n}</span>}
                    </button>
                  )
                })()}
                <button onClick={saveDraft} className="bg-gray-800 hover:bg-gray-700 text-white px-3 py-1.5 rounded-lg text-sm transition flex items-center gap-1.5"><Icon name="save" size={14} />Bozza</button>
                <button onClick={publish} className="bg-accent hover:opacity-90 text-white px-3 py-1.5 rounded-lg text-sm transition flex items-center gap-1.5"><Icon name="check" size={14} />Pubblica</button>
                {(saved || published) && <span className={saved ? 'text-green-400 text-xs' : 'text-accent text-xs'}>{saved ? 'Bozza salvata' : 'Pubblicato!'}</span>}
              </div>
            </div>

            {/* Breadcrumb — la navigazione primaria tra categorie ora vive nell'albero
                a sinistra (vedi ModuleListItem); qui resta solo un'indicazione di dove
                si è, più la via di fuga "Tutti" per chi vuole vedere/riordinare l'intera
                sequenza indipendentemente dalla categoria. */}
            <div className="flex items-center gap-2 mb-3 text-xs">
              <span className="text-gray-600">{modules.find((m) => m.slug === selected)?.name}</span>
              <Icon name="chevron-right" size={11} className="text-gray-700" />
              <span className="text-ink font-medium">{tab === 'Tutti' ? 'Tutti i blocchi' : tab}</span>
              <span className="text-gray-600">({(tab === 'Tutti' ? schema.steps : schema.steps.filter((s) => categoryOf(s.block_type) === tab)).length})</span>
              {tab !== 'Tutti' && (
                <button onClick={() => setTab('Tutti')} className="text-gray-600 hover:text-gray-400 transition ml-1">— vedi tutti i blocchi</button>
              )}
            </div>

            {/* Filtro per categoria — SOLO visuale: nasconde le card che non appartengono
                alla categoria attiva, senza toccare schema.steps né gli indici usati
                da drag-and-drop/inserimento. Ogni card qui sotto mantiene il suo idx
                originale nell'array completo, anche quando è nascosta — è per questo
                che il filtro va fatto DENTRO il .map (return null), mai con un
                .filter() prima del .map, altrimenti idx smetterebbe di corrispondere
                alla posizione vera in schema.steps e ogni riordino/inserimento
                romperebbe silenziosamente l'ordine dei blocchi non visibili. */}
            {/* Quando l'anteprima è attiva la colonna si divide in due: editor a
                sinistra, pannello live a destra — niente quarta colonna (evita
                conflitti con PropertiesPanel, che resta a destra di tutto). */}
            <div className={showPreview ? 'flex gap-4 items-start' : ''}>
            {/* Canvas a griglia (2026-08-16) — card collassate per default, 2 per riga;
                una card espansa occupa l'intera riga (col-span-full, vedi sotto). Prima
                era una singola colonna verticale con ogni blocco sempre aperto: con
                molti blocchi era una scrollata lunga per trovarne uno. */}
            <div className={(showPreview ? 'flex-1 min-w-0 ' : '') + 'grid grid-cols-1 lg:grid-cols-2 gap-2 items-start'} {...canvasDropHandlers}>
              {schema.steps.map((step, idx) => {
                // Filtro tab: idx resta quello vero nell'array completo, si salta solo
                // il render — vedi commento sopra la barra dei tab.
                if (tab !== 'Tutti' && categoryOf(step.block_type) !== tab) return null
                const expanded = expandedSteps[step.id] ?? false
                // Corpo di editing completo del blocco — invariato per tipo, solo ora
                // "montato" solo quando la card è espansa (vedi collapse più sotto).
                const rendered = (() => {
                if (step.block_type === 'field') return (
                  <div key={step.id} {...dragHandlers(idx)}
                    className="bg-surface-card rounded-md border border-gray-800 p-4 cursor-grab active:cursor-grabbing"
                    style={{ borderLeft: '3px solid #2563EB' }}>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2 text-xs font-semibold text-gray-400">
                        <span className="text-gray-600 select-none">&#8942;&#8942;</span>
                        <Icon name="edit" size={12} /> Campo
                      </div>
                      <button onClick={() => removeStep(idx)} className="text-red-400/60 hover:text-red-400 transition"><Icon name="trash" size={14} /></button>
                    </div>
                    <div className="grid grid-cols-2 gap-3 mb-1.5">
                      <input className="w-full bg-surface-page text-ink px-3 py-2 rounded-lg text-sm outline-none border border-gray-700 focus:border-accent transition" placeholder="Label" value={step.label} onChange={(e) => updateStep(idx, 'label', e.target.value)} />
                      <select className="w-full bg-surface-page text-ink px-3 py-2 rounded-lg text-sm outline-none border border-gray-700 focus:border-accent transition" value={step.type} onChange={(e) => updateStep(idx, 'type', e.target.value)}>
                        {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <div className="mb-3">
                      {advancedKeyOpen[idx] ? (
                        <input autoFocus className="bg-surface-page text-gray-300 px-2 py-1 rounded text-xs outline-none border border-accent font-mono w-64"
                          value={step.key} onChange={(e) => handleKeyChange(idx, e.target.value)}
                          onBlur={() => setAdvancedKeyOpen((p) => ({ ...p, [idx]: false }))} />
                      ) : (
                        <button onClick={() => setAdvancedKeyOpen((p) => ({ ...p, [idx]: true }))}
                          className="text-[10px] text-gray-600 hover:text-gray-400 transition font-mono flex items-center gap-1">
                          chiave: {step.key} <Icon name="edit" size={9} />
                        </button>
                      )}
                      {keyRenameWarning[idx] && (
                        <div className="text-[10px] text-amber-400 mt-1 flex items-start gap-1">
                          <Icon name="alert-triangle" size={10} className="flex-shrink-0 mt-0.5" />{keyRenameWarning[idx]}
                        </div>
                      )}
                      <div className="text-[10px] text-gray-700 mt-0.5">Questo è il nome da usare nelle formule (es. sum_children({selected}.{step.key})) — si aggiorna da solo con la label, a meno che tu non la personalizzi qui.</div>
                    </div>
                    {(step.type === 'select' || step.type === 'multiselect') && (
                      <textarea className="w-full bg-surface-page text-ink px-3 py-2 rounded-lg text-sm outline-none border border-gray-700 focus:border-accent transition resize-none mb-3" rows={2} placeholder="Opzioni (una per riga)"
                        value={(step.options || []).join('\n')}
                        onChange={(e) => updateStep(idx, 'options', e.target.value.split('\n').filter(Boolean))} />
                    )}
                    {step.type !== 'computed' && (
                      <div className="mb-2">
                        <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer mb-1.5">
                          <input type="checkbox" checked={!!(step.visible_if && step.visible_if.enabled)}
                            onChange={(e) => updateStep(idx, 'visible_if', { ...(step.visible_if || {}), enabled: e.target.checked, field: '', op: '==', value: '' })}
                            className="accent-accent" />
                          Visibile solo se...
                        </label>
                        {step.visible_if && step.visible_if.enabled && (
                          <div className="flex items-center gap-2 flex-wrap bg-surface-page rounded-lg p-2 border border-gray-700">
                            <select className="bg-surface-card text-ink px-2 py-1.5 rounded-md text-xs outline-none border border-gray-700" value={step.visible_if.field || ''} onChange={(e) => updateStep(idx, 'visible_if', { ...step.visible_if, field: e.target.value })}>
                              <option value="">Campo...</option>
                              {schema.steps.filter((s) => s.block_type === 'field' && s.key !== step.key).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                            </select>
                            <select className="bg-surface-card text-ink px-2 py-1.5 rounded-md text-xs outline-none border border-gray-700 w-16" value={step.visible_if.op || '=='} onChange={(e) => updateStep(idx, 'visible_if', { ...step.visible_if, op: e.target.value })}>
                              <option value="==">=</option><option value="!=">≠</option>
                            </select>
                            <input className="flex-1 bg-surface-card text-ink px-2 py-1.5 rounded-md text-xs outline-none border border-gray-700" placeholder="valore atteso" value={step.visible_if.value || ''} onChange={(e) => updateStep(idx, 'visible_if', { ...step.visible_if, value: e.target.value })} />
                          </div>
                        )}
                      </div>
                    )}
                    {step.type === 'giacenza' && (
                      <div className="mb-3">
                        <div className="text-[11px] text-gray-400 mb-1.5">Locations (una per riga, formato: chiave=Etichetta)</div>
                        <textarea className="w-full bg-surface-page text-ink px-3 py-2 rounded-lg text-sm outline-none border border-gray-700 focus:border-accent transition resize-none" rows={3}
                          placeholder={'furgone_1=Furgone 1\nfurgone_2=Furgone 2\ndeposito=Deposito'}
                          value={(step.locations || []).map((l) => l.key + '=' + l.label).join('\n')}
                          onChange={(e) => updateStep(idx, 'locations', e.target.value.split('\n').filter(Boolean).map((r) => { const [k, ...rest] = r.split('='); return { key: k.trim(), label: rest.join('=').trim() || k.trim() } }))} />
                      </div>
                    )}
                    {step.type === 'soglia' && (
                      <div className="mb-3 bg-surface-page rounded-lg p-3 border border-gray-700">
                        <div className="text-[11px] text-gray-400 mb-2">Campo sorgente (numerico)</div>
                        <select className="w-full bg-surface-card text-ink px-2 py-1.5 rounded-md text-xs outline-none border border-gray-700 mb-3" value={step.source_field || ''} onChange={(e) => updateStep(idx, 'source_field', e.target.value)}>
                          <option value="">Seleziona campo...</option>
                          {schema.steps.filter((s) => s.block_type === 'field' && (s.type === 'number' || s.type === 'currency') && s.key !== step.key).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                        </select>
                        <div className="text-[11px] text-gray-400 mb-1.5">Fasce — "fino" è il limite superiore della fascia (vuoto = terminale), "tasso" è l'aliquota (0.23 = 23%)</div>
                        <div className="space-y-1.5 mb-2">
                          {(step.scaglioni || []).map((s, si) => (
                            <div key={si} className="flex items-center gap-2">
                              <input type="number" placeholder="fino a" value={s.fino ?? ''} onChange={(e) => {
                                const nuovi = [...(step.scaglioni || [])]
                                if (e.target.value === '') { const c = { ...nuovi[si] }; delete c.fino; nuovi[si] = c }
                                else nuovi[si] = { ...nuovi[si], fino: parseFloat(e.target.value) }
                                updateStep(idx, 'scaglioni', nuovi)
                              }} className="w-28 bg-surface-card text-ink px-2 py-1.5 rounded text-xs border border-gray-700 outline-none" />
                              <input type="number" placeholder="tasso" step="0.01" value={s.tasso ?? ''} onChange={(e) => {
                                const nuovi = [...(step.scaglioni || [])]
                                nuovi[si] = { ...nuovi[si], tasso: parseFloat(e.target.value) || 0 }
                                updateStep(idx, 'scaglioni', nuovi)
                              }} className="w-24 bg-surface-card text-ink px-2 py-1.5 rounded text-xs border border-gray-700 outline-none" />
                              <button onClick={() => updateStep(idx, 'scaglioni', (step.scaglioni || []).filter((_, i) => i !== si))} className="text-red-400/50 hover:text-red-400 transition"><Icon name="x" size={11} /></button>
                            </div>
                          ))}
                        </div>
                        <button onClick={() => updateStep(idx, 'scaglioni', [...(step.scaglioni || []), { tasso: 0 }])} className="text-xs text-accent hover:opacity-80 transition flex items-center gap-1">
                          <Icon name="plus" size={11} />Aggiungi fascia
                        </button>
                      </div>
                    )}
                    {step.type === 'soglia_data' && (
                      <div className="mb-3 bg-surface-page rounded-lg p-3 border border-gray-700 space-y-2">
                        <div>
                          <div className="text-[11px] text-gray-400 mb-1">Campo data sorgente</div>
                          <select className="w-full bg-surface-card text-ink px-2 py-1.5 rounded-md text-xs outline-none border border-gray-700" value={step.source_date_field || ''} onChange={(e) => updateStep(idx, 'source_date_field', e.target.value)}>
                            <option value="">Seleziona campo data...</option>
                            {schema.steps.filter((s) => s.block_type === 'field' && (s.type === 'date' || s.type === 'datetime') && s.key !== step.key).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                          </select>
                        </div>
                        <div>
                          <div className="text-[11px] text-gray-400 mb-1">Tipo condizione</div>
                          <select className="w-full bg-surface-card text-ink px-2 py-1.5 rounded-md text-xs outline-none border border-gray-700" value={step.tipo || 'giorno_mese'} onChange={(e) => updateStep(idx, 'tipo', e.target.value)}>
                            <option value="giorno_mese">Giorno del mese (es. dal 27 in poi)</option>
                            <option value="range_date">Intervallo di date ricorrente</option>
                            <option value="giorno_settimana">Giorno della settimana</option>
                            <option value="fine_mese_offset">N giorni da fine mese</option>
                          </select>
                        </div>
                        {(step.tipo === 'giorno_mese' || !step.tipo) && (
                          <div>
                            <div className="text-[11px] text-gray-400 mb-1">Soglia (giorno del mese, 1–31)</div>
                            <input type="number" min="1" max="31" className="w-20 bg-surface-card text-ink px-2 py-1.5 rounded-md text-xs outline-none border border-gray-700" value={step.soglia ?? 27} onChange={(e) => updateStep(idx, 'soglia', parseInt(e.target.value) || 27)} />
                          </div>
                        )}
                        {step.tipo === 'fine_mese_offset' && (
                          <div>
                            <div className="text-[11px] text-gray-400 mb-1">Offset (N giorni da fine mese)</div>
                            <input type="number" min="1" className="w-20 bg-surface-card text-ink px-2 py-1.5 rounded-md text-xs outline-none border border-gray-700" value={step.offset ?? 5} onChange={(e) => updateStep(idx, 'offset', parseInt(e.target.value) || 5)} />
                          </div>
                        )}
                        {step.tipo === 'giorno_settimana' && (
                          <div>
                            <div className="text-[11px] text-gray-400 mb-1">Giorni (separati da virgola: lunedi, martedi...)</div>
                            <input className="w-full bg-surface-card text-ink px-2 py-1.5 rounded-md text-xs outline-none border border-gray-700" placeholder="lunedi, mercoledi, venerdi" value={(step.giorni || []).join(', ')} onChange={(e) => updateStep(idx, 'giorni', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))} />
                          </div>
                        )}
                        {step.tipo === 'range_date' && (
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <div className="text-[10px] text-gray-500 mb-0.5">Inizio (mese/giorno)</div>
                              <div className="flex gap-1">
                                <input type="number" min="1" max="12" placeholder="mese" className="w-14 bg-surface-card text-ink px-2 py-1 rounded text-xs border border-gray-700 outline-none" value={step.inizio_mese ?? ''} onChange={(e) => updateStep(idx, 'inizio_mese', parseInt(e.target.value) || 1)} />
                                <input type="number" min="1" max="31" placeholder="gg" className="w-12 bg-surface-card text-ink px-2 py-1 rounded text-xs border border-gray-700 outline-none" value={step.inizio_giorno ?? ''} onChange={(e) => updateStep(idx, 'inizio_giorno', parseInt(e.target.value) || 1)} />
                              </div>
                            </div>
                            <div>
                              <div className="text-[10px] text-gray-500 mb-0.5">Fine (mese/giorno)</div>
                              <div className="flex gap-1">
                                <input type="number" min="1" max="12" placeholder="mese" className="w-14 bg-surface-card text-ink px-2 py-1 rounded text-xs border border-gray-700 outline-none" value={step.fine_mese ?? ''} onChange={(e) => updateStep(idx, 'fine_mese', parseInt(e.target.value) || 1)} />
                                <input type="number" min="1" max="31" placeholder="gg" className="w-12 bg-surface-card text-ink px-2 py-1 rounded text-xs border border-gray-700 outline-none" value={step.fine_giorno ?? ''} onChange={(e) => updateStep(idx, 'fine_giorno', parseInt(e.target.value) || 1)} />
                              </div>
                            </div>
                          </div>
                        )}
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <div className="text-[10px] text-gray-500 mb-0.5">Se vero</div>
                            <input className="w-full bg-surface-card text-ink px-2 py-1.5 rounded-md text-xs outline-none border border-gray-700" placeholder="mese_successivo" value={step.se_vero || ''} onChange={(e) => updateStep(idx, 'se_vero', e.target.value)} />
                          </div>
                          <div>
                            <div className="text-[10px] text-gray-500 mb-0.5">Se falso</div>
                            <input className="w-full bg-surface-card text-ink px-2 py-1.5 rounded-md text-xs outline-none border border-gray-700" placeholder="mese_corrente" value={step.se_falso || ''} onChange={(e) => updateStep(idx, 'se_falso', e.target.value)} />
                          </div>
                        </div>
                        <div className="text-[10px] text-gray-600">Valori tipici: mese_corrente, mese_successivo, mese_precedente — o qualunque etichetta personalizzata.</div>
                      </div>
                    )}
                    {step.type === 'computed' && (
                      <div className="mb-3">
                        <div className="flex items-center gap-1 mb-2">
                          {['testo', 'blocchi'].map((m) => (
                            <button key={m} type="button"
                              onClick={() => switchFormulaMode(idx, m, updateStep, idx)}
                              className={'text-[11px] px-2.5 py-1 rounded-md transition ' + (getFormulaMode(idx, step) === m ? 'bg-accent/20 text-accent' : 'text-gray-500 hover:text-gray-300')}>
                              {m === 'testo' ? 'Testo' : 'Blocchi'}
                            </button>
                          ))}
                        </div>
                        {getFormulaMode(idx, step) === 'blocchi' ? (
                          <div className="pl-3 border-l-2 border-dashed border-gray-700 ml-1">
                            <div className="text-[10px] text-gray-600 mb-1.5 flex items-center gap-1">
                              <Icon name="corner-down-right" size={10} />diramazione di "{step.label || 'questo campo'}"
                            </div>
                            <StepChainEditor
                              steps={step.steps || []}
                              onChange={(v) => updateStep(idx, 'steps', v)}
                              fieldCache={fieldCache}
                              api={api}
                              context={{ currentModule: selected }}
                            />
                          </div>
                        ) : (
                          <FormulaEditor
                            value={step.expr || ''}
                            onChange={(v) => updateStep(idx, 'expr', v)}
                            fieldCache={fieldCache}
                            api={api}
                            context={{ currentModule: selected }}
                          />
                        )}
                        <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer mt-2.5 pt-2.5 border-t border-gray-800">
                          <input type="checkbox" checked={step.live || false} onChange={(e) => updateStep(idx, 'live', e.target.checked)} className="accent-accent" />
                          Valuta durante la compilazione (dal vivo)
                        </label>
                        {step.live && (
                          <div className="text-[10px] text-gray-700 mt-1">Ricalcolato a ogni modifica del form, anche prima di salvare — utile per un campo che deve produrre un vero/falso (con un passaggio "Confronta") da mostrare mentre si compila. Non blocca il salvataggio: quello resta una scelta separata, non ancora costruita.</div>
                        )}
                      </div>
                    )}
                    {step.type !== 'computed' && step.type !== 'soglia_data' && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-4 flex-wrap">
                          <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
                            <input type="checkbox" checked={step.required || false} onChange={(e) => updateStep(idx, 'required', e.target.checked)} className="accent-accent" />Obbligatorio
                          </label>
                          <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
                            <input type="checkbox" checked={step.unique || false} onChange={(e) => updateStep(idx, 'unique', e.target.checked)} className="accent-accent" />Univoco
                          </label>
                          <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
                            <input type="checkbox" checked={step.show_in_list !== false} onChange={(e) => updateStep(idx, 'show_in_list', e.target.checked)} className="accent-accent" />In lista
                          </label>
                          {step.type === 'select' && (
                            <label className="flex items-center gap-2 text-xs text-accent cursor-pointer" title="Mostra i valori come tab di filtro sopra la lista">
                              <input type="checkbox" checked={step.filter_tab || false} onChange={(e) => updateStep(idx, 'filter_tab', e.target.checked)} className="accent-accent" />Tab filtro
                            </label>
                          )}
                          {(step.type === 'date' || step.type === 'datetime') && (
                            <label className="flex items-center gap-2 text-xs text-accent cursor-pointer" title="Mostra navigazione mese/anno sopra la lista (con regola del 27)">
                              <input type="checkbox" checked={step.date_nav || false} onChange={(e) => updateStep(idx, 'date_nav', e.target.checked)} className="accent-accent" />Nav. mese
                            </label>
                          )}
                          {(step.type === 'date' || step.type === 'datetime') && (
                            <label className="flex items-center gap-2 text-xs text-amber-400 cursor-pointer" title="Se questo modulo ha una coppia di stati a interruttore (es. da_pagare/pagato), colora il cerchio di conferma rapida in tabella per urgenza rispetto a questa data">
                              <input type="checkbox" checked={step.scadenza || false} onChange={(e) => updateStep(idx, 'scadenza', e.target.checked)} className="accent-amber-500" />Scadenza
                            </label>
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          {['text','email','phone','url','textarea','number','currency','select','date','datetime'].includes(step.type) && (
                            <div>
                              <label className="text-[10px] text-gray-600 block mb-0.5">Placeholder</label>
                              <input className="w-full bg-surface-page text-gray-300 px-2 py-1 rounded text-xs outline-none border border-gray-700 focus:border-accent transition placeholder-gray-700"
                                placeholder="Testo guida nel campo..."
                                value={step.placeholder || ''} onChange={(e) => updateStep(idx, 'placeholder', e.target.value)} />
                            </div>
                          )}
                          {!['file','mappa','giacenza','encrypted','checkbox','soglia','soglia_data'].includes(step.type) && (
                            <div>
                              <label className="text-[10px] text-gray-600 block mb-0.5">Valore predefinito{step.type === 'date' ? ' (_today_ = oggi)' : step.type === 'datetime' ? ' (_now_ = adesso)' : ''}</label>
                              <input className="w-full bg-surface-page text-gray-300 px-2 py-1 rounded text-xs outline-none border border-gray-700 focus:border-accent transition placeholder-gray-700"
                                placeholder={step.type === 'date' ? '_today_' : step.type === 'datetime' ? '_now_' : 'default...'}
                                value={step.default_value || ''} onChange={(e) => updateStep(idx, 'default_value', e.target.value)} />
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )

                if (step.block_type === 'relation') return (
                  <div key={step.id} {...dragHandlers(idx)}
                    className="bg-surface-card rounded-md border border-gray-800 p-4 cursor-grab active:cursor-grabbing"
                    style={{ borderLeft: '3px solid #7C3AED' }}>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2 text-xs font-semibold text-gray-400">
                        <span className="text-gray-600 select-none">&#8942;&#8942;</span>
                        <Icon name="link" size={12} /> Relazione
                      </div>
                      <button onClick={() => removeStep(idx)} className="text-red-400/60 hover:text-red-400 transition"><Icon name="trash" size={14} /></button>
                    </div>
                    <div className="flex items-center gap-3 mb-1.5">
                      <input className="flex-1 bg-surface-page text-ink px-3 py-2 rounded-lg text-sm outline-none border border-gray-700 focus:border-accent transition" placeholder="Label (es. Cliente)" value={step.label} onChange={(e) => updateStep(idx, 'label', e.target.value)} />
                      <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer whitespace-nowrap">
                        <input type="checkbox" checked={step.show_in_list !== false} onChange={(e) => updateStep(idx, 'show_in_list', e.target.checked)} className="accent-accent" />In lista
                      </label>
                    </div>
                    <div className="mb-2">
                      {advancedKeyOpen[idx] ? (
                        <input autoFocus className="bg-surface-page text-gray-300 px-2 py-1 rounded text-xs outline-none border border-accent font-mono w-64"
                          value={step.key} onChange={(e) => handleKeyChange(idx, e.target.value)}
                          onBlur={() => setAdvancedKeyOpen((p) => ({ ...p, [idx]: false }))} />
                      ) : (
                        <button onClick={() => setAdvancedKeyOpen((p) => ({ ...p, [idx]: true }))}
                          className="text-[10px] text-gray-600 hover:text-gray-400 transition font-mono flex items-center gap-1">
                          chiave: {step.key} <Icon name="edit" size={9} />
                        </button>
                      )}
                      {keyRenameWarning[idx] && (
                        <div className="text-[10px] text-amber-400 mt-1 flex items-start gap-1">
                          <Icon name="alert-triangle" size={10} className="flex-shrink-0 mt-0.5" />{keyRenameWarning[idx]}
                        </div>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <select className="w-full bg-surface-page text-ink px-3 py-2 rounded-lg text-sm outline-none border border-gray-700 focus:border-accent transition" value={step.target_module} onChange={(e) => updateStep(idx, 'target_module', e.target.value)}>
                        <option value="">Modulo target...</option>
                        {otherModules.map((m) => <option key={m.slug} value={m.slug}>{m.name}</option>)}
                      </select>
                      <select className="w-full bg-surface-page text-ink px-3 py-2 rounded-lg text-sm outline-none border border-gray-700 focus:border-accent transition" value={step.type} onChange={(e) => updateStep(idx, 'type', e.target.value)}>
                        <option value="many_to_one">Molti a uno (FK)</option>
                        <option value="one_to_many">Uno a molti</option>
                        <option value="many_to_many">Molti a molti</option>
                      </select>
                    </div>
                    {step.target_module && (
                      <div className="mt-3">
                        <label className="text-xs text-gray-500 block mb-1.5">Campo da mostrare (di {(fieldCache.find((m) => m.slug === step.target_module) || {}).name || step.target_module})</label>
                        <select className="w-full bg-surface-page text-ink px-3 py-2 rounded-lg text-sm outline-none border border-gray-700 focus:border-accent transition"
                          value={step.display_field || ''} onChange={(e) => updateStep(idx, 'display_field', e.target.value)}>
                          <option value="">Seleziona campo...</option>
                          {(fieldCache.find((m) => m.slug === step.target_module)?.fields || []).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                        </select>
                        <div className="text-[10px] text-gray-600 mt-1">Il valore mostrato per ogni riferimento a questa relazione, es. il nome del cliente invece del suo id.</div>

                        <div className="mt-3 pt-3 border-t border-gray-800">
                          <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
                            <input type="checkbox" checked={step.display_mode === 'embedded_inline'}
                              onChange={(e) => updateStep(idx, 'display_mode', e.target.checked ? 'embedded_inline' : 'tab')}
                              className="accent-accent" />
                            Righe integrate nel form del modulo padre (invece di selettore singolo)
                          </label>
                          <div className="text-[10px] text-gray-600 mt-1 pl-6">Usa questa opzione sul lato "molti" della relazione — es. su Righe Ordine → Ordine, non su Ordine → Cliente. Nel form di creazione di {(fieldCache.find((m) => m.slug === step.target_module) || {}).name || 'del modulo target'} comparirà una mini-tabella per aggiungere questi record senza uscire dalla pagina.</div>
                        </div>

                        <div className="mt-3 pt-3 border-t border-gray-800">
                          <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer mb-2">
                            <input type="checkbox" checked={!!(step.quick_create && step.quick_create.enabled)}
                              onChange={(e) => updateStep(idx, 'quick_create', { ...(step.quick_create || {}), enabled: e.target.checked, roles: (step.quick_create && step.quick_create.roles) || ['admin'], fields_subset: (step.quick_create && step.quick_create.fields_subset) || [] })}
                              className="accent-accent" />
                            Consenti creazione al volo (+ Nuovo dal selettore)
                          </label>
                          {step.quick_create && step.quick_create.enabled && (
                            <div className="pl-1 space-y-2">
                              <div>
                                <div className="text-[10px] text-gray-600 mb-1">Ruoli abilitati</div>
                                <div className="flex gap-3 flex-wrap">
                                  {allRoles.map((role) => (
                                    <label key={role.name} className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer">
                                      <input type="checkbox" checked={(step.quick_create.roles || []).includes(role.name)}
                                        onChange={(e) => {
                                          const current = step.quick_create.roles || []
                                          const next = e.target.checked ? [...current, role.name] : current.filter((x) => x !== role.name)
                                          updateStep(idx, 'quick_create', { ...step.quick_create, roles: next })
                                        }} className="accent-accent" />
                                      {role.label}
                                    </label>
                                  ))}
                                </div>
                              </div>
                              <div>
                                <div className="text-[10px] text-gray-600 mb-1">Campi nel mini-form (vuoto = tutti i campi del modulo target)</div>
                                <div className="flex flex-wrap gap-2">
                                  {(fieldCache.find((m) => m.slug === step.target_module)?.fields || []).map((f) => (
                                    <label key={f.key} className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer bg-surface-page px-2 py-1 rounded-lg border border-gray-800">
                                      <input type="checkbox" checked={(step.quick_create.fields_subset || []).includes(f.key)}
                                        onChange={(e) => {
                                          const current = step.quick_create.fields_subset || []
                                          const next = e.target.checked ? [...current, f.key] : current.filter((x) => x !== f.key)
                                          updateStep(idx, 'quick_create', { ...step.quick_create, fields_subset: next })
                                        }} className="accent-accent" />
                                      {f.label}
                                    </label>
                                  ))}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {step.type === 'many_to_many' && (
                      <div className="mt-3 pt-3 border-t border-gray-800">
                        <div className="text-xs text-gray-400 mb-1.5">Attributi del link (es. prezzo, sconto)</div>
                        <textarea className="w-full bg-surface-page text-ink px-3 py-2 rounded-lg text-sm outline-none border border-gray-700 focus:border-accent transition resize-none" rows={2}
                          placeholder={'prezzo=Prezzo\nsconto=Sconto %'}
                          value={(step.attributes || []).map((a) => a.key + '=' + a.label).join('\n')}
                          onChange={(e) => updateStep(idx, 'attributes', e.target.value.split('\n').filter(Boolean).map((r) => { const [k, ...rest] = r.split('='); return { key: k.trim(), label: rest.join('=').trim() || k.trim() } }))} />
                      </div>
                    )}
                    {step.target_module && (
                      <div className="mt-3 pt-3 border-t border-gray-800">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs text-gray-400">Filtro record mostrati</span>
                          <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
                            <input type="checkbox" checked={!!(step.filter && step.filter.enabled)}
                              onChange={(e) => updateStep(idx, 'filter', { ...(step.filter || {}), enabled: e.target.checked, field: '', op: '==', value: '' })}
                              className="accent-accent" />
                            Attivo
                          </label>
                        </div>
                        {step.filter && step.filter.enabled && (
                          <div className="flex items-center gap-2 flex-wrap bg-surface-page rounded-lg p-2 border border-gray-700">
                            <select className="bg-surface-card text-ink px-2 py-1.5 rounded-md text-xs outline-none border border-gray-700" value={step.filter.field || ''} onChange={(e) => updateStep(idx, 'filter', { ...step.filter, field: e.target.value })}>
                              <option value="">Campo...</option>
                              {(fieldCache.find((m) => m.slug === step.target_module)?.fields || []).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                            </select>
                            <select className="bg-surface-card text-ink px-2 py-1.5 rounded-md text-xs outline-none border border-gray-700 w-16" value={step.filter.op || '=='} onChange={(e) => updateStep(idx, 'filter', { ...step.filter, op: e.target.value })}>
                              <option value="==">=</option><option value="!=">≠</option>
                              <option value=">">&gt;</option><option value="<">&lt;</option>
                            </select>
                            <input className="flex-1 bg-surface-card text-ink px-2 py-1.5 rounded-md text-xs outline-none border border-gray-700" placeholder="valore..." value={step.filter.value || ''} onChange={(e) => updateStep(idx, 'filter', { ...step.filter, value: e.target.value })} />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )

                // Stato workflow — ora un blocco a sé nell'elenco unico, non più annidato
                // dentro un'unica card "Workflow". Le Transizioni (sotto) leggono la lista
                // di stati filtrando schema.steps, non da un oggetto workflow separato.
                if (step.block_type === 'workflow_state') return (
                  <div key={step.id} {...dragHandlers(idx)}
                    className="bg-surface-card rounded-md border border-gray-800 p-4 cursor-grab active:cursor-grabbing"
                    style={{ borderLeft: '3px solid #10B981' }}>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2 text-xs font-semibold text-gray-400">
                        <span className="text-gray-600 select-none">&#8942;&#8942;</span>
                        <Icon name="git-branch" size={12} /> Stato workflow
                      </div>
                      <button onClick={() => removeStep(idx)} className="text-red-400/60 hover:text-red-400 transition"><Icon name="trash" size={14} /></button>
                    </div>
                    <div className="flex items-end gap-3 mb-2">
                      <div className="flex-shrink-0">
                        <label className="text-[10px] text-gray-500 block mb-1">Colore</label>
                        <input type="color" value={step.color} onChange={(e) => updateStep(idx, 'color', e.target.value)} className="w-10 h-10 rounded-lg cursor-pointer border border-gray-700 bg-transparent" />
                      </div>
                      <div className="flex-1">
                        <label className="text-[10px] text-gray-500 block mb-1">Nome dello stato</label>
                        <input className="w-full bg-surface-page text-ink px-3 py-2 rounded-lg text-sm outline-none border border-gray-700 focus:border-accent transition placeholder-gray-600" placeholder="es. Confermato, Spedito, Annullato" value={step.label} onChange={(e) => updateStep(idx, 'label', e.target.value)} />
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      {advancedKeyOpen['wst' + idx] ? (
                        <input autoFocus className="bg-surface-page text-gray-300 px-2 py-1 rounded text-xs outline-none border border-accent font-mono w-56"
                          value={step.key} onChange={(e) => handleKeyChange(idx, e.target.value)}
                          onBlur={() => setAdvancedKeyOpen((p) => ({ ...p, ['wst' + idx]: false }))} />
                      ) : (
                        <button onClick={() => setAdvancedKeyOpen((p) => ({ ...p, ['wst' + idx]: true }))}
                          className="text-[10px] text-gray-600 hover:text-gray-400 transition font-mono flex items-center gap-1">
                          <Icon name="edit" size={9} />{step.key}
                        </button>
                      )}
                      <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer whitespace-nowrap" title="Lo stato con cui parte un record appena creato">
                        <input type="checkbox" checked={step.initial || false} onChange={(e) => updateStep(idx, 'initial', e.target.checked)} className="accent-accent" />
                        Stato di partenza per un nuovo record
                      </label>
                    </div>
                    {keyRenameWarning[idx] && (
                      <div className="text-[10px] text-amber-400 mt-1 flex items-start gap-1">
                        <Icon name="alert-triangle" size={10} className="flex-shrink-0 mt-0.5" />{keyRenameWarning[idx]}
                      </div>
                    )}
                  </div>
                )

                if (step.block_type === 'workflow_transition') {
                  const allStates = schema.steps.filter((s) => s.block_type === 'workflow_state')
                  const roles = step.roles || []
                  return (
                    <div key={step.id} {...dragHandlers(idx)}
                      className="bg-surface-card rounded-md border border-gray-800 p-4 cursor-grab active:cursor-grabbing"
                      style={{ borderLeft: '3px solid #10B981' }}>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2 text-xs font-semibold text-gray-400">
                          <span className="text-gray-600 select-none">&#8942;&#8942;</span>
                          <Icon name="git-branch" size={12} /> Transizione workflow
                        </div>
                        <button onClick={() => removeStep(idx)} className="text-red-400/60 hover:text-red-400 transition"><Icon name="trash" size={14} /></button>
                      </div>
                      {allStates.length < 2 && (
                        <div className="text-[11px] text-amber-500 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 mb-3">Servono almeno due blocchi "Stato workflow" prima di poter configurare questa transizione.</div>
                      )}
                      <div className="grid grid-cols-3 gap-2 items-end mb-3">
                        <div>
                          <label className="text-[10px] text-gray-500 block mb-1">Da stato</label>
                          <select className="w-full bg-surface-page text-ink px-2 py-2 rounded-lg text-xs outline-none border border-gray-700 focus:border-accent transition" value={step.from} onChange={(e) => updateStep(idx, 'from', e.target.value)}>
                            <option value="">Seleziona...</option>
                            {allStates.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                          </select>
                        </div>
                        <div className="flex flex-col items-center text-gray-600 pb-2">
                          <Icon name="arrow-up" size={14} className="rotate-90" />
                        </div>
                        <div>
                          <label className="text-[10px] text-gray-500 block mb-1">A stato</label>
                          <select className="w-full bg-surface-page text-ink px-2 py-2 rounded-lg text-xs outline-none border border-gray-700 focus:border-accent transition" value={step.to} onChange={(e) => updateStep(idx, 'to', e.target.value)}>
                            <option value="">Seleziona...</option>
                            {allStates.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                          </select>
                        </div>
                      </div>
                      <div className="mb-3">
                        <label className="text-[10px] text-gray-500 block mb-1">Nome dell'azione (il pulsante che l'utente clicca)</label>
                        <input className="w-full bg-surface-page text-ink px-3 py-2 rounded-lg text-sm outline-none border border-gray-700 focus:border-accent transition placeholder-gray-600" placeholder="es. Conferma ordine, Segna come spedito" value={step.label} onChange={(e) => updateStep(idx, 'label', e.target.value)} />
                      </div>
                      <div>
                        <label className="text-[10px] text-gray-500 block mb-1.5">Ruoli che possono fare questa transizione</label>
                        <div className="flex gap-3 flex-wrap">
                          {allRoles.map(({ name: role, label: roleLabel }) => (
                            <label key={role} className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer">
                              <input type="checkbox" checked={roles.includes(role)}
                                onChange={(e) => updateStep(idx, 'roles', e.target.checked ? [...roles, role] : roles.filter((r) => r !== role))}
                                className="accent-accent" />
                              {roleLabel}
                            </label>
                          ))}
                        </div>
                        {roles.length === 0 && <div className="text-[10px] text-amber-500 mt-1">Nessun ruolo selezionato — questa transizione non sarà disponibile a nessuno.</div>}
                      </div>
                      {(() => {
                        const val = step.validazione || null
                        const tipo = !val ? 'nessuna' : (val.relazione_check ? 'relazione' : 'formula')
                        const setVal = (patch) => updateStep(idx, 'validazione', { ...(step.validazione || {}), ...patch })
                        const clearVal = () => updateStep(idx, 'validazione', undefined)
                        const setTipo = (t) => {
                          if (t === 'nessuna') { clearVal(); return }
                          if (t === 'formula') { updateStep(idx, 'validazione', { expr: '', messaggio: '' }); return }
                          updateStep(idx, 'validazione', { relazione_check: { relazione: '', modulo_relazionato: '', campo_relazionato: '', campo_corrente: '', op: '<=' }, messaggio: '' })
                        }
                        const rc = (val && val.relazione_check) || {}
                        const setRc = (patch) => setVal({ relazione_check: { ...rc, ...patch } })
                        return (
                          <div className="mt-3 pt-3 border-t border-gray-800">
                            <label className="text-[10px] text-gray-500 block mb-1.5">Validazione bloccante (opzionale) — se non soddisfatta, la transizione viene rifiutata</label>
                            <select className="w-full bg-surface-page text-ink px-2 py-2 rounded-lg text-xs outline-none border border-gray-700 focus:border-accent transition mb-2"
                              value={tipo} onChange={(e) => setTipo(e.target.value)}>
                              <option value="nessuna">Nessuna</option>
                              <option value="formula">Formula (come nei campi computed)</option>
                              <option value="relazione">Confronto con un record collegato</option>
                            </select>
                            {tipo === 'formula' && (
                              <div className="space-y-2 bg-surface-page rounded-lg p-2.5 border border-gray-700">
                                <div>
                                  <label className="text-[10px] text-gray-500 block mb-1">Espressione (deve risultare vero/falso)</label>
                                  <input className="w-full bg-surface-card text-ink px-2 py-1.5 rounded-md text-xs outline-none border border-gray-700 font-mono placeholder-gray-600"
                                    placeholder="es. sum_children(movimenti_righe.dare) == sum_children(movimenti_righe.avere)"
                                    value={val.expr || ''} onChange={(e) => setVal({ expr: e.target.value })} />
                                </div>
                                <div>
                                  <label className="text-[10px] text-gray-500 block mb-1">Messaggio se bloccata</label>
                                  <input className="w-full bg-surface-card text-ink px-2 py-1.5 rounded-md text-xs outline-none border border-gray-700 placeholder-gray-600"
                                    placeholder="es. Il movimento non è in pareggio" value={val.messaggio || ''} onChange={(e) => setVal({ messaggio: e.target.value })} />
                                </div>
                                <div className="text-[10px] text-gray-600">Nota: un campo qui riferito per nome dev'essere un campo numerico proprio (non un altro campo computed) — per aggregazioni sui figli usa direttamente sum_children(modulo.campo) nell'espressione, non il nome del campo computed che lo incapsula.</div>
                              </div>
                            )}
                            {tipo === 'relazione' && (
                              <div className="space-y-2 bg-surface-page rounded-lg p-2.5 border border-gray-700">
                                <Riga2 label="Relazione" placeholder="campo relazione sul record corrente (es. materia_prima)" value={rc.relazione} onChange={(v) => setRc({ relazione: v })} />
                                <Riga2 label="Modulo collegato" placeholder="es. magazzino_verde" value={rc.modulo_relazionato} onChange={(v) => setRc({ modulo_relazionato: v })} />
                                <Riga2 label="Campo collegato" placeholder="campo sul record collegato (es. quantita_kg)" value={rc.campo_relazionato} onChange={(v) => setRc({ campo_relazionato: v })} />
                                <Riga2 label="Campo corrente" placeholder="campo sul record corrente da confrontare (es. quantita_verde_kg)" value={rc.campo_corrente} onChange={(v) => setRc({ campo_corrente: v })} />
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] text-gray-500 w-28 flex-shrink-0">Operatore</span>
                                  <select className="bg-surface-card text-ink px-2 py-1.5 rounded-md text-xs outline-none border border-gray-700 w-20" value={rc.op || '<='} onChange={(e) => setRc({ op: e.target.value })}>
                                    <option value="<=">&le;</option><option value=">=">&ge;</option>
                                    <option value="<">&lt;</option><option value=">">&gt;</option>
                                    <option value="==">=</option><option value="!=">&ne;</option>
                                  </select>
                                  <span className="text-[10px] text-gray-600">campo corrente {rc.op || '<='} campo collegato</span>
                                </div>
                                <div>
                                  <label className="text-[10px] text-gray-500 block mb-1">Messaggio se bloccata</label>
                                  <input className="w-full bg-surface-card text-ink px-2 py-1.5 rounded-md text-xs outline-none border border-gray-700 placeholder-gray-600"
                                    placeholder="es. Kg richiesti superano la giacenza disponibile" value={val.messaggio || ''} onChange={(e) => setVal({ messaggio: e.target.value })} />
                                </div>
                              </div>
                            )}
                          </div>
                        )
                      })()}
                    </div>
                  )
                }

                if (step.block_type === 'permissions') {
                  const rules = step.rules || []
                  const ruleFor = (roleKey) => rules.find((r) => r.role === roleKey) || { role: roleKey, view: true, view_own_only: false, owner_field: '', create: true, edit: true, delete: true }
                  const updateRule = (roleKey, patch) => {
                    const current = ruleFor(roleKey)
                    const next = { ...current, ...patch }
                    const others = rules.filter((r) => r.role !== roleKey)
                    updateStep(idx, 'rules', [...others, next])
                  }
                  return (
                    <div key={step.id} {...dragHandlers(idx)}
                      className="bg-surface-card rounded-md border border-gray-800 p-4 cursor-grab active:cursor-grabbing"
                      style={{ borderLeft: '3px solid #FFB84D' }}>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2 text-xs font-semibold text-gray-400">
                          <span className="text-gray-600 select-none">&#8942;&#8942;</span>
                          <Icon name="eye" size={12} /> Permessi
                        </div>
                        <button onClick={() => removeStep(idx)} className="text-red-400/60 hover:text-red-400 transition"><Icon name="trash" size={14} /></button>
                      </div>
                      <div className="text-[10px] text-gray-600 mb-3">Chi può vedere, creare, modificare, eliminare i record di questo modulo. Nessuna riga configurata = nessuna restrizione (comportamento invariato).</div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-gray-500">
                              <th className="text-left font-medium pb-2">Ruolo</th>
                              <th className="text-center font-medium pb-2">Vedi</th>
                              <th className="text-center font-medium pb-2">Solo i propri</th>
                              <th className="text-left font-medium pb-2 pl-2">Campo proprietario</th>
                              <th className="text-left font-medium pb-2 pl-2">Nome nel menu</th>
                              <th className="text-center font-medium pb-2">Crea</th>
                              <th className="text-center font-medium pb-2">Modifica</th>
                              <th className="text-center font-medium pb-2">Elimina</th>
                            </tr>
                          </thead>
                          <tbody>
                            {allRoles.map((role) => {
                              const r = ruleFor(role.name)
                              return (
                                <tr key={role.name} className="border-t border-gray-800">
                                  <td className="py-2 text-gray-300">{role.label}</td>
                                  <td className="text-center py-2">
                                    <input type="checkbox" checked={!!r.view}
                                      onChange={(e) => updateRule(role.name, { view: e.target.checked })} className="accent-accent" />
                                  </td>
                                  <td className="text-center py-2">
                                    <input type="checkbox" checked={!!r.view_own_only} disabled={!r.view}
                                      onChange={(e) => updateRule(role.name, { view_own_only: e.target.checked })} className="accent-accent" />
                                  </td>
                                  <td className="py-2 pl-2">
                                    <input type="text" disabled={!r.view_own_only} placeholder="es. agente"
                                      className="w-24 bg-surface-page text-ink px-1.5 py-1 rounded text-[11px] outline-none border border-gray-700 focus:border-accent transition disabled:opacity-40 placeholder-gray-700"
                                      value={r.owner_field || ''} onChange={(e) => updateRule(role.name, { owner_field: e.target.value })} />
                                  </td>
                                  <td className="py-2 pl-2">
                                    <input type="text" placeholder="es. I miei ordini"
                                      className="w-28 bg-surface-page text-ink px-1.5 py-1 rounded text-[11px] outline-none border border-gray-700 focus:border-accent transition placeholder-gray-700"
                                      value={r.label_override || ''} onChange={(e) => updateRule(role.name, { label_override: e.target.value })} />
                                  </td>
                                  {['create', 'edit', 'delete'].map((action) => (
                                    <td key={action} className="text-center py-2">
                                      <input type="checkbox" checked={!!r[action]}
                                        onChange={(e) => updateRule(role.name, { [action]: e.target.checked })} className="accent-accent" />
                                    </td>
                                  ))}
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                      <div className="text-[10px] text-gray-600 mt-2">"Solo i propri" senza campo proprietario filtra su chi ha creato il record. Con un campo proprietario (es. una relazione "agente"), filtra invece sui record il cui campo punta al record collegato all'utente (Utenti → Record collegato) — utile per ruoli come "Agente" che devono vedere i dati assegnati a loro, non solo quelli creati da loro. "Nome nel menu" (opzionale) sostituisce il nome del modulo in sidebar solo per questo ruolo, es. "Ordini" → "I miei ordini" per l'Agente.</div>
                    </div>
                  )
                }

                if (step.block_type === 'validazione_creazione') return (
                  <div key={step.id} {...dragHandlers(idx)}
                    className="bg-surface-card rounded-md border border-gray-800 p-4 cursor-grab active:cursor-grabbing"
                    style={{ borderLeft: '3px solid #F97316' }}>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2 text-xs font-semibold text-gray-400">
                        <span className="text-gray-600 select-none">&#8942;&#8942;</span>
                        <Icon name="shield" size={12} /> Validazione creazione
                      </div>
                      <button onClick={() => removeStep(idx)} className="text-red-400/60 hover:text-red-400 transition"><Icon name="trash" size={14} /></button>
                    </div>
                    <div className="text-[10px] text-gray-600 mb-3">Se la condizione qui sotto non è soddisfatta, la creazione di un nuovo record viene rifiutata (stessa sintassi dei campi Formula/Aggregato — es. "campo:quantita &gt; 0"). Vuota = nessun blocco.</div>
                    <div className="mb-3">
                      <label className="text-[10px] text-gray-500 block mb-1">Condizione</label>
                      <input className="w-full bg-surface-page text-ink px-3 py-2 rounded-lg text-xs outline-none border border-gray-700 focus:border-orange-500 transition font-mono placeholder-gray-600"
                        placeholder="es. campo:quantita > 0" value={step.expr || ''} onChange={(e) => updateStep(idx, 'expr', e.target.value)} />
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500 block mb-1">Messaggio se bloccata</label>
                      <input className="w-full bg-surface-page text-ink px-3 py-2 rounded-lg text-xs outline-none border border-gray-700 focus:border-orange-500 transition placeholder-gray-600"
                        placeholder="es. La quantità deve essere maggiore di zero" value={step.messaggio || ''} onChange={(e) => updateStep(idx, 'messaggio', e.target.value)} />
                    </div>
                  </div>
                )

                if (step.block_type === 'allegati') return (
                  <div key={step.id} {...dragHandlers(idx)}
                    className="bg-surface-card rounded-md border border-gray-800 p-4 cursor-grab active:cursor-grabbing"
                    style={{ borderLeft: '3px solid #06B6D4' }}>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2 text-xs font-semibold text-gray-400">
                        <span className="text-gray-600 select-none">&#8942;&#8942;</span>
                        <Icon name="file" size={12} /> Allegati tipizzati
                      </div>
                      <button onClick={() => removeStep(idx)} className="text-red-400/60 hover:text-red-400 transition"><Icon name="trash" size={14} /></button>
                    </div>
                    <div className="text-[10px] text-gray-600 mb-3">Ogni record di questo modulo potrà avere allegati con tipo. Inserisci i tipi uno per riga (es. "fattura", "prova_pagamento").</div>
                    <textarea
                      className="w-full bg-surface-page text-gray-300 px-3 py-2 rounded-lg text-xs outline-none border border-gray-700 focus:border-accent transition font-mono"
                      rows={4}
                      placeholder={'fattura\nprova_pagamento'}
                      value={(step.types || []).join('\n')}
                      onChange={(e) => updateStep(idx, 'types', e.target.value.split('\n').map((s) => s.trim()).filter(Boolean))}
                    />
                  </div>
                )

                if (step.block_type === 'connection_required') return (
                  <div key={step.id} {...dragHandlers(idx)}
                    className="bg-surface-card rounded-md border border-gray-800 p-4 cursor-grab active:cursor-grabbing"
                    style={{ borderLeft: '3px solid #F59E0B' }}>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2 text-xs font-semibold text-gray-400">
                        <span className="text-gray-600 select-none">&#8942;&#8942;</span>
                        <Icon name="plug" size={12} /> Richiede connessione
                      </div>
                      <button onClick={() => removeStep(idx)} className="text-red-400/60 hover:text-red-400 transition"><Icon name="trash" size={14} /></button>
                    </div>
                    <div className="text-[10px] text-gray-600 mb-3">Chi installa questo modulo, se la connessione scelta non è già collegata, vede subito il pannello per collegarla direttamente sulla card del modulo — usa questo blocco solo per dipendenze fuori dal motore automazioni (es. un poller dedicato); le automazioni che usano un connettore lo segnalano già da sole.</div>
                    <select className="w-full bg-surface-page text-ink px-3 py-2 rounded-lg text-xs outline-none border border-gray-700 focus:border-yellow-500 transition"
                      value={step.integration_id || 'google'} onChange={(e) => updateStep(idx, 'integration_id', e.target.value)}>
                      <option value="google">Google Workspace</option>
                      <option value="slack">Slack</option>
                      <option value="stripe">Stripe</option>
                      <option value="mailchimp">Mailchimp</option>
                      <option value="whatsapp">WhatsApp Business</option>
                      <option value="whatsapp_callmebot">WhatsApp (CallMeBot)</option>
                      <option value="fatture_in_cloud">Fatture in Cloud</option>
                    </select>
                  </div>
                )

                if (step.block_type === 'form_step') {
                  const ownFieldRelKeys = schema.steps
                    .filter((s) => s.block_type === 'field' || s.block_type === 'relation')
                    .map((s) => ({ key: s.key, label: s.label || s.key }))
                  const selectedCampi = step.campi || []
                  const toggleCampo = (key) => updateStep(idx, 'campi', selectedCampi.includes(key) ? selectedCampi.filter((k) => k !== key) : [...selectedCampi, key])
                  return (
                    <div key={step.id} {...dragHandlers(idx)}
                      className="bg-surface-card rounded-md border border-gray-800 p-4 cursor-grab active:cursor-grabbing"
                      style={{ borderLeft: '3px solid #A78BFA' }}>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2 text-xs font-semibold text-gray-400">
                          <span className="text-gray-600 select-none">&#8942;&#8942;</span>
                          <Icon name="list" size={12} /> Passo del wizard
                        </div>
                        <button onClick={() => removeStep(idx)} className="text-red-400/60 hover:text-red-400 transition"><Icon name="trash" size={14} /></button>
                      </div>
                      <div className="text-[10px] text-gray-600 mb-3">Se ci sono almeno 2 blocchi "Passo del wizard" in questo modulo, il form di creazione diventa un wizard multi-step (Avanti/Indietro) invece di un unico form lungo. L'ordine dei passi segue l'ordine dei blocchi nel canvas.</div>
                      <div className="mb-3">
                        <label className="text-[10px] text-gray-500 block mb-1">Titolo del passo</label>
                        <input className="w-full bg-surface-page text-ink px-3 py-2 rounded-lg text-sm outline-none border border-gray-700 focus:border-accent transition placeholder-gray-600"
                          placeholder="es. Dati cliente, Righe prodotto, Pagamento" value={step.titolo || ''} onChange={(e) => updateStep(idx, 'titolo', e.target.value)} />
                      </div>
                      <div className="mb-3">
                        <div className="text-[10px] text-gray-500 mb-1.5">Campi e relazioni in questo passo</div>
                        <div className="flex flex-wrap gap-1.5">
                          {ownFieldRelKeys.map((f) => (
                            <button key={f.key} onClick={() => toggleCampo(f.key)}
                              className={'px-2 py-1 rounded text-[11px] border transition ' + (selectedCampi.includes(f.key) ? 'bg-cp-purple/20 border-cp-purple/50 text-cp-purple' : 'bg-gray-800/50 border-gray-700 text-gray-500 hover:text-gray-300')}>
                              {f.label}
                            </button>
                          ))}
                          {ownFieldRelKeys.length === 0 && <div className="text-[10px] text-gray-700">Aggiungi prima campi/relazioni al modulo.</div>}
                        </div>
                      </div>
                      <div>
                        <label className="text-[10px] text-gray-500 block mb-1">Moduli figli (righe embedded) in questo passo — uno per riga, slug esatto</label>
                        <textarea
                          className="w-full bg-surface-page text-gray-300 px-3 py-2 rounded-lg text-xs outline-none border border-gray-700 focus:border-accent transition font-mono"
                          rows={2} placeholder={'ordini_righe'}
                          value={(step.righe_figlio || []).join('\n')}
                          onChange={(e) => updateStep(idx, 'righe_figlio', e.target.value.split('\n').map((s) => s.trim()).filter(Boolean))}
                        />
                      </div>
                    </div>
                  )
                }

                if (step.block_type === 'branch_create') {
                  const branches = step.branches || []
                  const updateBranches = (next) => updateStep(idx, 'branches', next)
                  const addBranch = () => updateBranches([...branches, { value: 'opzione_' + (branches.length + 1), label: 'Nuova opzione', target_module: null, fields: [], defaults: {} }])
                  const updateBranch = (bi, patch) => updateBranches(branches.map((b, i) => i === bi ? { ...b, ...patch } : b))
                  const removeBranch = (bi) => updateBranches(branches.filter((_, i) => i !== bi))
                  const addField = (bi) => updateBranch(bi, { fields: [...(branches[bi].fields || []), { key: '' }] })
                  const updateField = (bi, fi, patch) => updateBranch(bi, { fields: branches[bi].fields.map((f, i) => i === fi ? { ...f, ...patch } : f) })
                  const removeField = (bi, fi) => updateBranch(bi, { fields: branches[bi].fields.filter((_, i) => i !== fi) })
                  return (
                    <div key={step.id} {...dragHandlers(idx)}
                      className="bg-surface-card rounded-md border border-gray-800 p-4 cursor-grab active:cursor-grabbing"
                      style={{ borderLeft: '3px solid #EC4899' }}>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2 text-xs font-semibold text-gray-400">
                          <span className="text-gray-600 select-none">&#8942;&#8942;</span>
                          <Icon name="git-branch" size={12} /> Creazione con scelta
                        </div>
                        <button onClick={() => removeStep(idx)} className="text-red-400/60 hover:text-red-400 transition"><Icon name="trash" size={14} /></button>
                      </div>
                      <div className="mb-3">
                        <label className="text-[10px] text-gray-500 block mb-1">Testo del bottone</label>
                        <input className="w-full bg-surface-page text-ink px-3 py-2 rounded-lg text-sm outline-none border border-gray-700 focus:border-accent transition placeholder-gray-600"
                          placeholder="es. Nuovo pagamento" value={step.label || ''} onChange={(e) => updateStep(idx, 'label', e.target.value)} />
                      </div>
                      <div className="space-y-3">
                        {branches.map((b, bi) => (
                          <div key={bi} className="bg-surface-page rounded-lg border border-gray-700 p-3">
                            <div className="grid grid-cols-2 gap-2 mb-2">
                              <input className="bg-surface-card text-ink px-2 py-1.5 rounded text-xs outline-none border border-gray-700 focus:border-pink-500 transition placeholder-gray-600"
                                placeholder="Etichetta (es. Diretto)" value={b.label || ''} onChange={(e) => updateBranch(bi, { label: e.target.value })} />
                              <div className="flex gap-1">
                                <Select value={b.target_module || ''} onChange={(v) => updateBranch(bi, { target_module: v || null })}
                                  placeholder="Questo modulo" options={[{ value: '', label: 'Questo modulo' }, ...allModules.filter((m) => m.slug !== selected).map((m) => ({ value: m.slug, label: m.name }))]}
                                  className="flex-1" />
                                <button onClick={() => removeBranch(bi)} className="text-red-400/50 hover:text-red-400 transition flex-shrink-0"><Icon name="trash" size={13} /></button>
                              </div>
                            </div>
                            <div className="text-[10px] text-gray-600 mb-1.5">Campi mostrati per questa scelta — scegli tra i campi REALI del modulo di destinazione (tipo select/checkbox/valuta ecc. presi da lì, non riconfigurati a mano). Etichetta opzionale solo se vuoi un testo diverso da quello del campo.</div>
                            <div className="space-y-1">
                              {(() => {
                                const targetSlug = b.target_module || selected
                                const targetMod = fieldCache.find((m) => m.slug === targetSlug)
                                const targetFieldOpts = (targetMod && targetMod.fields || []).filter((f) => f.type !== 'computed').map((f) => ({ value: f.key, label: f.label + ' (' + f.key + ')' }))
                                return (b.fields || []).map((f, fi) => (
                                  <div key={fi} className="grid grid-cols-[1fr_1fr_auto] gap-1 items-center">
                                    <Select value={f.key || ''} onChange={(v) => updateField(bi, fi, { key: v })}
                                      placeholder="Scegli un campo..." options={targetFieldOpts} className="text-xs" />
                                    <input className="bg-surface-card text-ink px-2 py-1 rounded text-xs outline-none border border-gray-700 focus:border-pink-500 transition"
                                      placeholder="Etichetta (opzionale)" value={f.label || ''} onChange={(e) => updateField(bi, fi, { label: e.target.value })} />
                                    <button onClick={() => removeField(bi, fi)} className="text-red-400/40 hover:text-red-400 transition"><Icon name="x" size={12} /></button>
                                  </div>
                                ))
                              })()}
                              <button onClick={() => addField(bi)} className="text-pink-400 hover:text-pink-300 text-[11px] transition flex items-center gap-1 mt-1">
                                <Icon name="plus" size={11} />Aggiungi campo
                              </button>
                            </div>
                          </div>
                        ))}
                        <button onClick={addBranch} className="text-pink-400 hover:text-pink-300 text-xs transition flex items-center gap-1">
                          <Icon name="plus" size={12} />Aggiungi opzione
                        </button>
                        {branches.length === 0 && <div className="text-[10px] text-gray-600">Nessuna opzione — "Aggiungi opzione" per iniziare (servono almeno 2 per avere una vera scelta).</div>}
                      </div>
                    </div>
                  )
                }

                if (step.block_type === 'reconciliation') {
                  const sourceA = step.source_a || {}
                  const sourceB = step.source_b || {}
                  const updateA = (patch) => updateStep(idx, 'source_a', { ...sourceA, ...patch })
                  const updateB = (patch) => updateStep(idx, 'source_b', { ...sourceB, ...patch })
                  const modA = fieldCache.find((m) => m.slug === sourceA.module)
                  const modB = fieldCache.find((m) => m.slug === sourceB.module)
                  const relsA = (modA && modA.relations || []).filter((r) => r.type === 'many_to_one')
                  const relsB = (modB && modB.relations || []).filter((r) => r.type === 'many_to_one')
                  const filterOptionsFor = (mod, rels) => ['_stato', ...(mod && mod.fields || []).map((f) => f.key),
                    ...rels.flatMap((r) => { const t = fieldCache.find((m) => m.slug === r.target_module); return (t && t.fields || []).map((f) => r.key + '.' + f.key) })]
                  return (
                    <div key={step.id} {...dragHandlers(idx)}
                      className="bg-surface-card rounded-md border border-gray-800 p-4 cursor-grab active:cursor-grabbing"
                      style={{ borderLeft: '3px solid #06B6D4' }}>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2 text-xs font-semibold text-gray-400">
                          <span className="text-gray-600 select-none">&#8942;&#8942;</span>
                          <Icon name="link" size={12} /> Riconciliazione a doppia lista
                        </div>
                        <button onClick={() => removeStep(idx)} className="text-red-400/60 hover:text-red-400 transition"><Icon name="trash" size={14} /></button>
                      </div>
                      <input className="w-full bg-surface-page text-ink px-3 py-2 rounded-lg text-sm outline-none border border-gray-700 focus:border-accent transition mb-3" placeholder="Titolo" value={step.label || ''} onChange={(e) => updateStep(idx, 'label', e.target.value)} />

                      <div className="bg-surface-page rounded-lg border border-gray-700 p-3 mb-2.5">
                        <div className="text-[11px] text-gray-400 font-semibold mb-2">Lista A — da riconciliare</div>
                        <div className="grid grid-cols-2 gap-2 mb-2">
                          <Select value={sourceA.module || ''} onChange={(v) => updateA({ module: v })} placeholder="Modulo"
                            options={fieldCache.map((m) => ({ value: m.slug, label: m.name }))} />
                          <select className="bg-surface-card text-ink px-2 py-2 rounded-lg text-xs outline-none border border-gray-700" value={sourceA.amount_field || ''} onChange={(e) => updateA({ amount_field: e.target.value })}>
                            <option value="">Campo importo...</option>
                            {(modA && modA.fields || []).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                          </select>
                        </div>
                        <div className="grid grid-cols-2 gap-2 mb-2">
                          <select className="bg-surface-card text-ink px-2 py-2 rounded-lg text-xs outline-none border border-gray-700" value={sourceA.direction_field || ''} onChange={(e) => updateA({ direction_field: e.target.value || undefined })}>
                            <option value="">Direzione: solo dal segno dell'importo</option>
                            {(modA && modA.fields || []).filter((f) => f.type === 'select').map((f) => <option key={f.key} value={f.key}>Direzione da: {f.label}</option>)}
                          </select>
                          <select className="bg-surface-card text-ink px-2 py-2 rounded-lg text-xs outline-none border border-gray-700" value={sourceA.date_field || ''} onChange={(e) => updateA({ date_field: e.target.value })}>
                            <option value="">Campo data...</option>
                            {(modA && modA.fields || []).filter((f) => f.type === 'date' || f.type === 'datetime').map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                          </select>
                        </div>
                        {sourceA.direction_field && (
                          <input className="w-full bg-surface-card text-ink px-2 py-1.5 rounded-lg text-xs outline-none border border-gray-700 mb-2" placeholder="Valori che contano come entrata, separati da virgola (es. Accredito, Bonifico In)"
                            value={(sourceA.direction_positive_values || []).join(', ')} onChange={(e) => updateA({ direction_positive_values: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />
                        )}
                        <select className="w-full bg-surface-card text-ink px-2 py-2 rounded-lg text-xs outline-none border border-gray-700 mb-2" value={sourceA.link_field || ''} onChange={(e) => updateA({ link_field: e.target.value })}>
                          <option value="">Campo dove salvare il collegamento...</option>
                          {(modA && modA.fields || []).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                        </select>
                        <div className="grid grid-cols-2 gap-2">
                          <select className="bg-surface-card text-ink px-2 py-1.5 rounded-lg text-xs outline-none border border-gray-700" value={(sourceA.filter && sourceA.filter.campo) || ''} onChange={(e) => updateA({ filter: e.target.value ? { campo: e.target.value, valori: (sourceA.filter && sourceA.filter.valori) || [] } : undefined })}>
                            <option value="">Nessun filtro</option>
                            {filterOptionsFor(modA, relsA).map((k) => <option key={k} value={k}>{k}</option>)}
                          </select>
                          <input className="bg-surface-card text-ink px-2 py-1.5 rounded-lg text-xs outline-none border border-gray-700" placeholder="valori (virgola)" disabled={!sourceA.filter}
                            value={(sourceA.filter && sourceA.filter.valori || []).join(', ')} onChange={(e) => updateA({ filter: { ...sourceA.filter, valori: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) } })} />
                        </div>
                      </div>

                      <div className="bg-surface-page rounded-lg border border-gray-700 p-3 mb-2.5">
                        <div className="text-[11px] text-gray-400 font-semibold mb-2">Lista B — candidati interni</div>
                        <div className="grid grid-cols-2 gap-2 mb-2">
                          <Select value={sourceB.module || ''} onChange={(v) => updateB({ module: v })} placeholder="Modulo"
                            options={fieldCache.map((m) => ({ value: m.slug, label: m.name }))} />
                          <select className="bg-surface-card text-ink px-2 py-2 rounded-lg text-xs outline-none border border-gray-700" value={sourceB.metric || ''} onChange={(e) => updateB({ metric: e.target.value })}>
                            <option value="">Campo importo (es. Dare)...</option>
                            {(modB && modB.fields || []).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                          </select>
                        </div>
                        <select className="w-full bg-surface-card text-ink px-2 py-2 rounded-lg text-xs outline-none border border-gray-700 mb-2" value={sourceB.metric_subtract || ''} onChange={(e) => updateB({ metric_subtract: e.target.value || undefined })}>
                          <option value="">Sottrai (opzionale, es. Avere)...</option>
                          {(modB && modB.fields || []).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                        </select>
                        <select className="w-full bg-surface-card text-ink px-2 py-2 rounded-lg text-xs outline-none border border-gray-700" value={sourceB.date_field || ''} onChange={(e) => updateB({ date_field: e.target.value })}>
                          <option value="">Campo data...</option>
                          {(modB && modB.fields || []).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                          {relsB.map((rel) => {
                            const target = fieldCache.find((m) => m.slug === rel.target_module)
                            return (target && target.fields || []).filter((f) => f.type === 'date' || f.type === 'datetime').map((f) => (
                              <option key={rel.key + '.' + f.key} value={rel.key + '.' + f.key}>via {rel.label} → {f.label}</option>
                            ))
                          })}
                        </select>
                        <div className="grid grid-cols-2 gap-2 mt-2">
                          <select className="bg-surface-card text-ink px-2 py-1.5 rounded-lg text-xs outline-none border border-gray-700" value={(sourceB.filter && sourceB.filter.campo) || ''} onChange={(e) => updateB({ filter: e.target.value ? { campo: e.target.value, valori: (sourceB.filter && sourceB.filter.valori) || [] } : undefined })}>
                            <option value="">Nessun filtro (es. limita ai soli conti Cassa/Banca)</option>
                            {filterOptionsFor(modB, relsB).map((k) => <option key={k} value={k}>{k}</option>)}
                          </select>
                          <input className="bg-surface-card text-ink px-2 py-1.5 rounded-lg text-xs outline-none border border-gray-700" placeholder="valori (virgola)" disabled={!sourceB.filter}
                            value={(sourceB.filter && sourceB.filter.valori || []).join(', ')} onChange={(e) => updateB({ filter: { ...sourceB.filter, valori: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) } })} />
                        </div>
                      </div>

                      <input className="w-full bg-surface-page text-ink px-3 py-2 rounded-lg text-sm outline-none border border-gray-700" placeholder="Chiave stato dopo il collegamento (opzionale, es. riconciliato — deve esistere nel workflow del modulo A)"
                        value={step.transition_to || ''} onChange={(e) => updateStep(idx, 'transition_to', e.target.value || undefined)} />
                    </div>
                  )
                }

                if (step.block_type === 'financial_statement') {
                  // righe_module è quasi sempre un modulo di supporto diverso da quello
                  // su cui vive questo blocco (es. il blocco sta su "movimenti", visibile
                  // in sidebar, ma le righe dare/avere vivono su "movimenti_righe",
                  // support_module nascosto) — per questo il blocco NON assume "questo
                  // modulo" come le altre viste (report_aggregate raggruppato usa lo
                  // stesso pattern con source_module).
                  const righeMod = fieldCache.find((m) => m.slug === step.righe_module)
                  const relsRighe = (righeMod && righeMod.relations || []).filter((r) => r.type === 'many_to_one')
                  const contoRel = relsRighe.find((r) => r.key === step.conto_relation)
                  const contoMod = contoRel && fieldCache.find((m) => m.slug === contoRel.target_module)
                  const filterRel = relsRighe.find((r) => r.key === step.filter_relation)
                  const filterMod = filterRel && fieldCache.find((m) => m.slug === filterRel.target_module)
                  return (
                    <div key={step.id} {...dragHandlers(idx)}
                      className="bg-surface-card rounded-md border border-gray-800 p-4 cursor-grab active:cursor-grabbing"
                      style={{ borderLeft: '3px solid #10B981' }}>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2 text-xs font-semibold text-gray-400">
                          <span className="text-gray-600 select-none">&#8942;&#8942;</span>
                          <Icon name="bar-chart" size={12} /> Bilancio contabile
                        </div>
                        <button onClick={() => removeStep(idx)} className="text-red-400/60 hover:text-red-400 transition"><Icon name="trash" size={14} /></button>
                      </div>
                      <input className="w-full bg-surface-page text-ink px-3 py-2 rounded-lg text-sm outline-none border border-gray-700 focus:border-accent transition mb-2.5" placeholder="Titolo" value={step.label || ''} onChange={(e) => updateStep(idx, 'label', e.target.value)} />

                      <Select value={step.righe_module || ''} onChange={(v) => updateStep(idx, 'righe_module', v)} placeholder="Modulo con le righe dare/avere (es. movimenti_righe)"
                        options={fieldCache.map((m) => ({ value: m.slug, label: m.name }))} className="mb-2.5" />

                      <div className="bg-surface-page rounded-lg border border-gray-700 p-3 mb-2.5">
                        <div className="text-[11px] text-gray-400 font-semibold mb-2">Piano dei conti</div>
                        <select className="w-full bg-surface-card text-ink px-2 py-2 rounded-lg text-xs outline-none border border-gray-700 mb-2" value={step.conto_relation || ''} onChange={(e) => updateStep(idx, 'conto_relation', e.target.value)} disabled={!righeMod}>
                          <option value="">Relazione verso il piano dei conti...</option>
                          {relsRighe.map((r) => <option key={r.key} value={r.key}>{r.label} → {r.target_module}</option>)}
                        </select>
                        {contoMod && (
                          <div className="grid grid-cols-3 gap-2">
                            <select className="bg-surface-card text-ink px-2 py-1.5 rounded-lg text-xs outline-none border border-gray-700" value={step.codice_field || ''} onChange={(e) => updateStep(idx, 'codice_field', e.target.value)}>
                              <option value="">Codice...</option>
                              {(contoMod.fields || []).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                            </select>
                            <select className="bg-surface-card text-ink px-2 py-1.5 rounded-lg text-xs outline-none border border-gray-700" value={step.nome_field || ''} onChange={(e) => updateStep(idx, 'nome_field', e.target.value)}>
                              <option value="">Nome...</option>
                              {(contoMod.fields || []).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                            </select>
                            <select className="bg-surface-card text-ink px-2 py-1.5 rounded-lg text-xs outline-none border border-gray-700" value={step.tipo_field || ''} onChange={(e) => updateStep(idx, 'tipo_field', e.target.value)}>
                              <option value="">Tipo (Ricavo/Costo/...)...</option>
                              {(contoMod.fields || []).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                            </select>
                          </div>
                        )}
                        <div className="text-[10px] text-gray-600 mt-2">Il campo "Tipo" deve contenere esattamente uno tra: Ricavo, Costo, Attivo, Passivo, Capitale.</div>
                      </div>

                      <div className="bg-surface-page rounded-lg border border-gray-700 p-3 mb-2.5">
                        <div className="text-[11px] text-gray-400 font-semibold mb-2">Righe dare/avere (sul modulo righe sopra)</div>
                        <div className="grid grid-cols-2 gap-2">
                          <select className="bg-surface-card text-ink px-2 py-1.5 rounded-lg text-xs outline-none border border-gray-700" value={step.dare_field || ''} onChange={(e) => updateStep(idx, 'dare_field', e.target.value)} disabled={!righeMod}>
                            <option value="">Campo Dare...</option>
                            {(righeMod && righeMod.fields || []).filter((f) => ['number', 'currency'].includes(f.type)).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                          </select>
                          <select className="bg-surface-card text-ink px-2 py-1.5 rounded-lg text-xs outline-none border border-gray-700" value={step.avere_field || ''} onChange={(e) => updateStep(idx, 'avere_field', e.target.value)} disabled={!righeMod}>
                            <option value="">Campo Avere...</option>
                            {(righeMod && righeMod.fields || []).filter((f) => ['number', 'currency'].includes(f.type)).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                          </select>
                        </div>
                      </div>

                      <div className="bg-surface-page rounded-lg border border-gray-700 p-3">
                        <div className="text-[11px] text-gray-400 font-semibold mb-2">Filtro righe (opzionale — es. solo movimenti confermati)</div>
                        <div className="grid grid-cols-2 gap-2 mb-2">
                          <select className="bg-surface-card text-ink px-2 py-1.5 rounded-lg text-xs outline-none border border-gray-700" value={step.filter_relation || ''} onChange={(e) => updateStep(idx, 'filter_relation', e.target.value || undefined)} disabled={!righeMod}>
                            <option value="">Nessun filtro</option>
                            {relsRighe.map((r) => <option key={r.key} value={r.key}>{r.label} → {r.target_module}</option>)}
                          </select>
                          <select className="bg-surface-card text-ink px-2 py-1.5 rounded-lg text-xs outline-none border border-gray-700" value={step.filter_field || ''} onChange={(e) => updateStep(idx, 'filter_field', e.target.value || undefined)} disabled={!filterMod}>
                            <option value="">Campo...</option>
                            {(filterMod && filterMod.fields || []).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                          </select>
                        </div>
                        {step.filter_relation && step.filter_field && (
                          <input className="w-full bg-surface-card text-ink px-2 py-1.5 rounded-lg text-xs outline-none border border-gray-700" placeholder="Valore richiesto (es. confermato)"
                            value={step.filter_value || ''} onChange={(e) => updateStep(idx, 'filter_value', e.target.value)} />
                        )}
                      </div>
                    </div>
                  )
                }

                if (step.block_type === 'distance_buckets') {
                  const ownMod = fieldCache.find((m) => m.slug === selected)
                  const relsOwn = (ownMod && ownMod.relations || []).filter((r) => r.type === 'many_to_one')
                  const buckets = step.buckets || []
                  const filters = step.filters || []
                  const updateBucket = (i, patch) => updateStep(idx, 'buckets', buckets.map((b, bi) => bi === i ? { ...b, ...patch } : b))
                  const addBucket = () => updateStep(idx, 'buckets', [...buckets, { key: 'bucket_' + Date.now(), label: 'Nuovo bucket', max_days: null }])
                  const removeBucket = (i) => updateStep(idx, 'buckets', buckets.filter((_, bi) => bi !== i))
                  const updateFilter = (i, patch) => updateStep(idx, 'filters', filters.map((f, fi) => fi === i ? { ...f, ...patch } : f))
                  const addFilter = () => updateStep(idx, 'filters', [...filters, { field: '_stato', op: '!=', value: '' }])
                  const removeFilter = (i) => updateStep(idx, 'filters', filters.filter((_, fi) => fi !== i))
                  const filterFieldOptions = ['_stato', ...(ownMod && ownMod.fields || []).map((f) => f.key),
                    ...relsOwn.flatMap((r) => { const t = fieldCache.find((m) => m.slug === r.target_module); return (t && t.fields || []).map((f) => r.key + '.' + f.key) })]
                  return (
                    <div key={step.id} {...dragHandlers(idx)}
                      className="bg-surface-card rounded-md border border-gray-800 p-4 cursor-grab active:cursor-grabbing"
                      style={{ borderLeft: '3px solid #F59E0B' }}>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2 text-xs font-semibold text-gray-400">
                          <span className="text-gray-600 select-none">&#8942;&#8942;</span>
                          <Icon name="list" size={12} /> Vista per distanza da una data
                        </div>
                        <button onClick={() => removeStep(idx)} className="text-red-400/60 hover:text-red-400 transition"><Icon name="trash" size={14} /></button>
                      </div>
                      <input className="w-full bg-surface-page text-ink px-3 py-2 rounded-lg text-sm outline-none border border-gray-700 focus:border-accent transition mb-2.5" placeholder="Titolo" value={step.label || ''} onChange={(e) => updateStep(idx, 'label', e.target.value)} />

                      <div className="grid grid-cols-2 gap-2 mb-2.5">
                        <select className="bg-surface-page text-ink px-2 py-2 rounded-lg text-xs outline-none border border-gray-700" value={step.date_field || ''} onChange={(e) => updateStep(idx, 'date_field', e.target.value)}>
                          <option value="">Campo data...</option>
                          {(ownMod && ownMod.fields || []).filter((f) => f.type === 'date' || f.type === 'datetime').map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                        </select>
                        <select className="bg-surface-page text-ink px-2 py-2 rounded-lg text-xs outline-none border border-gray-700" value={step.metric_field || ''} onChange={(e) => updateStep(idx, 'metric_field', e.target.value || undefined)}>
                          <option value="">Nessuna metrica (solo conteggio)</option>
                          {(ownMod && ownMod.fields || []).filter((f) => ['number', 'currency', 'computed'].includes(f.type)).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                        </select>
                      </div>

                      <div className="bg-surface-page rounded-lg border border-gray-700 p-3 mb-2.5">
                        <div className="text-[11px] text-gray-400 font-semibold mb-2">Bucket (in ordine — l'ultimo senza "max giorni" è il catch-all)</div>
                        {buckets.map((b, i) => (
                          <div key={i} className="grid grid-cols-[1fr_1fr_80px_28px] gap-2 mb-1.5 items-center">
                            <input className="bg-surface-card text-ink px-2 py-1.5 rounded-lg text-xs outline-none border border-gray-700" placeholder="chiave" value={b.key || ''} onChange={(e) => updateBucket(i, { key: e.target.value })} />
                            <input className="bg-surface-card text-ink px-2 py-1.5 rounded-lg text-xs outline-none border border-gray-700" placeholder="etichetta" value={b.label || ''} onChange={(e) => updateBucket(i, { label: e.target.value })} />
                            <input type="number" className="bg-surface-card text-ink px-2 py-1.5 rounded-lg text-xs outline-none border border-gray-700" placeholder="max gg" value={b.max_days ?? ''} onChange={(e) => updateBucket(i, { max_days: e.target.value === '' ? null : parseInt(e.target.value) })} />
                            <button onClick={() => removeBucket(i)} className="text-red-400/60 hover:text-red-400 transition"><Icon name="trash" size={12} /></button>
                          </div>
                        ))}
                        <button onClick={addBucket} className="text-xs text-accent hover:opacity-80 transition mt-1">+ Aggiungi bucket</button>
                      </div>

                      <div className="bg-surface-page rounded-lg border border-gray-700 p-3">
                        <div className="text-[11px] text-gray-400 font-semibold mb-2">Filtri (opzionali, tutti richiesti — es. escludi pagate/annullate con 2 filtri "!=")</div>
                        {filters.map((f, i) => (
                          <div key={i} className="grid grid-cols-[1fr_70px_1fr_28px] gap-2 mb-1.5 items-center">
                            <select className="bg-surface-card text-ink px-2 py-1.5 rounded-lg text-xs outline-none border border-gray-700" value={f.field || ''} onChange={(e) => updateFilter(i, { field: e.target.value })}>
                              {filterFieldOptions.map((k) => <option key={k} value={k}>{k}</option>)}
                            </select>
                            <select className="bg-surface-card text-ink px-2 py-1.5 rounded-lg text-xs outline-none border border-gray-700" value={f.op || '=='} onChange={(e) => updateFilter(i, { op: e.target.value })}>
                              {['==', '!=', '>', '<', '>=', '<='].map((o) => <option key={o} value={o}>{o}</option>)}
                            </select>
                            <input className="bg-surface-card text-ink px-2 py-1.5 rounded-lg text-xs outline-none border border-gray-700" placeholder="valore" value={f.value || ''} onChange={(e) => updateFilter(i, { value: e.target.value })} />
                            <button onClick={() => removeFilter(i)} className="text-red-400/60 hover:text-red-400 transition"><Icon name="trash" size={12} /></button>
                          </div>
                        ))}
                        <button onClick={addFilter} className="text-xs text-accent hover:opacity-80 transition mt-1">+ Aggiungi filtro</button>
                      </div>
                    </div>
                  )
                }

                if (step.block_type === 'period_view') {
                  const ownMod = fieldCache.find((m) => m.slug === selected)
                  const relsOwn = (ownMod && ownMod.relations || []).filter((r) => r.type === 'many_to_one')
                  const metrics = step.metrics || []
                  const filters = step.filters || []
                  const updateMetric = (i, patch) => updateStep(idx, 'metrics', metrics.map((m, mi) => mi === i ? { ...m, ...patch } : m))
                  const addMetric = () => updateStep(idx, 'metrics', [...metrics, { key: 'metrica_' + Date.now(), label: 'Nuova metrica', field: '', func: 'sum', format: 'currency' }])
                  const removeMetric = (i) => updateStep(idx, 'metrics', metrics.filter((_, mi) => mi !== i))
                  const updateFilter = (i, patch) => updateStep(idx, 'filters', filters.map((f, fi) => fi === i ? { ...f, ...patch } : f))
                  const addFilter = () => updateStep(idx, 'filters', [...filters, { field: '_stato', op: '!=', value: '' }])
                  const removeFilter = (i) => updateStep(idx, 'filters', filters.filter((_, fi) => fi !== i))
                  const filterFieldOptions = ['_stato', ...(ownMod && ownMod.fields || []).map((f) => f.key),
                    ...relsOwn.flatMap((r) => { const t = fieldCache.find((m) => m.slug === r.target_module); return (t && t.fields || []).map((f) => r.key + '.' + f.key) })]
                  return (
                    <div key={step.id} {...dragHandlers(idx)}
                      className="bg-surface-card rounded-md border border-gray-800 p-4 cursor-grab active:cursor-grabbing"
                      style={{ borderLeft: '3px solid #10B981' }}>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2 text-xs font-semibold text-gray-400">
                          <span className="text-gray-600 select-none">&#8942;&#8942;</span>
                          <Icon name="calendar" size={12} /> Vista per periodo navigabile
                        </div>
                        <button onClick={() => removeStep(idx)} className="text-red-400/60 hover:text-red-400 transition"><Icon name="trash" size={14} /></button>
                      </div>
                      <input className="w-full bg-surface-page text-ink px-3 py-2 rounded-lg text-sm outline-none border border-gray-700 focus:border-accent transition mb-2.5" placeholder="Titolo" value={step.label || ''} onChange={(e) => updateStep(idx, 'label', e.target.value)} />

                      <div className="grid grid-cols-3 gap-2 mb-2.5">
                        <select className="bg-surface-page text-ink px-2 py-2 rounded-lg text-xs outline-none border border-gray-700" value={step.granularity || 'mese'} onChange={(e) => updateStep(idx, 'granularity', e.target.value)}>
                          <option value="mese">Naviga per mese</option>
                          <option value="settimana">Naviga per settimana</option>
                          <option value="anno">Naviga per anno</option>
                        </select>
                        <select className="bg-surface-page text-ink px-2 py-2 rounded-lg text-xs outline-none border border-gray-700" value={step.date_field || ''} onChange={(e) => updateStep(idx, 'date_field', e.target.value)}>
                          <option value="">Campo data...</option>
                          {(ownMod && ownMod.fields || []).filter((f) => f.type === 'date' || f.type === 'datetime').map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                        </select>
                        <label className="flex items-center gap-1.5 text-xs text-gray-400 px-2">
                          <input type="checkbox" checked={!!step.compare_previous} onChange={(e) => updateStep(idx, 'compare_previous', e.target.checked)} />
                          Confronta col periodo precedente
                        </label>
                      </div>

                      <div className="bg-surface-page rounded-lg border border-gray-700 p-3 mb-2.5">
                        <div className="text-[11px] text-gray-400 font-semibold mb-2">Metriche (KPI mostrati per il periodo attivo)</div>
                        {metrics.map((m, i) => (
                          <div key={i} className="mb-2 pb-2 border-b border-gray-800/60 last:border-0">
                            <div className="grid grid-cols-[1fr_1fr_70px_28px] gap-2 mb-1.5 items-center">
                              <input className="bg-surface-card text-ink px-2 py-1.5 rounded-lg text-xs outline-none border border-gray-700" placeholder="etichetta" value={m.label || ''} onChange={(e) => updateMetric(i, { label: e.target.value })} />
                              <select className="bg-surface-card text-ink px-2 py-1.5 rounded-lg text-xs outline-none border border-gray-700" value={m.field || ''} onChange={(e) => updateMetric(i, { field: e.target.value })} disabled={m.func === 'count'}>
                                <option value="">campo...</option>
                                {(ownMod && ownMod.fields || []).filter((f) => ['number', 'currency', 'computed'].includes(f.type)).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                              </select>
                              <select className="bg-surface-card text-ink px-2 py-1.5 rounded-lg text-xs outline-none border border-gray-700" value={m.func || 'sum'} onChange={(e) => updateMetric(i, { func: e.target.value })}>
                                <option value="sum">somma</option>
                                <option value="count">conteggio</option>
                                <option value="avg">media</option>
                              </select>
                              <button onClick={() => removeMetric(i)} className="text-red-400/60 hover:text-red-400 transition"><Icon name="trash" size={12} /></button>
                            </div>
                            <div className="grid grid-cols-[1fr_60px_1fr] gap-2">
                              <select className="bg-surface-card text-gray-400 px-2 py-1 rounded-lg text-[11px] outline-none border border-gray-700" value={(m.filter && m.filter.field) || ''} onChange={(e) => updateMetric(i, { filter: e.target.value ? { field: e.target.value, op: (m.filter && m.filter.op) || '==', value: (m.filter && m.filter.value) || '' } : undefined })}>
                                <option value="">solo per questa metrica: nessun filtro</option>
                                {filterFieldOptions.map((k) => <option key={k} value={k}>filtro: {k}</option>)}
                              </select>
                              <select className="bg-surface-card text-gray-400 px-2 py-1 rounded-lg text-[11px] outline-none border border-gray-700" disabled={!m.filter} value={(m.filter && m.filter.op) || '=='} onChange={(e) => updateMetric(i, { filter: { ...m.filter, op: e.target.value } })}>
                                {['==', '!=', '>', '<', '>=', '<='].map((o) => <option key={o} value={o}>{o}</option>)}
                              </select>
                              <input className="bg-surface-card text-gray-400 px-2 py-1 rounded-lg text-[11px] outline-none border border-gray-700" placeholder="valore" disabled={!m.filter} value={(m.filter && m.filter.value) || ''} onChange={(e) => updateMetric(i, { filter: { ...m.filter, value: e.target.value } })} />
                            </div>
                          </div>
                        ))}
                        <button onClick={addMetric} className="text-xs text-accent hover:opacity-80 transition mt-1">+ Aggiungi metrica</button>
                      </div>

                      <div className="bg-surface-page rounded-lg border border-gray-700 p-3">
                        <div className="text-[11px] text-gray-400 font-semibold mb-2">Filtri (opzionali, tutti richiesti)</div>
                        {filters.map((f, i) => (
                          <div key={i} className="grid grid-cols-[1fr_70px_1fr_28px] gap-2 mb-1.5 items-center">
                            <select className="bg-surface-card text-ink px-2 py-1.5 rounded-lg text-xs outline-none border border-gray-700" value={f.field || ''} onChange={(e) => updateFilter(i, { field: e.target.value })}>
                              {filterFieldOptions.map((k) => <option key={k} value={k}>{k}</option>)}
                            </select>
                            <select className="bg-surface-card text-ink px-2 py-1.5 rounded-lg text-xs outline-none border border-gray-700" value={f.op || '=='} onChange={(e) => updateFilter(i, { op: e.target.value })}>
                              {['==', '!=', '>', '<', '>=', '<='].map((o) => <option key={o} value={o}>{o}</option>)}
                            </select>
                            <input className="bg-surface-card text-ink px-2 py-1.5 rounded-lg text-xs outline-none border border-gray-700" placeholder="valore" value={f.value || ''} onChange={(e) => updateFilter(i, { value: e.target.value })} />
                            <button onClick={() => removeFilter(i)} className="text-red-400/60 hover:text-red-400 transition"><Icon name="trash" size={12} /></button>
                          </div>
                        ))}
                        <button onClick={addFilter} className="text-xs text-accent hover:opacity-80 transition mt-1">+ Aggiungi filtro</button>
                      </div>
                    </div>
                  )
                }

                if (step.block_type === 'parent_children_view') {
                  const childMod = fieldCache.find((m) => m.slug === step.children_module)
                  const childRels = (childMod && childMod.relations || []).filter((r) => r.type === 'many_to_one' && r.target_module === selected)
                  const ownMod = fieldCache.find((m) => m.slug === selected)
                  return (
                    <div key={step.id} {...dragHandlers(idx)}
                      className="bg-surface-card rounded-md border border-gray-800 p-4 cursor-grab active:cursor-grabbing"
                      style={{ borderLeft: '3px solid #8B5CF6' }}>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2 text-xs font-semibold text-gray-400">
                          <span className="text-gray-600 select-none">&#8942;&#8942;</span>
                          <Icon name="git-branch" size={12} /> Genitori con figli
                        </div>
                        <button onClick={() => removeStep(idx)} className="text-red-400/60 hover:text-red-400 transition"><Icon name="trash" size={14} /></button>
                      </div>
                      <input className="w-full bg-surface-page text-ink px-3 py-2 rounded-lg text-sm outline-none border border-gray-700 focus:border-accent transition mb-2.5" placeholder="Titolo" value={step.label || ''} onChange={(e) => updateStep(idx, 'label', e.target.value)} />

                      <div className="bg-surface-page rounded-lg border border-gray-700 p-3 mb-2.5">
                        <div className="text-[11px] text-gray-400 font-semibold mb-2">Figli</div>
                        <Select value={step.children_module || ''} onChange={(v) => { updateStep(idx, 'children_module', v); updateStep(idx, 'children_relation', '') }} placeholder="Modulo figli (es. rate)"
                          options={fieldCache.filter((m) => m.slug !== selected).map((m) => ({ value: m.slug, label: m.name }))} className="mb-2" />
                        <select className="w-full bg-surface-card text-ink px-2 py-1.5 rounded-lg text-xs outline-none border border-gray-700 mb-2" value={step.children_relation || ''} onChange={(e) => updateStep(idx, 'children_relation', e.target.value)} disabled={!childMod}>
                          <option value="">Relazione dei figli verso questo modulo...</option>
                          {childRels.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                        </select>
                        <div className="grid grid-cols-2 gap-2 mb-2">
                          <select className="bg-surface-card text-ink px-2 py-1.5 rounded-lg text-xs outline-none border border-gray-700" value={step.children_status_field || '_stato'} onChange={(e) => updateStep(idx, 'children_status_field', e.target.value)} disabled={!childMod}>
                            <option value="_stato">Stato workflow (_stato)</option>
                            {(childMod && childMod.fields || []).filter((f) => f.type === 'select' || f.type === 'checkbox').map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                          </select>
                          <input className="bg-surface-card text-ink px-2 py-1.5 rounded-lg text-xs outline-none border border-gray-700" placeholder="valore 'fatto' (es. pagato)" value={step.children_status_done_value || ''} onChange={(e) => updateStep(idx, 'children_status_done_value', e.target.value)} />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <select className="bg-surface-card text-ink px-2 py-1.5 rounded-lg text-xs outline-none border border-gray-700" value={step.children_order_field || ''} onChange={(e) => updateStep(idx, 'children_order_field', e.target.value || undefined)} disabled={!childMod}>
                            <option value="">Ordina per...</option>
                            {(childMod && childMod.fields || []).filter((f) => f.type === 'date' || f.type === 'datetime').map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                          </select>
                          <select className="bg-surface-card text-ink px-2 py-1.5 rounded-lg text-xs outline-none border border-gray-700" value={step.child_amount_field || ''} onChange={(e) => updateStep(idx, 'child_amount_field', e.target.value || undefined)} disabled={!childMod}>
                            <option value="">Campo importo figlio...</option>
                            {(childMod && childMod.fields || []).filter((f) => ['number', 'currency'].includes(f.type)).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                          </select>
                        </div>
                      </div>

                      <select className="w-full bg-surface-page text-ink px-3 py-2 rounded-lg text-sm outline-none border border-gray-700" value={step.amount_field || ''} onChange={(e) => updateStep(idx, 'amount_field', e.target.value || undefined)}>
                        <option value="">Campo importo totale su questo modulo (opzionale, per il residuo)...</option>
                        {(ownMod && ownMod.fields || []).filter((f) => ['number', 'currency'].includes(f.type)).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                      </select>
                    </div>
                  )
                }

                if (step.block_type === 'yearly_breakdown') {
                  const srcMod = fieldCache.find((m) => m.slug === (step.source_module || selected))
                  const relsSrc = (srcMod && srcMod.relations || []).filter((r) => r.type === 'many_to_one')
                  const metrics = step.metrics || []
                  const updateMetric = (i, patch) => updateStep(idx, 'metrics', metrics.map((m, mi) => mi === i ? { ...m, ...patch } : m))
                  const addMetric = () => updateStep(idx, 'metrics', [...metrics, { key: 'metrica_' + Date.now(), label: 'Nuova metrica', field: '', func: 'sum', format: 'currency' }])
                  const removeMetric = (i) => updateStep(idx, 'metrics', metrics.filter((_, mi) => mi !== i))
                  const filters = step.filters || []
                  const updateFilter = (i, patch) => updateStep(idx, 'filters', filters.map((f, fi) => fi === i ? { ...f, ...patch } : f))
                  const addFilter = () => updateStep(idx, 'filters', [...filters, { field: '_stato', op: '!=', value: '' }])
                  const removeFilter = (i) => updateStep(idx, 'filters', filters.filter((_, fi) => fi !== i))
                  const filterFieldOptions = ['_stato', ...(srcMod && srcMod.fields || []).map((f) => f.key),
                    ...relsSrc.flatMap((r) => { const t = fieldCache.find((m) => m.slug === r.target_module); return (t && t.fields || []).map((f) => r.key + '.' + f.key) })]
                  return (
                    <div key={step.id} {...dragHandlers(idx)}
                      className="bg-surface-card rounded-md border border-gray-800 p-4 cursor-grab active:cursor-grabbing"
                      style={{ borderLeft: '3px solid #F59E0B' }}>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2 text-xs font-semibold text-gray-400">
                          <span className="text-gray-600 select-none">&#8942;&#8942;</span>
                          <Icon name="bar-chart" size={12} /> Riepilogo mensile per anno
                        </div>
                        <button onClick={() => removeStep(idx)} className="text-red-400/60 hover:text-red-400 transition"><Icon name="trash" size={14} /></button>
                      </div>
                      <input className="w-full bg-surface-page text-ink px-3 py-2 rounded-lg text-sm outline-none border border-gray-700 focus:border-accent transition mb-2.5" placeholder="Titolo" value={step.label || ''} onChange={(e) => updateStep(idx, 'label', e.target.value)} />

                      <div className="grid grid-cols-3 gap-2 mb-2.5">
                        <Select value={step.source_module || ''} onChange={(v) => { updateStep(idx, 'source_module', v); updateStep(idx, 'date_field', '') }} placeholder="Modulo (vuoto = questo)"
                          options={fieldCache.map((m) => ({ value: m.slug, label: m.name }))} />
                        <select className="bg-surface-page text-ink px-2 py-2 rounded-lg text-xs outline-none border border-gray-700" value={step.date_field || ''} onChange={(e) => updateStep(idx, 'date_field', e.target.value)}>
                          <option value="">Campo data...</option>
                          {(srcMod && srcMod.fields || []).filter((f) => f.type === 'date' || f.type === 'datetime').map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                        </select>
                        <label className="flex items-center gap-1.5 text-xs text-gray-400 px-2">
                          <input type="checkbox" checked={step.compare_previous_year !== false} onChange={(e) => updateStep(idx, 'compare_previous_year', e.target.checked)} />
                          Confronta anno prec.
                        </label>
                      </div>

                      <div className="bg-surface-page rounded-lg border border-gray-700 p-3 mb-2.5">
                        <div className="text-[11px] text-gray-400 font-semibold mb-2">Metriche</div>
                        {metrics.map((m, i) => (
                          <div key={i} className="grid grid-cols-[1fr_1fr_70px_28px] gap-2 mb-1.5 items-center">
                            <input className="bg-surface-card text-ink px-2 py-1.5 rounded-lg text-xs outline-none border border-gray-700" placeholder="etichetta" value={m.label || ''} onChange={(e) => updateMetric(i, { label: e.target.value })} />
                            <select className="bg-surface-card text-ink px-2 py-1.5 rounded-lg text-xs outline-none border border-gray-700" value={m.field || ''} onChange={(e) => updateMetric(i, { field: e.target.value })} disabled={m.func === 'count'}>
                              <option value="">campo...</option>
                              {(srcMod && srcMod.fields || []).filter((f) => ['number', 'currency', 'computed'].includes(f.type)).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                            </select>
                            <select className="bg-surface-card text-ink px-2 py-1.5 rounded-lg text-xs outline-none border border-gray-700" value={m.func || 'sum'} onChange={(e) => updateMetric(i, { func: e.target.value })}>
                              <option value="sum">somma</option>
                              <option value="count">conteggio</option>
                              <option value="avg">media</option>
                            </select>
                            <button onClick={() => removeMetric(i)} className="text-red-400/60 hover:text-red-400 transition"><Icon name="trash" size={12} /></button>
                          </div>
                        ))}
                        <button onClick={addMetric} className="text-xs text-accent hover:opacity-80 transition mt-1">+ Aggiungi metrica</button>
                      </div>

                      <div className="bg-surface-page rounded-lg border border-gray-700 p-3">
                        <div className="text-[11px] text-gray-400 font-semibold mb-2">Filtri (opzionali)</div>
                        {filters.map((f, i) => (
                          <div key={i} className="grid grid-cols-[1fr_70px_1fr_28px] gap-2 mb-1.5 items-center">
                            <select className="bg-surface-card text-ink px-2 py-1.5 rounded-lg text-xs outline-none border border-gray-700" value={f.field || ''} onChange={(e) => updateFilter(i, { field: e.target.value })}>
                              {filterFieldOptions.map((k) => <option key={k} value={k}>{k}</option>)}
                            </select>
                            <select className="bg-surface-card text-ink px-2 py-1.5 rounded-lg text-xs outline-none border border-gray-700" value={f.op || '=='} onChange={(e) => updateFilter(i, { op: e.target.value })}>
                              {['==', '!=', '>', '<', '>=', '<='].map((o) => <option key={o} value={o}>{o}</option>)}
                            </select>
                            <input className="bg-surface-card text-ink px-2 py-1.5 rounded-lg text-xs outline-none border border-gray-700" placeholder="valore" value={f.value || ''} onChange={(e) => updateFilter(i, { value: e.target.value })} />
                            <button onClick={() => removeFilter(i)} className="text-red-400/60 hover:text-red-400 transition"><Icon name="trash" size={12} /></button>
                          </div>
                        ))}
                        <button onClick={addFilter} className="text-xs text-accent hover:opacity-80 transition mt-1">+ Aggiungi filtro</button>
                      </div>
                    </div>
                  )
                }

                if (step.block_type === 'category_pivot') {
                  const srcMod = fieldCache.find((m) => m.slug === (step.source_module || selected))
                  return (
                    <div key={step.id} {...dragHandlers(idx)}
                      className="bg-surface-card rounded-md border border-gray-800 p-4 cursor-grab active:cursor-grabbing"
                      style={{ borderLeft: '3px solid #EC4899' }}>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2 text-xs font-semibold text-gray-400">
                          <span className="text-gray-600 select-none">&#8942;&#8942;</span>
                          <Icon name="grid" size={12} /> Pivot per categoria
                        </div>
                        <button onClick={() => removeStep(idx)} className="text-red-400/60 hover:text-red-400 transition"><Icon name="trash" size={14} /></button>
                      </div>
                      <input className="w-full bg-surface-page text-ink px-3 py-2 rounded-lg text-sm outline-none border border-gray-700 focus:border-accent transition mb-2.5" placeholder="Titolo" value={step.label || ''} onChange={(e) => updateStep(idx, 'label', e.target.value)} />

                      <Select value={step.source_module || ''} onChange={(v) => { updateStep(idx, 'source_module', v); updateStep(idx, 'date_field', ''); updateStep(idx, 'group_by', ''); updateStep(idx, 'metric_field', '') }} placeholder="Modulo (vuoto = questo)"
                        options={fieldCache.map((m) => ({ value: m.slug, label: m.name }))} className="mb-2.5" />

                      <div className="grid grid-cols-2 gap-2 mb-2.5">
                        <select className="bg-surface-page text-ink px-2 py-2 rounded-lg text-xs outline-none border border-gray-700" value={step.date_field || ''} onChange={(e) => updateStep(idx, 'date_field', e.target.value)}>
                          <option value="">Campo data...</option>
                          {(srcMod && srcMod.fields || []).filter((f) => f.type === 'date' || f.type === 'datetime').map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                        </select>
                        <select className="bg-surface-page text-ink px-2 py-2 rounded-lg text-xs outline-none border border-gray-700" value={step.group_by || ''} onChange={(e) => updateStep(idx, 'group_by', e.target.value)}>
                          <option value="">Raggruppa per...</option>
                          {(srcMod && srcMod.fields || []).filter((f) => f.type === 'select' || f.type === 'text').map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                        </select>
                      </div>
                      <div className="grid grid-cols-3 gap-2 mb-2.5">
                        <select className="bg-surface-page text-ink px-2 py-2 rounded-lg text-xs outline-none border border-gray-700" value={step.metric_field || ''} onChange={(e) => updateStep(idx, 'metric_field', e.target.value)}>
                          <option value="">Campo metrica...</option>
                          {(srcMod && srcMod.fields || []).filter((f) => ['number', 'currency', 'computed'].includes(f.type)).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                        </select>
                        <select className="bg-surface-page text-ink px-2 py-2 rounded-lg text-xs outline-none border border-gray-700" value={step.metric_func || 'sum'} onChange={(e) => updateStep(idx, 'metric_func', e.target.value)}>
                          <option value="sum">somma</option>
                          <option value="avg">media</option>
                          <option value="count">conteggio</option>
                        </select>
                        <input type="number" min="1" max="10" className="bg-surface-page text-ink px-2 py-2 rounded-lg text-xs outline-none border border-gray-700" placeholder="N anni" value={step.n_years ?? 2} onChange={(e) => updateStep(idx, 'n_years', parseInt(e.target.value) || 2)} />
                      </div>
                    </div>
                  )
                }

                if (step.block_type === 'weekly_breakdown') {
                  const srcMod = fieldCache.find((m) => m.slug === (step.source_module || selected))
                  return (
                    <div key={step.id} {...dragHandlers(idx)}
                      className="bg-surface-card rounded-md border border-gray-800 p-4 cursor-grab active:cursor-grabbing"
                      style={{ borderLeft: '3px solid #2563EB' }}>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2 text-xs font-semibold text-gray-400">
                          <span className="text-gray-600 select-none">&#8942;&#8942;</span>
                          <Icon name="bar-chart" size={12} /> Ore per settimana
                        </div>
                        <button onClick={() => removeStep(idx)} className="text-red-400/60 hover:text-red-400 transition"><Icon name="trash" size={14} /></button>
                      </div>
                      <input className="w-full bg-surface-page text-ink px-3 py-2 rounded-lg text-sm outline-none border border-gray-700 focus:border-accent transition mb-2.5" placeholder="Titolo" value={step.label || ''} onChange={(e) => updateStep(idx, 'label', e.target.value)} />

                      <Select value={step.source_module || ''} onChange={(v) => { updateStep(idx, 'source_module', v); updateStep(idx, 'date_field', ''); updateStep(idx, 'metric_field', '') }} placeholder="Modulo (vuoto = questo)"
                        options={fieldCache.map((m) => ({ value: m.slug, label: m.name }))} className="mb-2.5" />

                      <div className="grid grid-cols-2 gap-2 mb-2.5">
                        <select className="bg-surface-page text-ink px-2 py-2 rounded-lg text-xs outline-none border border-gray-700" value={step.date_field || ''} onChange={(e) => updateStep(idx, 'date_field', e.target.value)}>
                          <option value="">Campo data...</option>
                          {(srcMod && srcMod.fields || []).filter((f) => f.type === 'date' || f.type === 'datetime').map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                        </select>
                        <select className="bg-surface-page text-ink px-2 py-2 rounded-lg text-xs outline-none border border-gray-700" value={step.metric_field || ''} onChange={(e) => updateStep(idx, 'metric_field', e.target.value)}>
                          <option value="">Campo metrica...</option>
                          {(srcMod && srcMod.fields || []).filter((f) => ['number', 'currency', 'computed'].includes(f.type)).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                        </select>
                      </div>
                      <div className="grid grid-cols-3 gap-2 mb-2.5">
                        <select className="bg-surface-page text-ink px-2 py-2 rounded-lg text-xs outline-none border border-gray-700" value={step.metric_func || 'sum'} onChange={(e) => updateStep(idx, 'metric_func', e.target.value)}>
                          <option value="sum">somma</option>
                          <option value="avg">media</option>
                          <option value="count">conteggio</option>
                        </select>
                        <select className="bg-surface-page text-ink px-2 py-2 rounded-lg text-xs outline-none border border-gray-700" value={step.metric_format || 'number'} onChange={(e) => updateStep(idx, 'metric_format', e.target.value)}>
                          <option value="number">numero</option>
                          <option value="currency">valuta</option>
                        </select>
                        <input type="number" className="bg-surface-page text-ink px-2 py-2 rounded-lg text-xs outline-none border border-gray-700" placeholder="Soglia (opz.)" value={step.threshold ?? ''} onChange={(e) => updateStep(idx, 'threshold', e.target.value === '' ? undefined : parseFloat(e.target.value))} />
                      </div>
                      <div className="text-[10px] text-gray-600">La soglia è nella stessa unità del campo metrica (es. minuti, se il campo calcolato durata è in minuti) — oltre questo valore per settimana viene sommato come "oltre soglia" (es. straordinari).</div>
                    </div>
                  )
                }

                if (step.block_type === 'view_tabs') {
                  const tabs = step.tabs || []
                  const updateTabs = (next) => updateStep(idx, 'tabs', next)
                  const addTab = () => updateTabs([...tabs, { key: 'tab_' + Date.now(), label: '', block_type: 'period_view', block_key: '', source_module: null }])
                  const updateTab = (ti, patch) => updateTabs(tabs.map((t, i) => i === ti ? { ...t, ...patch } : t))
                  const removeTab = (ti) => updateTabs(tabs.filter((_, i) => i !== ti))
                  const BLOCK_TYPE_LABELS = { period_view: 'Vista per periodo', distance_buckets: 'Vista per distanza', parent_children_view: 'Genitori con figli', reconciliation: 'Riconciliazione', financial_statement: 'Bilancio contabile' }
                  const BLOCK_ARRAY_KEY = { period_view: 'period_views', distance_buckets: 'distance_buckets', parent_children_view: 'parent_children_views', reconciliation: 'reconciliations', financial_statement: 'financial_statements' }
                  return (
                    <div key={step.id} {...dragHandlers(idx)}
                      className="bg-surface-card rounded-md border border-gray-800 p-4 cursor-grab active:cursor-grabbing"
                      style={{ borderLeft: '3px solid #8B5CF6' }}>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2 text-xs font-semibold text-gray-400">
                          <span className="text-gray-600 select-none">&#8942;&#8942;</span>
                          <Icon name="list" size={12} /> Tab della vista
                        </div>
                        <button onClick={() => removeStep(idx)} className="text-red-400/60 hover:text-red-400 transition"><Icon name="trash" size={14} /></button>
                      </div>
                      <div className="space-y-3">
                        {tabs.map((t, ti) => {
                          const srcSlug = t.source_module || selected
                          const srcMod = fieldCache.find((m) => m.slug === srcSlug)
                          const arrayKey = BLOCK_ARRAY_KEY[t.block_type]
                          const blockOpts = (srcMod && srcMod[arrayKey] || []).map((b) => ({ value: b.key, label: b.label || b.key }))
                          return (
                            <div key={ti} className="bg-surface-page rounded-lg border border-gray-700 p-3 space-y-2">
                              <div className="flex items-center gap-2">
                                <input className="flex-1 bg-surface-card text-ink px-2 py-1.5 rounded text-xs outline-none border border-gray-700 focus:border-cp-purple transition placeholder-gray-600"
                                  placeholder="Etichetta tab (es. Debiti)" value={t.label || ''} onChange={(e) => updateTab(ti, { label: e.target.value })} />
                                <button onClick={() => removeTab(ti)} className="text-red-400/50 hover:text-red-400 transition flex-shrink-0"><Icon name="trash" size={13} /></button>
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <Select value={t.source_module || ''} onChange={(v) => updateTab(ti, { source_module: v || null, block_key: '' })} placeholder="Modulo (vuoto = questo)"
                                  options={fieldCache.map((m) => ({ value: m.slug, label: m.name }))} />
                                <select className="bg-surface-card text-ink px-2 py-1.5 rounded text-xs outline-none border border-gray-700"
                                  value={t.block_type || 'period_view'} onChange={(e) => updateTab(ti, { block_type: e.target.value, block_key: '' })}>
                                  {Object.entries(BLOCK_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                                </select>
                              </div>
                              <Select value={t.block_key || ''} onChange={(v) => updateTab(ti, { block_key: v })}
                                placeholder="Quale blocco..." options={blockOpts} />
                              {blockOpts.length === 0 && <div className="text-[10px] text-gray-600">Nessun blocco di questo tipo su "{srcSlug}" — creane uno prima (qui o sul modulo scelto).</div>}
                            </div>
                          )
                        })}
                        <button onClick={addTab} className="text-cp-purple hover:opacity-80 text-xs transition flex items-center gap-1">
                          <Icon name="plus" size={12} />Aggiungi tab
                        </button>
                        {tabs.length === 0 && <div className="text-[10px] text-gray-600">Nessuna tab — "Aggiungi tab" per iniziare (servono almeno 2).</div>}
                      </div>
                    </div>
                  )
                }

                if (step.block_type === 'document_template') return (
                  <div key={step.id} {...dragHandlers(idx)}
                    className="bg-surface-card rounded-md border border-gray-800 p-4 cursor-grab active:cursor-grabbing"
                    style={{ borderLeft: '3px solid #06B6D4' }}>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2 text-xs font-semibold text-gray-400">
                        <span className="text-gray-600 select-none">&#8942;&#8942;</span>
                        <Icon name="file" size={12} /> Documento stampabile
                      </div>
                      <button onClick={() => removeStep(idx)} className="text-red-400/60 hover:text-red-400 transition"><Icon name="trash" size={14} /></button>
                    </div>
                    <div className="grid grid-cols-3 gap-2 mb-3">
                      <div className="col-span-2">
                        <label className="text-[10px] text-gray-500 block mb-1">Nome (il bottone che vede l'utente)</label>
                        <input className="w-full bg-surface-page text-ink px-3 py-2 rounded-lg text-sm outline-none border border-gray-700 focus:border-accent transition placeholder-gray-600"
                          placeholder="es. Bolla 80mm, Fattura" value={step.nome || ''} onChange={(e) => updateStep(idx, 'nome', e.target.value)} />
                      </div>
                      <div>
                        <label className="text-[10px] text-gray-500 block mb-1">Formato</label>
                        <select className="w-full bg-surface-page text-ink px-2 py-2 rounded-lg text-sm outline-none border border-gray-700 focus:border-accent transition"
                          value={step.formato || 'a4'} onChange={(e) => updateStep(idx, 'formato', e.target.value)}>
                          <option value="a4">Pagina intera</option>
                          <option value="80mm">80mm (scontrino/bolla)</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500 block mb-1">Contenuto HTML</label>
                      <textarea
                        className="w-full bg-surface-page text-gray-300 px-3 py-2 rounded-lg text-xs outline-none border border-gray-700 focus:border-accent transition font-mono"
                        rows={10}
                        placeholder={'<h2>Ordine {{campo:numero}}</h2>\n<div>Cliente: {{campo:cliente}}</div>\n{{#righe modulo="ordini_righe" campo="ordine"}}\n  <div>{{campo:prodotto}} x {{campo:quantita}}</div>\n{{/righe}}\n<div>Totale: {{campo:totale}}</div>'}
                        value={step.contenuto_html || ''}
                        onChange={(e) => updateStep(idx, 'contenuto_html', e.target.value)}
                      />
                      <div className="text-[10px] text-gray-600 mt-2 space-y-0.5">
                        <div><code className="text-cyan-500">{'{{campo:X}}'}</code> — campo X del record (una relazione mostra il nome collegato, non l'id)</div>
                        <div><code className="text-cyan-500">{'{{azienda:X}}'}</code> — ragione_sociale / indirizzo / piva / logo_url del tenant</div>
                        <div><code className="text-cyan-500">{'{{oggi}}'}</code> — data odierna</div>
                        <div><code className="text-cyan-500">{'{{#righe modulo="..." campo="..."}}...{{/righe}}'}</code> — ripete il contenuto per ogni riga figlia (es. righe ordine)</div>
                      </div>
                      <DocumentTemplatePreview slug={selected} api={api} template={step} />
                    </div>
                  </div>
                )

                if (step.block_type === 'report_aggregate') {
                  // Due forme distinte, mai miste sullo stesso blocco: "valore singolo"
                  // (expr testuale, esistente) per un numero solo — es. margine totale —
                  // e "raggruppato" (group_by/metric/func/source_module, nuova) per una
                  // vista tipo Report — es. saldo per centro di costo — eseguita da
                  // GET /:slug/report (vedi records.js). Il toggle sceglie tra le due
                  // ripulendo le chiavi dell'altra, così un blocco non porta mai in giro
                  // proprietà di un modo che non sta più usando.
                  const isGrouped = !!step.group_by
                  const sourceSlug = step.source_module || selected
                  const sourceMod = fieldCache.find((m) => m.slug === sourceSlug)
                  const sourceFields = (sourceMod && sourceMod.fields || []).filter((f) => f.type !== 'computed' || true)
                  const numericFields = (sourceMod && sourceMod.fields || []).filter((f) => ['number', 'currency', 'computed'].includes(f.type))
                  const sourceRelations = (sourceMod && sourceMod.relations || []).filter((r) => r.type === 'many_to_one')
                  return (
                  <div key={step.id} {...dragHandlers(idx)}
                    className="bg-surface-card rounded-md border border-gray-800 p-4 cursor-grab active:cursor-grabbing"
                    style={{ borderLeft: '3px solid #F87171' }}>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2 text-xs font-semibold text-gray-400">
                        <span className="text-gray-600 select-none">&#8942;&#8942;</span>
                        &#8721; {isGrouped ? 'Report raggruppato' : 'Formula'}
                      </div>
                      <button onClick={() => removeStep(idx)} className="text-red-400/60 hover:text-red-400 transition"><Icon name="trash" size={14} /></button>
                    </div>
                    <div className="grid grid-cols-2 gap-3 mb-2">
                      <input className="w-full bg-surface-page text-ink px-3 py-2 rounded-lg text-sm outline-none border border-gray-700 focus:border-accent transition" placeholder="Label" value={step.label} onChange={(e) => updateStep(idx, 'label', e.target.value)} />
                      <select className="w-full bg-surface-page text-ink px-3 py-2 rounded-lg text-sm outline-none border border-gray-700 focus:border-accent transition" value={step.format} onChange={(e) => updateStep(idx, 'format', e.target.value)}>
                        <option value="number">Numero</option>
                        <option value="currency">Valuta (EUR)</option>
                        <option value="percent">Percentuale</option>
                      </select>
                    </div>
                    <div className="flex gap-1.5 mb-3">
                      <button type="button" onClick={() => { updateStep(idx, 'group_by', undefined); updateStep(idx, 'metric', undefined); updateStep(idx, 'metric_subtract', undefined); updateStep(idx, 'func', undefined); updateStep(idx, 'source_module', undefined) }}
                        className={'flex-1 py-1.5 rounded-lg text-xs font-medium transition ' + (!isGrouped ? 'bg-accent text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200')}>
                        Valore singolo
                      </button>
                      <button type="button" onClick={() => { updateStep(idx, 'expr', undefined); updateStep(idx, 'group_by', ''); updateStep(idx, 'func', 'sum') }}
                        className={'flex-1 py-1.5 rounded-lg text-xs font-medium transition ' + (isGrouped ? 'bg-accent text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200')}>
                        Raggruppato per gruppo
                      </button>
                    </div>
                    {!isGrouped ? (
                      <>
                      <div className="mb-2">
                        <label className="text-[11px] text-gray-500 block mb-1">Chiave (per referenziarlo da un altro aggregato, es. in un "indice")</label>
                        <input className="w-full bg-surface-page text-gray-300 px-3 py-2 rounded-lg text-xs outline-none border border-gray-700 focus:border-accent transition font-mono"
                          value={step.key || ''} onChange={(e) => updateStep(idx, 'key', e.target.value.replace(/[^a-zA-Z0-9_]/g, '_'))} />
                      </div>
                      <FormulaEditor
                        value={step.expr}
                        onChange={(v) => updateStep(idx, 'expr', v)}
                        fieldCache={fieldCache}
                        api={api}
                      />
                      <label className="flex items-center gap-2 mt-2 text-xs text-gray-500 cursor-pointer">
                        <input type="checkbox" checked={!!step.internal} onChange={(e) => updateStep(idx, 'internal', e.target.checked || undefined)} />
                        Interno — non mostrare una card propria (solo referenziabile da un altro aggregato)
                      </label>
                      </>
                    ) : (
                      <div className="space-y-2.5">
                        <div>
                          <label className="text-[11px] text-gray-500 block mb-1">Modulo sorgente</label>
                          <select className="w-full bg-surface-page text-ink px-3 py-2 rounded-lg text-sm outline-none border border-gray-700 focus:border-accent transition"
                            value={sourceSlug} onChange={(e) => { updateStep(idx, 'source_module', e.target.value === selected ? undefined : e.target.value); updateStep(idx, 'group_by', ''); updateStep(idx, 'metric', undefined); updateStep(idx, 'metric_subtract', undefined) }}>
                            {fieldCache.map((m) => <option key={m.slug} value={m.slug}>{m.name}{m.slug === selected ? ' (questo modulo)' : ''}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="text-[11px] text-gray-500 block mb-1">Raggruppa per</label>
                          <select className="w-full bg-surface-page text-ink px-3 py-2 rounded-lg text-sm outline-none border border-gray-700 focus:border-accent transition"
                            value={step.group_by || ''} onChange={(e) => updateStep(idx, 'group_by', e.target.value)}>
                            <option value="">-- scegli un campo --</option>
                            <optgroup label={(sourceMod && sourceMod.name) || sourceSlug}>
                              {sourceFields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                            </optgroup>
                            {sourceRelations.map((rel) => {
                              const targetMod = fieldCache.find((m) => m.slug === rel.target_module)
                              return (
                                <optgroup key={rel.key} label={'via ' + rel.label + ' → ' + ((targetMod && targetMod.name) || rel.target_module)}>
                                  {(targetMod && targetMod.fields || []).map((f) => (
                                    <option key={rel.key + '.' + f.key} value={rel.key + '.' + f.key}>{f.label}</option>
                                  ))}
                                </optgroup>
                              )
                            })}
                          </select>
                          <div className="text-[10px] text-gray-600 mt-1">Un campo con "via ..." raggruppa per un campo del modulo collegato tramite quella relazione — es. il centro di costo del conto, non del movimento stesso.</div>
                        </div>
                        <div className="grid grid-cols-2 gap-2.5">
                          <div>
                            <label className="text-[11px] text-gray-500 block mb-1">Campo da aggregare</label>
                            <select className="w-full bg-surface-page text-ink px-3 py-2 rounded-lg text-sm outline-none border border-gray-700 focus:border-accent transition"
                              value={step.metric || ''} onChange={(e) => updateStep(idx, 'metric', e.target.value)}>
                              <option value="">-- scegli un campo --</option>
                              {step.func === 'count' && <option value="count">(nessuno — solo conteggio)</option>}
                              {numericFields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="text-[11px] text-gray-500 block mb-1">Funzione</label>
                            <select className="w-full bg-surface-page text-ink px-3 py-2 rounded-lg text-sm outline-none border border-gray-700 focus:border-accent transition"
                              value={step.func || 'sum'} onChange={(e) => updateStep(idx, 'func', e.target.value)}>
                              <option value="sum">Somma</option>
                              <option value="avg">Media</option>
                              <option value="min">Minimo</option>
                              <option value="max">Massimo</option>
                              <option value="count">Conteggio</option>
                            </select>
                          </div>
                        </div>
                        <div>
                          <label className="text-[11px] text-gray-500 block mb-1">Sottrai (opzionale — es. saldo = Dare meno Avere)</label>
                          <select className="w-full bg-surface-page text-ink px-3 py-2 rounded-lg text-sm outline-none border border-gray-700 focus:border-accent transition"
                            value={step.metric_subtract || ''} onChange={(e) => updateStep(idx, 'metric_subtract', e.target.value || undefined)}>
                            <option value="">-- nessuno --</option>
                            {numericFields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                          </select>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                if (step.block_type === 'automation') return (
                  <div key={step.id} {...dragHandlers(idx)}
                    className="bg-surface-card rounded-md border border-gray-800 p-4 cursor-grab active:cursor-grabbing"
                    style={{ borderLeft: '3px solid #FBBF24' }}>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2 text-xs font-semibold text-gray-400">
                        <span className="text-gray-600 select-none">&#8942;&#8942;</span>
                        <Icon name="zap" size={12} /> Automazione
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => updateStep(idx, 'enabled', step.enabled === false)}
                          title={step.enabled === false ? 'Disattivata — clic per riattivare' : 'Attiva — clic per mettere in pausa'}
                          className={'text-[10px] px-2 py-0.5 rounded-full transition flex items-center gap-1 ' + (step.enabled === false ? 'bg-gray-800 text-gray-500' : 'bg-green-900/30 text-green-400')}>
                          <span className={'w-1.5 h-1.5 rounded-full ' + (step.enabled === false ? 'bg-gray-600' : 'bg-green-400')} />
                          {step.enabled === false ? 'In pausa' : 'Attiva'}
                        </button>
                        <button onClick={() => removeStep(idx)} className="text-red-400/60 hover:text-red-400 transition"><Icon name="trash" size={14} /></button>
                      </div>
                    </div>
                    <input className="w-full bg-surface-page text-ink px-3 py-2 rounded-lg text-sm outline-none border border-gray-700 focus:border-accent transition mb-2"
                      placeholder="Nome automazione" value={step.label} onChange={(e) => updateStep(idx, 'label', e.target.value)} />
                    <div className="grid grid-cols-2 gap-2 mb-3">
                      <select className="w-full bg-surface-page text-ink px-3 py-2 rounded-lg text-sm outline-none border border-gray-700 focus:border-accent transition"
                        value={step.trigger.evento} onChange={(e) => updateStep(idx, 'trigger', { ...step.trigger, evento: e.target.value })}>
                        <option value="nuovo_record">Quando: Nuovo record</option>
                        <option value="cambio_stato">Quando: Cambio stato</option>
                        <option value="modifica_campo">Quando: Modifica campo</option>
                        <option value="schedulato">Pianificato: schedule</option>
                      </select>
                      {step.trigger.evento === 'cambio_stato' && (
                        <select className="w-full bg-surface-page text-ink px-3 py-2 rounded-lg text-sm outline-none border border-gray-700 focus:border-accent transition"
                          value={step.trigger.stato || ''} onChange={(e) => updateStep(idx, 'trigger', { ...step.trigger, stato: e.target.value })}>
                          <option value="">Qualunque stato</option>
                          {schema.steps.filter((s) => s.block_type === 'workflow_state').map((s) => <option key={s.key} value={s.key}>&#8594; {s.label}</option>)}
                        </select>
                      )}
                      {step.trigger.evento === 'modifica_campo' && (
                        <select className="w-full bg-surface-page text-ink px-3 py-2 rounded-lg text-sm outline-none border border-gray-700 focus:border-accent transition"
                          value={step.trigger.campo || ''} onChange={(e) => updateStep(idx, 'trigger', { ...step.trigger, campo: e.target.value })}>
                          <option value="">Qualunque campo</option>
                          {schema.steps.filter((s) => s.block_type === 'field').map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                        </select>
                      )}
                      {step.trigger.evento === 'schedulato' && (() => {
                        const sched = step.trigger.schedulazione || {}
                        const setSched = (patch) => updateStep(idx, 'trigger', { ...step.trigger, schedulazione: { ...sched, ...patch } })
                        return (
                          <div className="col-span-2 bg-surface-page rounded-lg p-3 border border-gray-700 space-y-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <select className="bg-surface-card text-ink px-2 py-1.5 rounded-md text-xs outline-none border border-gray-700" value={sched.tipo || 'giornaliero'} onChange={(e) => setSched({ tipo: e.target.value })}>
                                <option value="giornaliero">Ogni giorno</option>
                                <option value="mensile">Ogni mese</option>
                                <option value="ogni_N_giorni">Ogni N giorni</option>
                              </select>
                              {sched.tipo === 'mensile' && (
                                <span className="flex items-center gap-1 text-xs text-gray-400">
                                  giorno <input type="number" min="1" max="31" className="w-12 bg-surface-card text-ink px-2 py-1.5 rounded-md text-xs outline-none border border-gray-700" value={sched.giorno || 1} onChange={(e) => setSched({ giorno: parseInt(e.target.value) || 1 })} />
                                </span>
                              )}
                              {sched.tipo === 'ogni_N_giorni' && (
                                <span className="flex items-center gap-1 text-xs text-gray-400">
                                  ogni <input type="number" min="1" className="w-12 bg-surface-card text-ink px-2 py-1.5 rounded-md text-xs outline-none border border-gray-700" value={sched.giorni || 30} onChange={(e) => setSched({ giorni: parseInt(e.target.value) || 30 })} /> giorni
                                </span>
                              )}
                              <span className="flex items-center gap-1 text-xs text-gray-400">
                                alle <input type="number" min="0" max="23" className="w-12 bg-surface-card text-ink px-2 py-1.5 rounded-md text-xs outline-none border border-gray-700" value={sched.ora !== undefined ? sched.ora : 6} onChange={(e) => setSched({ ora: parseInt(e.target.value) || 0 })} />:00 UTC
                              </span>
                            </div>
                            <div className="pt-2 border-t border-gray-800">
                              <label className="text-[10px] text-gray-500 block mb-1">Modalità</label>
                              <select className="w-full bg-surface-card text-ink px-2 py-1.5 rounded-md text-xs outline-none border border-gray-700 mb-2"
                                value={step.trigger.modalita || 'aggregata'}
                                onChange={(e) => updateStep(idx, 'trigger', { ...step.trigger, modalita: e.target.value === 'aggregata' ? undefined : e.target.value })}>
                                <option value="aggregata">Aggregata (esegue una volta sola)</option>
                                <option value="per_record">Per ogni record di questo modulo che soddisfa un filtro</option>
                              </select>
                              {step.trigger.modalita === 'per_record' && (() => {
                                const filtro = step.trigger.filtro || []
                                const fieldOptions = schema.steps.filter((s) => s.block_type === 'field')
                                const setFiltro = (next) => updateStep(idx, 'trigger', { ...step.trigger, filtro: next })
                                const updateRow = (i, patch) => setFiltro(filtro.map((f, fi) => fi === i ? { ...f, ...patch } : f))
                                const removeRow = (i) => setFiltro(filtro.filter((_, fi) => fi !== i))
                                const addRow = () => setFiltro([...filtro, { campo: '', op: '==', valore: '' }])
                                return (
                                  <div className="space-y-1.5">
                                    <div className="text-[10px] text-gray-500">Filtro (tutte le condizioni in AND) — usa "_oggi_" come valore per confrontare con la data odierna, o lascia il valore vuoto per "campo non impostato"</div>
                                    {filtro.map((f, i) => (
                                      <div key={i} className="flex items-center gap-1.5">
                                        <select className="bg-surface-card text-ink px-2 py-1.5 rounded-md text-xs outline-none border border-gray-700 flex-1" value={f.campo || ''} onChange={(e) => updateRow(i, { campo: e.target.value })}>
                                          <option value="">Campo...</option>
                                          <option value="_stato">_stato</option>
                                          {fieldOptions.map((fo) => <option key={fo.key} value={fo.key}>{fo.label || fo.key}</option>)}
                                        </select>
                                        <select className="bg-surface-card text-ink px-2 py-1.5 rounded-md text-xs outline-none border border-gray-700 w-16" value={f.op || '=='} onChange={(e) => updateRow(i, { op: e.target.value })}>
                                          <option value="==">=</option><option value="!=">&ne;</option>
                                          <option value="<">&lt;</option><option value=">">&gt;</option>
                                          <option value="<=">&le;</option><option value=">=">&ge;</option>
                                        </select>
                                        <input className="flex-1 bg-surface-card text-ink px-2 py-1.5 rounded-md text-xs outline-none border border-gray-700 placeholder-gray-600" placeholder="valore, o _oggi_" value={f.valore ?? ''} onChange={(e) => updateRow(i, { valore: e.target.value })} />
                                        <button onClick={() => removeRow(i)} className="text-red-400/60 hover:text-red-400 transition"><Icon name="trash" size={12} /></button>
                                      </div>
                                    ))}
                                    <button onClick={addRow} className="w-full py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-[11px] font-medium transition">+ Condizione</button>
                                  </div>
                                )
                              })()}
                            </div>
                          </div>
                        )
                      })()}
                    </div>
                    <AutomationActionsList
                      azioni={step.azioni}
                      onChange={(v) => updateStep(idx, 'azioni', v)}
                      connections={connections}
                      fields={schema.steps.filter((s) => s.block_type === 'field')}
                      allowCondition={true}
                      allRoles={allRoles}
                    />
                    <div className="text-[10px] text-gray-600 mt-2">Le azioni verso un connettore esterno restano disattivate finché non è collegato (vai su Store, sulla card del modulo). Con credenziali configurate: Slack (webhook), WhatsApp Business, Mailchimp e Stripe eseguono chiamate reali. Senza credenziali: l'esecuzione viene loggata come simulata.</div>
                    <AutomationDryRun slug={selected} api={api} automation={step} />
                  </div>
                )

                return null
                })()
                if (!rendered) return null
                // Card collassata di default (canvas a griglia, 2026-08-16) — solo la
                // riga di riepilogo è sempre montata; il corpo di editing completo
                // (`rendered`, invariato per tipo) si monta solo quando espansa. La
                // card espansa occupa l'intera riga (col-span-full) — molti editor
                // per-tipo (automazioni, riconciliazione...) hanno bisogno di più
                // spazio di quanto ne dia una colonna della griglia.
                return (
                  <div key={step.id} className={expanded ? 'col-span-full' : ''}>
                    <div {...dragHandlers(idx)} onClick={() => toggleExpanded(step.id)}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg border text-xs cursor-pointer select-none transition bg-surface-card border-gray-800 hover:border-gray-700 text-gray-400 hover:text-ink mb-1.5">
                      <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={11} className="flex-shrink-0" />
                      <span className="truncate flex-1">{summaryForStep(step)}</span>
                    </div>
                    {expanded && rendered}
                  </div>
                )
              })}

              {schema.steps.length === 0 && (
                <div className="col-span-full border border-dashed border-gray-800 rounded-xl text-center py-12 text-gray-600 text-sm">
                  Nessun blocco ancora — inizia aggiungendone uno.
                </div>
              )}
            </div>

            {showPreview && (
              <div className="w-full lg:w-[380px] flex-shrink-0 sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto bg-surface-card rounded-md border border-gray-800 p-4">
                <div className="text-sm font-medium text-ink mb-3 flex items-center gap-1.5"><Icon name="eye" size={14} />Anteprima live</div>
                <BuilderPreviewPanel schema={schema} />
              </div>
            )}
            </div>

            <BottomPanel schema={schema} fieldCache={fieldCache} allRoles={allRoles}
              activeTab={bottomTab} setActiveTab={setBottomTab} collapsed={bottomCollapsed} setCollapsed={setBottomCollapsed} />
          </div>
        )}
      </div>

      {selected && schema && !showCanvas && (
        <PropertiesPanel mod={modules.find((m) => m.slug === selected)} schema={schema} fieldCache={fieldCache} allModules={modules}
          onUpdate={(patch) => updateModuleIconColor(selected, patch)}
          onSelectModule={(slug) => { setShowCanvas(false); selectModule(slug) }}
          showIconPicker={showIconPicker} setShowIconPicker={setShowIconPicker}
          history={history} restoreVersion={restoreVersion} tab={propTab} setTab={setPropTab} />
      )}

      {showNewModule && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-surface-card rounded-md p-6 w-full max-w-sm border border-gray-800">
            <div className="flex items-center gap-2 mb-4">
              <h2 className="text-lg font-bold text-ink">Nuovo Modulo</h2>
              <span className="text-xs text-gray-600 ml-auto">Passo {wizardStep} di 2</span>
            </div>

            {wizardStep === 1 && (
              <>
                <input autoFocus className="w-full bg-surface-page text-ink px-4 py-3 rounded-lg outline-none border border-gray-800 focus:border-accent transition placeholder-gray-600 mb-4" placeholder="Nome del modulo" value={newModuleName} onChange={(e) => setNewModuleName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && newModuleName.trim() && setWizardStep(2)} />
                {newModuleName && <div className="text-xs text-gray-500 mb-4 font-mono">slug: {newModuleName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}</div>}

                <div className="mb-3">
                  <div className="text-xs text-gray-500 mb-2">Icona</div>
                  <div className="grid grid-cols-4 sm:grid-cols-8 gap-1.5">
                    {MODULE_ICON_CHOICES.map((ic) => (
                      <button key={ic} type="button" onClick={() => setNewModuleIcon(ic)}
                        className={'w-8 h-8 rounded-lg flex items-center justify-center transition border ' + (newModuleIcon === ic ? 'border-accent bg-accent/20 text-accent' : 'border-gray-800 bg-gray-800/50 text-gray-500 hover:text-gray-300')}>
                        <Icon name={ic} size={14} />
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mb-5">
                  <div className="text-xs text-gray-500 mb-2">Colore</div>
                  <div className="flex gap-1.5">
                    {MODULE_COLOR_CHOICES.map((c) => (
                      <button key={c} type="button" onClick={() => setNewModuleColor(c)}
                        className={'w-7 h-7 rounded-lg transition border-2 ' + (newModuleColor === c ? 'border-white' : 'border-transparent')}
                        style={{ backgroundColor: c }} />
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-2 mb-5 p-3 bg-surface-page rounded-lg">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: newModuleColor + '22', color: newModuleColor }}>
                    <Icon name={newModuleIcon} size={16} />
                  </div>
                  <span className="text-sm text-gray-400">{newModuleName || 'Anteprima modulo'}</span>
                </div>

                <label className="flex items-start gap-2 mb-5 cursor-pointer">
                  <input type="checkbox" checked={newModuleSupport} onChange={(e) => setNewModuleSupport(e.target.checked)} className="accent-accent mt-0.5" />
                  <span>
                    <span className="text-xs text-gray-300 block">Modulo di supporto</span>
                    <span className="text-[10px] text-gray-600 block mt-0.5">Non compare nello Store né nel menu laterale — usalo per moduli che esistono solo come collegati ad altri (es. righe di un ordine), non per moduli che le persone devono aprire direttamente. Resta un modulo vero, modificabile qui nel Builder in ogni momento.</span>
                  </span>
                </label>

                <div className="mb-5">
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input type="checkbox" checked={!!templateSlug}
                      onChange={(e) => { setTemplateSlug(e.target.checked ? STARTER_TEMPLATES[0].slug : ''); if (e.target.checked) setCloneFromSlug('') }}
                      className="accent-accent mt-0.5" />
                    <span>
                      <span className="text-xs text-gray-300 block">Parti da un template</span>
                      <span className="text-[10px] text-gray-600 block mt-0.5">Campi e workflow già pronti per un caso comune (anagrafica clienti, prodotti, ordini, ticket) — bozza di partenza da modificare liberamente, utile quando non hai ancora nulla di simile in questo tenant.</span>
                    </span>
                  </label>
                  {templateSlug && (
                    <>
                      <select className="w-full mt-2 bg-surface-page text-ink px-3 py-2.5 rounded-lg text-sm outline-none border border-gray-800 focus:border-accent transition"
                        value={templateSlug} onChange={(e) => setTemplateSlug(e.target.value)}>
                        {STARTER_TEMPLATES.map((t) => <option key={t.slug} value={t.slug}>{t.name}</option>)}
                      </select>
                      <div className="text-[10px] text-gray-600 mt-1.5">{STARTER_TEMPLATES.find((t) => t.slug === templateSlug)?.description}</div>
                    </>
                  )}
                </div>

                <div className="mb-5">
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input type="checkbox" checked={!!cloneFromSlug}
                      onChange={(e) => { setCloneFromSlug(e.target.checked ? ((modules.find((m) => m.slug !== 'dashboard') || {}).slug || '') : ''); if (e.target.checked) setTemplateSlug('') }}
                      className="accent-accent mt-0.5" />
                    <span>
                      <span className="text-xs text-gray-300 block">Parti da un modulo esistente</span>
                      <span className="text-[10px] text-gray-600 block mt-0.5">Copia campi, relazioni e workflow di un modulo che hai già come bozza di partenza, invece di un canvas vuoto — la modifichi liberamente dopo, resta indipendente dall'originale.</span>
                    </span>
                  </label>
                  {cloneFromSlug && (
                    <select className="w-full mt-2 bg-surface-page text-ink px-3 py-2.5 rounded-lg text-sm outline-none border border-gray-800 focus:border-accent transition"
                      value={cloneFromSlug} onChange={(e) => setCloneFromSlug(e.target.value)}>
                      {modules.filter((m) => m.slug !== 'dashboard').map((m) => <option key={m.slug} value={m.slug}>{m.name}</option>)}
                    </select>
                  )}
                </div>

                <div className="flex gap-3">
                  <button onClick={() => setShowNewModule(false)} className="flex-1 bg-gray-800 hover:bg-gray-700 text-white py-3 rounded-lg transition">Annulla</button>
                  {cloneFromSlug || templateSlug ? (
                    <button onClick={createModule} disabled={!newModuleName.trim()} className="flex-1 bg-accent hover:opacity-90 disabled:opacity-50 text-white py-3 rounded-lg transition font-medium">Crea modulo</button>
                  ) : (
                    <button onClick={() => setWizardStep(2)} disabled={!newModuleName.trim()} className="flex-1 bg-accent hover:opacity-90 disabled:opacity-50 text-white py-3 rounded-lg transition font-medium">Avanti</button>
                  )}
                </div>
              </>
            )}

            {wizardStep === 2 && (
              <>
                <label className="flex items-start gap-2 mb-4 cursor-pointer">
                  <input type="checkbox" checked={newModuleRelation.enabled} onChange={(e) => setNewModuleRelation({ ...newModuleRelation, enabled: e.target.checked })} className="accent-accent mt-0.5" />
                  <span>
                    <span className="text-xs text-gray-300 block">Collega questo modulo a uno già esistente</span>
                    <span className="text-[10px] text-gray-600 block mt-0.5">Es. un modulo "Ordini" collegato a "Clienti": ogni ordine appartiene a un cliente. Se salti, puoi aggiungere una relazione in qualunque momento dal pannello a destra del Builder.</span>
                  </span>
                </label>

                {newModuleRelation.enabled && (
                  <div className="space-y-3 mb-5 p-3 bg-surface-page rounded-lg border border-gray-800">
                    <div>
                      <label className="text-xs text-gray-400 block mb-1">Collegato a</label>
                      <select className="w-full bg-surface-card text-ink px-3 py-2.5 rounded-lg text-sm outline-none border border-gray-700 focus:border-accent transition"
                        value={newModuleRelation.target_module} onChange={(e) => setNewModuleRelation({ ...newModuleRelation, target_module: e.target.value, label: newModuleRelation.label || (modules.find((m) => m.slug === e.target.value)?.name || '') })}>
                        <option value="">Seleziona modulo...</option>
                        {modules.filter((m) => !['dashboard'].includes(m.slug)).map((m) => <option key={m.slug} value={m.slug}>{m.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 block mb-1">Etichetta della relazione</label>
                      <input className="w-full bg-surface-card text-ink px-3 py-2.5 rounded-lg text-sm outline-none border border-gray-700 focus:border-accent transition placeholder-gray-600"
                        placeholder="es. Cliente" value={newModuleRelation.label} onChange={(e) => setNewModuleRelation({ ...newModuleRelation, label: e.target.value })} />
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 block mb-1">Tipo di collegamento</label>
                      <select className="w-full bg-surface-card text-ink px-3 py-2.5 rounded-lg text-sm outline-none border border-gray-700 focus:border-accent transition"
                        value={newModuleRelation.cardinality} onChange={(e) => setNewModuleRelation({ ...newModuleRelation, cardinality: e.target.value })}>
                        <option value="many_to_one">Ogni record di "{newModuleName || 'questo modulo'}" appartiene a UN solo {newModuleRelation.target_module ? (modules.find((m) => m.slug === newModuleRelation.target_module)?.name) : 'record'} (il caso più comune)</option>
                        <option value="one_to_many">Ogni record di "{newModuleName || 'questo modulo'}" può avere PIÙ record collegati</option>
                      </select>
                    </div>
                    <div className="text-[10px] text-gray-600">Questa relazione arriva già pronta in bozza nel Builder — la rivedi e pubblichi tu, non è ancora attiva.</div>
                  </div>
                )}

                <div className="flex gap-3">
                  <button onClick={() => setWizardStep(1)} className="flex-1 bg-gray-800 hover:bg-gray-700 text-white py-3 rounded-lg transition">Indietro</button>
                  <button onClick={createModule} disabled={newModuleRelation.enabled && !newModuleRelation.target_module} className="flex-1 bg-accent hover:opacity-90 disabled:opacity-50 text-white py-3 rounded-lg transition font-medium">Crea modulo</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      </div>
    </>
  )
}

export default BuilderPage
