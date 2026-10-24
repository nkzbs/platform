import React, { useState, useEffect } from 'react'
import RiepilogoMensile from '../components/RiepilogoMensile'
import useApi from '../lib/useApi'
import Icon from '../components/Icon'
import { parseSchemaFrontend } from '../lib/schema-v3-frontend'
import ChecklistWidget from './ChecklistWidget'
import InsightsCard from '../components/InsightsCard'
import QueueWidget from '../components/QueueWidget'
import TimbratureWidget from '../components/TimbratureWidget'
import YearlyBreakdownView from './ModulePage/YearlyBreakdownView'
import CategoryPivotView from './ModulePage/CategoryPivotView'
import WeeklyBreakdownView from './ModulePage/WeeklyBreakdownView'

// ─── DASHBOARD / REPORT ─────────────────────────────────────────────────────────
// Stesso motore widget per due pagine — page='dashboard' (default, invariato) o
// page='report': stessa tabella (dashboard_widgets, colonna 'page'), stesso editor,
// due collezioni separate. Report nasce per i pannelli aggregati già costruiti
// altrove (riepilogo mensile, pivot categoria, andamento settimanale, aggregato
// singolo) — qui si sceglie liberamente quali vedere insieme, invece di doverli
// trovare sparsi sulla pagina di ogni singolo modulo.
function DashboardPage({ user, modules, token, page = 'dashboard', onNavigate, features = {} }) {
  const api = useApi(token)
  const [editMode, setEditMode] = useState(false)
  // Mese scelto con le frecce della Checklist ('AAAA-MM', null = quello di partenza): il Riepilogo mensile lo segue.
  const [meseSel, setMeseSel] = useState(null)
  const meseScelto = (cutoff) => (meseSel ? { anno: Number(meseSel.slice(0, 4)), mese: Number(meseSel.slice(5, 7)) - 1 } : meseTarget(cutoff))
  // Su telefono i widget lunghi si chiudono con un tocco (su PC sono sempre aperti): di default chiusi "come sta andando" e checklist.
  const [aperti, setAperti] = useState(() => { try { return JSON.parse(localStorage.getItem('dash_aperti') || '{}') } catch (e) { return {} } })
  const isAperto = (w) => (w.id in aperti ? aperti[w.id] : !['come_sta_andando', 'checklist'].includes(w.type))
  const toggleAperto = (w) => setAperti((a) => { const n = { ...a, [w.id]: !isAperto(w) }; try { localStorage.setItem('dash_aperti', JSON.stringify(n)) } catch (e) { /* storage non disponibile */ } return n })
  // Prima i widget vivevano in localStorage (per browser, non per tenant — due persone
  // sulla stessa istanza vedevano dashboard diverse, e sparivano cambiando browser).
  // Ora sono dati reali del tenant (tabella dashboard_widgets), condivisi da chiunque
  // apra questa istanza, coerenti col resto del sistema.
  const [widgets, setWidgets] = useState([])
  const [showAdd, setShowAdd] = useState(false)
  // null = si sta creando un widget nuovo, altrimenti l'id del widget esistente in
  // modifica — stesso modale di creazione, precompilato, salvataggio con PATCH
  // invece di POST. Prima l'unico modo per cambiare un widget già creato (tipo,
  // sorgenti, soglia, ruoli...) era eliminarlo e ricrearlo da zero, perdendo la
  // posizione: la route PATCH /dashboard/widgets/:id esisteva già lato backend,
  // mancava solo questo collegamento in UI.
  const [editingWidgetId, setEditingWidgetId] = useState(null)
  const [newWidget, setNewWidget] = useState({ type: 'kpi', module_slug: '', field: '', aggregation: 'sum', label: '', color: '#2563EB', roles: [], user_ids: [] })
  // Config condivisa dai 4 widget "pannello aggregato" (yearly_breakdown/category_pivot/
  // weekly_breakdown/aggregate_value) — stessa forma per tutti: un modulo sorgente + la
  // chiave del blocco già dichiarato lì (non lo ridefiniscono, lo referenziano).
  const [reportBlockConfig, setReportBlockConfig] = useState({ source_module: '', block_key: '' })
  // Ruoli del tenant, per scegliere a chi mostrare il widget (vuoto = tutti, come
  // sempre) — stessa fonte già usata in Utenti/Builder, non una copia locale.
  const [allRoles, setAllRoles] = useState([])
  // Utenti reali del tenant, per scegliere singoli individui (non solo ruoli) —
  // due persone possono condividere lo stesso ruolo (es. Finance: Nima e
  // Federica, entrambi "Utente") e restare comunque distinguibili.
  const [allUsers, setAllUsers] = useState([])
  useEffect(() => {
    if (user && user.role === 'admin') {
      api.get('/roles').then((data) => { if (data) setAllRoles(data) })
      api.get('/users').then((data) => { if (data) setAllUsers(data) })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user && user.role])
  const [widgetData, setWidgetData] = useState({})
  // Configurazione del widget Checklist multi-modulo — separata da newWidget perché
  // ha una forma diversa (più moduli, non uno) e diventa la 'config' JSON del widget.
  const [checklistConfig, setChecklistConfig] = useState({ sources: [], period: 'questo_mese', giorno_cutoff: 1, from: '', to: '', apri_dettaglio: false })
  // Config del widget 'periodo' — campo data su cui filtrare, finestra relativa, e
  // un'eventuale soglia che colora il numero come allerta (es. "straordinari > 120 min").
  const [periodoConfig, setPeriodoConfig] = useState({ date_field: '', periodo: 'mese', soglia: '', soglia_operatore: '>', colore_soglia: '#F87171' })
  // Config del widget 'riepilogo_mensile' — replica generica (non hardcoded a
  // moduli/nomi specifici) della card "Riepilogo" di hearth: entrate del mese,
  // uscite per uno o più gruppi (es. Casa/Personale) con split fisso/variabile,
  // pagato/da pagare, e una stima "previsto" per tipo di conto (es. carta
  // prepagata vs conto corrente) letta dalla relazione conto di ogni gruppo.
  const [riepilogoConfig, setRiepilogoConfig] = useState({
    giorno_cutoff: 27,
    entrate: { modulo: '', campo_importo: '', campo_data: '' },
    gruppi: [],
    conti: { modulo: '', campo_tipo: '', valore_carta: '', valore_conto: '' },
  })

  const loadWidgets = async () => {
    const data = await api.get('/dashboard/widgets?page=' + page)
    if (data) setWidgets(data)
  }
  useEffect(() => { loadWidgets() }, [page]) // eslint-disable-line react-hooks/exhaustive-deps


  // Blocchi già dichiarati su un modulo per uno dei 4 tipi "pannello aggregato" — stesso
  // bisogno di fieldsOf() più sotto, per un array diverso dello schema normalizzato.
  const REPORT_BLOCK_ARRAY = { yearly_breakdown: 'yearly_breakdowns', category_pivot: 'category_pivots', weekly_breakdown: 'weekly_breakdowns' }
  const reportBlocksOf = (moduleSlug, widgetType) => {
    const mod = modules.find((m) => m.slug === moduleSlug)
    if (!mod) return []
    const schema = parseSchemaFrontend(mod.schema_json)
    if (widgetType === 'aggregate_value') return (schema.aggregati || []).filter((a) => !a.group_by && a.key && !a.internal)
    const arrayKey = REPORT_BLOCK_ARRAY[widgetType]
    return arrayKey ? (schema[arrayKey] || []) : []
  }
  const resolveReportBlock = (cfg, widgetType) => {
    const blocks = reportBlocksOf(cfg && cfg.source_module, widgetType)
    return blocks.find((b) => b.key === (cfg && cfg.block_key)) || null
  }

  // Calcolo aggregazione lato client sui record già filtrati per modulo — stesso
  // ventaglio di funzioni già offerto nel motore formule (sum/avg/count/min/max),
  // prima qui era sempre e solo "somma" indipendentemente da cosa si scegliesse
  // (in realtà non si poteva nemmeno scegliere: era hardcoded).
  const aggregate = (vals, fn) => {
    if (fn === 'count') return vals.length
    if (vals.length === 0) return 0
    if (fn === 'avg') return vals.reduce((a, b) => a + b, 0) / vals.length
    if (fn === 'min') return Math.min(...vals)
    if (fn === 'max') return Math.max(...vals)
    return vals.reduce((a, b) => a + b, 0) // sum, default
  }

  // Finestra di un periodo relativo (oggi/settimana/mese/anno) — stessa idea già usata
  // per il widget Checklist (period: questo_mese/personalizzato/tutti), qui generalizzata
  // a più periodi e riusata da qualunque widget 'periodo', non solo dashboard fisse tipo
  // Timbrature: quel comportamento ora è dato configurabile, non più codice a sé.
  const inPeriodo = (dataStr, periodo) => {
    if (!dataStr) return false
    if (periodo === 'tutti' || !periodo) return true
    const d = new Date(dataStr)
    if (isNaN(d.getTime())) return false
    const now = new Date()
    if (periodo === 'oggi') return dataStr.slice(0, 10) === now.toISOString().slice(0, 10)
    if (periodo === 'settimana') {
      const day = now.getDay() || 7
      const start = new Date(now)
      start.setDate(now.getDate() - day + 1)
      start.setHours(0, 0, 0, 0)
      return d >= start
    }
    if (periodo === 'mese') return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
    if (periodo === 'anno') return d.getFullYear() === now.getFullYear()
    return true
  }

  // Mese "di competenza": se oggi è al giorno di cutoff (default 27, come in
  // hearth) o oltre, il mese target è il prossimo — stessa regola già replicata
  // più volte nelle pagine finance (SpeseFinancePage, DashboardFinancePage),
  // qui generalizzata con un giorno configurabile invece di 27 fisso.
  const meseTarget = (giornoCutoff) => {
    const cutoff = giornoCutoff || 27
    const oggi = new Date()
    let anno = oggi.getFullYear(), mese = oggi.getMonth()
    if (oggi.getDate() >= cutoff) { mese += 1; if (mese > 11) { mese = 0; anno += 1 } }
    return { anno, mese }
  }
  const inMeseTarget = (dataStr, anno, mese) => {
    if (!dataStr) return false
    const d = new Date(dataStr)
    return d.getFullYear() === anno && d.getMonth() === mese
  }

  useEffect(() => {
    widgets.forEach(async (w) => {
      if (w.type === 'riepilogo_mensile') {
        const cfg = w.config || {}
        const { anno, mese } = meseScelto(cfg.giorno_cutoff)
        const [entrateRec, contiRec, ...gruppiRec] = await Promise.all([
          cfg.entrate?.modulo ? api.get('/records/' + cfg.entrate.modulo) : Promise.resolve([]),
          cfg.conti?.modulo ? api.get('/records/' + cfg.conti.modulo) : Promise.resolve([]),
          ...(cfg.gruppi || []).map((g) => (g.modulo ? api.get('/records/' + g.modulo) : Promise.resolve([]))),
        ])
        const contiTipoById = {}
        ;(contiRec || []).forEach((c) => { contiTipoById[c.id] = c.data[cfg.conti?.campo_tipo] })

        // Lo stipendio di fine mese (di solito il 27, ma anche prima se cade nel weekend) paga il mese DOPO: le entrate di un mese vanno da 5 giorni
        // prima del cutoff del mese prima a 6 giorni prima del cutoff del mese; le uscite restano il mese di calendario.
        const cutoff = Math.max(2, (cfg.giorno_cutoff || 27) - 5)
        const p2 = (n) => String(n).padStart(2, '0')
        const prev = new Date(anno, mese - 1, 1)
        const daData = prev.getFullYear() + '-' + p2(prev.getMonth() + 1) + '-' + p2(cutoff)
        const aData = anno + '-' + p2(mese + 1) + '-' + p2(cutoff - 1)
        const entrateMese = (entrateRec || []).filter((r) => { const d = String(r.data[cfg.entrate?.campo_data] || '').slice(0, 10); return d >= daData && d <= aData })
        const entrateTotale = entrateMese.reduce((s, r) => s + (parseFloat(r.data[cfg.entrate?.campo_importo]) || 0), 0)

        let uscite = 0, fissa = 0, pagato = 0, prevCarta = 0, prevConto = 0
        ;(cfg.gruppi || []).forEach((g, i) => {
          const recMese = (gruppiRec[i] || []).filter((r) => inMeseTarget(r.data[g.campo_data], anno, mese))
          recMese.forEach((r) => {
            const imp = parseFloat(r.data[g.campo_importo]) || 0
            uscite += imp
            if (g.campo_fisso && r.data[g.campo_fisso]) fissa += imp
            if (g.campo_stato && r.data[g.campo_stato] === g.valore_pagato) pagato += imp
            const tipoConto = g.campo_conto ? contiTipoById[r.data[g.campo_conto]] : null
            if (cfg.conti?.valore_carta && tipoConto === cfg.conti.valore_carta) prevCarta += imp
            // "Previsto Conto" conta solo il conto personale indicato (es. Corrente/
            // "Conto Nima") — NON è un residuo "tutto il resto": le uscite dal conto
            // condiviso/casa o senza conto assegnato non rientrano in nessuna delle
            // due, stessa distinzione confermata contro il dato reale dell'utente.
            if (cfg.conti?.valore_conto && tipoConto === cfg.conti.valore_conto) prevConto += imp
          })
        })
        const variabile = uscite - fissa
        const daPagare = uscite - pagato
        const spendibile = entrateTotale - uscite
        setWidgetData((prev) => ({ ...prev, [w.id]: { entrateTotale, uscite, fissa, variabile, prevCarta, prevConto, pagato, daPagare, spendibile } }))
      }
      if (w.type === 'kpi' && w.module_slug) {
        const records = await api.get('/records/' + w.module_slug)
        if (records && w.field) {
          const vals = records.map((r) => parseFloat(r.data[w.field] || 0)).filter((v) => !isNaN(v))
          setWidgetData((prev) => ({ ...prev, [w.id]: { value: aggregate(vals, w.aggregation || 'sum'), count: records.length } }))
        } else if (records) {
          setWidgetData((prev) => ({ ...prev, [w.id]: { value: records.length, count: records.length } }))
        }
      }
      if (w.type === 'table' && w.module_slug) {
        const records = await api.get('/records/' + w.module_slug)
        if (records) setWidgetData((prev) => ({ ...prev, [w.id]: { records: records.slice(0, 5) } }))
      }
      if (w.type === 'periodo' && w.module_slug) {
        const records = await api.get('/records/' + w.module_slug)
        if (records) {
          const cfg = w.config || {}
          const filtered = cfg.date_field ? records.filter((r) => inPeriodo(r.data[cfg.date_field], cfg.periodo)) : records
          const vals = w.field ? filtered.map((r) => parseFloat(r.data[w.field] || 0)).filter((v) => !isNaN(v)) : []
          const value = w.field ? aggregate(vals, w.aggregation || 'sum') : filtered.length
          let allarme = false
          if (cfg.soglia !== undefined && cfg.soglia !== null && cfg.soglia !== '') {
            const s = parseFloat(cfg.soglia)
            const op = cfg.soglia_operatore || '>'
            allarme = op === '>' ? value > s : op === '<' ? value < s : op === '>=' ? value >= s : op === '<=' ? value <= s : false
          }
          setWidgetData((prev) => ({ ...prev, [w.id]: { value, count: filtered.length, allarme } }))
        }
      }
      // aggregate_value: unico dei 4 widget "pannello aggregato" senza un componente
      // vista già pronto da riusare (SingleValueCard vive dentro SchemaReports.jsx, non
      // esportata a parte) — un fetch diretto della stessa route, stesso formato.
      if (w.type === 'aggregate_value') {
        const cfg = w.config || {}
        if (cfg.source_module && cfg.block_key) {
          const res = await api.get('/records/' + cfg.source_module + '/aggregate/' + cfg.block_key)
          if (res) setWidgetData((prev) => ({ ...prev, [w.id]: { value: res.value, format: res.format } }))
        }
      }
    })
  }, [widgets, meseSel])

  const REPORT_WIDGET_TYPES = ['yearly_breakdown', 'category_pivot', 'weekly_breakdown', 'aggregate_value']
  const resetWidgetForm = () => {
    setShowAdd(false)
    setEditingWidgetId(null)
    setNewWidget({ type: 'kpi', module_slug: '', field: '', aggregation: 'sum', label: '', color: '#2563EB', roles: [], user_ids: [] })
    setChecklistConfig({ sources: [], period: 'questo_mese', giorno_cutoff: 1, from: '', to: '', apri_dettaglio: false })
    setPeriodoConfig({ date_field: '', periodo: 'mese', soglia: '', soglia_operatore: '>', colore_soglia: '#F87171' })
    setRiepilogoConfig({ giorno_cutoff: 27, entrate: { modulo: '', campo_importo: '', campo_data: '' }, gruppi: [], conti: { modulo: '', campo_tipo: '', valore_carta: '', valore_conto: '' } })
    setReportBlockConfig({ source_module: '', block_key: '' })
  }
  const [declared, setDeclared] = useState([]) // moduli che hanno dichiarato di essere spese o entrate (Builder → Ruoli del modulo)
  useEffect(() => { if (showAdd) api.get('/module-roles').then((d) => setDeclared(Array.isArray(d) ? d : [])) }, [showAdd]) // eslint-disable-line react-hooks/exhaustive-deps
  const spesaModules = declared.filter((m) => m.kind === 'spesa')
  // I widget di finanza compaiono solo se il progetto ha moduli di spese o entrate (o se stai modificando uno di quelli)
  const showFinanza = declared.length > 0 || ['riepilogo_mensile', 'come_sta_andando'].includes(newWidget.type)
  const TYPE_HELP = {
    kpi: 'Un numero grande: la somma, la media o il conteggio di un campo di un modulo.',
    periodo: 'Come il numero, ma per un periodo (oggi, settimana, mese) e con un colore se supera una soglia.',
    aggregate_value: 'Un numero calcolato da una formula o da un aggregato definito nel Builder.',
    table: 'Le ultime righe di un modulo, in una piccola tabella.',
    checklist: 'Righe da spuntare, prese da uno o più moduli (es. cosa è già pagato e cosa no).',
    coda: 'Le righe rimaste nello stato «nuovo» dei moduli che lo hanno dichiarato (Builder → Avvisi), con il pulsante per smistarle.',
    timbrature_rapide: 'Entrata/uscita con un tocco e il totale di oggi, per il modulo dichiarato come Timbrature (Builder → Ruoli del modulo).',
    yearly_breakdown: 'Un campo sommato mese per mese, con il confronto con l\'anno prima.',
    category_pivot: 'Un campo sommato per categoria, anno su anno.',
    weekly_breakdown: 'Un campo sommato per settimana, con una soglia (es. straordinari oltre un limite).',
    riepilogo_mensile: 'Entrate, uscite, parte fissa e variabile e quanto resta da spendere nel mese. Serve scegliere i moduli.',
    come_sta_andando: 'Come è andato il mese e l\'anno: totali, confronti, categorie e cose da guardare. Si può scegliere cosa conta e farlo spiegare dall\'AI.',
  }


  const saveWidget = async () => {
    const w = { ...newWidget, page }
    if (!w.label) w.label = w.module_slug || (w.type === 'checklist' ? 'Checklist' : w.type === 'come_sta_andando' ? 'Come sta andando' : w.type === 'coda' ? 'Coda' : w.type === 'timbrature_rapide' ? 'Timbrature' : 'Widget')
    if (w.type === 'checklist') w.config = checklistConfig
    if (w.type === 'periodo') w.config = periodoConfig
    if (w.type === 'riepilogo_mensile') w.config = riepilogoConfig
    if (REPORT_WIDGET_TYPES.includes(w.type)) w.config = reportBlockConfig
    if (w.type === 'come_sta_andando') {
      const grp = String(newWidget.entrate_include || '').split(',').map((x) => x.trim()).filter(Boolean)
      w.config = { explainable: newWidget.explainable !== false, spese_modules: newWidget.spese_modules || [], entrate_include_groups: grp, accantonamento: newWidget.accantonamento !== false, solo_spese: !!newWidget.solo_spese, monitor: !!newWidget.monitor }
    }
    const saved = editingWidgetId ? await api.patch('/dashboard/widgets/' + editingWidgetId, w) : await api.post('/dashboard/widgets', w)
    if (saved && saved.ok !== false) {
      resetWidgetForm()
      loadWidgets()
    }
  }
  // Precompila il modale con un widget esistente — stessi campi di newWidget più la
  // config specifica del tipo, quindi il salvataggio (PATCH) riparte da uno stato
  // identico a quello che avrebbe prodotto quel widget in creazione.
  const startEditWidget = (w) => {
    setNewWidget({ type: w.type, module_slug: w.module_slug || '', field: w.field || '', aggregation: w.aggregation || 'sum', label: w.label || '', color: w.color || '#2563EB', roles: w.roles || [], user_ids: w.user_ids || [] })
    const cfg = w.config || {}
    if (w.type === 'checklist') setChecklistConfig({ sources: cfg.sources || [], period: cfg.period || 'questo_mese', giorno_cutoff: cfg.giorno_cutoff || 1, from: cfg.from || '', to: cfg.to || '', apri_dettaglio: !!cfg.apri_dettaglio })
    if (w.type === 'periodo') setPeriodoConfig({ date_field: cfg.date_field || '', periodo: cfg.periodo || 'mese', soglia: cfg.soglia ?? '', soglia_operatore: cfg.soglia_operatore || '>', colore_soglia: cfg.colore_soglia || '#F87171' })
    if (w.type === 'riepilogo_mensile') setRiepilogoConfig({
      giorno_cutoff: cfg.giorno_cutoff || 27,
      entrate: cfg.entrate || { modulo: '', campo_importo: '', campo_data: '' },
      gruppi: cfg.gruppi || [],
      conti: cfg.conti || { modulo: '', campo_tipo: '', valore_carta: '', valore_conto: '' },
    })
    if (REPORT_WIDGET_TYPES.includes(w.type)) setReportBlockConfig({ source_module: cfg.source_module || '', block_key: cfg.block_key || '' })
    if (w.type === 'come_sta_andando') setNewWidget((n) => ({ ...n, explainable: cfg.explainable !== false, spese_modules: cfg.spese_modules || [], entrate_include: (cfg.entrate_include_groups || []).join(', '), accantonamento: cfg.accantonamento !== false, solo_spese: !!cfg.solo_spese, monitor: !!cfg.monitor }))
    setEditingWidgetId(w.id)
    setShowAdd(true)
  }

  const fieldsOf = (moduleSlug) => {
    const mod = modules.find((m) => m.slug === moduleSlug)
    if (!mod) return []
    return parseSchemaFrontend(mod.schema_json).fields || []
  }

  const addChecklistSource = () => {
    setChecklistConfig((c) => ({ ...c, sources: [...c.sources, { module_slug: '', amount_field: '', status_field: '', date_field: '' }] }))
  }
  const updateChecklistSource = (idx, patch) => {
    setChecklistConfig((c) => {
      const sources = [...c.sources]
      sources[idx] = { ...sources[idx], ...patch }
      return { ...c, sources }
    })
  }
  const removeChecklistSource = (idx) => {
    setChecklistConfig((c) => ({ ...c, sources: c.sources.filter((_, i) => i !== idx) }))
  }

  const addRiepilogoGruppo = () => {
    setRiepilogoConfig((c) => ({ ...c, gruppi: [...c.gruppi, { label: '', modulo: '', campo_importo: '', campo_data: '', campo_stato: '', valore_pagato: '', campo_fisso: '', campo_conto: '' }] }))
  }
  const updateRiepilogoGruppo = (idx, patch) => {
    setRiepilogoConfig((c) => { const gruppi = [...c.gruppi]; gruppi[idx] = { ...gruppi[idx], ...patch }; return { ...c, gruppi } })
  }
  const removeRiepilogoGruppo = (idx) => {
    setRiepilogoConfig((c) => ({ ...c, gruppi: c.gruppi.filter((_, i) => i !== idx) }))
  }

  const removeWidget = async (id) => { await api.del('/dashboard/widgets/' + id); loadWidgets() }
  const moveWidget = async (id, dir) => {
    const idx = widgets.findIndex((w) => w.id === id)
    if ((dir === -1 && idx === 0) || (dir === 1 && idx === widgets.length - 1)) return
    const reordered = [...widgets]
    const tmp = reordered[idx]; reordered[idx] = reordered[idx + dir]; reordered[idx + dir] = tmp
    setWidgets(reordered) // ottimistico, subito visibile
    await api.put('/dashboard/widgets/reorder', { order: reordered.map((w) => w.id) })
  }

  const AGGREGATION_LABELS = { sum: 'Somma', avg: 'Media', count: 'Conteggio', min: 'Minimo', max: 'Massimo' }
  const PERIODO_LABELS = { oggi: 'Oggi', settimana: 'Questa settimana', mese: 'Questo mese', anno: "Quest'anno", tutti: 'Sempre' }

  const selectedModule = modules.find((m) => m.slug === newWidget.module_slug)
  const selectedSchema = selectedModule ? parseSchemaFrontend(selectedModule.schema_json) : {}
  const selectedFields = selectedSchema.fields || []

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold text-ink tracking-[-0.35px]">{page === 'report' ? 'Report' : 'Dashboard'}</h1>
          <p className="text-gray-500 text-sm mt-0.5">{page === 'report' ? 'Pannelli aggregati — componi tu quali vedere.' : 'Benvenuto, ' + (user && user.display_name)}</p>
        </div>
        {/* I widget sono condivisi da tutta l'istanza (vedi commento sopra) — modificarli
            (aggiungere/togliere/riordinare) è un'azione da admin, stesso vincolo già
            applicato dal backend (requireAdmin su POST/PATCH/DELETE/reorder). Prima questo
            pulsante era visibile a chiunque: un utente non-admin lo vedeva, provava a
            togliere un widget, la richiesta veniva rifiutata dal server ma senza nessun
            messaggio d'errore — sembrava semplicemente che "non succedesse nulla". */}
        {user && user.role === 'admin' && (
          <div className="flex gap-2">
            {editMode && (
              <button onClick={() => setShowAdd(true)} className="bg-accent hover:opacity-90 text-white px-4 py-2 rounded-lg text-sm transition flex items-center gap-2">
                <Icon name="plus" size={14} />Aggiungi widget
              </button>
            )}
            <button onClick={() => setEditMode(!editMode)} className={'px-4 py-2 rounded-lg text-sm transition ' + (editMode ? 'bg-green-600 hover:bg-green-700 text-white' : 'bg-gray-800 hover:bg-gray-700 text-gray-300')}>
              {editMode ? 'Fine modifica' : 'Modifica layout'}
            </button>
          </div>
        )}
      </div>


      {widgets.length === 0 && (
        <div className="bg-surface-card rounded-md p-12 text-center border border-gray-800 border-dashed">
          <div className="text-gray-500 mb-2">{page === 'report' ? 'Report vuoto' : 'Dashboard vuota'}</div>
          <div className="text-gray-600 text-sm mb-4">
            {user && user.role === 'admin' ? 'Aggiungi widget per visualizzare i tuoi dati' : 'Nessun widget configurato — chiedi a un admin di aggiungerne.'}
          </div>
          {user && user.role === 'admin' && (
            <button onClick={() => { setEditMode(true); setShowAdd(true) }} className="bg-accent hover:opacity-90 text-white px-4 py-2 rounded-lg text-sm transition">
              Aggiungi il primo widget
            </button>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
        {widgets.map((w) => {
          const data = widgetData[w.id] || {}
          // yearly_breakdown/category_pivot/weekly_breakdown riusano YearlyBreakdownView/
          // CategoryPivotView/WeeklyBreakdownView così come sono (stesso componente già
          // usato sulla pagina di un modulo) — hanno già la propria card (bg-surface-card
          // rounded-xl border p-5), niente doppia cornice qui, solo 'relative' per
          // ancorare i controlli di editMode.
          return (
            <div key={w.id} className={(!isAperto(w) ? 'max-lg:[&>*:not(.wbar)]:hidden ' : '') + (['yearly_breakdown', 'category_pivot', 'weekly_breakdown', 'come_sta_andando'].includes(w.type) ? 'relative' : 'bg-surface-card rounded-md border border-gray-800 overflow-hidden relative') + (['checklist', 'yearly_breakdown', 'category_pivot', 'weekly_breakdown'].includes(w.type) ? ' col-span-full' : ['coda'].includes(w.type) ? ' col-span-full' : ['come_sta_andando', 'riepilogo_mensile'].includes(w.type) ? ' col-span-full lg:col-span-3' : ' lg:col-span-2')}>
              {['come_sta_andando', 'checklist', 'coda', 'riepilogo_mensile'].includes(w.type) && !editMode && (
                <button type="button" onClick={() => toggleAperto(w)} className={'wbar lg:hidden w-full flex items-center justify-between text-sm ' + (isAperto(w) ? 'justify-end px-1 py-1 text-xs text-gray-500' : 'px-4 py-3 font-medium text-ink bg-surface-card rounded-md border border-gray-800')}>
                  {isAperto(w) ? null : <span>{w.label}</span>}
                  <span className="flex items-center gap-1">{isAperto(w) ? 'Riduci' : ''}<Icon name={isAperto(w) ? 'chevron-up' : 'chevron-down'} size={14} /></span>
                </button>
              )}
              {editMode && (() => {
                const r = w.roles || [], ids = w.user_ids || []
                const nomi = ids.map((id) => { const x = allUsers.find((u) => u.id === id); return x ? (x.display_name || x.username) : null }).filter(Boolean)
                const chi = r.length === 0 && ids.length === 0 ? 'Visibile a tutti' : 'Admin' + (r.filter((x) => x !== 'admin').length ? ' + ruoli: ' + r.filter((x) => x !== 'admin').join(', ') : '') + (nomi.length ? ' + ' + nomi.join(', ') : ' (solo admin)')
                return <div className="absolute top-2 left-2 z-10 text-[10px] bg-gray-800 text-gray-400 rounded px-1.5 py-0.5 max-w-[60%] truncate" title="Chi lo vede (si cambia dalla matita o dalla scheda dell'utente)">{chi}</div>
              })()}
              {editMode && (
                <div className="absolute top-2 right-2 flex gap-1 z-10">
                  <button onClick={() => startEditWidget(w)} className="w-6 h-6 flex items-center justify-center bg-gray-800 hover:bg-gray-700 text-gray-400 rounded text-xs" title="Modifica widget"><Icon name="edit" size={11} /></button>
                  <button onClick={() => moveWidget(w.id, -1)} className="w-6 h-6 flex items-center justify-center bg-gray-800 hover:bg-gray-700 text-gray-400 rounded text-xs">&#8592;</button>
                  <button onClick={() => moveWidget(w.id, 1)} className="w-6 h-6 flex items-center justify-center bg-gray-800 hover:bg-gray-700 text-gray-400 rounded text-xs">&#8594;</button>
                  <button onClick={() => removeWidget(w.id)} className="w-6 h-6 flex items-center justify-center bg-red-900/40 hover:bg-red-900/60 text-red-400 rounded text-xs"><Icon name="x" size={10} /></button>
                </div>
              )}
              {w.type === 'kpi' && (
                <div className="p-5">
                  <div className="text-xs text-gray-500 mb-2 uppercase tracking-wider">{w.label}{w.field ? ' · ' + (AGGREGATION_LABELS[w.aggregation] || 'Somma') : ''}</div>
                  <div className="text-3xl font-bold mb-1" style={{ color: w.color }}>
                    {w.field ? (data.value || 0).toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : (data.count || 0)}
                  </div>
                  <div className="text-xs text-gray-500">{data.count || 0} record totali</div>
                </div>
              )}
              {w.type === 'table' && (
                <div>
                  <div className="px-5 pt-4 pb-2 border-b border-gray-800">
                    <div className="text-sm font-medium text-ink">{w.label}</div>
                  </div>
                  <div className="divide-y divide-gray-800">
                    {(data.records || []).slice(0, 4).map((r) => (
                      <div key={r.id} className="px-5 py-2.5 text-sm text-gray-400 flex items-center justify-between">
                        <span>{Object.values(r.data)[0] || 'Record ' + r.id}</span>
                        <span className="text-xs text-gray-600">{new Date(r.created_at).toLocaleDateString('it-IT')}</span>
                      </div>
                    ))}
                    {(!data.records || data.records.length === 0) && <div className="px-5 py-4 text-sm text-gray-600">Nessun record</div>}
                  </div>
                </div>
              )}
              {w.type === 'riepilogo_mensile' && (() => {
                const { anno, mese } = meseScelto((w.config || {}).giorno_cutoff)
                return <RiepilogoMensile data={data} label={w.label} nomeMese={new Date(anno, mese, 1).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })} />
              })()}
              {w.type === 'coda' && <QueueWidget token={token} onNavigate={onNavigate} modules={modules} />}
              {w.type === 'timbrature_rapide' && <TimbratureWidget token={token} user={user} onNavigate={onNavigate} />}
              {w.type === 'come_sta_andando' && <InsightsCard token={token} widgetId={w.id} title={w.label} onNavigate={features.movimenti ? onNavigate : undefined} />}
              {w.type === 'checklist' && (
                <ChecklistWidget config={w.config} token={token} label={w.label} color={w.color} modules={modules} user={user} onMese={setMeseSel} />
              )}
              {w.type === 'periodo' && (() => {
                const cfg = w.config || {}
                const color = data.allarme && cfg.colore_soglia ? cfg.colore_soglia : w.color
                return (
                  <div className="p-5">
                    <div className="text-xs text-gray-500 mb-2 uppercase tracking-wider">{w.label}{w.field ? ' · ' + (AGGREGATION_LABELS[w.aggregation] || 'Somma') : ''}</div>
                    <div className="text-3xl font-bold mb-1" style={{ color }}>
                      {w.field ? (data.value || 0).toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : (data.count || 0)}
                    </div>
                    <div className="text-xs text-gray-500">{PERIODO_LABELS[cfg.periodo] || 'sempre'} · {data.count || 0} record{data.allarme && <span className="ml-1" style={{ color: cfg.colore_soglia || '#F87171' }}>⚠</span>}</div>
                  </div>
                )
              })()}
              {w.type === 'aggregate_value' && (
                <div className="p-5">
                  <div className="text-xs text-gray-500 mb-2 uppercase tracking-wider">{w.label}</div>
                  <div className="text-3xl font-bold" style={{ color: w.color }}>
                    {data.value === undefined ? '…' : data.format === 'currency'
                      ? (data.value || 0).toLocaleString('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
                      : data.format === 'percent' ? (data.value || 0).toFixed(1) + '%'
                      : (data.value || 0).toLocaleString('it-IT', { maximumFractionDigits: 2 })}
                  </div>
                </div>
              )}
              {w.type === 'yearly_breakdown' && (() => {
                const config = resolveReportBlock(w.config, 'yearly_breakdown')
                return config ? <YearlyBreakdownView config={config} defaultModuleSlug={w.config.source_module} token={token} />
                  : <div className="p-5 text-sm text-red-400">Blocco non trovato — modulo o chiave cambiati.</div>
              })()}
              {w.type === 'category_pivot' && (() => {
                const config = resolveReportBlock(w.config, 'category_pivot')
                return config ? <CategoryPivotView config={config} defaultModuleSlug={w.config.source_module} token={token} />
                  : <div className="p-5 text-sm text-red-400">Blocco non trovato — modulo o chiave cambiati.</div>
              })()}
              {w.type === 'weekly_breakdown' && (() => {
                const config = resolveReportBlock(w.config, 'weekly_breakdown')
                return config ? <WeeklyBreakdownView config={config} defaultModuleSlug={w.config.source_module} token={token} />
                  : <div className="p-5 text-sm text-red-400">Blocco non trovato — modulo o chiave cambiati.</div>
              })()}
            </div>
          )
        })}
      </div>

      {showAdd && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className={'bg-surface-card rounded-md p-6 w-full border border-gray-800 max-h-[90vh] overflow-y-auto ' + (['checklist', 'riepilogo_mensile'].includes(newWidget.type) ? 'max-w-2xl' : 'max-w-md')}>
            <h2 className="text-lg font-bold text-ink mb-4">{editingWidgetId ? 'Modifica Widget' : 'Nuovo Widget'}</h2>
            <div className="space-y-3 mb-6">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Tipo</label>
                <select className="w-full bg-surface-page text-ink px-4 py-3 rounded-lg outline-none border border-gray-800 focus:border-accent transition" value={newWidget.type} onChange={(e) => setNewWidget({ ...newWidget, type: e.target.value })}>
                  <optgroup label="Numeri">
                    <option value="kpi">Numero — somma, media o conteggio di un campo</option>
                    <option value="periodo">Numero con soglia — per periodo, con allerta</option>
                    <option value="aggregate_value">Numero da formula — dal Builder</option>
                  </optgroup>
                  <optgroup label="Elenchi">
                    <option value="table">Tabella — ultime righe di un modulo</option>
                    <option value="checklist">Checklist — righe da spuntare, da più moduli</option>
                    <option value="coda">Coda — righe nello stato «nuovo» dei moduli</option>
                    <option value="timbrature_rapide">Timbrature rapide — entrata/uscita e il totale di oggi</option>
                  </optgroup>
                  <optgroup label="Andamenti">
                    <option value="yearly_breakdown">Mesi dell'anno — 12 mesi, con l'anno prima</option>
                    <option value="category_pivot">Per categoria — anno su anno</option>
                    <option value="weekly_breakdown">Per settimana — con soglia</option>
                  </optgroup>
                  {showFinanza && (
                    <optgroup label="Finanza (per moduli di spese ed entrate)">
                      <option value="riepilogo_mensile">Riepilogo mensile — entrate, uscite, fisso/variabile, spendibile</option>
                      {features.analisi && <option value="come_sta_andando">Come sta andando — mese e da inizio anno</option>}
                    </optgroup>
                  )}
                </select>
                {TYPE_HELP[newWidget.type] && <div className="text-xs text-gray-500 mt-1.5">{TYPE_HELP[newWidget.type]}</div>}
              </div>
              <div className="rounded-lg border border-gray-800 p-3">
                <label className="text-xs text-gray-400 block mb-2">Chi lo vede</label>
                {(() => {
                  const r = newWidget.roles || [], ids = newWidget.user_ids || []
                  const tutti = r.length === 0 && ids.length === 0
                  const soloAdmin = !tutti && ids.length === 0 && r.every((x) => x === 'admin')
                  const chip = (on) => 'px-3 py-1.5 rounded-lg text-xs border transition ' + (on ? 'bg-accent/20 border-accent/50 text-accent' : 'bg-gray-800/50 border-gray-700 text-gray-500 hover:text-gray-300')
                  const others = allUsers.filter((u) => u.role !== 'admin')
                  const nomi = others.filter((u) => ids.includes(u.id)).map((u) => u.display_name || u.username)
                  return (
                    <>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" className={chip(tutti)} onClick={() => setNewWidget({ ...newWidget, roles: [], user_ids: [] })}>Tutti</button>
                        <button type="button" className={chip(soloAdmin)} onClick={() => setNewWidget({ ...newWidget, roles: ['admin'], user_ids: [] })}>Solo admin</button>
                        {others.map((u) => {
                          const on = ids.includes(u.id)
                          return <button key={u.id} type="button" className={chip(on)} onClick={() => setNewWidget({ ...newWidget, roles: ['admin'], user_ids: on ? ids.filter((x) => x !== u.id) : [...ids, u.id] })}>{u.display_name || u.username}</button>
                        })}
                      </div>
                      <div className="text-[11px] text-gray-500 mt-2">
                        {tutti ? 'Lo vedono tutti.' : 'Lo vedono: tu (admin)' + (nomi.length ? ', ' + nomi.join(', ') : '') + (r.filter((x) => x !== 'admin').length ? ' e chi ha il ruolo ' + r.filter((x) => x !== 'admin').join(', ') : '') + '.'}
                        {' '}Tu, admin, vedi sempre tutto.
                      </div>
                      {allRoles.filter((x) => x.name !== 'admin').length > 0 && (
                        <details className="mt-2">
                          <summary className="text-[11px] text-gray-600 cursor-pointer">Per ruolo (avanzato)</summary>
                          <div className="flex flex-wrap gap-2 mt-2">
                            {allRoles.filter((x) => x.name !== 'admin').map((x) => {
                              const on = r.includes(x.name)
                              return <button key={x.name} type="button" className={chip(on)} onClick={() => setNewWidget({ ...newWidget, roles: on ? r.filter((y) => y !== x.name) : [...(r.length ? r : ['admin']), x.name] })}>{x.label}</button>
                            })}
                          </div>
                        </details>
                      )}
                    </>
                  )
                })()}
              </div>
              {!['checklist', 'riepilogo_mensile', 'come_sta_andando', 'coda', 'timbrature_rapide', ...REPORT_WIDGET_TYPES].includes(newWidget.type) && (
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Modulo</label>
                  <select className="w-full bg-surface-page text-ink px-4 py-3 rounded-lg outline-none border border-gray-800 focus:border-accent transition" value={newWidget.module_slug} onChange={(e) => setNewWidget({ ...newWidget, module_slug: e.target.value, field: '' })}>
                    <option value="">Seleziona modulo...</option>
                    {modules.filter((m) => !['dashboard'].includes(m.slug)).map((m) => <option key={m.slug} value={m.slug}>{m.name}</option>)}
                  </select>
                </div>
              )}
              {newWidget.type === 'come_sta_andando' && (
                <label className="flex items-start gap-2.5 cursor-pointer text-sm text-gray-300">
                  <input type="checkbox" className="mt-1" checked={newWidget.explainable !== false} onChange={(e) => setNewWidget({ ...newWidget, explainable: e.target.checked })} />
                  <span>Spiegabile con l'AI<span className="block text-xs text-gray-500">Con l'AI accesa (Impostazioni → AI) compare «Spiega con l'AI» sul widget. Legge solo i totali mostrati, mai le righe.</span></span>
                </label>
              )}
              {newWidget.type === 'come_sta_andando' && (
                <label className="flex items-start gap-2.5 cursor-pointer text-sm text-gray-300">
                  <input type="checkbox" className="mt-1" checked={!!newWidget.monitor} onChange={(e) => setNewWidget({ ...newWidget, monitor: e.target.checked })} />
                  <span>Invia ogni mese su WhatsApp<span className="block text-xs text-gray-500">Il giorno 2 alle 9 arriva «come sta andando» dell'ultimo mese: numeri, cose da guardare e, con l'AI accesa, il commento. Va ai destinatari con il tag «report».</span></span>
                </label>
              )}
              {newWidget.type === 'come_sta_andando' && (
                <div className="space-y-3 rounded-lg border border-gray-800 p-3">
                  <div className="text-xs text-gray-500">Cosa conta in questo widget. Lascia vuoto per la vista generale (i moduli dichiarati nei riepiloghi).</div>
                  <div>
                    <div className="text-xs text-gray-400 mb-1">Moduli di spese</div>
                    {spesaModules.length === 0 && <div className="text-xs text-gray-600">Nessun modulo dichiarato come spesa (Builder → Ruoli del modulo).</div>}
                    {spesaModules.map((m) => (
                      <label key={m.module_slug} className="flex items-center gap-2 py-0.5 text-sm text-gray-300 cursor-pointer">
                        <input type="checkbox" checked={(newWidget.spese_modules || []).includes(m.module_slug)}
                          onChange={(e) => setNewWidget({ ...newWidget, spese_modules: e.target.checked ? [...(newWidget.spese_modules || []), m.module_slug] : (newWidget.spese_modules || []).filter((x) => x !== m.module_slug) })} />{m.name}
                      </label>
                    ))}
                  </div>
                  <label className="flex items-start gap-2 text-sm text-gray-300 cursor-pointer"><input type="checkbox" className="mt-1" checked={!!newWidget.solo_spese} onChange={(e) => setNewWidget({ ...newWidget, solo_spese: e.target.checked })} /><span>Solo spese<span className="block text-xs text-gray-500">Niente entrate, saldo e risparmio: mostra quanto si spende, cosa è già pagato e cosa resta da pagare (per la casa).</span></span></label>
                  {!newWidget.solo_spese && <>
                  <div>
                    <div className="text-xs text-gray-400 mb-1">Solo le entrate di questi gruppi (separati da virgola)</div>
                    <input className="w-full bg-surface-page text-ink px-3 py-2 rounded-lg outline-none border border-gray-800 focus:border-accent text-sm" placeholder="es. Casa" value={newWidget.entrate_include || ''} onChange={(e) => setNewWidget({ ...newWidget, entrate_include: e.target.value })} />
                  </div>
                  <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer"><input type="checkbox" checked={newWidget.accantonamento !== false} onChange={(e) => setNewWidget({ ...newWidget, accantonamento: e.target.checked })} />Conta l'accantonamento (stipendio trattenuto in busta)</label>
                  </>}
                </div>
              )}
              {newWidget.type === 'checklist' && (
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-gray-400 block mb-1.5">Moduli sorgente</label>
                    <div className="space-y-2">
                      {checklistConfig.sources.map((src, idx) => {
                        const fields = fieldsOf(src.module_slug)
                        return (
                          <div key={idx} className="bg-surface-page border border-gray-800 rounded-lg p-3 space-y-2">
                            <div className="flex items-center gap-2">
                              <select className="flex-1 bg-surface-card text-ink px-3 py-2 rounded-md text-sm outline-none border border-gray-700 focus:border-accent transition"
                                value={src.module_slug} onChange={(e) => updateChecklistSource(idx, { module_slug: e.target.value, amount_field: '', status_field: '', date_field: '' })}>
                                <option value="">Seleziona modulo...</option>
                                {modules.filter((m) => !['dashboard'].includes(m.slug)).map((m) => <option key={m.slug} value={m.slug}>{m.name}</option>)}
                              </select>
                              <button onClick={() => removeChecklistSource(idx)} className="text-red-400/60 hover:text-red-400 transition flex-shrink-0"><Icon name="trash" size={13} /></button>
                            </div>
                            {src.module_slug && (
                              <div className="grid grid-cols-3 gap-2">
                                <select className="bg-surface-card text-ink px-2 py-1.5 rounded-md text-xs outline-none border border-gray-700 focus:border-accent transition"
                                  value={src.amount_field} onChange={(e) => updateChecklistSource(idx, { amount_field: e.target.value })}>
                                  <option value="">Campo importo...</option>
                                  {fields.filter((f) => ['number', 'currency'].includes(f.type)).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                                </select>
                                <select className="bg-surface-card text-ink px-2 py-1.5 rounded-md text-xs outline-none border border-gray-700 focus:border-accent transition"
                                  value={src.status_field} onChange={(e) => updateChecklistSource(idx, { status_field: e.target.value })}>
                                  <option value="">Campo stato...</option>
                                  <option value="_stato">_stato (workflow: transizione tra 2 stati)</option>
                                  {fields.filter((f) => f.type === 'checkbox' || f.type === 'boolean').map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                                </select>
                                <select className="bg-surface-card text-ink px-2 py-1.5 rounded-md text-xs outline-none border border-gray-700 focus:border-accent transition"
                                  value={src.date_field} onChange={(e) => updateChecklistSource(idx, { date_field: e.target.value })}>
                                  <option value="">Campo data...</option>
                                  {fields.filter((f) => ['date', 'datetime'].includes(f.type)).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                                </select>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                    <button onClick={addChecklistSource} className="mt-2 w-full py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-medium transition">+ Aggiungi modulo</button>
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Periodo</label>
                    <select className="w-full bg-surface-page text-ink px-4 py-3 rounded-lg outline-none border border-gray-800 focus:border-accent transition"
                      value={checklistConfig.period} onChange={(e) => setChecklistConfig((c) => ({ ...c, period: e.target.value }))}>
                      <option value="questo_mese">Questo mese</option>
                      <option value="personalizzato">Intervallo personalizzato</option>
                      <option value="tutti">Tutti i record (nessun filtro)</option>
                    </select>
                  </div>
                  {checklistConfig.period === 'questo_mese' && (
                    <div>
                      <label className="text-xs text-gray-400 block mb-1">Passa al mese prossimo dal giorno (opzionale)</label>
                      <input type="number" min="1" max="28" className="w-24 bg-surface-page text-ink px-3 py-2.5 rounded-lg outline-none border border-gray-800 focus:border-accent transition"
                        value={checklistConfig.giorno_cutoff || 1}
                        onChange={(e) => setChecklistConfig((c) => ({ ...c, giorno_cutoff: Math.min(28, Math.max(1, parseInt(e.target.value, 10) || 1)) }))} />
                      <p className="text-[11px] text-gray-600 mt-1">Es. 20 → dal 20 del mese in poi mostra già per intero il mese prossimo (comprese le spese datate a fine mese, es. il 27-28), invece di aspettare il 1°. Stesso meccanismo del "giorno di cutoff" del widget Riepilogo mensile. Lascia 1 per il mese di calendario normale (nessun anticipo).</p>
                    </div>
                  )}
                  {checklistConfig.period === 'personalizzato' && (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-gray-400 block mb-1">Dal</label>
                        <input type="date" className="w-full bg-surface-page text-ink px-3 py-2.5 rounded-lg outline-none border border-gray-800 focus:border-accent transition"
                          value={checklistConfig.from} onChange={(e) => setChecklistConfig((c) => ({ ...c, from: e.target.value }))} />
                      </div>
                      <div>
                        <label className="text-xs text-gray-400 block mb-1">Al</label>
                        <input type="date" className="w-full bg-surface-page text-ink px-3 py-2.5 rounded-lg outline-none border border-gray-800 focus:border-accent transition"
                          value={checklistConfig.to} onChange={(e) => setChecklistConfig((c) => ({ ...c, to: e.target.value }))} />
                      </div>
                    </div>
                  )}
                  <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                    <input type="checkbox" checked={checklistConfig.apri_dettaglio} onChange={(e) => setChecklistConfig((c) => ({ ...c, apri_dettaglio: e.target.checked }))} />
                    Click sulla riga apre il dettaglio (modifica + allega prova di pagamento)
                  </label>
                  <p className="text-[11px] text-gray-600 leading-relaxed">Ogni modulo selezionato deve avere un campo Numero/Valuta (l'importo), un campo Casella di spunta (lo stato pagato/non pagato) e un campo Data — solo così può entrare nella checklist unificata.</p>
                </div>
              )}
              {newWidget.type === 'riepilogo_mensile' && (
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Giorno di cutoff mese di competenza (default 27)</label>
                    <input type="number" min="1" max="28" className="w-full bg-surface-page text-ink px-3 py-2 rounded-lg text-sm outline-none border border-gray-800"
                      value={riepilogoConfig.giorno_cutoff} onChange={(e) => setRiepilogoConfig((c) => ({ ...c, giorno_cutoff: Math.min(28, Math.max(1, parseInt(e.target.value, 10) || 27)) }))} />
                    <p className="text-[11px] text-gray-600 mt-1">Limitato a 28 così il giorno esiste in qualunque mese, febbraio incluso — stesso limite del widget Checklist.</p>
                  </div>
                  <div className="bg-surface-page border border-gray-800 rounded-lg p-3 space-y-2">
                    <div className="text-xs text-gray-400 font-medium">Entrate</div>
                    <select className="w-full bg-surface-card text-ink px-3 py-2 rounded-md text-sm outline-none border border-gray-700"
                      value={riepilogoConfig.entrate.modulo} onChange={(e) => setRiepilogoConfig((c) => ({ ...c, entrate: { modulo: e.target.value, campo_importo: '', campo_data: '' } }))}>
                      <option value="">Modulo entrate...</option>
                      {modules.filter((m) => !['dashboard'].includes(m.slug)).map((m) => <option key={m.slug} value={m.slug}>{m.name}</option>)}
                    </select>
                    {riepilogoConfig.entrate.modulo && (
                      <div className="grid grid-cols-2 gap-2">
                        <select className="bg-surface-card text-ink px-2 py-1.5 rounded-md text-xs outline-none border border-gray-700"
                          value={riepilogoConfig.entrate.campo_importo} onChange={(e) => setRiepilogoConfig((c) => ({ ...c, entrate: { ...c.entrate, campo_importo: e.target.value } }))}>
                          <option value="">Campo importo...</option>
                          {fieldsOf(riepilogoConfig.entrate.modulo).filter((f) => ['number', 'currency'].includes(f.type)).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                        </select>
                        <select className="bg-surface-card text-ink px-2 py-1.5 rounded-md text-xs outline-none border border-gray-700"
                          value={riepilogoConfig.entrate.campo_data} onChange={(e) => setRiepilogoConfig((c) => ({ ...c, entrate: { ...c.entrate, campo_data: e.target.value } }))}>
                          <option value="">Campo data...</option>
                          {fieldsOf(riepilogoConfig.entrate.modulo).filter((f) => ['date', 'datetime'].includes(f.type)).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                        </select>
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1.5">Gruppi di spesa (es. Casa, Personale)</label>
                    <div className="space-y-2">
                      {riepilogoConfig.gruppi.map((g, idx) => {
                        const fields = fieldsOf(g.modulo)
                        return (
                          <div key={idx} className="bg-surface-page border border-gray-800 rounded-lg p-3 space-y-2">
                            <div className="flex items-center gap-2">
                              <input className="w-28 bg-surface-card text-ink px-2 py-1.5 rounded-md text-xs outline-none border border-gray-700 placeholder-gray-600" placeholder="Etichetta (es. Casa)"
                                value={g.label} onChange={(e) => updateRiepilogoGruppo(idx, { label: e.target.value })} />
                              <select className="flex-1 bg-surface-card text-ink px-3 py-2 rounded-md text-sm outline-none border border-gray-700"
                                value={g.modulo} onChange={(e) => updateRiepilogoGruppo(idx, { modulo: e.target.value, campo_importo: '', campo_data: '', campo_stato: '', campo_fisso: '', campo_conto: '' })}>
                                <option value="">Modulo...</option>
                                {modules.filter((m) => !['dashboard'].includes(m.slug)).map((m) => <option key={m.slug} value={m.slug}>{m.name}</option>)}
                              </select>
                              <button onClick={() => removeRiepilogoGruppo(idx)} className="text-red-400/60 hover:text-red-400 transition flex-shrink-0"><Icon name="trash" size={13} /></button>
                            </div>
                            {g.modulo && (
                              <>
                                <div className="grid grid-cols-2 gap-2">
                                  <select className="bg-surface-card text-ink px-2 py-1.5 rounded-md text-xs outline-none border border-gray-700"
                                    value={g.campo_importo} onChange={(e) => updateRiepilogoGruppo(idx, { campo_importo: e.target.value })}>
                                    <option value="">Campo importo...</option>
                                    {fields.filter((f) => ['number', 'currency'].includes(f.type)).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                                  </select>
                                  <select className="bg-surface-card text-ink px-2 py-1.5 rounded-md text-xs outline-none border border-gray-700"
                                    value={g.campo_data} onChange={(e) => updateRiepilogoGruppo(idx, { campo_data: e.target.value })}>
                                    <option value="">Campo data...</option>
                                    {fields.filter((f) => ['date', 'datetime'].includes(f.type)).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                                  </select>
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                  <select className="bg-surface-card text-ink px-2 py-1.5 rounded-md text-xs outline-none border border-gray-700"
                                    value={g.campo_stato} onChange={(e) => updateRiepilogoGruppo(idx, { campo_stato: e.target.value })}>
                                    <option value="">Campo stato (workflow)...</option>
                                    <option value="_stato">_stato</option>
                                  </select>
                                  <input className="bg-surface-card text-ink px-2 py-1.5 rounded-md text-xs outline-none border border-gray-700 placeholder-gray-600" placeholder="valore 'pagato' (es. pagato)"
                                    value={g.valore_pagato} onChange={(e) => updateRiepilogoGruppo(idx, { valore_pagato: e.target.value })} />
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                  <select className="bg-surface-card text-ink px-2 py-1.5 rounded-md text-xs outline-none border border-gray-700"
                                    value={g.campo_fisso} onChange={(e) => updateRiepilogoGruppo(idx, { campo_fisso: e.target.value })}>
                                    <option value="">Campo "fisso" (opzionale)...</option>
                                    {fields.filter((f) => f.type === 'checkbox' || f.type === 'boolean').map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                                  </select>
                                  <select className="bg-surface-card text-ink px-2 py-1.5 rounded-md text-xs outline-none border border-gray-700"
                                    value={g.campo_conto} onChange={(e) => updateRiepilogoGruppo(idx, { campo_conto: e.target.value })}>
                                    <option value="">Relazione conto (opzionale)...</option>
                                    {(fieldsOf(g.modulo).length ? modules.find((m) => m.slug === g.modulo) : null) && (parseSchemaFrontend(modules.find((m) => m.slug === g.modulo).schema_json).relations || []).map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                                  </select>
                                </div>
                              </>
                            )}
                          </div>
                        )
                      })}
                    </div>
                    <button onClick={addRiepilogoGruppo} className="mt-2 w-full py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-medium transition">+ Aggiungi gruppo</button>
                  </div>
                  <div className="bg-surface-page border border-gray-800 rounded-lg p-3 space-y-2">
                    <div className="text-xs text-gray-400 font-medium">Conti (per "Previsto Carta"/"Previsto Conto")</div>
                    <select className="w-full bg-surface-card text-ink px-3 py-2 rounded-md text-sm outline-none border border-gray-700"
                      value={riepilogoConfig.conti.modulo} onChange={(e) => setRiepilogoConfig((c) => ({ ...c, conti: { modulo: e.target.value, campo_tipo: '', valore_carta: '', valore_conto: '' } }))}>
                      <option value="">Modulo conti (opzionale)...</option>
                      {modules.filter((m) => !['dashboard'].includes(m.slug)).map((m) => <option key={m.slug} value={m.slug}>{m.name}</option>)}
                    </select>
                    {riepilogoConfig.conti.modulo && (
                      <div className="grid grid-cols-2 gap-2">
                        <select className="bg-surface-card text-ink px-2 py-1.5 rounded-md text-xs outline-none border border-gray-700"
                          value={riepilogoConfig.conti.campo_tipo} onChange={(e) => setRiepilogoConfig((c) => ({ ...c, conti: { ...c.conti, campo_tipo: e.target.value } }))}>
                          <option value="">Campo tipo conto...</option>
                          {fieldsOf(riepilogoConfig.conti.modulo).filter((f) => f.type === 'select').map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                        </select>
                        <input className="bg-surface-card text-ink px-2 py-1.5 rounded-md text-xs outline-none border border-gray-700 placeholder-gray-600" placeholder="valore 'carta' (es. Prepagata)"
                          value={riepilogoConfig.conti.valore_carta} onChange={(e) => setRiepilogoConfig((c) => ({ ...c, conti: { ...c.conti, valore_carta: e.target.value } }))} />
                        <input className="bg-surface-card text-ink px-2 py-1.5 rounded-md text-xs outline-none border border-gray-700 placeholder-gray-600 col-span-2" placeholder="valore 'conto personale' per Previsto Conto (es. Corrente)"
                          value={riepilogoConfig.conti.valore_conto} onChange={(e) => setRiepilogoConfig((c) => ({ ...c, conti: { ...c.conti, valore_conto: e.target.value } }))} />
                      </div>
                    )}
                  </div>
                </div>
              )}
              {REPORT_WIDGET_TYPES.includes(newWidget.type) && (
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Modulo sorgente</label>
                    <select className="w-full bg-surface-page text-ink px-4 py-3 rounded-lg outline-none border border-gray-800 focus:border-accent transition"
                      value={reportBlockConfig.source_module} onChange={(e) => setReportBlockConfig({ source_module: e.target.value, block_key: '' })}>
                      <option value="">Seleziona modulo...</option>
                      {modules.filter((m) => !['dashboard'].includes(m.slug)).map((m) => <option key={m.slug} value={m.slug}>{m.name}</option>)}
                    </select>
                  </div>
                  {reportBlockConfig.source_module && (() => {
                    const blocks = reportBlocksOf(reportBlockConfig.source_module, newWidget.type)
                    return blocks.length === 0 ? (
                      <div className="text-xs text-gray-600">Nessun blocco di questo tipo su questo modulo — creane uno prima dal Builder.</div>
                    ) : (
                      <div>
                        <label className="text-xs text-gray-400 block mb-1">Blocco</label>
                        <select className="w-full bg-surface-page text-ink px-4 py-3 rounded-lg outline-none border border-gray-800 focus:border-accent transition"
                          value={reportBlockConfig.block_key} onChange={(e) => setReportBlockConfig((c) => ({ ...c, block_key: e.target.value }))}>
                          <option value="">Seleziona...</option>
                          {blocks.map((b) => <option key={b.key} value={b.key}>{b.label || b.key}</option>)}
                        </select>
                      </div>
                    )
                  })()}
                </div>
              )}
              {(newWidget.type === 'kpi' || newWidget.type === 'periodo') && selectedFields.filter((f) => ['number', 'currency', 'computed'].includes(f.type)).length > 0 && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Campo (opzionale)</label>
                    <select className="w-full bg-surface-page text-ink px-4 py-3 rounded-lg outline-none border border-gray-800 focus:border-accent transition" value={newWidget.field} onChange={(e) => setNewWidget({ ...newWidget, field: e.target.value })}>
                      <option value="">Conta record</option>
                      {selectedFields.filter((f) => ['number', 'currency', 'computed'].includes(f.type)).map((f) => <option key={f.key} value={f.key}>{f.label}{f.type === 'computed' ? ' (calcolato)' : ''}</option>)}
                    </select>
                  </div>
                  {newWidget.field && (
                    <div>
                      <label className="text-xs text-gray-400 block mb-1">Aggregazione</label>
                      <select className="w-full bg-surface-page text-ink px-4 py-3 rounded-lg outline-none border border-gray-800 focus:border-accent transition" value={newWidget.aggregation} onChange={(e) => setNewWidget({ ...newWidget, aggregation: e.target.value })}>
                        {Object.entries(AGGREGATION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </div>
                  )}
                </div>
              )}
              {newWidget.type === 'periodo' && (
                <div className="space-y-3 bg-surface-page rounded-lg p-3 border border-gray-800">
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Campo data (per filtrare sul periodo)</label>
                    <select className="w-full bg-surface-card text-ink px-3 py-2 rounded-lg text-sm outline-none border border-gray-700" value={periodoConfig.date_field} onChange={(e) => setPeriodoConfig((c) => ({ ...c, date_field: e.target.value }))}>
                      <option value="">Nessuno (tutti i record)</option>
                      {selectedFields.filter((f) => ['date', 'datetime'].includes(f.type)).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Periodo</label>
                    <select className="w-full bg-surface-card text-ink px-3 py-2 rounded-lg text-sm outline-none border border-gray-700" value={periodoConfig.periodo} onChange={(e) => setPeriodoConfig((c) => ({ ...c, periodo: e.target.value }))}>
                      <option value="oggi">Oggi</option>
                      <option value="settimana">Questa settimana</option>
                      <option value="mese">Questo mese</option>
                      <option value="anno">Quest'anno</option>
                      <option value="tutti">Sempre</option>
                    </select>
                  </div>
                  <div className="pt-2 border-t border-gray-800">
                    <div className="text-[11px] text-gray-500 mb-1.5">Soglia di allerta (opzionale) — colora il numero se superata</div>
                    <div className="flex items-center gap-2">
                      <select className="bg-surface-card text-ink px-2 py-2 rounded-lg text-sm outline-none border border-gray-700 w-16" value={periodoConfig.soglia_operatore} onChange={(e) => setPeriodoConfig((c) => ({ ...c, soglia_operatore: e.target.value }))}>
                        <option value=">">&gt;</option><option value="<">&lt;</option>
                        <option value=">=">&ge;</option><option value="<=">&le;</option>
                      </select>
                      <input type="number" placeholder="valore" className="flex-1 bg-surface-card text-ink px-3 py-2 rounded-lg text-sm outline-none border border-gray-700 placeholder-gray-600"
                        value={periodoConfig.soglia} onChange={(e) => setPeriodoConfig((c) => ({ ...c, soglia: e.target.value }))} />
                      <input type="color" className="h-9 w-10 rounded-lg border border-gray-700 bg-surface-card cursor-pointer flex-shrink-0"
                        value={periodoConfig.colore_soglia} onChange={(e) => setPeriodoConfig((c) => ({ ...c, colore_soglia: e.target.value }))} />
                    </div>
                  </div>
                </div>
              )}
              <div>
                <label className="text-xs text-gray-400 block mb-1">Etichetta</label>
                <input className="w-full bg-surface-page text-ink px-4 py-3 rounded-lg outline-none border border-gray-800 focus:border-accent transition placeholder-gray-600" placeholder="Nome del widget" value={newWidget.label} onChange={(e) => setNewWidget({ ...newWidget, label: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Colore</label>
                <input type="color" value={newWidget.color} onChange={(e) => setNewWidget({ ...newWidget, color: e.target.value })} className="h-10 w-full rounded-lg border border-gray-800 bg-surface-page cursor-pointer" />
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={resetWidgetForm} className="flex-1 bg-gray-800 hover:bg-gray-700 text-white py-3 rounded-lg transition">Annulla</button>
              <button onClick={saveWidget} disabled={
                newWidget.type === 'checklist' ? checklistConfig.sources.filter((s) => s.module_slug && s.amount_field && s.status_field).length === 0
                : newWidget.type === 'riepilogo_mensile' ? !(riepilogoConfig.entrate.modulo && riepilogoConfig.gruppi.some((g) => g.modulo && g.campo_importo))
                : REPORT_WIDGET_TYPES.includes(newWidget.type) ? !(reportBlockConfig.source_module && reportBlockConfig.block_key)
                : newWidget.type === 'come_sta_andando' || newWidget.type === 'coda' || newWidget.type === 'timbrature_rapide' ? false
                : !newWidget.module_slug
              } className="flex-1 bg-accent hover:opacity-90 disabled:opacity-50 text-white py-3 rounded-lg transition font-medium">{editingWidgetId ? 'Salva modifiche' : 'Aggiungi'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default DashboardPage
