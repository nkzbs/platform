import React, { useState, useEffect } from 'react'
import { API, notifyUnauthorized, setAuth, clearAuth } from './lib/api'

import Login from './components/Login'
import Sidebar from './components/Sidebar'
import Icon from './components/Icon'
import AskData from './components/AskData'
import DashboardPage from './pages/DashboardPage'
import LibreriaPage from './pages/LibreriaPage'
import MovimentiPage from './pages/MovimentiPage'
import BuilderPage from './pages/BuilderPage'
import SetupWizard from './components/SetupWizard'
import GuidaPage from './pages/GuidaPage'
import AuditPage from './pages/AuditPage'
import ImpostazioniPage from './pages/ImpostazioniPage'
import ModulePage from './pages/ModulePage'
import ExportDatiPage from './pages/ExportDatiPage'

// Toast globale: qualunque componente fa:
//   window.dispatchEvent(new CustomEvent('platform:toast', { detail: { message, type } }))
// type: 'success' | 'error' | 'info'
function ToastContainer() {
  const [toasts, setToasts] = useState([])
  useEffect(() => {
    const handler = (e) => {
      const { message, type = 'success' } = e.detail
      const id = Date.now() + Math.random()
      setToasts((p) => [...p.slice(-3), { id, message, type }])
      setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), 3500)
    }
    window.addEventListener('platform:toast', handler)
    return () => window.removeEventListener('platform:toast', handler)
  }, [])

  const colors = {
    success: 'bg-green-900/90 border-green-700 text-green-200',
    error: 'bg-red-900/90 border-red-700 text-red-200',
    info: 'bg-blue-900/90 border-blue-700 text-blue-200',
  }
  if (toasts.length === 0) return null
  return (
    <div className="fixed bottom-5 right-5 z-[200] flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div key={t.id} className={'px-4 py-3 rounded-lg border text-sm font-medium shadow-lg backdrop-blur-sm transition-all ' + (colors[t.type] || colors.info)}>
          {t.message}
        </div>
      ))}
    </div>
  )
}

// ─── GLOBAL SEARCH ────────────────────────────────────────────────────────────
function GlobalSearch({ token, modules, onNavigate }) {
  const [q, setQ] = React.useState('')
  const [results, setResults] = React.useState([])
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef(null)
  const debounce = React.useRef(null)

  React.useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const search = (val) => {
    setQ(val)
    if (debounce.current) clearTimeout(debounce.current)
    if (!val.trim() || val.trim().length < 2) { setResults([]); setOpen(false); return }
    debounce.current = setTimeout(async () => {
      const res = await fetch(API + '/search?q=' + encodeURIComponent(val.trim()), { headers: { Authorization: 'Bearer ' + token } })
      if (res.ok) { const data = await res.json(); setResults(data); setOpen(true) }
    }, 300)
  }

  const pick = (r) => { setQ(''); setOpen(false); onNavigate(r.module_slug) }

  return (
    <div className="relative flex-1 min-w-0 md:flex-none" ref={ref}>
      <div className="flex items-center gap-2 bg-surface-card border border-gray-800 rounded-lg px-3 py-1.5 w-full md:w-56 focus-within:border-blue-500 transition">
        <Icon name="search" size={13} className="text-gray-600 flex-shrink-0" />
        <input className="bg-transparent text-sm text-ink outline-none w-full placeholder-gray-600"
          placeholder="Cerca in tutti i moduli..." value={q} onChange={(e) => search(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)} />
      </div>
      {open && results.length > 0 && (
        <div className="absolute top-full mt-1 right-0 md:left-0 w-[min(20rem,90vw)] bg-surface-card border border-gray-700 rounded-xl shadow-xl z-50 overflow-hidden max-h-72 overflow-y-auto">
          {results.map((r, i) => (
            <button key={i} onClick={() => pick(r)}
              className="w-full px-4 py-2.5 hover:bg-white/5 transition text-left flex items-center gap-3 border-b border-gray-800/50">
              <div className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0" style={{ backgroundColor: (r.module_color || '#2563EB') + '22', color: r.module_color || '#2563EB' }}>
                <Icon name={r.module_icon || 'box'} size={12} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm text-ink truncate">{r.label}</div>
                <div className="text-xs text-gray-500">{r.module_name} · #{r.record_id}</div>
              </div>
            </button>
          ))}
        </div>
      )}
      {open && results.length === 0 && q.length >= 2 && (
        <div className="absolute top-full mt-1 left-0 w-64 bg-surface-card border border-gray-700 rounded-xl shadow-xl z-50 px-4 py-3 text-sm text-gray-500">
          Nessun risultato per "{q}"
        </div>
      )}
    </div>
  )
}

// ─── APP ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem('platform_token'))
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('platform_user')) } catch { return null }
  })
  const [currentPage, setCurrentPage] = useState('dashboard')
  const [installedModules, setInstalledModules] = useState([])
  // Ponte Store -> Builder: "Personalizza" installa e naviga qui col modulo già
  // selezionato, invece di lasciare l'utente a cercarlo a mano nel menu del Builder.
  const [builderPreselect, setBuilderPreselect] = useState(null)
  const openInBuilder = (slug) => { setBuilderPreselect(slug); setCurrentPage('builder') }
  // Stesso ponte, ma per "crea il tuo gestionale da zero" dallo Store — apre
  // direttamente il wizard "nuovo modulo" invece di preselezionarne uno esistente.
  const [builderOpenNew, setBuilderOpenNew] = useState(false)
  const openBuilderNewModule = () => { setBuilderOpenNew(true); setCurrentPage('builder') }
  const [tenantName, setTenantName] = useState('')
  const [aiOn, setAiOn] = useState(false) // interruttore generale dell'AI
  const [features, setFeatures] = useState({}) // funzioni facoltative accese su questo progetto (da /api/tenant-info)
  const [tenantLogoUrl, setTenantLogoUrl] = useState('')
  const [hidePlatformName, setHidePlatformName] = useState(false)
  const [loginCms, setLoginCms] = useState(null)
  // Sidebar come drawer off-canvas sotto md — chiusa di default, aperta
  // dall'hamburger nella barra in alto (nascosto sopra md, dove la sidebar è
  // sempre visibile come prima).
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  const loadModules = async () => {
    if (!token) return
    try {
      const res = await fetch(API + '/modules/installed', { headers: { Authorization: 'Bearer ' + token } })
      notifyUnauthorized(res)
      if (res.ok) {
        const data = await res.json()
        setInstalledModules(data)
        return
      }
    } catch (e) {
      // rete assente: la sidebar resta com'è
    }
  }

  // White-label minimo (2026-08-14): stesso endpoint pubblico già usato per il
  // nome tenant, esteso con logo_url/accent_color. Il colore va applicato come
  // tripletta RGB (formato richiesto da withOpacity in tailwind.config.js, non
  // esadecimale) — hex2rgbTriplet converte solo se il tenant ne ha scelto uno,
  // altrimenti resta il default già in index.css (nessuna scrittura = nessun
  // cambiamento).
  const hex2rgbTriplet = (hex) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '')
    if (!m) return null
    const n = parseInt(m[1], 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(' ')
  }

  const loadTenantName = async () => {
    const res = await fetch(API + '/tenant-info')
    if (!res.ok) return
    const data = await res.json()
    setTenantName(data.name || '')
    setFeatures(data.features || {})
    setAiOn(!!data.ai)
    setTenantLogoUrl((data.logo_url || ''))
    setHidePlatformName(!!data.hide_platform_name)
    setLoginCms(data.login_headline ? {
      headline: data.login_headline,
      subheadline: data.login_subheadline || '',
      body: data.login_body || '',
      heroImageUrl: (data.login_hero_image_url || ''),
    } : null)
    const triplet = hex2rgbTriplet(data.accent_color)
    if (triplet) document.documentElement.style.setProperty('--accent', triplet)
    document.title = data.name ? data.name + ' — Platform' : 'Platform'
  }

  useEffect(() => { loadModules() }, [token])
  useEffect(() => { loadTenantName() }, [])

  const logout = () => {
    clearAuth()
    setToken(null)
    setUser(null)
  }

  // Login automatico da Super Admin ("Apri →" su un tenant, vedi TenantsPage.jsx):
  // apre questa app con ?token=... in query string invece del solito form di
  // login. Verificato con GET /auth/me (non ci si fida del contenuto del JWT senza
  // controllarlo lato server) prima di considerarlo una sessione valida, poi
  // ripulito subito dalla barra indirizzi — non deve restare in cronologia/preferiti.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const urlToken = params.get('token')
    if (!urlToken) return
    fetch(API + '/auth/me', { headers: { Authorization: 'Bearer ' + urlToken } })
      .then((res) => (res.ok ? res.json() : null))
      .then((me) => {
        if (!me) return
        const u = { id: me.id, username: me.username, role: me.role, display_name: me.display_name, linked_module_slug: me.linked_module_slug, linked_record_id: me.linked_record_id }
        setAuth(urlToken, u)
        setToken(urlToken)
        setUser(u)
      })
      .finally(() => {
        const url = new URL(window.location.href)
        url.searchParams.delete('token')
        window.history.replaceState({}, '', url.toString())
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Token scaduto/non valido (401 su una qualunque chiamata autenticata, vedi
  // lib/api.js) -> logout automatico invece di lasciare l'app con dati vuoti e
  // nessuna spiegazione del perché.
  useEffect(() => {
    const handler = () => {
      logout()
      window.dispatchEvent(new CustomEvent('platform:toast', { detail: { message: 'Sessione scaduta — effettua di nuovo l\'accesso', type: 'error' } }))
    }
    window.addEventListener('platform:unauthorized', handler)
    return () => window.removeEventListener('platform:unauthorized', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onLogin = (t, u) => { setToken(t); setUser(u) }


  if (!token) return <Login onLogin={onLogin} tenantName={tenantName} logoUrl={tenantLogoUrl} hidePlatformName={hidePlatformName} cms={loginCms} />

  const currentModule = installedModules.find((m) => m.slug === currentPage)
  const allModulesForBuilder = installedModules

  return (
    <div className="flex min-h-screen bg-surface-page">
      <Sidebar modules={installedModules} currentPage={currentPage} onNavigate={setCurrentPage} user={user} onLogout={logout} tenantName={tenantName} logoUrl={tenantLogoUrl} hidePlatformName={hidePlatformName} features={features} token={token}
        mobileOpen={mobileNavOpen} onMobileClose={() => setMobileNavOpen(false)} collapsed />
      <main className="md:ml-14 flex-1 min-w-0">
        <div className="sticky top-0 z-20 bg-surface-page/90 backdrop-blur-sm border-b border-gray-800/50 px-4 md:px-8 py-3 flex items-center justify-between md:justify-end gap-3" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}>
          <button onClick={() => setMobileNavOpen(true)} className="md:hidden text-gray-400 hover:text-ink transition flex-shrink-0" title="Apri menu">
            <Icon name="menu" size={20} />
          </button>
          <div className="flex items-center gap-4">
            {aiOn && user && user.role === 'admin' && <AskData token={token} />}
            <GlobalSearch token={token} modules={installedModules} onNavigate={setCurrentPage} />
          </div>
        </div>
        <div className="p-4 md:p-8">
        {currentPage === 'dashboard' && <DashboardPage user={user} modules={installedModules} token={token} features={features} onNavigate={setCurrentPage} />}
        {currentPage === 'report' && <DashboardPage user={user} modules={installedModules} token={token} page="report" />}
        {currentPage === 'movimenti' && user && user.role === 'admin' && features.movimenti && <MovimentiPage token={token} />}
        {currentPage === 'libreria' && user && user.role === 'admin' && <LibreriaPage token={token} onFeaturesChanged={loadTenantName} onRefresh={loadModules} onOpenInBuilder={openInBuilder} onCreateNewModule={openBuilderNewModule} />}
        {currentPage === 'builder' && user && user.role === 'admin' && <BuilderPage token={token} allModules={allModulesForBuilder} onModulesChanged={loadModules} preselectSlug={builderPreselect} onPreselectHandled={() => setBuilderPreselect(null)} openNewModule={builderOpenNew} onNewModuleHandled={() => setBuilderOpenNew(false)} />}
        {currentPage === 'guida' && <GuidaPage modules={installedModules} token={token} />}
        {/* Export e Backup uniti (2026-08-29): un solo tab-set dentro ExportDatiPage,
            Backup resta un tab admin-only al suo interno — stesso gate di prima, solo
            spostato dentro il componente invece che qui. */}
        {currentPage === 'audit' && <AuditPage token={token} />}
        {/* Impostazioni e "Il mio account" uniti (2026-08-29): stessa
            pagina, non più admin-gated qui — un non-admin ci arriva comunque
            ma vede solo il tab "Il mio account" (filtrato dentro
            ImpostazioniPage), nessuna delle altre impostazioni tenant-wide
            che erano già admin-only.
            Sito Web rinestato dentro Impostazioni (2026-10-01) — era già
            stato provato e poi riportato a voce Sidebar a sé il 2026-09-05
            stesso per darle visibilità da menu principale; richiesto di
            nuovo esplicitamente dall'utente, stavolta come scelta definitiva.
            'sito_web' qui sotto instrada sullo stesso meccanismo di 'account'
            sopra, solo con un tab diverso. */}
        {(currentPage === 'impostazioni' || currentPage === 'account' || currentPage === 'sito_web' || currentPage === 'export_dati' || currentPage === 'connessioni') && user &&
          <ImpostazioniPage token={token} user={user} features={features} modules={installedModules} onOpenInBuilder={openInBuilder} onFeaturesChanged={loadTenantName} initialTab={currentPage === 'impostazioni' ? undefined : currentPage} />}
        {currentModule && !['dashboard', 'utenti', 'report'].includes(currentPage) && <ModulePage module={currentModule} token={token} user={user} onNavigate={setCurrentPage} />}
        </div>
      </main>
      <ToastContainer />
      {token && user && <SetupWizard token={token} user={user} onNavigate={setCurrentPage} onOpenBuilderNewModule={openBuilderNewModule} />}
    </div>
  )
}
