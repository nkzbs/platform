import React, { useState, useEffect } from 'react'
import { API } from '../lib/api'
import Icon from '../components/Icon'
import Select from '../components/Select'
import Tile from '../components/Tile'
import StatusDot from '../components/StatusDot'
import StatusBadge from '../components/StatusBadge'
import TenantCreatingOverlay from '../components/TenantCreatingOverlay'
import RegisterExistingModal from '../components/RegisterExistingModal'

// F7 (PLATFORM-MASTER-ROADMAP.md) — Provisioning Engine: se un tenant resta
// bloccato in status 'creating' (es. il processo Super Admin è stato riavviato
// a metà di una creazione, mai un retry automatico, vedi tenants.js) o finisce
// in 'error', provisioning_step dice ESATTAMENTE a quale fase si è fermato,
// senza dover cercare nei log del server.
const PROVISIONING_STEP_LABEL = {
  creating_container: 'Creazione del container',
  seeding_database: 'Inizializzazione del database e dei moduli',
  configuring_domain: 'Configurazione del dominio',
  active: 'Completato',
}

// Stessa mappa italiana già usata nel filtro "Tutti gli stati" più sotto — riusata anche
// per l'etichetta sulla card (2026-09-03).
const TENANT_STATUS_LABEL = { active: 'Attivo', stopped: 'Fermo', creating: 'In creazione', error: 'Errore' }

// PLATFORM-UI-REDESIGN-CATALOG.md #18-27 — le tab del pannello espanso, una per
// sezione esistente (nessuna sezione unita/spostata rispetto a prima, solo
// mostrata una alla volta invece che tutte impilate). Bento (2026-08-29,
// "bento ovunque" per le pagine di stato/impostazioni) — stesso pattern di
// SettingsPage.jsx e di ImpostazioniPage.jsx sui tenant: tile di riepilogo,
// un pannello alla volta sotto. Valori/sub statici o dal solo oggetto tenant
// (già disponibile subito), mai dai dati lazy-caricati all'apertura di ogni
// singola tab (stats/sessioni/ecc.) per evitare un flash "undefined" prima
// che la tab venga aperta la prima volta.
const DETAIL_TABS = [
  { id: 'panoramica', label: 'Panoramica', icon: 'activity', sub: 'Consumi live' },
  { id: 'moduli', label: 'Moduli', icon: 'box', value: 'Moduli installati', sub: 'Ordine e configurazione' },
  { id: 'credenziali', label: 'Credenziali', icon: 'key', value: 'Accesso amministratore', sub: 'Vedi credenziali' },
  { id: 'backup', label: 'Backup', icon: 'shield', value: 'Copie di sicurezza', sub: 'Locale e offsite' },
  { id: 'sessioni', label: 'Accessi', icon: 'clock', value: 'Storico accessi', sub: 'Chi ha aperto questo tenant' },
]

function TenantsPage({ token, onViewActivity, onNavigate }) {
  const [tenants, setTenants] = useState([])
  const [cfStatus, setCfStatus] = useState(null)
  const [showNew, setShowNew] = useState(false)
  const [showRegister, setShowRegister] = useState(false)
  // Se alla creazione Cloudflare non crea il sottodominio il tenant esiste ma da fuori non si apre:
  // lo si dice subito, con la possibilità di riprovare.
  const [dnsWarning, setDnsWarning] = useState(null) // { slug, name, domain, error }
  const [dnsRetrying, setDnsRetrying] = useState(false)
  const [form, setForm] = useState({ name: '', slug: '', domain: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [expandedSlug, setExpandedSlug] = useState(null)
  // PLATFORM-UI-REDESIGN-CATALOG.md #18-27 — il pannello espanso era un'unica
  // colonna che scorreva all'infinito (Consumi/Moduli/Credenziali/Backup/
  // Fatturazione/Verticale/Accessi impilati) — diventa a tab, come per Partner
  // (#2). Tocca SOLO come le sezioni ESISTENTI sono mostrate: nessuna sezione
  // riscritta, nessuna capacità nuova aggiunta (le due capacità davvero nuove
  // segnalate nel catalogo — utenti-tenant-da-remoto, policy di sicurezza — NON
  // sono qui, restano da confermare prima di costruirle). Per tenant (slug),
  // così aprirne più di uno non mischia la tab attiva dell'uno con l'altro.
  const [detailTabBySlug, setDetailTabBySlug] = useState({})
  const [statsBySlug, setStatsBySlug] = useState({})
  const [statsError, setStatsError] = useState('')
  const [editingDomainSlug, setEditingDomainSlug] = useState(null)
  // Credenziali del TENANT prima di "Apri →" (2026-08-30, sostituisce lo
  // step-up sulla propria password) — pendingOpenTenant resta il tenant in
  // attesa mentre l'utente inserisce username+password admin DI QUEL TENANT;
  // mai persistite, consumate subito dopo un /open-session riuscito.
  const [pendingOpenTenant, setPendingOpenTenant] = useState(null)
  const [reauthUsername, setReauthUsername] = useState('')
  const [reauthPassword, setReauthPassword] = useState('')
  const [reauthError, setReauthError] = useState('')
  const [reauthBusy, setReauthBusy] = useState(false)
  const [reauthReadyUrl, setReauthReadyUrl] = useState(null)
  const [domainDraft, setDomainDraft] = useState('')
  const [backupsBySlug, setBackupsBySlug] = useState({})
  // G18 (PLATFORM-0.6-GAP-ANALYSIS.md) — un solo URL decide la destinazione
  // off-site (mai un toggle separato che potrebbe disallinearsi), più credenziali
  // opzionali in JSON per quando servirà uno schema che le richiede (oggi 'file://'
  // non ne ha bisogno). offsiteDraft è per-tenant (chiave slug) così aprire più
  // pannelli non mischia i campi in modifica di tenant diversi.
  const [offsiteSettingsBySlug, setOffsiteSettingsBySlug] = useState({})
  const [offsiteDraft, setOffsiteDraft] = useState({})
  const [savingOffsiteSlug, setSavingOffsiteSlug] = useState(null)
  const [offsiteMsg, setOffsiteMsg] = useState({})
  const [moduleStatsBySlug, setModuleStatsBySlug] = useState({})
  const [sessionsBySlug, setSessionsBySlug] = useState({})
  const [activeSessions, setActiveSessions] = useState({})
  const [revokingSid, setRevokingSid] = useState(null)
  const [backingUpSlug, setBackingUpSlug] = useState(null)
  const [restoringId, setRestoringId] = useState(null)
  const [backupMsg, setBackupMsg] = useState({})
  const [resettingSlug, setResettingSlug] = useState(null)
  // PLATFORM-UI-REDESIGN-CATALOG.md #21 — moduli a licenza per tenant, dentro la tab "Moduli".
  const [registryModules, setRegistryModules] = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [tenantsPage, setTenantsPage] = useState(1)
  const [tenantStatusFilter, setTenantStatusFilter] = useState('')
  // Rivelazione credenziali "una volta sola" — sia dopo la creazione di un
  // tenant, sia dopo un reset manuale. Stessa forma in entrambi i casi, cosi'
  // un solo modale serve a tutti e due i flussi.
  const [credentialsReveal, setCredentialsReveal] = useState(null)

  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }

  const load = async () => {
    const res = await fetch(API + '/tenants', { headers })
    if (res.ok) setTenants(await res.json())
  }

  // "Apri →" con login reale come admin DEL TENANT (2026-08-30) — richiede
  // sempre username+password admin di quel tenant specifico (mai la propria
  // password di Partner/Core, richiesto esplicitamente dall'utente per vera
  // esclusione: se non conosce le credenziali del cliente, non entra). Apre
  // una scheda nuova sul vero frontend del tenant col token in query string,
  // che App.jsx del tenant raccoglie da solo al volo.
  const openTenant = (t) => {
    setPendingOpenTenant(t)
    setReauthUsername('')
    setReauthPassword('')
    setReauthError('')
    setReauthReadyUrl(null)
  }
  const closeReauthModal = () => { setPendingOpenTenant(null); setReauthUsername(''); setReauthPassword(''); setReauthError(''); setReauthReadyUrl(null) }

  const submitReauth = async () => {
    if (!reauthUsername || !reauthPassword) return
    setReauthBusy(true)
    setReauthError('')
    const t = pendingOpenTenant
    try {
      const res = await fetch(API + '/tenants/' + t.slug + '/open-session', { method: 'POST', headers, body: JSON.stringify({ username: reauthUsername, password: reauthPassword }) })
      const data = await res.json()
      if (!res.ok) { setReauthError(data.error || 'Credenziali non valide'); return }
      const base = t.domain ? ('https://' + t.domain) : (window.location.protocol + '//' + window.location.hostname + ':' + t.port)
      // reauthReadyUrl (2026-09-02, sostituisce il tentativo con window.open):
      // aprire la scheda in automatico (about:blank sincrono + newTab.location.href
      // dopo il fetch) funzionava con un click vero ma inaffidabile nei test ripetuti
      // — Chrome tratta diversamente i click sintetici dagli automation tool, popup
      // silenziosamente mai navigato, nessun errore. Un vero <a href target="_blank">
      // mostrato dopo il login non dipende da nessuna euristica su popup/gesture.
      setReauthReadyUrl(base + '/?token=' + encodeURIComponent(data.token))
    } catch (e) {
      setReauthError('Errore di rete, riprova')
    } finally {
      setReauthBusy(false)
    }
  }

  const loadCfStatus = async () => {
    const res = await fetch(API + '/tenants/cloudflare/status', { headers })
    if (res.ok) setCfStatus(await res.json())
  }

  const loadRegistryModules = async () => {
    const res = await fetch(API + '/registry/modules', { headers })
    if (res.ok) setRegistryModules(await res.json())
  }

  // "Attivo ora" (ultimi 5 minuti) per TUTTI i tenant in una chiamata sola — non
  // nascosto sotto "Dettagli" come lo storico completo, un bollino visibile subito
  // in lista era il punto: prima si scopriva un utente attivo solo aprendo i
  // dettagli di ogni tenant uno per uno.
  const loadActiveSessions = async () => {
    const res = await fetch(API + '/tenants/active-sessions', { headers })
    if (res.ok) setActiveSessions(await res.json())
  }

  useEffect(() => {
    load()
    loadCfStatus()
    loadActiveSessions()
    loadRegistryModules()
    const iv = setInterval(load, 5000)
    const ivActive = setInterval(loadActiveSessions, 15000)
    return () => { clearInterval(iv); clearInterval(ivActive) }
  }, [])

  // Poll live delle statistiche solo per il tenant espanso
  useEffect(() => {
    if (!expandedSlug) return
    setStatsError('')
    const fetchStats = async () => {
      try {
        const res = await fetch(API + '/tenants/' + expandedSlug + '/stats', { headers })
        const data = await res.json()
        if (!res.ok) { setStatsError(data.error || 'Errore nel recupero statistiche'); return }
        setStatsBySlug((p) => ({ ...p, [expandedSlug]: data }))
      } catch (e) {
        setStatsError('Impossibile contattare il Super Admin backend')
      }
    }
    fetchStats()
    const iv = setInterval(fetchStats, 3000)
    return () => clearInterval(iv)
  }, [expandedSlug, token])

  const toggleDetails = (slug) => {
    setExpandedSlug((p) => (p === slug ? null : slug))
    if (expandedSlug !== slug) { loadBackups(slug); loadSessions(slug); loadModuleStats(slug); loadBackupSettings(slug) }
  }

  const formatDuration = (loginAt, lastSeenAt) => {
    const ms = new Date(lastSeenAt).getTime() - new Date(loginAt).getTime()
    const min = Math.max(1, Math.round(ms / 60000))
    if (min < 60) return min + ' min'
    return Math.floor(min / 60) + 'h ' + (min % 60) + 'min'
  }

  const formatUptime = (startedAt) => {
    if (!startedAt) return '—'
    const ms = Date.now() - new Date(startedAt).getTime()
    const h = Math.floor(ms / 3600000)
    const m = Math.floor((ms % 3600000) / 60000)
    if (h < 1) return m + ' min'
    return h + 'h ' + m + 'min'
  }

  const EMPTY_TENANT_FORM = { name: '', slug: '', domain: '' }

  const openNew = () => {
    setForm({ ...EMPTY_TENANT_FORM })
    setError('')
    setShowNew(true)
  }

  const create = async () => {
    if (!form.name || !form.slug) return setError('Nome e slug obbligatori')
    setLoading(true)
    setError('')
    const res = await fetch(API + '/tenants', { method: 'POST', headers, body: JSON.stringify(form) })
    const data = await res.json()
    setLoading(false)
    if (!res.ok) return setError(data.error)
    setShowNew(false)
    setForm(EMPTY_TENANT_FORM)
    if (data.initial_credentials) {
      setCredentialsReveal({ slug: data.slug, name: data.name, username: data.initial_credentials.username, password: data.initial_credentials.password })
    }
    if (data.cloudflare && data.cloudflare.error) {
      setDnsWarning({ slug: data.slug, name: data.name, domain: data.domain, error: data.cloudflare.error })
    }
    load()
  }

  const retryDns = async () => {
    setDnsRetrying(true)
    try {
      const res = await fetch(API + '/tenants/' + dnsWarning.slug + '/domain', { method: 'PATCH', headers, body: JSON.stringify({ domain: dnsWarning.domain }) })
      const data = await res.json()
      if (res.ok && data.cloudflare && !data.cloudflare.error) setDnsWarning(null)
      else setDnsWarning({ ...dnsWarning, error: (data.cloudflare && data.cloudflare.error) || data.error || 'Errore sconosciuto' })
    } finally {
      setDnsRetrying(false)
    }
  }

  // Start/Stop del tenant, con errore visibile. Start funziona anche se il container
  // non esiste ancora: lo ricrea sullo stesso volume dati, con le chiavi salvate (un
  // tenant registrato da "Registra esistente" nasce fermo e parte da qui).
  const [actionSlug, setActionSlug] = useState(null)
  const tenantAction = async (t, action) => {
    setActionSlug(t.slug)
    setError('')
    try {
      const res = await fetch(API + '/tenants/' + t.slug + '/' + action, { method: 'POST', headers, body: '{}' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) setError((action === 'start' ? 'Avvio' : 'Arresto') + ' di "' + t.name + '" fallito: ' + (data.error || res.status))
    } catch (e) {
      setError('Errore di rete: ' + e.message)
    } finally {
      setActionSlug(null)
      load()
    }
  }

  // Aggiorna: ricrea il container del tenant con l'ultima immagine, sullo stesso volume dati (i dati non si toccano).
  // Il popup mostra i passi veri man mano che il server li esegue (stream di righe JSON) e chiude con AGGIORNATO / NON AGGIORNATO.
  const [upd, setUpd] = useState(null) // { t, lines: [{at,msg}], state: 'running'|'ok'|'ko'|'busy', note }
  const runUpdate = async (t, force) => {
    setUpd({ t, lines: [], state: 'running', note: '' })
    const add = (msg, at) => setUpd((u) => u && { ...u, lines: [...u.lines, { at: at || new Date().toISOString(), msg }] })
    try {
      const res = await fetch(API + '/tenants/' + t.slug + '/redeploy?stream=1', { method: 'POST', headers, body: JSON.stringify({ force: !!force }) })
      if (!res.ok || !res.body) { const d = await res.json().catch(() => ({})); add('Errore: ' + (d.error || res.status)); setUpd((u) => u && { ...u, state: 'ko' }); return }
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ''; let last = null
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        let i
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1)
          if (!line) continue
          let o; try { o = JSON.parse(line) } catch (e) { continue }
          if (o.msg) add(o.msg, o.at)
          if (o.done) last = o
        }
      }
      if (!last) setUpd((u) => u && { ...u, state: 'ko', note: 'Collegamento interrotto: controlla lo stato nei Dettagli.' })
      else if (last.ok) setUpd((u) => u && { ...u, state: last.healthy === false ? 'ko' : 'ok', note: last.healthy === false ? 'Il container è stato ricreato ma il tenant non risponde ancora.' : '' })
      else if (last.skipped === 'active_session') setUpd((u) => u && { ...u, state: 'busy', note: 'Sessione attiva: ' + last.active_session.username })
      else setUpd((u) => u && { ...u, state: 'ko', note: last.error || '' })
    } catch (e) {
      add('Errore di rete: ' + e.message); setUpd((u) => u && { ...u, state: 'ko' })
    } finally { load() }
  }
  const redeploy = (t) => runUpdate(t, false)

  const resetCredentials = async (t) => {
    if (!confirm('Generare nuove credenziali per "' + t.name + '"? La password attuale smetterà subito di funzionare.')) return
    setResettingSlug(t.slug)
    const res = await fetch(API + '/tenants/' + t.slug + '/reset-credentials', { method: 'POST', headers })
    const data = await res.json()
    setResettingSlug(null)
    if (!res.ok) { setStatsError(data.error || 'Errore nel reset credenziali'); return }
    setCredentialsReveal({ slug: t.slug, name: t.name, username: data.username, password: data.password })
  }

  const saveDomain = async (slug) => {
    await fetch(API + '/tenants/' + slug + '/domain', { method: 'PATCH', headers, body: JSON.stringify({ domain: domainDraft }) })
    setEditingDomainSlug(null)
    load()
  }

  const loadBackups = async (slug) => {
    const res = await fetch(API + '/tenants/' + slug + '/backups', { headers })
    if (res.ok) {
      const data = await res.json()
      setBackupsBySlug((p) => ({ ...p, [slug]: data }))
    }
  }

  // Backup settimanale via mail: acceso/spento, invio di prova, passphrase dell'allegato cifrato.
  const [mailBusy, setMailBusy] = useState(null)
  const [mailMsg, setMailMsg] = useState({})
  const [passVisible, setPassVisible] = useState({})
  const toggleMail = async (slug, enabled) => {
    setMailBusy(slug); setMailMsg((m) => ({ ...m, [slug]: null }))
    const res = await fetch(API + '/tenants/' + slug + '/backup-mail', { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) })
    setMailBusy(null)
    if (res.ok) loadBackupSettings(slug); else setMailMsg((m) => ({ ...m, [slug]: { ok: false, text: 'Non riuscito.' } }))
  }
  const sendMailNow = async (slug) => {
    setMailBusy(slug); setMailMsg((m) => ({ ...m, [slug]: null }))
    const res = await fetch(API + '/tenants/' + slug + '/backup-mail/send-now', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}' })
    const data = await res.json().catch(() => ({}))
    setMailBusy(null)
    setMailMsg((m) => ({ ...m, [slug]: res.ok ? { ok: true, text: 'Mail inviata (' + data.size_mb + ' MB): controlla la posta.' } : { ok: false, text: data.error || 'Invio non riuscito.' } }))
    loadBackupSettings(slug)
  }
  const showPassphrase = async (slug) => {
    if (passVisible[slug]) { setPassVisible((p) => ({ ...p, [slug]: null })); return }
    const res = await fetch(API + '/tenants/' + slug + '/backup-mail/passphrase', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}' })
    const data = await res.json().catch(() => ({}))
    setPassVisible((p) => ({ ...p, [slug]: res.ok ? data.passphrase : null }))
  }

  const loadBackupSettings = async (slug) => {
    const res = await fetch(API + '/tenants/' + slug + '/backup-settings', { headers })
    if (res.ok) {
      const data = await res.json()
      setOffsiteSettingsBySlug((p) => ({ ...p, [slug]: data }))
      setOffsiteDraft((p) => ({ ...p, [slug]: { url: data.backup_offsite_url || '', credentials: '' } }))
    }
  }

  // Le credenziali sono un campo di testo JSON libero (opzionale) — non un form
  // dedicato per schema di destinazione, perché oggi esiste solo 'file://' (che
  // non ne ha bisogno): costruire una UI per campi che nessuno schema usa ancora
  // sarebbe lavoro speso su un'ipotesi, non su un bisogno reale. Lasciato vuoto
  // = non toccare le credenziali già salvate (vedi PATCH lato backend).
  const saveOffsiteSettings = async (slug) => {
    const draft = offsiteDraft[slug] || { url: '', credentials: '' }
    let credentials
    if (draft.credentials && draft.credentials.trim()) {
      try { credentials = JSON.parse(draft.credentials) }
      catch (e) { setOffsiteMsg((p) => ({ ...p, [slug]: { ok: false, error: 'Credenziali non valide — deve essere JSON, es. {"chiave":"valore"}' } })); return }
    }
    setSavingOffsiteSlug(slug)
    setOffsiteMsg((p) => ({ ...p, [slug]: null }))
    const body = { backup_offsite_url: draft.url.trim() || null }
    if (credentials !== undefined) body.backup_offsite_credentials = credentials
    const res = await fetch(API + '/tenants/' + slug + '/backup-settings', { method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data = await res.json()
    setSavingOffsiteSlug(null)
    if (res.ok) {
      setOffsiteSettingsBySlug((p) => ({ ...p, [slug]: data }))
      setOffsiteDraft((p) => ({ ...p, [slug]: { url: data.backup_offsite_url || '', credentials: '' } }))
      setOffsiteMsg((p) => ({ ...p, [slug]: { ok: true } }))
    } else {
      setOffsiteMsg((p) => ({ ...p, [slug]: { ok: false, error: data.error } }))
    }
  }

  const loadSessions = async (slug) => {
    const res = await fetch(API + '/tenants/' + slug + '/sessions', { headers })
    if (res.ok) {
      const data = await res.json()
      setSessionsBySlug((p) => ({ ...p, [slug]: data }))
    }
  }

  const loadModuleStats = async (slug) => {
    const res = await fetch(API + '/tenants/' + slug + '/module-stats', { headers })
    if (res.ok) {
      const data = await res.json()
      setModuleStatsBySlug((p) => ({ ...p, [slug]: data }))
    }
  }

  // Logout remoto reale — non solo un badge che sparisce qui: requireAuth in
  // core/backend rifiuta il token alla richiesta successiva dell'utente, non
  // aspetta la scadenza naturale (24h).
  const revokeSession = async (slug, sid) => {
    setRevokingSid(sid)
    const res = await fetch(API + '/tenants/' + slug + '/sessions/' + sid + '/revoke', { method: 'POST', headers })
    setRevokingSid(null)
    if (res.ok) { loadSessions(slug); loadActiveSessions() }
    else { const data = await res.json().catch(() => ({})); alert(data.error || 'Errore nella revoca') }
  }

  const runBackup = async (slug) => {
    setBackingUpSlug(slug)
    setBackupMsg((p) => ({ ...p, [slug]: null }))
    const res = await fetch(API + '/tenants/' + slug + '/backup', { method: 'POST', headers })
    const data = await res.json()
    setBackingUpSlug(null)
    setBackupMsg((p) => ({ ...p, [slug]: res.ok ? { ok: true, size: data.size_mb, emailed: data.email?.sent } : { ok: false, error: data.error } }))
    loadBackups(slug)
  }

  const runRestore = async (slug, backup) => {
    if (!confirm('Ripristinare il backup del ' + new Date(backup.created_at).toLocaleString('it-IT') + '?\n\nIl container verrà fermato e riavviato. Lo stato attuale viene comunque salvato come backup "pre-restore" prima di sovrascrivere, quindi è annullabile.')) return
    setRestoringId(backup.id)
    setBackupMsg((p) => ({ ...p, [slug]: null }))
    const res = await fetch(API + '/tenants/' + slug + '/restore/' + backup.id, { method: 'POST', headers })
    const data = await res.json()
    setRestoringId(null)
    setBackupMsg((p) => ({ ...p, [slug]: res.ok ? { ok: true, restored: true } : { ok: false, error: data.error } }))
    loadBackups(slug)
    load()
  }

  const toggle = (t) => tenantAction(t, t.status === 'active' ? 'stop' : 'start')

  const deleteTenant = async (t) => {
    if (!confirm('Eliminare "' + t.name + '"? Azione irreversibile.')) return
    await fetch(API + '/tenants/' + t.slug, { method: 'DELETE', headers })
    load()
  }

  const activeCount = tenants.filter((t) => t.status === 'active').length
  const visibleTenants = tenants
    .filter((t) => !searchQuery.trim() || t.name.toLowerCase().includes(searchQuery.trim().toLowerCase()) || t.slug.toLowerCase().includes(searchQuery.trim().toLowerCase()))
    .filter((t) => !tenantStatusFilter || t.status === tenantStatusFilter)
  // Paginazione (2026-09-03, richiesto dall'utente: "il paging va sistemato ovunque
  // ora") — card espandibili con sotto-liste (backup, sessioni), su Core platform-wide
  // potenzialmente centinaia. 20/pagina, stesso pattern già in uso in LicensesPage.jsx.
  const TENANTS_PAGE_SIZE = 20
  const tenantsTotalPages = Math.ceil(visibleTenants.length / TENANTS_PAGE_SIZE) || 1
  const tenantsPageClamped = Math.min(tenantsPage, tenantsTotalPages)
  const pagedTenants = visibleTenants.slice((tenantsPageClamped - 1) * TENANTS_PAGE_SIZE, tenantsPageClamped * TENANTS_PAGE_SIZE)

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold text-ink tracking-[-0.35px]">Tenant</h1>
          <p className="text-gray-500 text-sm mt-0.5">{activeCount} attivi su {tenants.length} totali</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={openNew} className="text-xs bg-cp-primary hover:bg-cp-primary-hover text-white px-3 py-2 rounded-lg transition flex items-center gap-1.5 whitespace-nowrap font-medium">
            <Icon name="plus" size={13} />Nuovo tenant
          </button>
          <button onClick={() => setShowRegister(true)} className="text-xs text-gray-400 hover:text-ink border border-gray-800 hover:border-gray-700 px-3 py-2 rounded-lg transition flex items-center gap-1.5 whitespace-nowrap">
            <Icon name="download" size={13} />Registra esistente
          </button>
        </div>
      </div>

      {tenants.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap mb-4">
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <Icon name="search" size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600" />
            <input value={searchQuery} onChange={(e) => { setSearchQuery(e.target.value); setTenantsPage(1) }} placeholder="Cerca per nome o slug..."
              className="w-full bg-surface-card text-ink pl-8 pr-3 py-2 rounded-lg text-sm outline-none border border-gray-800 focus:border-cp-primary transition placeholder-gray-600" />
          </div>
          <Select value={tenantStatusFilter} onChange={(v) => { setTenantStatusFilter(v); setTenantsPage(1) }} placeholder="Tutti gli stati" className="w-40"
            options={[{ value: '', label: 'Tutti gli stati' }, { value: 'active', label: 'Attivo' }, { value: 'stopped', label: 'Fermo' }, { value: 'creating', label: 'In creazione' }, { value: 'error', label: 'Errore' }]} />
        </div>
      )}

      {tenants.length === 0 ? (
        <div className="bg-surface-card rounded-md p-12 text-center border border-gray-800">
          <div className="text-gray-500 mb-1">Nessun tenant ancora</div>
          <div className="text-gray-600 text-sm">Crea il tuo primo tenant per iniziare</div>
        </div>
      ) : visibleTenants.length === 0 ? (
        <div className="bg-surface-card rounded-md p-8 text-center border border-gray-800 border-dashed">
          <div className="text-gray-500 text-sm">Nessun tenant corrisponde ai filtri scelti</div>
          <button onClick={() => { setSearchQuery(''); setTenantStatusFilter(''); setTenantsPage(1) }}
            className="text-cp-primary hover:opacity-80 text-sm transition mt-1">Azzera tutti i filtri</button>
        </div>
      ) : (
        <div className="space-y-3">
          {pagedTenants.map((t) => {
            const stats = statsBySlug[t.slug]
            const expanded = expandedSlug === t.slug
            return (
            <div key={t.id} className="bg-surface-card rounded-md border border-gray-800 hover:border-gray-700 transition overflow-hidden">
              <div className="p-5 flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-4 min-w-0">
                  <StatusDot status={t.status} />
                  <div>
                    <div className="font-medium text-ink flex items-center gap-2 flex-wrap">
                      {t.name}
                      {/* Prima l'unico segnale di stato era il pallino colorato (StatusDot,
                          senza testo/tooltip) più la parola grezza in inglese ("active"/
                          "stopped") sepolta nella riga meta in monospace — facile da perdere,
                          soprattutto per "fermo" (nessun colore d'allarme, si confonde con
                          "attivo" a colpo d'occhio). Aggiunta un'etichetta vera e leggibile
                          (2026-09-03, richiesto dall'utente dopo aver visto 7 tenant fermi
                          per RAM con lo status DB rimasto "active": "label per indicare
                          tenant fermo è necessario"). Stessa mappa italiana già usata nel
                          filtro qui sopra, solo anche sulla card. */}
                      {t.status !== 'active' && (
                        <StatusBadge tone={t.status === 'stopped' ? 'gray' : t.status === 'error' ? 'red' : 'amber'}>
                          {TENANT_STATUS_LABEL[t.status] || t.status}
                        </StatusBadge>
                      )}
                      {activeSessions[t.slug] && (
                        <StatusBadge tone="green" className="border border-cp-success-bg font-normal"
                          title={'Ultima azione: ' + activeSessions[t.slug].username + ', ' + new Date(activeSessions[t.slug].last_active_at).toLocaleTimeString('it-IT')}>
                          <span className="w-1.5 h-1.5 rounded-full bg-cp-success animate-pulse" /> attivo ora
                        </StatusBadge>
                      )}
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-800 text-gray-500" title="Moduli reali installati, esclusi quelli di supporto">
                        {t.n_moduli} moduli
                      </span>
                    </div>
                    <div className="text-sm text-gray-500 font-mono mt-0.5">
                      <>{t.slug} &middot; :{t.port} &middot; {t.status}</>
                      {(t.status === 'creating' || t.status === 'error') && t.provisioning_step && (
                        <>
                          {' '}&middot; fermo a: {PROVISIONING_STEP_LABEL[t.provisioning_step] || t.provisioning_step}
                        </>
                      )}
                    </div>
                    {t.status === 'error' && t.provisioning_error && (
                      <div className="text-xs text-cp-danger font-mono mt-0.5 truncate" title={t.provisioning_error}>{t.provisioning_error}</div>
                    )}
                    {editingDomainSlug === t.slug ? (
                      <div className="flex items-center gap-1.5 mt-1.5" onClick={(e) => e.stopPropagation()}>
                        <Icon name="globe" size={11} />
                        <input autoFocus className="bg-surface-page text-gray-300 text-xs font-mono px-2 py-1 rounded outline-none border border-gray-700 focus:border-cp-primary transition w-48"
                          placeholder="dominio.it" value={domainDraft} onChange={(e) => setDomainDraft(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && saveDomain(t.slug)} />
                        <button onClick={() => saveDomain(t.slug)} className="text-cp-primary hover:opacity-80 transition"><Icon name="save" size={12} /></button>
                        <button onClick={() => setEditingDomainSlug(null)} className="text-gray-600 hover:text-gray-400 transition"><Icon name="x" size={12} /></button>
                      </div>
                    ) : (
                      <button onClick={() => { setEditingDomainSlug(t.slug); setDomainDraft(t.domain || '') }}
                        className="flex items-center gap-1.5 mt-1.5 text-xs text-gray-600 hover:text-gray-400 transition disabled:opacity-50 disabled:cursor-default disabled:hover:text-gray-600">
                        <Icon name="globe" size={11} />
                        {t.domain ? <span className="font-mono">{t.domain}</span> : <span>assegna dominio</span>}
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  {t.status === 'active' && (
                    <button
                      onClick={() => openTenant(t)}
                      className="text-sm text-cp-primary hover:opacity-80 disabled:opacity-50 transition"
                    >
                      Apri &#8594;
                    </button>
                  )}
                  <button
                    onClick={() => toggleDetails(t.slug)}
                    className={
                      'text-sm px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 ' +
                      (expanded ? 'bg-cp-primary/20 text-cp-primary border border-cp-primary/40' : 'bg-gray-800 hover:bg-gray-700 text-gray-300')
                    }
                  >
                    <Icon name="activity" size={12} />
                    Dettagli
                    <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={12} />
                  </button>
                  {t.status === 'active' && (
                    <button onClick={() => redeploy(t)} disabled={actionSlug === t.slug} title="Ricrea il container con l'ultima versione; i dati non si toccano"
                      className="text-sm px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 transition disabled:opacity-40 flex items-center gap-1.5">
                      <Icon name="refresh" size={12} />
                      Aggiorna
                    </button>
                  )}
                  <button
                    onClick={() => toggle(t)}
                    disabled={t.status === 'creating' || t.status === 'error' || actionSlug === t.slug}
                    className={
                      'text-sm px-3 py-1.5 rounded-lg transition disabled:opacity-40 flex items-center gap-1.5 ' +
                      (t.status === 'active'
                        ? 'bg-gray-800 hover:bg-gray-700 text-gray-300'
                        : 'bg-green-900/30 hover:bg-green-900/50 text-green-400 border border-green-900/50')
                    }
                  >
                    <Icon name={t.status === 'active' ? 'square' : 'play'} size={12} />
                    {actionSlug === t.slug ? '...' : t.status === 'active' ? 'Stop' : 'Start'}
                  </button>
                  <button
                    onClick={() => deleteTenant(t)}
                    className="text-sm px-3 py-1.5 rounded-lg bg-red-900/20 hover:bg-red-900/40 text-red-400 border border-red-900/30 transition flex items-center gap-1.5"
                  >
                    <Icon name="trash" size={12} />
                    Elimina
                  </button>
                </div>
              </div>

              {expanded && (
                <div className="border-t border-gray-800 bg-surface-page px-5 py-4">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
                    {DETAIL_TABS.map((tb) => (
                      <Tile key={tb.id} icon={tb.icon} label={tb.label}
                        active={(detailTabBySlug[t.slug] || 'panoramica') === tb.id}
                        onClick={() => setDetailTabBySlug((s) => ({ ...s, [t.slug]: tb.id }))}
                        value={tb.value || (tb.id === 'panoramica' ? (t.status === 'active' ? 'Attivo' : t.status === 'creating' ? 'In creazione' : t.status === 'error' ? 'Errore' : 'Fermo') : (t.client_id ? 'Collegato' : 'Non collegato'))}
                        sub={tb.sub} />
                    ))}
                  </div>

                  {(detailTabBySlug[t.slug] || 'panoramica') === 'panoramica' && (
                  <>
                  {statsError ? (
                    <div className="text-sm text-red-400">{statsError}</div>
                  ) : !stats ? (
                    <div className="text-sm text-gray-500">Caricamento consumi live…</div>
                  ) : !stats.running ? (
                    <div className="text-sm text-gray-500">
                      Container non attivo — nessun consumo live da mostrare.
                      {stats.db_size_mb != null && <span className="ml-2 text-gray-400">Database su disco: <span className="font-mono">{stats.db_size_mb} MB</span></span>}
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                      <div>
                        <div className="text-xs text-gray-500 mb-1">CPU</div>
                        <div className="text-ink font-mono text-sm">{stats.cpu_percent}%</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500 mb-1">RAM</div>
                        <div className="text-ink font-mono text-sm">{stats.mem_usage_mb} / {stats.mem_limit_mb ?? '—'} MB</div>
                        <div className="text-xs text-gray-600">{stats.mem_percent}%</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500 mb-1">Rete (rx / tx)</div>
                        <div className="text-ink font-mono text-sm">{stats.net_rx_mb} / {stats.net_tx_mb} MB</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500 mb-1">Database su disco</div>
                        <div className="text-ink font-mono text-sm">{stats.db_size_mb != null ? stats.db_size_mb + ' MB' : '—'}</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500 mb-1">Attivo da</div>
                        <div className="text-ink font-mono text-sm">{formatUptime(stats.started_at)}</div>
                      </div>
                    </div>
                  )}
                  <div className="text-xs text-gray-600 mt-3">Aggiornato ogni 3 secondi mentre questo pannello è aperto.</div>
                  {onViewActivity && (
                    <button onClick={() => onViewActivity(t.name)} className="text-xs text-cp-primary hover:opacity-80 mt-2">
                      Vedi errori di questo tenant →
                    </button>
                  )}
                  </>
                  )}

                  {(detailTabBySlug[t.slug] || 'panoramica') === 'moduli' && (
                  <div>
                    <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-2">Moduli installati</div>
                    {!moduleStatsBySlug[t.slug] ? (
                      <div className="text-xs text-gray-600">Caricamento…</div>
                    ) : moduleStatsBySlug[t.slug].total === 0 ? (
                      <div className="text-xs text-gray-600">Nessun modulo reale installato.</div>
                    ) : (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs text-ink font-mono">{moduleStatsBySlug[t.slug].total} totali</span>
                        {moduleStatsBySlug[t.slug].by_category.map((c) => (
                          <span key={c.category || '_none'} className="text-[10px] bg-gray-800 text-gray-400 px-2 py-0.5 rounded-full">
                            {c.category || 'Senza categoria'} · {c.count}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  )}

                  {(detailTabBySlug[t.slug] || 'panoramica') === 'credenziali' && (
                  <div>
                    <div className="flex items-center justify-between">
                      <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Credenziali accesso</div>
                      <button onClick={() => resetCredentials(t)} disabled={resettingSlug === t.slug}
                        className="text-xs bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-300 px-3 py-1.5 rounded-lg transition">
                        {resettingSlug === t.slug ? 'Generazione...' : 'Reset credenziali'}
                      </button>
                    </div>
                    <div className="text-xs text-gray-600 mt-1.5">Genera una nuova password per l'utente admin di questo tenant — la precedente smette subito di funzionare.</div>
                  </div>
                  )}

                  {(detailTabBySlug[t.slug] || 'panoramica') === 'backup' && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Backup</div>
                      <button onClick={() => runBackup(t.slug)} disabled={backingUpSlug === t.slug}
                        className="text-xs bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-300 px-3 py-1.5 rounded-lg transition">
                        {backingUpSlug === t.slug ? 'Backup in corso...' : 'Backup ora'}
                      </button>
                    </div>
                    {(() => {
                      const bs = offsiteSettingsBySlug[t.slug] || {}
                      const on = !!bs.backup_mail_weekly
                      return (
                        <div className="mb-4 rounded-lg border border-gray-800 p-3">
                          <div className="flex items-center justify-between gap-3 flex-wrap">
                            <div>
                              <div className="text-sm text-ink font-medium">Backup settimanale via mail</div>
                              <div className="text-xs text-gray-500 mt-0.5">Ogni lunedì dalle 08:00 ricevi la copia del database, compressa e cifrata. Non contiene i file caricati (documenti, PDF, foto).</div>
                            </div>
                            <button onClick={() => toggleMail(t.slug, !on)} disabled={mailBusy === t.slug || bs.backup_mail_smtp_ready === false}
                              className={'text-xs px-3 py-1.5 rounded-lg transition disabled:opacity-50 ' + (on ? 'bg-green-900/30 text-green-400 border border-green-900/50' : 'bg-gray-800 hover:bg-gray-700 text-gray-300')}>
                              {on ? 'Acceso' : 'Spento'}
                            </button>
                          </div>
                          {bs.backup_mail_smtp_ready === false && <div className="text-xs text-amber-400 mt-2">La posta non è configurata su questo Super Admin: non posso inviare.</div>}
                          {on && (
                            <div className="mt-3 flex items-center gap-2 flex-wrap text-xs">
                              <button onClick={() => sendMailNow(t.slug)} disabled={mailBusy === t.slug} className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-300">{mailBusy === t.slug ? 'Invio…' : 'Invia ora una prova'}</button>
                              <button onClick={() => showPassphrase(t.slug)} className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300">{passVisible[t.slug] ? 'Nascondi passphrase' : 'Mostra passphrase'}</button>
                              <span className="text-gray-500">{bs.backup_mail_last_sent ? 'Ultimo invio: ' + new Date(bs.backup_mail_last_sent).toLocaleString('it-IT') : 'Ancora nessun invio'}</span>
                            </div>
                          )}
                          {on && passVisible[t.slug] && (
                            <div className="mt-2 text-xs">
                              <code className="px-2 py-1 rounded bg-black/20 text-ink select-all break-all">{passVisible[t.slug]}</code>
                              <div className="text-gray-500 mt-1">Conservala in un posto sicuro (gestore di password): senza, le copie ricevute non si riaprono. Il comando per riaprirle è scritto in ogni mail.</div>
                            </div>
                          )}
                          {mailMsg[t.slug] && <div className={'text-xs mt-2 ' + (mailMsg[t.slug].ok ? 'text-green-400' : 'text-red-400')}>{mailMsg[t.slug].text}</div>}
                        </div>
                      )
                    })()}
                    {backupMsg[t.slug] && (
                      backupMsg[t.slug].ok
                        ? <div className="text-xs text-green-400 mb-2">
                            {backupMsg[t.slug].restored ? 'Ripristino completato — il container è ripartito con i dati del backup scelto.' : ('Completato — ' + backupMsg[t.slug].size + ' MB. ' + (backupMsg[t.slug].emailed ? 'Notifica inviata via email.' : 'Email non inviata (SMTP non configurato).'))}
                          </div>
                        : <div className="text-xs text-red-400 mb-2">{backupMsg[t.slug].error}</div>
                    )}
                    {/* PLATFORM-UI-RESKIN-PLAN.md — passato da lista a tabella con pillole di
                        stato reali (era testo colorato in linea), come la reference "Backup &
                        Ripristino": stessi identici dati e azioni, solo il contenitore cambia. */}
                    {(backupsBySlug[t.slug] || []).length === 0 ? (
                      <div className="text-xs text-gray-600">Nessun backup ancora.</div>
                    ) : (
                      <div className="border border-gray-800 rounded-lg overflow-hidden">
                        {/* stesso bug reale di PartnersPage/UsersPage: overflow-x-auto
                            sulla tabella, non solo overflow-hidden per il bordo. */}
                        <div className="overflow-x-auto">
                        <table className="w-full">
                          <thead className="border-b border-gray-800">
                            <tr>
                              <th className="text-left text-[10px] font-medium text-gray-500 px-3 py-1.5">Data</th>
                              <th className="text-left text-[10px] font-medium text-gray-500 px-3 py-1.5">Dimensione</th>
                              <th className="text-left text-[10px] font-medium text-gray-500 px-3 py-1.5">Stato</th>
                              <th className="text-left text-[10px] font-medium text-gray-500 px-3 py-1.5">Off-site</th>
                              <th className="text-right text-[10px] font-medium text-gray-500 px-3 py-1.5">Azioni</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-800/70">
                            {(backupsBySlug[t.slug] || []).slice(0, 5).map((b) => (
                              <tr key={b.id} className="text-xs">
                                <td className="px-3 py-1.5 text-gray-400 font-mono whitespace-nowrap">{new Date(b.created_at).toLocaleString('it-IT')}</td>
                                <td className="px-3 py-1.5 text-gray-400 font-mono">{b.status === 'ok' ? b.size_mb + ' MB' : '—'}</td>
                                <td className="px-3 py-1.5">
                                  <StatusBadge tone={b.status === 'ok' ? 'green' : 'red'}>{b.status === 'ok' ? 'Completato' : 'Fallito'}</StatusBadge>
                                </td>
                                <td className="px-3 py-1.5">
                                  {/* G18 — esito della copia off-site per QUESTO backup, stesso log, non una lista a parte.
                                      offsite_status assente = off-site non configurato quando questo backup è stato fatto, non un errore. */}
                                  {b.offsite_status === 'ok' && <span className="text-cp-primary" title={'Copiato off-site ' + new Date(b.offsite_synced_at).toLocaleString('it-IT')}>☁︎</span>}
                                  {b.offsite_status === 'error' && <span className="text-amber-400" title={'Copia off-site fallita: ' + b.offsite_error}>☁︎!</span>}
                                  {/* G18 — esito della verifica periodica che la copia off-site sia
                                      davvero ripristinabile (backup-verify.js), non solo "copiata".
                                      verify_status assente = non ancora verificata (primo giro dello
                                      scheduler settimanale non ancora passato per questa riga). */}
                                  {b.verify_status === 'ok' && <span className="text-cp-success ml-1" title={'Ripristino verificato ' + new Date(b.verify_checked_at).toLocaleString('it-IT')}>✓</span>}
                                  {b.verify_status === 'error' && <span className="text-cp-danger ml-1" title={'Verifica ripristino fallita: ' + b.verify_error}>✗</span>}
                                  {!b.offsite_status && <span className="text-gray-700">—</span>}
                                </td>
                                <td className="px-3 py-1.5 text-right whitespace-nowrap">
                                  {b.status === 'ok' && (
                                    <>
                                      <a href={API + '/tenants/' + t.slug + '/backups/' + b.id + '/download?token=' + encodeURIComponent(token)}
                                        className="text-gray-400 hover:text-gray-200 transition normal-case">
                                        Scarica
                                      </a>
                                      <button onClick={() => runRestore(t.slug, b)} disabled={restoringId === b.id}
                                        className="text-cp-primary hover:opacity-80 disabled:opacity-40 transition normal-case ml-3">
                                        {restoringId === b.id ? 'Ripristino...' : 'Ripristina'}
                                      </button>
                                    </>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        </div>
                      </div>
                    )}

                    {/* G18 (PLATFORM-0.6-GAP-ANALYSIS.md) — un solo campo URL decide la
                        destinazione off-site, mai un interruttore separato: vuoto =
                        disattivato. Cambiare destinazione domani (oggi un percorso locale
                        sincronizzato altrove, "a regime" sarà altro) significa scrivere un
                        URL diverso qui, nessun redeploy. Credenziali: campo JSON libero,
                        opzionale, lasciato vuoto non tocca quelle già salvate — nessuno
                        schema oggi le richiede (file:// no), pronto per quando servirà. */}
                    <div className="mt-3 pt-3 border-t border-gray-800/60">
                      <div className="text-xs text-gray-500 mb-1.5">Backup off-site</div>
                      <input type="text" placeholder="es. file:///offsite-backups/nome-tenant"
                        value={(offsiteDraft[t.slug] || {}).url ?? ''}
                        onChange={(e) => setOffsiteDraft((p) => ({ ...p, [t.slug]: { ...(p[t.slug] || {}), url: e.target.value } }))}
                        className="w-full text-xs font-mono bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-gray-300 disabled:opacity-50" />
                      <details className="mt-1.5">
                        <summary className="text-[11px] text-gray-600 cursor-pointer select-none">Credenziali (opzionale, solo se la destinazione le richiede)</summary>
                        <textarea placeholder='{"access_key":"...","secret_key":"..."}' rows={2}
                          value={(offsiteDraft[t.slug] || {}).credentials ?? ''}
                          onChange={(e) => setOffsiteDraft((p) => ({ ...p, [t.slug]: { ...(p[t.slug] || {}), credentials: e.target.value } }))}
                          className="w-full mt-1 text-xs font-mono bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-gray-300 disabled:opacity-50" />
                        <div className="text-[11px] text-gray-600 mt-1">
                          {(offsiteSettingsBySlug[t.slug] || {}).backup_offsite_credentials_configured ? 'Credenziali già salvate — lascia vuoto per non modificarle.' : 'Nessuna credenziale salvata.'}
                        </div>
                      </details>
                      <button onClick={() => saveOffsiteSettings(t.slug)} disabled={savingOffsiteSlug === t.slug}
                        className="mt-2 text-xs bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-300 px-3 py-1.5 rounded-lg transition">
                        {savingOffsiteSlug === t.slug ? 'Salvataggio...' : 'Salva'}
                      </button>
                      {offsiteMsg[t.slug] && (
                        offsiteMsg[t.slug].ok
                          ? <div className="text-xs text-green-400 mt-1.5">Salvato.</div>
                          : <div className="text-xs text-red-400 mt-1.5">{offsiteMsg[t.slug].error}</div>
                      )}
                    </div>
                  </div>
                  )}

                  {(detailTabBySlug[t.slug] || 'panoramica') === 'sessioni' && (
                  <div>
                    <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-2">Accessi</div>
                    <div className="space-y-1">
                      {(sessionsBySlug[t.slug] || []).length === 0 && <div className="text-xs text-gray-600">Nessun accesso registrato.</div>}
                      {(sessionsBySlug[t.slug] || []).slice(0, 20).map((s, i) => (
                        <div key={s.id != null ? s.id : i} className="flex items-center justify-between text-xs text-gray-500 font-mono gap-2">
                          <span className="truncate">{s.username} — {new Date(s.login_at).toLocaleString('it-IT')}</span>
                          <span className="flex-shrink-0 flex items-center gap-2">
                            {formatDuration(s.login_at, s.last_seen_at)}
                            {s.revoked_at ? (
                              <span className="text-gray-700">terminata</span>
                            ) : s.id != null ? (
                              <button onClick={() => revokeSession(t.slug, s.id)} disabled={revokingSid === s.id}
                                className="text-red-500/70 hover:text-red-400 transition disabled:opacity-40" title="Termina questa sessione da remoto">
                                {revokingSid === s.id ? '...' : 'termina'}
                              </button>
                            ) : null}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                  )}
                </div>
              )}
            </div>
            )
          })}
        </div>
      )}
      {tenantsTotalPages > 1 && (
        <div className="flex items-center justify-between mt-3">
          <div className="text-xs text-gray-500">{(tenantsPageClamped - 1) * TENANTS_PAGE_SIZE + 1}–{Math.min(tenantsPageClamped * TENANTS_PAGE_SIZE, visibleTenants.length)} di {visibleTenants.length}</div>
          <div className="flex items-center gap-1">
            <button onClick={() => setTenantsPage((p) => Math.max(1, p - 1))} disabled={tenantsPageClamped === 1}
              className="px-2 py-1 rounded text-gray-400 hover:text-ink disabled:opacity-30 transition text-xs">
              <Icon name="chevron-left" size={14} />
            </button>
            {Array.from({ length: tenantsTotalPages }, (_, i) => i + 1).filter((p) => p === 1 || p === tenantsTotalPages || Math.abs(p - tenantsPageClamped) <= 1).map((p, idx, arr) => (
              <React.Fragment key={p}>
                {idx > 0 && arr[idx - 1] !== p - 1 && <span className="text-gray-600 text-xs px-1">…</span>}
                <button onClick={() => setTenantsPage(p)}
                  className={'px-2.5 py-1 rounded text-xs transition ' + (p === tenantsPageClamped ? 'bg-cp-primary text-white' : 'text-gray-400 hover:text-ink')}>
                  {p}
                </button>
              </React.Fragment>
            ))}
            <button onClick={() => setTenantsPage((p) => Math.min(tenantsTotalPages, p + 1))} disabled={tenantsPageClamped === tenantsTotalPages}
              className="px-2 py-1 rounded text-gray-400 hover:text-ink disabled:opacity-30 transition text-xs">
              <Icon name="chevron-right" size={14} />
            </button>
          </div>
        </div>
      )}

      {dnsWarning && (
        <div className="bg-amber-900/20 border border-amber-900/50 rounded-xl p-4 mb-4 flex items-start justify-between gap-4 flex-wrap">
          <div className="text-sm min-w-0">
            <div className="text-amber-400 font-medium">"{dnsWarning.name}" è stato creato, ma il sottodominio non è stato registrato su Cloudflare</div>
            <div className="text-xs text-gray-400 mt-1">Finché non esiste, <span className="font-mono">{dnsWarning.domain}</span> non si apre da fuori casa. Errore: {dnsWarning.error}</div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button onClick={retryDns} disabled={dnsRetrying} className="text-xs bg-amber-700 hover:bg-amber-600 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg transition">{dnsRetrying ? 'Riprovo...' : 'Riprova'}</button>
            <button onClick={() => setDnsWarning(null)} className="text-xs text-gray-500 hover:text-gray-300 transition px-2 py-1.5">Chiudi</button>
          </div>
        </div>
      )}

      {showRegister && <RegisterExistingModal token={token} onClose={() => setShowRegister(false)} onDone={load} />}

      {showNew && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-surface-card rounded-md p-6 w-full max-w-md border border-gray-800">
            <h2 className="text-lg font-bold text-ink mb-1">Nuovo tenant</h2>
            <p className="text-sm text-gray-500 mb-5">Crea una nuova istanza ospitata su questo Core.</p>
            {error && <div className="bg-red-900/30 text-red-400 text-sm p-3 rounded-lg mb-4 border border-red-900/50">{error}</div>}
            <div className="space-y-3 mb-6">
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Nome</label>
                <input className="w-full bg-surface-page text-ink px-4 py-3 rounded-lg outline-none border border-gray-800 focus:border-cp-primary transition placeholder-gray-600"
                  placeholder="es. Coffee" value={form.name}
                  onChange={(e) => { const name = e.target.value; setForm({ ...form, name, slug: name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') }) }} />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Slug</label>
                <input className="w-full bg-surface-page text-ink px-4 py-3 rounded-lg outline-none border border-gray-800 focus:border-cp-primary transition font-mono placeholder-gray-600"
                  placeholder="es. coffee" value={form.slug}
                  onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })} />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Dominio (opzionale)</label>
                <input className="w-full bg-surface-page text-ink px-4 py-3 rounded-lg outline-none border border-gray-800 focus:border-cp-primary transition font-mono placeholder-gray-600"
                  placeholder="es. coffee.platform-core.it" value={form.domain}
                  onChange={(e) => setForm({ ...form, domain: e.target.value })} />
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => { setShowNew(false); setError('') }} className="flex-1 bg-gray-800 hover:bg-gray-700 text-white py-3 rounded-lg transition">Annulla</button>
              <button onClick={create} disabled={loading} className="flex-1 bg-cp-primary hover:bg-cp-primary-hover disabled:opacity-50 text-white py-3 rounded-lg transition font-medium">
                {loading ? 'Creo...' : 'Crea tenant'}
              </button>
            </div>
          </div>
        </div>
      )}

      {loading && showNew && <TenantCreatingOverlay />}

      {credentialsReveal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setCredentialsReveal(null)}>
          <div className="bg-surface-card rounded-md p-6 w-full max-w-sm border border-gray-800" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 text-green-400 mb-1">
              <Icon name="check" size={16} />
              <h2 className="text-lg font-bold text-ink">Credenziali generate</h2>
            </div>
            <p className="text-xs text-gray-500 mb-5">Per <span className="text-gray-300">{credentialsReveal.name}</span> — salvale ora, non le rivedrai più qui.</p>
            <div className="space-y-3 mb-5">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Username</label>
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-surface-page text-ink px-4 py-2.5 rounded-lg border border-gray-800 font-mono text-sm">{credentialsReveal.username}</div>
                  <button onClick={() => navigator.clipboard.writeText(credentialsReveal.username)} className="w-9 h-9 flex-shrink-0 flex items-center justify-center bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition" title="Copia">
                    <Icon name="file" size={14} />
                  </button>
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Password</label>
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-surface-page text-ink px-4 py-2.5 rounded-lg border border-gray-800 font-mono text-sm">{credentialsReveal.password}</div>
                  <button onClick={() => navigator.clipboard.writeText(credentialsReveal.password)} className="w-9 h-9 flex-shrink-0 flex items-center justify-center bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition" title="Copia">
                    <Icon name="file" size={14} />
                  </button>
                </div>
              </div>
            </div>
            <button onClick={() => setCredentialsReveal(null)} className="w-full bg-cp-primary hover:bg-cp-primary-hover text-white py-3 rounded-lg transition font-medium">
              Ho salvato le credenziali
            </button>
          </div>
        </div>
      )}

      {pendingOpenTenant && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={closeReauthModal}>
          <div className="bg-surface-card rounded-md p-6 w-full max-w-sm border border-gray-800" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-1">
              <Icon name="lock" size={16} />
              <h2 className="text-lg font-bold text-ink">Credenziali del tenant</h2>
            </div>
            <p className="text-xs text-gray-500 mb-5">Per accedere come admin di <span className="text-gray-300">{pendingOpenTenant.name}</span>, inserisci le credenziali admin di QUEL tenant — non le tue.</p>
            {reauthError && <div className="bg-red-900/30 text-red-400 text-sm p-3 rounded-lg mb-4 border border-red-900/50">{reauthError}</div>}
            {reauthReadyUrl ? (
              <>
                <div className="bg-green-900/20 text-green-400 text-sm p-3 rounded-lg mb-4 border border-green-900/40">Accesso verificato — clicca per aprire.</div>
                <a href={reauthReadyUrl} target="_blank" rel="noopener noreferrer" onClick={closeReauthModal}
                  className="block text-center bg-cp-primary hover:bg-cp-primary-hover text-white py-2.5 rounded-lg text-sm transition mb-2">
                  Apri il tenant →
                </a>
                <button onClick={closeReauthModal} className="w-full bg-gray-800 hover:bg-gray-700 text-white py-2.5 rounded-lg text-sm transition">Chiudi</button>
              </>
            ) : (
              <>
                <input type="text" autoFocus value={reauthUsername} onChange={(e) => setReauthUsername(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && submitReauth()}
                  className="w-full bg-surface-page text-ink px-4 py-3 rounded-lg outline-none border border-gray-800 focus:border-cp-primary transition mb-3"
                  placeholder="Username admin del tenant" autoComplete="off" />
                <input type="password" value={reauthPassword} onChange={(e) => setReauthPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && submitReauth()}
                  className="w-full bg-surface-page text-ink px-4 py-3 rounded-lg outline-none border border-gray-800 focus:border-cp-primary transition mb-4"
                  placeholder="Password admin del tenant" autoComplete="off" />
                <div className="flex gap-2">
                  <button onClick={closeReauthModal}
                    className="flex-1 bg-gray-800 hover:bg-gray-700 text-white py-2.5 rounded-lg text-sm transition">Annulla</button>
                  <button onClick={submitReauth} disabled={reauthBusy || !reauthUsername || !reauthPassword}
                    className="flex-1 bg-cp-primary hover:bg-cp-primary-hover disabled:opacity-50 text-white py-2.5 rounded-lg text-sm transition">
                    {reauthBusy ? 'Verifica...' : 'Accedi'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      {upd && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-surface-card border border-gray-800 rounded-xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="px-6 pt-6 pb-4 flex items-center gap-3">
              <div className={'w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ' + (upd.state === 'ok' ? 'bg-green-500/15 text-green-500' : upd.state === 'ko' ? 'bg-red-500/15 text-red-500' : upd.state === 'busy' ? 'bg-amber-500/15 text-amber-500' : 'bg-cp-primary/15 text-cp-primary')}>
                <Icon name={upd.state === 'ok' ? 'check' : upd.state === 'ko' ? 'alert-triangle' : 'refresh'} size={18} className={upd.state === 'running' ? 'animate-spin' : ''} />
              </div>
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-ink leading-tight">{upd.state === 'ok' ? 'Aggiornato' : upd.state === 'ko' ? 'Non aggiornato' : upd.state === 'busy' ? 'Sessione attiva' : 'Aggiornamento in corso'}</h2>
                <div className="text-sm text-gray-500">{upd.t.name}</div>
              </div>
            </div>
            <ol className="px-6 pb-4 space-y-2.5 max-h-72 overflow-y-auto">
              {upd.lines.map((l, i) => {
                const last = i === upd.lines.length - 1
                const working = upd.state === 'running' && last
                return (
                  <li key={i} className="flex items-start gap-3 text-sm">
                    <span className="mt-0.5 w-4 h-4 flex-shrink-0 flex items-center justify-center">
                      {working ? <Icon name="refresh" size={14} className="animate-spin text-cp-primary" /> : <Icon name="check" size={14} className="text-green-500" />}
                    </span>
                    <span className="flex-1 text-ink">{l.msg}</span>
                    <span className="text-xs text-gray-500 tabular-nums mt-0.5">{new Date(l.at).toLocaleTimeString('it-IT')}</span>
                  </li>
                )
              })}
            </ol>
            {upd.state === 'ok' && <div className="mx-6 mb-5 rounded-lg bg-green-500/10 border border-green-500/30 text-green-600 text-center font-semibold tracking-wide py-3">AGGIORNATO</div>}
            {upd.state === 'ko' && <div className="mx-6 mb-5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-600 text-center py-3"><div className="font-semibold tracking-wide">NON AGGIORNATO</div>{upd.note && <div className="text-xs mt-1 px-3">{upd.note}</div>}</div>}
            {upd.state === 'busy' && <div className="mx-6 mb-5 text-sm text-gray-500">{upd.note}. Aggiornando, l'utente collegato viene scollegato per qualche secondo.</div>}
            <div className="px-6 py-4 border-t border-gray-800 flex justify-end gap-2">
              {upd.state === 'busy' && <button onClick={() => runUpdate(upd.t, true)} className="text-sm px-4 py-2 rounded-lg bg-cp-primary hover:bg-cp-primary-hover text-white transition">Aggiorna comunque</button>}
              <button onClick={() => setUpd(null)} disabled={upd.state === 'running'} className="text-sm px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200 transition disabled:opacity-40">{upd.state === 'running' ? 'Attendi…' : 'Chiudi'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default TenantsPage
