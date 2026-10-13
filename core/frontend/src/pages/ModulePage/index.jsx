import React, { useState, useEffect, useRef } from 'react'
import { API, openUploadedFile } from '../../lib/api'
const toast = (message, type = 'success') => window.dispatchEvent(new CustomEvent('platform:toast', { detail: { message, type } }))
import useApi from '../../lib/useApi'
import { parseSchemaFrontend, getRequiredConnectors } from '../../lib/schema-v3-frontend'
import Icon from '../../components/Icon'
import FormDrawer from '../../components/FormDrawer'
import Select from '../../components/Select'
import FieldEditorInput from './FieldEditorInput'
import RecordDetailModal from './RecordDetailModal'
import ReportPanel from './ReportPanel'
import AiSuggestionsPanel from '../../components/AiSuggestionsPanel'
import ImportPdf from '../../components/ImportPdf'
import SchemaReports from './SchemaReports'
import BranchCreateModal from './BranchCreateModal'
import PeriodView from './PeriodView'
import ParentChildrenView from './ParentChildrenView'
import YearlyBreakdownView from './YearlyBreakdownView'
import CategoryPivotView from './CategoryPivotView'
import WeeklyBreakdownView from './WeeklyBreakdownView'
import ViewTabs from './ViewTabs'
import ArchiveView from './ArchiveView'
import FormulaEditor from '../BuilderPage/FormulaEditor'
import { StepChainEditor } from '../BuilderPage/StepChainEditor'

function ModulePage({ module: mod, token, user, onNavigate }) {
  const api = useApi(token)
  const [records, setRecords] = useState([])
  const [schema, setSchema] = useState(null)
  const [showNew, setShowNew] = useState(false)
  const [branchCreateOpen, setBranchCreateOpen] = useState(null)
  const [showReport, setShowReport] = useState(false)
  const [form, setForm] = useState({})
  const [relatedCache, setRelatedCache] = useState({})
  const [detailId, setDetailId] = useState(null)
  // Modulo "nuovo" semplice: i collegamenti facoltativi stanno chiusi in fondo; in un archivio il nuovo documento parte dalla cartella aperta
  const [mostraCollegamenti, setMostraCollegamenti] = useState(false)
  const [cartellaCorrente, setCartellaCorrente] = useState('')
  const [uploading, setUploading] = useState({})
  // Quick-create: quale relazione ha aperto il mini-form (null = chiuso) + i suoi valori
  const [quickCreateRel, setQuickCreateRel] = useState(null)
  const [quickCreateForm, setQuickCreateForm] = useState({})
  const [quickCreateSaving, setQuickCreateSaving] = useState(false)
  const [quickCreateError, setQuickCreateError] = useState('')

  const [quickCreateTargetFields, setQuickCreateTargetFields] = useState([])

  // Moduli figli con display_mode 'embedded_inline' (es. Righe Ordine su Ordine):
  // vanno editati come mini-tabella dentro il form di creazione del genitore, non
  // aperti come pagina separata. Caricati con schema completo (campi + relazioni
  // proprie, es. Riga Ordine -> Prodotto) così la riga può contenere anche selettori.
  const [embeddedChildren, setEmbeddedChildren] = useState([])
  const [embeddedRows, setEmbeddedRows] = useState({})

  // Risultati dei campi computed marcati 'live' (§3.1 addendum 18/7) — ricalcolati
  // dal backend a ogni modifica del form ancora in bozza, mai dal client (stesso
  // principio del resto del motore: il backend resta l'unica fonte di verità).
  const [liveResults, setLiveResults] = useState({})
  const liveDebounceRef = React.useRef(null)

  // Banner di stato+gestione connessione in cima al modulo, quando lo schema
  // dichiara di aver bisogno di un connettore (block_type 'connection_required',
  // es. gmail_regole → google) — richiesto dall'utente 2026-08-23, esteso lo
  // stesso giorno da "solo avviso se manca" a "stato+gestione sempre visibili,
  // per chiunque abbia il modulo attivo" ("se l'utente ha il modulo attivo deve
  // vedere tutto"). 'google' ha gestione piena qui (stessa identica azione di
  // ConnessioniTab in ImpostazioniPage.jsx — connetti/disconnetti/Drive/avviso
  // scope); altri connettori mostrano solo lo stato, la gestione (form
  // credenziali) resta in Impostazioni → Connessioni per non duplicare quel
  // form per ogni modulo che lo richiede.
  const requiredConnectors = getRequiredConnectors(mod.schema_json)
  const [connectorStatus, setConnectorStatus] = useState({})
  const [googleStatus, setGoogleStatus] = useState(null)
  const loadConnectorStatus = () => {
    if (requiredConnectors.length === 0) return
    if (requiredConnectors.includes('google')) {
      api.get('/integrazioni/google/status').then((s) => {
        if (s) { setGoogleStatus(s); setConnectorStatus((p) => ({ ...p, google: !!s.connected })) }
      })
    }
    const others = requiredConnectors.filter((c) => c !== 'google')
    if (others.length > 0) {
      api.get('/connections').then((list) => {
        if (!list) return
        setConnectorStatus((p) => {
          const next = { ...p }
          others.forEach((id) => { next[id] = !!(list.find((c) => c.id === id) || {}).connected })
          return next
        })
      })
    }
  }
  useEffect(loadConnectorStatus, [mod.slug]) // eslint-disable-line react-hooks/exhaustive-deps
  const missingConnectors = requiredConnectors.filter((id) => connectorStatus[id] === false)
  const connectGoogle = () => { window.location.href = API + '/integrazioni/google/oauth/start' }
  const disconnectGoogle = async () => { const res = await api.post('/integrazioni/google/disconnect', {}); if (res && res.ok) loadConnectorStatus() }
  const toggleDrive = async () => { const res = await api.put('/integrazioni/google/drive', { enabled: !(googleStatus && googleStatus.drive_enabled) }); if (res && res.ok) loadConnectorStatus() }

  const loadEmbeddedChildren = async () => {
    const children = await api.get('/modules/' + mod.slug + '/children-modules')
    if (!children) return
    const embedded = children.filter((c) => c.display_mode === 'embedded_inline')
    const withSchema = await Promise.all(embedded.map(async (c) => {
      const modRow = await api.get('/modules/' + c.module_slug)
      const parsed = parseSchemaFrontend(modRow && modRow.schema_json)
      const fields = (parsed.fields || []).filter((f) => f.type !== 'computed')
      // Le relazioni proprie del figlio, esclusa quella che punta al genitore corrente
      // (quella la impostiamo noi automaticamente al salvataggio, non va editata a mano)
      const ownRelations = (parsed.relations || []).filter((r) => r.key !== c.relation_key)
      const relOptions = {}
      for (const r of ownRelations) {
        if (!r.target_module) continue
        const recs = await api.get('/records/' + r.target_module)
        relOptions[r.key] = recs || []
      }
      return { ...c, fields, relations: ownRelations, relOptions }
    }))
    setEmbeddedChildren(withSchema)
  }

  const addEmbeddedRow = (slug) => setEmbeddedRows((p) => ({ ...p, [slug]: [...(p[slug] || []), { _tmpId: Math.random().toString(36).slice(2), data: {} }] }))
  const updateEmbeddedRow = (slug, tmpId, key, val) => setEmbeddedRows((p) => ({ ...p, [slug]: (p[slug] || []).map((row) => (row._tmpId === tmpId ? { ...row, data: { ...row.data, [key]: val } } : row)) }))
  const removeEmbeddedRow = (slug, tmpId) => setEmbeddedRows((p) => ({ ...p, [slug]: (p[slug] || []).filter((row) => row._tmpId !== tmpId) }))

  const openQuickCreate = async (relation) => {
    setQuickCreateRel(relation); setQuickCreateForm({}); setQuickCreateError(''); setQuickCreateTargetFields([])
    const targetSchema = await api.get('/modules/' + relation.target_module)
    if (!targetSchema) return
    const parsed = parseSchemaFrontend(targetSchema.schema_json)
    const allFields = (parsed.fields || []).filter((f) => f.type !== 'computed')
    const subset = relation.quick_create && Array.isArray(relation.quick_create.fields_subset) && relation.quick_create.fields_subset.length > 0
      ? allFields.filter((f) => relation.quick_create.fields_subset.includes(f.key))
      : allFields
    setQuickCreateTargetFields(subset)
  }

  const submitQuickCreate = async () => {
    if (!quickCreateRel) return
    setQuickCreateSaving(true)
    setQuickCreateError('')
    const { ok, data } = await api.post('/records/' + quickCreateRel.target_module + '/quick-create', {
      via_module: mod.slug, via_relation: quickCreateRel.key, data: quickCreateForm
    })
    setQuickCreateSaving(false)
    if (!ok) { setQuickCreateError((data && data.error) || 'Creazione non riuscita'); return }
    // Aggiorna la cache della relazione con il nuovo record e seleziona subito il valore nel form padre
    setRelatedCache((p) => {
      const cache = p[quickCreateRel.key] || { records: [], byId: {} }
      const label = quickCreateRel.display_field ? (data.data[quickCreateRel.display_field] ?? ('#' + data.id)) : ('#' + data.id)
      return { ...p, [quickCreateRel.key]: { records: [...cache.records, data], byId: { ...cache.byId, [data.id]: label } } }
    })
    setForm((p) => ({ ...p, [quickCreateRel.key]: data.id }))
    setQuickCreateRel(null)
  }

  // Upload multipart diretto (non tramite useApi.post, che serializza sempre in JSON) —
  // salva subito il file e mette il riferimento {id, name, size} nel campo del form
  const uploadFile = async (fieldKey, file) => {
    if (!file) return
    setUploading((p) => ({ ...p, [fieldKey]: true }))
    const body = new FormData()
    body.append('file', file)
    const res = await fetch(API + '/uploads', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body })
    setUploading((p) => ({ ...p, [fieldKey]: false }))
    if (res.ok) {
      const uploaded = await res.json()
      setForm((p) => {
        const next = { ...p, [fieldKey]: uploaded }
        const tf = mod.list_view === 'archive' ? fields.find((f) => f.type === 'text') : null
        if (tf && !String(p[tf.key] || '').trim() && uploaded && uploaded.name) next[tf.key] = String(uploaded.name).replace(/\.[^.]+$/, '')
        return next
      })
    } else {
      window.alert('Upload non riuscito')
    }
  }

  const loadSchema = async () => {
    const data = await api.get('/modules/' + mod.slug)
    if (data) setSchema(parseSchemaFrontend(data.schema_json))
  }

  const loadRecords = async () => {
    const data = await api.get('/records/' + mod.slug)
    if (data) setRecords(data)
  }

  useEffect(() => { loadSchema(); loadRecords(); loadEmbeddedChildren() }, [mod.slug])

  // Ricalcolo dal vivo dei campi computed marcati 'live', solo mentre il form di
  // creazione è aperto — debounce 450ms, stesso pattern già usato da FormulaEditor/
  // StepChainEditor nel Builder. childRows manda solo i dati (row.data), non il
  // _tmpId interno del form: il backend non deve sapere nulla della UI.
  useEffect(() => {
    if (!showNew || !schema) { setLiveResults({}); return }
    const liveFields = (schema.fields || []).filter((f) => f.type === 'computed' && f.live)
    if (liveFields.length === 0) return
    if (liveDebounceRef.current) clearTimeout(liveDebounceRef.current)
    liveDebounceRef.current = setTimeout(async () => {
      const childRows = {}
      Object.keys(embeddedRows).forEach((slug) => { childRows[slug] = (embeddedRows[slug] || []).map((r) => r.data) })
      const res = await api.post('/records/' + mod.slug + '/evaluate-live', { data: form, childRows })
      if (res && res.ok) setLiveResults(res.data.results || {})
    }, 450)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, embeddedRows, showNew, schema])

  // Per ogni relazione many_to_one, carica una volta i record del modulo target e
  // costruisce una mappa id -> valore leggibile (display_field), usata sia nel form
  // (selettore) sia nella tabella (colonna risolta) — non più un ID grezzo.
  useEffect(() => {
    const relations = (schema && schema.relations) || []
    relations.forEach((r) => {
      if (!r.target_module || relatedCache[r.key]) return
      api.get('/records/' + r.target_module).then((data) => {
        if (!data) return
        const byId = {}
        data.forEach((rec) => { byId[rec.id] = r.display_field ? (rec.data[r.display_field] ?? ('#' + rec.id)) : ('#' + rec.id) })
        setRelatedCache((p) => ({ ...p, [r.key]: { records: data, byId } }))
      })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema])

  const [showImport, setShowImport] = useState(false)
  const [importResult, setImportResult] = useState(null)
  const [importing, setImporting] = useState(false)
  // F15 (PLATFORM-MASTER-ROADMAP.md) — Discover/Profile/Map resi reali: prima dell'import
  // vero e proprio si mostra un'anteprima (intestazioni trovate, righe di esempio, quanti
  // campi restano senza colonna) con una mappatura proposta che l'utente può correggere a
  // mano prima di confermare — mai più un match "alla cieca" per nome esatto senza che chi
  // importa lo sappia.
  const [importPreview, setImportPreview] = useState(null)
  const [importCsvText, setImportCsvText] = useState(null)
  const [importFieldMap, setImportFieldMap] = useState({})

  const [search, setSearch] = useState('')
  const [sortField, setSortField] = useState(null)
  const [sortDir, setSortDir] = useState('asc')
  const [page, setPage] = useState(1)
  const PER_PAGE = 50
  // activeFilterTab/navMonth devono essere dichiarati PRIMA del useMemo qui sotto che li
  // legge (altrimenti è un ReferenceError da temporal dead zone, non solo un problema di
  // stile — "Cannot access before initialization" a runtime, non un semplice warning).
  const [activeFilterTab, setActiveFilterTab] = useState(null)
  const [navMonth, setNavMonth] = useState(() => {
    const n = new Date()
    if (n.getDate() >= 27) return n.getMonth() === 11 ? { y: n.getFullYear() + 1, m: 0 } : { y: n.getFullYear(), m: n.getMonth() + 1 }
    return { y: n.getFullYear(), m: n.getMonth() }
  })

  useEffect(() => { setPage(1); setActiveFilterTab(null) }, [search, sortField, sortDir, mod.slug])

  const displayRecords = React.useMemo(() => {
    let list = records
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter((r) =>
        tableColumns.some((c) => {
          const isRel = relations.some((rel) => rel.key === c.key)
          if (isRel) {
            const cache = relatedCache[c.key]
            return ((cache && cache.byId[r.data[c.key]]) || '').toLowerCase().includes(q)
          }
          const v = r.data[c.key]
          return v !== null && v !== undefined && String(v).toLowerCase().includes(q)
        })
      )
    }
    if (sortField) {
      list = [...list].sort((a, b) => {
        const av = a.data[sortField] ?? ''
        const bv = b.data[sortField] ?? ''
        const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' })
        return sortDir === 'asc' ? cmp : -cmp
      })
    }
    const _ftf = schema && (schema.fields || []).find((f) => f.filter_tab && f.type === 'select')
    const _dnf = schema && (schema.fields || []).find((f) => f.date_nav && (f.type === 'date' || f.type === 'datetime'))
    if (_ftf && activeFilterTab !== null) list = list.filter((r) => r.data[_ftf.key] === activeFilterTab)
    if (_dnf) list = list.filter((r) => {
      const raw = String(r.data[_dnf.key] || '')
      if (!raw || raw.length < 7) return false
      return parseInt(raw.slice(0, 4)) === navMonth.y && parseInt(raw.slice(5, 7)) - 1 === navMonth.m
    })
    return list
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, search, sortField, sortDir, relatedCache, schema, activeFilterTab, navMonth])

  const totalPages = Math.ceil(displayRecords.length / PER_PAGE) || 1
  const pagedRecords = displayRecords.slice((page - 1) * PER_PAGE, page * PER_PAGE)

  const toggleSort = (key) => {
    if (sortField === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortField(key); setSortDir('asc') }
  }

  const [viewMode, setViewMode] = useState('table')
  const [calMonth, setCalMonth] = useState(() => { const n = new Date(); return { y: n.getFullYear(), m: n.getMonth() } })
  const [creating, setCreating] = useState(false)

  const create = async () => {
    setCreating(true)
    const { ok, data } = await api.post('/records/' + mod.slug, form)
    if (!ok) { setCreating(false); toast((data && data.error) || 'Creazione non riuscita', 'error'); return }
    const parentId = data.id
    // Le righe embedded si creano DOPO il genitore: hanno bisogno del suo id come FK,
    // che non esiste finché il record padre non è salvato — sequenziale per costruzione,
    // non parallelizzabile.
    for (const child of embeddedChildren) {
      const rows = embeddedRows[child.module_slug] || []
      for (const row of rows) {
        await api.post('/records/' + child.module_slug, { ...row.data, [child.relation_key]: parentId })
      }
    }
    setCreating(false)
    setShowNew(false)
    setForm({})
    setEmbeddedRows({})
    loadRecords()
    toast('Record creato')
  }

  const remove = async (id) => {
    await api.del('/records/' + mod.slug + '/' + id)
    loadRecords()
  }

  // Toggle rapido dalla tabella (vedi togglePair più sotto): cambia stato senza aprire
  // il record, stessa transizione già validata server-side che userebbe RecordDetailModal.
  const quickToggle = async (r) => {
    if (!togglePair) return
    const to = r.data._stato === togglePair.on ? togglePair.off : togglePair.on
    await api.post('/records/' + mod.slug + '/' + r.id + '/transition', { to })
    loadRecords()
  }

  const uploadInline = async (r, file) => {
    if (!file) return
    const body = new FormData()
    body.append('file', file)
    const res = await fetch(API + '/uploads', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body })
    if (!res.ok) { toast('Upload non riuscito', 'error'); return }
    const uploaded = await res.json()
    await api.post('/records/' + mod.slug + '/' + r.id + '/attachments', { upload_id: uploaded.id })
    toast('Allegato caricato')
  }

  const fields = schema && schema.fields ? schema.fields : []

  // Upload batch: un file selezionato = un nuovo record, con il file nel campo
  // mod.batch_upload_field — a differenza di uploadInline sopra (allegato multiplo su
  // UN record esistente). Copre DocumentiFinancePage.jsx (ogni bolletta/ricevuta
  // caricata diventa un documento a sé) come proprietà a livello modulo, non più
  // codice pagina-specifico.
  const [batchUploading, setBatchUploading] = useState(false)
  const batchFileRef = useRef(null)
  // Categoria scelta UNA volta prima del batch (es. "Tipo documento"), applicata a tutti
  // i record del batch — copre la scelta di categoria di DocumentiFinancePage.jsx prima
  // dell'upload multiplo, che altrimenti andrebbe impostata record per record dopo.
  const [batchCategory, setBatchCategory] = useState('')
  const batchCategoryField = fields.find((f) => f.key === mod.batch_upload_category_field && f.type === 'select')
  useEffect(() => { if (batchCategoryField && !batchCategory) setBatchCategory(batchCategoryField.options[0] || '') }, [batchCategoryField]) // eslint-disable-line react-hooks/exhaustive-deps
  const uploadBatch = async (fileList) => {
    const files = Array.from(fileList || [])
    if (files.length === 0 || !mod.batch_upload_field) return
    setBatchUploading(true)
    const titleField = fields.find((f) => f.type === 'text' && f.key !== mod.batch_upload_field)
    for (const file of files) {
      const body = new FormData()
      body.append('file', file)
      const res = await fetch(API + '/uploads', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body })
      if (!res.ok) { toast('Upload non riuscito: ' + file.name, 'error'); continue }
      const uploaded = await res.json()
      const record = { [mod.batch_upload_field]: uploaded }
      if (titleField) record[titleField.key] = file.name.replace(/\.[^.]+$/, '')
      if (batchCategoryField && batchCategory) record[batchCategoryField.key] = batchCategory
      await api.post('/records/' + mod.slug, record)
    }
    setBatchUploading(false)
    toast(files.length > 1 ? files.length + ' file caricati' : 'File caricato')
    loadRecords()
  }

  const editableFields = fields.filter((f) => f.type !== 'computed' && f.type !== 'soglia')
  const relations = (schema && schema.relations) || []
  const allegatiConfig = schema && schema.allegati
  const fileInputRefs = useRef({})
  const todayStr = new Date().toISOString().slice(0, 10)
  const workflow = schema && schema.workflow
  const branchCreates = (schema && schema.branch_creates) || []
  const filterTabField = fields.find((f) => f.filter_tab && f.type === 'select')
  const filterTabOptions = filterTabField ? (filterTabField.options || []) : []
  const dateNavField = fields.find((f) => f.date_nav && (f.type === 'date' || f.type === 'datetime'))
  // Campo scadenza (facoltativo, stesso flag-pattern di date_nav): se un modulo lo marca
  // su un campo data, il toggle rapido qui sotto colora il cerchio per urgenza — senza,
  // resta comunque funzionante, solo senza il colore rosso/arancio.
  const scadenzaField = fields.find((f) => f.scadenza && (f.type === 'date' || f.type === 'datetime'))
  // Coppia di stati "a interruttore": qualunque workflow con transizioni A->B E B->A
  // (es. da_pagare<->pagato) ottiene automaticamente un cerchio cliccabile in tabella
  // per cambiare stato senza aprire il record — nessuna configurazione aggiuntiva
  // richiesta, si deduce da transizioni già esistenti nello schema.
  const togglePair = (() => {
    if (mod.quick_toggle === 0) return null
    if (!workflow || !workflow.transitions) return null
    for (const t1 of workflow.transitions) {
      if (workflow.transitions.some((t2) => t2.from === t1.to && t2.to === t1.from)) {
        return { off: t1.from, on: t1.to }
      }
    }
    return null
  })()
  const MONTHS = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre']
  const getOptValue = (o) => (typeof o === 'string' ? o : o.value)
  const getOptLabel = (o) => (typeof o === 'string' ? o : (o.label || o.value))
  // Usa show_in_list (default true) per scegliere le colonne — SENZA un tetto
  // fisso: un tetto a 5 campi (bug reale trovato il 2026-08-10 su Ordini/Coffee)
  // tagliava via colonne in coda allo schema anche quando nessuno le aveva
  // nascoste apposta col checkbox "In lista" — un campo computed importante
  // come "Totale" definito per 6° spariva dalla lista in silenzio solo per la
  // sua posizione nello schema, non per una scelta di chi costruisce il modulo.
  // La tabella scorre in orizzontale (overflow-x-auto sul contenitore) quando
  // le colonne sono tante, non serve tagliarle qui.
  const visibleFields = fields.filter((f) => f.show_in_list !== false)
  const visibleRelations = relations.filter((r) => r.show_in_list !== false)
  const tableColumns = visibleFields.length > 0 || visibleRelations.length > 0
    ? [...visibleFields, ...visibleRelations]
    : [...fields.slice(0, 4), ...relations.slice(0, 2)]

  // Permessi derivati dallo schema: se non c'è nessun blocco permissions configurato
  // non c'è restrizione (stesso default del backend). Admin ha sempre tutto.
  const permRules = schema && schema.permissions && schema.permissions.rules
  function canDo(action) {
    if (!permRules || permRules.length === 0) return true
    const rule = permRules.find((r) => r.role === (user && user.role))
    if (rule) return !!rule[action]
    return (user && user.role) === 'admin'
  }
  const canCreate = canDo('create')
  const canDelete = canDo('delete')

  const visibleEditableFields = editableFields.filter((f) => {
    if (!f.visible_if || !f.visible_if.enabled || !f.visible_if.field) return true
    const v = String(form[f.visible_if.field] ?? '')
    return f.visible_if.op === '!=' ? v !== String(f.visible_if.value) : v === String(f.visible_if.value)
  })

  const renderRelationField = (r) => {
    const canQuickCreate = r.quick_create && r.quick_create.enabled && user && (!Array.isArray(r.quick_create.roles) || r.quick_create.roles.length === 0 || r.quick_create.roles.includes(user.role))
    const allRecs = (relatedCache[r.key] && relatedCache[r.key].records) || []
    const filteredRecs = (r.filter && r.filter.enabled && r.filter.field)
      ? allRecs.filter((rec) => {
          const v = String(rec.data[r.filter.field] ?? '')
          if (r.filter.op === '==') return v === String(r.filter.value)
          if (r.filter.op === '!=') return v !== String(r.filter.value)
          if (r.filter.op === '>') return parseFloat(v) > parseFloat(r.filter.value)
          if (r.filter.op === '<') return parseFloat(v) < parseFloat(r.filter.value)
          return true
        })
      : allRecs
    return (
      <div key={r.key}>
        <label className="text-xs text-gray-400 block mb-1">{r.label}</label>
        <Select
          value={form[r.key] || ''}
          onChange={(v) => setForm({ ...form, [r.key]: v })}
          placeholder={'Seleziona ' + r.label.toLowerCase() + '...'}
          options={filteredRecs.map((rec) => ({ value: rec.id, label: r.display_field ? (rec.data[r.display_field] ?? ('#' + rec.id)) : ('#' + rec.id) }))}
          actionOption={canQuickCreate ? { label: '+ Nuovo ' + r.label.toLowerCase() + '...', onClick: () => openQuickCreate(r) } : undefined}
        />
      </div>
    )
  }

  const renderRegularField = (f) => (
    <div key={f.key}>
      <label className="text-xs text-gray-400 block mb-1">{f.label}{f.required && ' *'}</label>
      <FieldEditorInput f={f} value={form[f.key]} onChange={(v) => setForm({ ...form, [f.key]: v })} uploading={uploading[f.key]} onUploadFile={(file) => uploadFile(f.key, file)} />
    </div>
  )

  const renderChildBlock = (child) => {
    const rows = embeddedRows[child.module_slug] || []
    return (
      <div key={child.module_slug} className="mb-5">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-gray-400">
            <Icon name={child.module_icon || 'box'} size={12} />{child.module_name}
          </div>
          <button onClick={() => addEmbeddedRow(child.module_slug)} className="text-accent hover:opacity-80 text-xs transition flex items-center gap-1">
            <Icon name="plus" size={12} />Aggiungi riga
          </button>
        </div>
        {rows.length === 0 ? (
          <div className="text-xs text-gray-600 bg-surface-page rounded-lg p-3 border border-gray-800">Nessuna riga — "Aggiungi riga" per iniziare.</div>
        ) : (
          <div className="space-y-2">
            {rows.map((row) => (
              <div key={row._tmpId} className="bg-surface-page rounded-lg border border-gray-800 p-2.5 flex items-end gap-2 flex-wrap">
                {child.relations.map((r) => (
                  <div key={r.key} className="flex-1 min-w-[110px]">
                    <label className="text-[10px] text-gray-600 block mb-0.5">{r.label}</label>
                    <Select
                      value={row.data[r.key] || ''}
                      onChange={(v) => updateEmbeddedRow(child.module_slug, row._tmpId, r.key, v)}
                      options={(child.relOptions[r.key] || []).map((rec) => ({ value: rec.id, label: r.display_field ? (rec.data[r.display_field] ?? ('#' + rec.id)) : ('#' + rec.id) }))}
                    />
                  </div>
                ))}
                {child.fields.map((f) => (
                  <div key={f.key} className="flex-1 min-w-[90px]">
                    <label className="text-[10px] text-gray-600 block mb-0.5">{f.label}</label>
                    <input className="w-full bg-surface-card text-ink px-2 py-1.5 rounded text-xs outline-none border border-gray-700 focus:border-accent transition"
                      type={(f.type === 'number' || f.type === 'currency') ? 'number' : f.type === 'date' ? 'date' : f.type === 'time' ? 'time' : 'text'}
                      value={row.data[f.key] || ''} onChange={(e) => updateEmbeddedRow(child.module_slug, row._tmpId, f.key, e.target.value)} />
                  </div>
                ))}
                <button onClick={() => removeEmbeddedRow(child.module_slug, row._tmpId)} className="text-red-400/50 hover:text-red-400 transition pb-1.5"><Icon name="trash" size={13} /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  const previewImportCsv = async (file) => {
    if (!file) return
    setImporting(true); setImportResult(null); setImportPreview(null)
    const text = await file.text()
    const res = await fetch(API + '/records/' + mod.slug + '/import/preview', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ csv: text }),
    })
    const data = await res.json()
    setImporting(false)
    if (!res.ok) { toast((data && data.error) || 'Lettura del file fallita', 'error'); return }
    setImportCsvText(text)
    setImportPreview(data)
    setImportFieldMap(data.suggestedMap || {})
  }

  const confirmImport = async () => {
    setImporting(true)
    const res = await fetch(API + '/records/' + mod.slug + '/import', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ csv: importCsvText, field_map: importFieldMap }),
    })
    const data = await res.json()
    setImporting(false)
    if (!res.ok) { toast((data && data.error) || 'Import fallito', 'error'); return }
    setImportResult(data)
    loadRecords()
  }

  const resetImport = () => {
    setImportPreview(null); setImportCsvText(null); setImportFieldMap({}); setImportResult(null)
  }

  const exportCsv = async () => {
    const res = await fetch(API + '/records/' + mod.slug + '/export', {
      headers: { Authorization: 'Bearer ' + token },
    })
    if (!res.ok) { toast('Export fallito', 'error'); return }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = mod.slug + '-export.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: mod.color + '22', color: mod.color }}>
            <Icon name={mod.icon} size={18} />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-ink tracking-[-0.35px] truncate">{mod.name}</h1>
            <div className="text-xs text-gray-500">{search.trim() ? displayRecords.length + ' / ' + records.length : records.length} record</div>
          </div>
        </div>
        {editableFields.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            {canCreate && <ImportPdf token={token} mod={mod} onCreated={loadRecords} />}
            <button onClick={exportCsv} className="bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-gray-200 px-3 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2" title="Esporta CSV">
              <Icon name="download" size={14} />CSV
            </button>
            {canCreate && mod.batch_upload_field && (
              <>
                {batchCategoryField && (
                  <select className="bg-surface-card text-ink px-3 py-2 rounded-lg text-sm outline-none border border-gray-800" value={batchCategory} onChange={(e) => setBatchCategory(e.target.value)}>
                    {(batchCategoryField.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                )}
                <input ref={batchFileRef} type="file" multiple className="hidden" onChange={(e) => uploadBatch(e.target.files)} />
                <button onClick={() => batchFileRef.current && batchFileRef.current.click()} disabled={batchUploading}
                  className="bg-accent hover:opacity-90 disabled:opacity-50 text-white px-3 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2" title="Carica uno o più file — ognuno diventa un nuovo record">
                  <Icon name="upload" size={14} />{batchUploading ? 'Caricamento...' : 'Carica file'}
                </button>
              </>
            )}
            {canCreate && (
              <button onClick={() => { setShowImport(true); resetImport() }} className="bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-gray-200 px-3 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2" title="Importa CSV">
                <Icon name="upload" size={14} />Importa
              </button>
            )}
            <button onClick={() => setShowReport(!showReport)} className={'px-4 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2 ' + (showReport ? 'bg-gray-700 text-ink' : 'bg-gray-800 hover:bg-gray-700 text-gray-300')}>
              <Icon name="bar-chart" size={14} />Report
            </button>
            {fields.some((f) => f.type === 'date' || f.type === 'datetime') && (
              <button onClick={() => setViewMode((v) => v === 'calendar' ? 'table' : 'calendar')} className={'px-4 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2 ' + (viewMode === 'calendar' ? 'bg-gray-700 text-ink' : 'bg-gray-800 hover:bg-gray-700 text-gray-300')}>
                <Icon name="calendar" size={14} />Calendario
              </button>
            )}
            {canCreate && branchCreates.length > 0 ? (
              branchCreates.map((bc, i) => (
                <button key={i} onClick={() => setBranchCreateOpen(bc)} className="bg-accent hover:opacity-90 text-white px-4 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2">
                  <Icon name="plus" size={14} />{bc.label || 'Nuovo'}
                </button>
              ))
            ) : canCreate && (
              <button onClick={() => { setShowNew(true); setMostraCollegamenti(false); const ff = mod.list_view === 'archive' ? fields.find((f) => f.type === 'select') : null; setForm({ ...(workflow && workflow.states && workflow.states.length > 0 ? { _stato: workflow.states[0].key } : {}), ...(ff && cartellaCorrente ? { [ff.key]: cartellaCorrente } : {}) }) }} className="bg-accent hover:opacity-90 text-white px-4 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2">
                <Icon name="plus" size={14} />Nuovo
              </button>
            )}
          </div>
        )}
      </div>


      {requiredConnectors.includes('google') && (
        <div className={'mb-6 border rounded-lg px-4 py-3 ' + (connectorStatus.google ? 'bg-surface-card border-gray-800' : 'bg-amber-900/20 border-amber-900/40')}>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className={'flex items-center gap-2 text-sm ' + (connectorStatus.google ? 'text-gray-300' : 'text-amber-400')}>
              <Icon name="plug" size={15} className="flex-shrink-0" />
              {connectorStatus.google
                ? <>Google collegato{googleStatus && googleStatus.email ? ' — ' + googleStatus.email : ''}</>
                : 'Questo modulo richiede la connessione a Google (Gmail), non ancora collegata.'}
            </div>
            {connectorStatus.google ? (
              <button onClick={disconnectGoogle} className="text-xs text-gray-500 hover:text-red-400 transition flex-shrink-0">Disconnetti</button>
            ) : (
              <button onClick={connectGoogle} className="text-xs bg-amber-600 hover:bg-amber-500 text-white px-3 py-1.5 rounded-lg transition font-medium flex-shrink-0">
                Connetti con Google
              </button>
            )}
          </div>
          {connectorStatus.google && (
            <>
              <label className="flex items-center gap-2.5 mt-2 text-xs text-gray-400 cursor-pointer select-none">
                <button type="button" role="switch" aria-checked={!!(googleStatus && googleStatus.drive_enabled)} onClick={toggleDrive}
                  className={'w-8 h-[18px] rounded-full transition-colors relative flex-shrink-0 ' + (googleStatus && googleStatus.drive_enabled ? 'bg-accent' : 'bg-gray-700')}>
                  <span className={'absolute top-[2px] left-0 w-[14px] h-[14px] rounded-full bg-white transition-transform ' + (googleStatus && googleStatus.drive_enabled ? 'translate-x-[16px]' : 'translate-x-[2px]')} />
                </button>
                Salva gli allegati su Google Drive invece che sul server
              </label>
              {googleStatus && googleStatus.drive_enabled && !googleStatus.drive_scope_ok && (
                <div className="mt-2 text-xs bg-amber-900/20 text-amber-400 border border-amber-900/40 rounded-lg px-3 py-2">
                  Il permesso Drive non è (più) autorizzato — probabilmente ti sei connesso prima che venisse richiesto.
                  Gli allegati vengono comunque salvati sul server (mai persi), ma non su Drive finché non
                  {' '}<button onClick={connectGoogle} className="underline hover:text-amber-300 transition">ricolleghi Google</button>.
                </div>
              )}
            </>
          )}
        </div>
      )}

      {missingConnectors.filter((id) => id !== 'google').length > 0 && (
        <div className="mb-6 bg-amber-900/20 border border-amber-900/40 rounded-lg px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-sm text-amber-400">
            <Icon name="plug" size={15} className="flex-shrink-0" />
            Questo modulo richiede la connessione {missingConnectors.filter((id) => id !== 'google').join(', ')}, non ancora collegata.
          </div>
          {onNavigate && (
            <button onClick={() => onNavigate('impostazioni')} className="text-xs text-amber-500/80 hover:text-amber-300 transition flex-shrink-0">
              Collegala da Impostazioni → Connessioni
            </button>
          )}
        </div>
      )}

      <AiSuggestionsPanel token={token} isAdmin={!!(user && user.role === 'admin')} moduleSlug={mod.slug} onChanged={loadRecords} />

      {showReport && (
        <div className="mb-6">
          <ReportPanel moduleSlug={mod.slug} fields={editableFields} token={token} />
        </div>
      )}

      {schema && schema.aggregati && schema.aggregati.length > 0 && (
        <div className="mb-6">
          <SchemaReports aggregates={schema.aggregati} defaultModuleSlug={mod.slug} token={token} />
        </div>
      )}

      {schema && schema.yearly_breakdowns && schema.yearly_breakdowns.length > 0 && (
        <div className="mb-6 space-y-4">
          {schema.yearly_breakdowns.map((yb) => <YearlyBreakdownView key={yb.key} config={yb} defaultModuleSlug={mod.slug} token={token} />)}
        </div>
      )}

      {schema && schema.category_pivots && schema.category_pivots.length > 0 && (
        <div className="mb-6 space-y-4">
          {schema.category_pivots.map((cp) => <CategoryPivotView key={cp.key} config={cp} defaultModuleSlug={mod.slug} token={token} />)}
        </div>
      )}

      {schema && schema.weekly_breakdowns && schema.weekly_breakdowns.length > 0 && (
        <div className="mb-6 space-y-4">
          {schema.weekly_breakdowns.map((wb) => <WeeklyBreakdownView key={wb.key} config={wb} defaultModuleSlug={mod.slug} token={token} />)}
        </div>
      )}

      {workflow && (
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          {workflow.states.map((s) => (
            <div key={s.key} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-card border border-gray-800">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
              <span className="text-xs text-gray-400">{s.label}</span>
              <span className="text-xs text-gray-600">{records.filter((r) => r.data._stato === s.key).length}</span>
            </div>
          ))}
        </div>
      )}

      {dateNavField && (
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <button onClick={() => setNavMonth(({ y, m }) => m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 })} className="p-1.5 text-gray-400 hover:text-ink transition rounded-lg hover:bg-gray-800">
            <Icon name="chevron-left" size={16} />
          </button>
          <span className="text-sm font-semibold text-ink min-w-[140px] text-center">{MONTHS[navMonth.m]} {navMonth.y}</span>
          <button onClick={() => setNavMonth(({ y, m }) => m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 })} className="p-1.5 text-gray-400 hover:text-ink transition rounded-lg hover:bg-gray-800">
            <Icon name="chevron-right" size={16} />
          </button>
          <button onClick={() => { const n = new Date(); setNavMonth(n.getDate() >= 27 ? (n.getMonth() === 11 ? { y: n.getFullYear() + 1, m: 0 } : { y: n.getFullYear(), m: n.getMonth() + 1 }) : { y: n.getFullYear(), m: n.getMonth() }) }} className="text-xs text-gray-600 hover:text-gray-400 transition ml-1">oggi</button>
          <span className="text-xs text-gray-600 sm:ml-auto">{displayRecords.length} record</span>
        </div>
      )}

      {filterTabField && filterTabOptions.length > 0 && mod.list_view !== 'archive' && (
        <div className="flex items-center gap-1 mb-4 flex-wrap">
          <button onClick={() => setActiveFilterTab(null)} className={'px-3 py-1.5 rounded-lg text-sm font-medium transition ' + (activeFilterTab === null ? 'bg-accent text-white' : 'bg-gray-800 text-gray-400 hover:text-ink')}>
            Tutti
          </button>
          {filterTabOptions.map((opt) => (
            <button key={getOptValue(opt)} onClick={() => setActiveFilterTab(activeFilterTab === getOptValue(opt) ? null : getOptValue(opt))}
              className={'px-3 py-1.5 rounded-lg text-sm font-medium transition ' + (activeFilterTab === getOptValue(opt) ? 'bg-accent text-white' : 'bg-gray-800 text-gray-400 hover:text-ink')}>
              {getOptLabel(opt)}
            </button>
          ))}
        </div>
      )}

      {records.length > 0 && (
        <div className="mb-4">
          <input
            className="w-full max-w-xs bg-surface-card text-ink px-3 py-2 rounded-lg text-sm outline-none border border-gray-800 focus:border-accent transition placeholder-gray-600"
            placeholder="Cerca..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      )}

      {schema && schema.view_tabs && schema.view_tabs.tabs && schema.view_tabs.tabs.length > 0 ? (
        <ViewTabs tabs={schema.view_tabs.tabs} mod={mod} schema={schema} token={token} tableColumns={tableColumns} records={records} />
      ) : schema && schema.parent_children_views && schema.parent_children_views.length > 0 ? (
        <ParentChildrenView config={schema.parent_children_views[0]} mod={mod} schema={schema} token={token} tableColumns={tableColumns} records={records} />
      ) : schema && schema.period_views && schema.period_views.length > 0 ? (
        <PeriodView config={schema.period_views[0]} mod={mod} schema={schema} token={token} tableColumns={tableColumns} records={records} />
      ) : mod.list_view === 'archive' ? (
        <ArchiveView mod={mod} schema={schema} records={displayRecords} token={token} canEdit={canDo('edit')} onOpen={(id) => setDetailId(id)} onChanged={loadRecords} onCartella={setCartellaCorrente} onSchemaChanged={async () => { await loadSchema(); await loadRecords() }} searching={search.trim() !== ''} />
      ) : mod.list_view === 'card_grid' ? (
        displayRecords.length === 0 ? (
          <div className="bg-surface-card rounded-md p-12 text-center border border-gray-800">
            <div className="text-gray-500">{records.length === 0 ? 'Nessun record ancora' : `Nessun risultato per "${search}"`}</div>
          </div>
        ) : (
          <div>
            {/* pagedRecords, non displayRecords (2026-09-03) — la vista tabella qui sotto
                era già paginata (PER_PAGE=50), questa vista a card no: ogni record del
                modulo finiva nel DOM in una volta sola, potenzialmente migliaia su un
                modulo transazionale. Stessa identica logica page/PER_PAGE/totalPages già
                calcolata sopra per la tabella, solo applicata anche qui. */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {pagedRecords.map((r) => {
                const stato = workflow && workflow.states.find((s) => s.key === r.data._stato)
                const titleField = tableColumns[0]
                const bodyFields = tableColumns.slice(1, 4)
                return (
                  <div key={r.id} onClick={() => setDetailId(r.id)}
                    className="rounded-xl p-4 border cursor-pointer transition hover:border-gray-600"
                    style={{ backgroundColor: mod.color + '14', borderColor: mod.color + '40' }}>
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="font-medium text-ink truncate">{titleField ? String(r.data[titleField.key] ?? '—') : '#' + r.id}</div>
                      {stato && <span className="text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ backgroundColor: stato.color + '22', color: stato.color }}>{stato.label}</span>}
                    </div>
                    <div className="space-y-1">
                      {bodyFields.map((f) => (
                        <div key={f.key} className="text-xs text-gray-400 truncate">{f.label}: {String(r.data[f.key] ?? '—')}</div>
                      ))}
                    </div>
                    <div className="flex items-center justify-end gap-2 mt-3">
                      <button onClick={(e) => { e.stopPropagation(); remove(r.id) }} className="text-gray-600 hover:text-red-400 transition"><Icon name="trash" size={13} /></button>
                    </div>
                  </div>
                )
              })}
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-1 py-3">
                <div className="text-xs text-gray-500">{(page - 1) * PER_PAGE + 1}–{Math.min(page * PER_PAGE, displayRecords.length)} di {displayRecords.length}</div>
                <div className="flex items-center gap-1">
                  <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
                    className="px-2 py-1 rounded text-gray-400 hover:text-ink disabled:opacity-30 transition text-xs">
                    <Icon name="chevron-left" size={14} />
                  </button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1).filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 1).map((p, idx, arr) => (
                    <React.Fragment key={p}>
                      {idx > 0 && arr[idx - 1] !== p - 1 && <span className="text-gray-600 text-xs px-1">…</span>}
                      <button onClick={() => setPage(p)}
                        className={'px-2.5 py-1 rounded text-xs transition ' + (p === page ? 'bg-accent text-white' : 'text-gray-400 hover:text-ink')}>
                        {p}
                      </button>
                    </React.Fragment>
                  ))}
                  <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                    className="px-2 py-1 rounded text-gray-400 hover:text-ink disabled:opacity-30 transition text-xs">
                    <Icon name="chevron-right" size={14} />
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      ) : viewMode === 'calendar' && fields.some((f) => f.type === 'date' || f.type === 'datetime') ? (() => {
        const dateField = fields.find((f) => f.type === 'date' || f.type === 'datetime')
        const { y, m } = calMonth
        const firstDay = new Date(y, m, 1)
        const lastDay = new Date(y, m + 1, 0)
        const startPad = (firstDay.getDay() + 6) % 7
        const DAYS = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom']
        const cells = []
        for (let i = 0; i < startPad; i++) cells.push(null)
        for (let d = 1; d <= lastDay.getDate(); d++) cells.push(d)
        const recsByDay = {}
        records.forEach((r) => {
          const raw = r.data[dateField.key]
          if (!raw) return
          const day = String(raw).slice(8, 10)
          const month = String(raw).slice(5, 7)
          const year = String(raw).slice(0, 4)
          if (parseInt(year) === y && parseInt(month) - 1 === m) {
            const d = parseInt(day)
            if (!recsByDay[d]) recsByDay[d] = []
            recsByDay[d].push(r)
          }
        })
        const today = new Date()
        return (
          <div className="bg-surface-card rounded-md border border-gray-800 overflow-x-auto">
            <div className="min-w-[560px] sm:min-w-0">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
                <button onClick={() => setCalMonth(({ y, m }) => m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 })} className="text-gray-400 hover:text-ink transition"><Icon name="chevron-left" size={18} /></button>
                <span className="text-ink font-semibold">{MONTHS[m]} {y}</span>
                <button onClick={() => setCalMonth(({ y, m }) => m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 })} className="text-gray-400 hover:text-ink transition"><Icon name="chevron-right" size={18} /></button>
              </div>
              <div className="grid grid-cols-7 border-b border-gray-800">
                {DAYS.map((d) => <div key={d} className="text-center text-xs text-gray-600 py-2 font-medium">{d}</div>)}
              </div>
              <div className="grid grid-cols-7">
                {cells.map((day, i) => {
                  const isToday = day && today.getFullYear() === y && today.getMonth() === m && today.getDate() === day
                  const dayRecs = day ? (recsByDay[day] || []) : []
                  const labelField = tableColumns[0]
                  return (
                    <div key={i} className={'min-h-[60px] sm:min-h-[80px] border-b border-r border-gray-800/60 p-1 sm:p-1.5 ' + (!day ? 'bg-surface-page/30' : 'hover:bg-white/5 transition')}>
                      {day && (
                        <>
                          <div className={'text-xs mb-1 w-6 h-6 flex items-center justify-center rounded-full ' + (isToday ? 'bg-accent text-white font-bold' : 'text-gray-500')}>{day}</div>
                          <div className="space-y-0.5">
                            {dayRecs.slice(0, 3).map((r) => {
                              const stato = workflow && workflow.states.find((s) => s.key === r.data._stato)
                              const lbl = labelField ? (r.data[labelField.key] ?? ('#' + r.id)) : ('#' + r.id)
                              return (
                                <button key={r.id} onClick={() => setDetailId(r.id)}
                                  className="w-full text-left text-[10px] px-1.5 py-0.5 rounded truncate transition hover:opacity-80"
                                  style={{ backgroundColor: (stato ? stato.color : mod.color) + '33', color: stato ? stato.color : mod.color }}>
                                  {String(lbl).slice(0, 20)}
                                </button>
                              )
                            })}
                            {dayRecs.length > 3 && <div className="text-[10px] text-gray-600 pl-1">+{dayRecs.length - 3} altri</div>}
                          </div>
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )
      })() : fields.length === 0 ? (
        <div className="bg-surface-card rounded-md p-12 text-center border border-gray-800">
          <div className="text-gray-500 mb-2">Modulo senza campi configurati</div>
          <div className="text-gray-600 text-sm">Vai nel Builder per aggiungere campi a questo modulo</div>
        </div>
      ) : records.length === 0 ? (
        <div className="bg-surface-card rounded-md p-12 text-center border border-gray-800">
          <div className="text-gray-500">Nessun record ancora</div>
        </div>
      ) : displayRecords.length === 0 ? (
        <div className="bg-surface-card rounded-md p-12 text-center border border-gray-800">
          <div className="text-gray-500">Nessun risultato per "{search}"</div>
        </div>
      ) : (
        <div className="bg-surface-card rounded-md border border-gray-800 overflow-x-auto">
          {/* Mobile: una scheda per riga (la tabella larga costringeva a scorrere di lato e si vedeva solo la prima colonna). */}
          <div className="md:hidden divide-y divide-gray-800/60">
            {pagedRecords.map((r) => {
              const stato = workflow && workflow.states.find((s) => s.key === r.data._stato)
              const val = (c) => {
                const v = r.data[c.key]
                if (v === undefined || v === null || v === '') return null
                if (relations.some((x) => x.key === c.key)) { const cache = relatedCache[c.key]; return (cache && cache.byId[v]) || '#' + v }
                if (c.type === 'file') return v.name || null
                return String(v)
              }
              const [first, ...rest] = tableColumns
              const sub = rest.map(val).filter(Boolean)
              return (
                <div key={r.id} onClick={() => setDetailId(r.id)} className="flex items-start gap-3 px-4 py-3 active:bg-white/5 cursor-pointer">
                  {togglePair && (
                    <button onClick={(e) => { e.stopPropagation(); quickToggle(r) }} className="mt-0.5 w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: r.data._stato === togglePair.on ? '#10B981' : 'transparent', border: '2px solid ' + (r.data._stato === togglePair.on ? '#10B981' : '#374151') }}>
                      {r.data._stato === togglePair.on && <Icon name="check" size={12} className="text-white" />}
                    </button>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-ink break-words">{(first && val(first)) || '—'}</div>
                    {(sub.length > 0 || stato) && (
                      <div className="text-xs text-gray-500 mt-0.5 break-words">
                        {stato && <span className="mr-2"><span className="inline-block w-1.5 h-1.5 rounded-full mr-1" style={{ backgroundColor: stato.color }} />{stato.label}</span>}
                        {sub.slice(0, 3).join(' · ')}
                      </div>
                    )}
                  </div>
                  {canDelete && <button onClick={(e) => { e.stopPropagation(); remove(r.id) }} className="text-red-400/50 p-1 flex-shrink-0" aria-label="Elimina"><Icon name="trash" size={15} /></button>}
                </div>
              )
            })}
          </div>
          <table className="hidden md:table w-full min-w-[640px]">
            <thead>
              <tr className="border-b border-gray-800">
                {togglePair && <th className="w-8 px-2 py-3"></th>}
                {workflow && <th className="text-left px-4 py-3 text-xs text-gray-500 uppercase tracking-wider font-medium">Stato</th>}
                {tableColumns.map((c) => (
                <th key={c.key} onClick={() => toggleSort(c.key)}
                  className="text-left px-4 py-3 text-xs text-gray-500 uppercase tracking-wider font-medium cursor-pointer select-none hover:text-gray-300 transition">
                  <span className="flex items-center gap-1">
                    {c.label}
                    {sortField === c.key ? <Icon name={sortDir === 'asc' ? 'chevron-up' : 'chevron-down'} size={11} /> : null}
                  </span>
                </th>
              ))}
                {allegatiConfig && <th className="px-4 py-3"></th>}
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {pagedRecords.map((r) => {
                const stato = workflow && workflow.states.find((s) => s.key === r.data._stato)
                // Colora il cerchio per urgenza SOLO se il modulo marca un campo come
                // scadenza — altrimenti resta un semplice verde/grigio per stato.
                const scaduto = togglePair && scadenzaField && r.data._stato !== togglePair.on && r.data[scadenzaField.key] && r.data[scadenzaField.key] < todayStr
                const urgente = togglePair && scadenzaField && !scaduto && r.data._stato !== togglePair.on && r.data[scadenzaField.key] &&
                  Math.ceil((new Date(r.data[scadenzaField.key]) - new Date()) / 86400000) <= 3
                return (
                  <tr key={r.id} onClick={() => setDetailId(r.id)} className="border-b border-gray-800/50 hover:bg-white/5 transition cursor-pointer">
                    {togglePair && (
                      <td className="px-2 py-3" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => quickToggle(r)}
                          className="w-5 h-5 rounded-full flex items-center justify-center transition flex-shrink-0"
                          style={{
                            backgroundColor: r.data._stato === togglePair.on ? '#10B981' : 'transparent',
                            border: '2px solid ' + (r.data._stato === togglePair.on ? '#10B981' : scaduto ? '#F87171' : urgente ? '#F59E0B' : '#374151'),
                          }}
                          title={r.data._stato === togglePair.on ? 'Segna ' + togglePair.off : 'Segna ' + togglePair.on}>
                          {r.data._stato === togglePair.on && <Icon name="check" size={10} className="text-white" />}
                        </button>
                      </td>
                    )}
                    {workflow && (
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: stato ? stato.color : '#6B7280' }} />
                          <span className="text-xs text-gray-400">{stato ? stato.label : '—'}</span>
                        </div>
                      </td>
                    )}
                    {tableColumns.map((c) => {
                      const isRelation = relations.some((r) => r.key === c.key)
                      let display
                      if (isRelation) {
                        const cache = relatedCache[c.key]
                        display = (cache && cache.byId[r.data[c.key]]) || (r.data[c.key] ? '#' + r.data[c.key] : '—')
                      } else if (c.type === 'file') {
                        display = r.data[c.key] && r.data[c.key].id ? (
                          <button onClick={(e) => { e.stopPropagation(); openUploadedFile(r.data[c.key], token) }} className="text-accent hover:opacity-80 transition flex items-center gap-1">
                            <Icon name="file" size={12} />{r.data[c.key].name}
                          </button>
                        ) : '—'
                      } else {
                        display = r.data[c.key] !== undefined && r.data[c.key] !== null ? String(r.data[c.key]) : '—'
                      }
                      // Badge stato pagamento (Non pagato/Parziale/Pagato) accanto al
                      // campo 'pagato', quando il record ha anche un campo 'totale' da
                      // confrontarci — richiesto esplicitamente per Ordini ("totale
                      // visibile e se pagato totale o parziale"), generico per
                      // qualunque modulo che abbia entrambi i campi, non hardcoded sul
                      // modulo. Solo visivo, non un campo salvato: il motore formule
                      // sa produrre solo numeri/booleani, non un'etichetta a 3 stati.
                      const showPagamentoBadge = c.key === 'pagato' && r.data.totale !== undefined && r.data.totale !== null
                      let pagamentoBadge = null
                      if (showPagamentoBadge) {
                        const pagato = parseFloat(r.data.pagato) || 0
                        const totale = parseFloat(r.data.totale) || 0
                        const stato = pagato <= 0 ? { label: 'Non pagato', cls: 'bg-red-900/30 text-red-400' }
                          : pagato >= totale && totale > 0 ? { label: 'Pagato', cls: 'bg-green-900/30 text-green-400' }
                          : { label: 'Parziale', cls: 'bg-amber-900/30 text-amber-400' }
                        pagamentoBadge = <span className={'ml-1.5 text-[10px] px-1.5 py-0.5 rounded ' + stato.cls}>{stato.label}</span>
                      }
                      return <td key={c.key} className="px-4 py-3 text-sm text-gray-300 whitespace-nowrap">{display}{pagamentoBadge}</td>
                    })}
                    {allegatiConfig && (
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <input ref={(el) => { fileInputRefs.current[r.id] = el }} type="file" className="hidden" onChange={(e) => uploadInline(r, e.target.files[0])} />
                        <button onClick={() => fileInputRefs.current[r.id] && fileInputRefs.current[r.id].click()}
                          className="flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-full bg-gray-800 hover:bg-gray-700 text-gray-400 transition">
                          <Icon name="link" size={10} />Allega
                        </button>
                      </td>
                    )}
                    <td className="px-4 py-3 text-right">
                      {canDelete && <button onClick={(e) => { e.stopPropagation(); remove(r.id) }} className="text-red-400/50 hover:text-red-400 transition"><Icon name="trash" size={14} /></button>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-800">
              <div className="text-xs text-gray-500">{(page - 1) * PER_PAGE + 1}–{Math.min(page * PER_PAGE, displayRecords.length)} di {displayRecords.length}</div>
              <div className="flex items-center gap-1">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
                  className="px-2 py-1 rounded text-gray-400 hover:text-ink disabled:opacity-30 transition text-xs">
                  <Icon name="chevron-left" size={14} />
                </button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 1).map((p, idx, arr) => (
                  <React.Fragment key={p}>
                    {idx > 0 && arr[idx - 1] !== p - 1 && <span className="text-gray-600 text-xs px-1">…</span>}
                    <button onClick={() => setPage(p)}
                      className={'px-2.5 py-1 rounded text-xs transition ' + (p === page ? 'bg-accent text-white' : 'text-gray-400 hover:text-ink')}>
                      {p}
                    </button>
                  </React.Fragment>
                ))}
                <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                  className="px-2 py-1 rounded text-gray-400 hover:text-ink disabled:opacity-30 transition text-xs">
                  <Icon name="chevron-right" size={14} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {showNew && editableFields.length > 0 && (() => {
        const closeAll = () => { setShowNew(false); setForm({}); setEmbeddedRows({}) }

        return (
          <FormDrawer
            title={'Nuovo record — ' + mod.name}
            onClose={closeAll}
            footer={(
              <div className="flex gap-3">
                <button onClick={closeAll} disabled={creating} className="flex-1 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-white py-3 rounded-lg transition">Annulla</button>
                <button onClick={create} disabled={creating} className="flex-1 bg-accent hover:opacity-90 disabled:opacity-50 text-white py-3 rounded-lg transition font-medium">{creating ? 'Salvataggio...' : 'Salva'}</button>
              </div>
            )}
          >
            <div className="space-y-3 mb-6">
              {workflow && (
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Stato iniziale</label>
                  <Select value={form._stato || ''} onChange={(v) => setForm({ ...form, _stato: v })}
                    options={workflow.states.filter((s) => s.initial || true).map((s) => ({ value: s.key, label: s.label }))} />
                </div>
              )}
              {(() => {
                // Prima ciò che serve davvero: in un archivio il file in testa, poi i campi obbligatori, poi gli altri; i collegamenti
                // facoltativi (spese, debiti…) stanno chiusi in fondo, a meno che uno sia obbligatorio.
                const arch = mod.list_view === 'archive'
                const peso = (f) => (arch && f.type === 'file' ? 0 : f.required ? 1 : 2)
                const campi = [...visibleEditableFields].sort((a, b) => peso(a) - peso(b))
                const obbl = relations.filter((r) => r.required)
                const facolt = relations.filter((r) => !r.required)
                return (
                  <>
                    {obbl.map(renderRelationField)}
                    {campi.map(renderRegularField)}
                    {facolt.length > 0 && (
                      <div className="border-t border-gray-800 pt-3">
                        <button type="button" onClick={() => setMostraCollegamenti((v) => !v)} className="w-full flex items-center justify-between text-sm text-gray-400 hover:text-ink py-1">
                          <span>Collegamenti <span className="text-xs text-gray-600">(facoltativo)</span></span>
                          <Icon name={mostraCollegamenti ? 'chevron-down' : 'chevron-right'} size={14} />
                        </button>
                        {mostraCollegamenti && <div className="space-y-3 mt-2">{facolt.map(renderRelationField)}</div>}
                      </div>
                    )}
                  </>
                )
              })()}
            </div>

            {Object.entries(liveResults).some(([, r]) => r.valid && r.value === true) && (
              <div className="space-y-2 mb-5">
                {Object.entries(liveResults).filter(([, r]) => r.valid && r.value === true).map(([key, r]) => (
                  <div key={key} className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs rounded-lg px-3 py-2">
                    <Icon name="alert-triangle" size={13} />{r.label || key}
                  </div>
                ))}
              </div>
            )}

            {embeddedChildren.map(renderChildBlock)}
          </FormDrawer>
        )
      })()}

      {detailId && (
        <RecordDetailModal mod={mod} schema={schema} recordId={detailId} relatedCache={relatedCache} onClose={() => setDetailId(null)} token={token} onSaved={loadRecords} user={user} />
      )}

      {branchCreateOpen && (
        <BranchCreateModal config={branchCreateOpen} defaultModuleSlug={mod.slug} token={token}
          onClose={() => setBranchCreateOpen(null)}
          onCreated={() => { setBranchCreateOpen(null); loadRecords(); toast('Creato') }} />
      )}

      {showImport && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-surface-card rounded-md p-6 w-full max-w-lg border border-gray-800 max-h-[85vh] overflow-y-auto">
            <h2 className="text-base font-bold text-ink mb-1">Importa CSV — {mod.name}</h2>
            {!importPreview && !importResult && (
              <>
                <p className="text-xs text-gray-500 mb-4">Prima riga = intestazioni. Nella schermata successiva potrai controllare e correggere come ogni colonna viene abbinata ai campi del modulo, prima di importare davvero.</p>
                <input type="file" accept=".csv,text/csv"
                  className="w-full text-xs text-gray-400 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-gray-800 file:text-gray-300 file:text-xs hover:file:bg-gray-700 file:cursor-pointer cursor-pointer mb-4"
                  onChange={(e) => e.target.files[0] && previewImportCsv(e.target.files[0])} />
                {importing && <div className="text-xs text-gray-500 mb-3">Lettura del file in corso...</div>}
                <button onClick={() => { setShowImport(false); resetImport() }} className="w-full bg-gray-800 hover:bg-gray-700 text-white py-3 rounded-lg transition text-sm">Annulla</button>
              </>
            )}
            {importPreview && !importResult && (
              <>
                <p className="text-xs text-gray-500 mb-3">
                  {importPreview.totalRows} righe trovate. Controlla la mappatura (proposta automaticamente dove possibile) — scegli "non importare" per una colonna che non serve.
                </p>
                {importPreview.unmatchedFields.some((f) => f.required) && (
                  <div className="text-xs text-amber-400 mb-3 flex items-center gap-1"><Icon name="alert-triangle" size={12} />
                    Campo obbligatorio senza colonna abbinata: {importPreview.unmatchedFields.filter((f) => f.required).map((f) => f.label).join(', ')}
                  </div>
                )}
                <div className="space-y-2 mb-4">
                  {importPreview.headers.map((h, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <div className="flex-1 min-w-0">
                        <div className="text-ink font-mono truncate">{h}</div>
                        <div className="text-gray-600 truncate">es. "{(importPreview.sampleRows[0] || [])[i] || '—'}"</div>
                      </div>
                      <Icon name="chevron-right" size={12} className="text-gray-600 flex-shrink-0" />
                      <select value={importFieldMap[i] || ''} onChange={(e) => setImportFieldMap((m) => ({ ...m, [i]: e.target.value || undefined }))}
                        className="flex-1 min-w-0 bg-surface-page text-ink px-2 py-1.5 rounded-lg outline-none border border-gray-800 focus:border-accent transition">
                        <option value="">— non importare —</option>
                        {editableFields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
                {importing && <div className="text-xs text-gray-500 mb-3">Importazione in corso...</div>}
                <div className="flex gap-2">
                  <button onClick={resetImport} className="flex-1 bg-gray-800 hover:bg-gray-700 text-white py-3 rounded-lg transition text-sm">Indietro</button>
                  <button onClick={confirmImport} disabled={importing} className="flex-1 bg-accent hover:opacity-90 disabled:opacity-50 text-white py-3 rounded-lg transition text-sm font-medium">Importa {importPreview.totalRows} righe</button>
                </div>
              </>
            )}
            {importResult && (
              <>
                <div className="bg-surface-page rounded-lg p-4 border border-gray-800 mb-4 text-sm">
                  <div className="text-green-400 font-medium mb-1">{importResult.created} record importati</div>
                  {importResult.skipped > 0 && <div className="text-gray-500 text-xs">{importResult.skipped} righe vuote saltate</div>}
                  {importResult.errors && importResult.errors.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {importResult.errors.map((e, i) => (
                        <div key={i} className="text-xs text-red-400">Riga {e.row}: {e.error}</div>
                      ))}
                    </div>
                  )}
                </div>
                <button onClick={() => { setShowImport(false); resetImport() }} className="w-full bg-accent hover:opacity-90 text-white py-3 rounded-lg transition text-sm font-medium">Chiudi</button>
              </>
            )}
          </div>
        </div>
      )}

      {quickCreateRel && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[60]">
          <div className="bg-surface-card rounded-md p-6 w-full max-w-sm border border-gray-800">
            <h2 className="text-base font-bold text-ink mb-1">Nuovo {quickCreateRel.label.toLowerCase()}</h2>
            <div className="text-[11px] text-gray-600 mb-4">Creazione rapida — potrai completare l'anagrafica per intero più tardi.</div>
            <div className="space-y-3 mb-5">
              {quickCreateTargetFields.length === 0 ? (
                <div className="text-xs text-gray-500">Caricamento campi...</div>
              ) : quickCreateTargetFields.map((f) => (
                <div key={f.key}>
                  <label className="text-xs text-gray-400 block mb-1">{f.label}{f.required && ' *'}</label>
                  <input className="w-full bg-surface-page text-ink px-3 py-2.5 rounded-lg text-sm outline-none border border-gray-800 focus:border-accent transition"
                    type={f.type === 'date' ? 'date' : f.type === 'time' ? 'time' : (f.type === 'number' || f.type === 'currency') ? 'number' : 'text'}
                    value={quickCreateForm[f.key] || ''} onChange={(e) => setQuickCreateForm({ ...quickCreateForm, [f.key]: e.target.value })} />
                </div>
              ))}
            </div>
            {quickCreateError && <div className="text-xs text-red-400 mb-3">{quickCreateError}</div>}
            <div className="flex gap-3">
              <button onClick={() => setQuickCreateRel(null)} className="flex-1 bg-gray-800 hover:bg-gray-700 text-white py-2.5 rounded-lg text-sm transition">Annulla</button>
              <button onClick={submitQuickCreate} disabled={quickCreateSaving || quickCreateTargetFields.length === 0}
                className="flex-1 bg-accent hover:opacity-90 disabled:opacity-50 text-white py-2.5 rounded-lg text-sm transition font-medium">
                {quickCreateSaving ? 'Salvataggio...' : 'Crea e seleziona'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default ModulePage
