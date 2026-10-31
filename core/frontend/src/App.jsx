import React, { useState, useEffect } from 'react'
import { API, notifyUnauthorized, setAuth, clearAuth } from './lib/api'

import Login from './components/Login'
import Sidebar from './components/Sidebar'
import Icon from './components/Icon'
import AskData from './components/AskData'
import GlobalSearch from './components/GlobalSearch'
import DashboardPage from './pages/DashboardPage'
import LibreriaPage from './pages/LibreriaPage'
import BuilderPage from './pages/BuilderPage'
import SetupWizard from './components/SetupWizard'
import ProductTour from './components/ProductTour'
import { ONBOARDING_STEPS } from './components/onboardingSteps'
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

// GlobalSearch spostata in ./components/GlobalSearch.jsx (2026-10-31) — vive ora dentro il
// pannello "Altro" del dock, non più nella testa della pagina (richiesto dall'utente dopo
// aver visto un launcher macOS: "ricerca in alto, togliendola dalla testa della pagina").

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
  // Sidebar come drawer off-canvas sotto md — chiusa di default, aperta
  // dall'hamburger nella barra in alto (nascosto sopra md, dove la sidebar è
  // sempre visibile come prima).
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [showTour, setShowTour] = useState(false) // il giro guidato: parte a richiesta, mai da solo
  const finishTour = () => { setShowTour(false); setMobileNavOpen(false); setCurrentPage('dashboard') }

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


  if (!token) return <Login onLogin={onLogin} tenantName={tenantName} logoUrl={tenantLogoUrl} hidePlatformName={hidePlatformName} />

  const currentModule = installedModules.find((m) => m.slug === currentPage)
  const allModulesForBuilder = installedModules

  return (
    <div className="flex min-h-screen bg-surface-page">
      <Sidebar modules={installedModules} currentPage={currentPage} onNavigate={setCurrentPage} user={user} onLogout={logout} tenantName={tenantName} logoUrl={tenantLogoUrl} hidePlatformName={hidePlatformName} features={features} token={token}
        mobileOpen={mobileNavOpen} onMobileClose={() => setMobileNavOpen(false)} collapsed />
      {/* "Liquid Glass" (2026-10-31): la sidebar non è più una rail fissa a sinistra (il dock
          flottante in basso non riserva spazio), tolto md:ml-14 di prima. */}
      {/* env(safe-area-inset-top) qui, sempre (0 su desktop/senza notch, innocuo) — prima
          viveva solo nel padding della barra sticky sopra: ora che quella barra può non
          esserci affatto, lo spazio per la notch va garantito indipendentemente da lei. */}
      <main className="flex-1 min-w-0" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        {/* "Liquid Glass" (2026-10-31) — su Dashboard/Report questa barra sticky creava una
            cucitura visibile contro lo sfondo sfumato sotto: tolto il bordo e abbassata
            l'opacità non è bastato (segnalato dal vivo due volte, "impresentabile questa
            linea") — qualunque sfondo proprio, per quanto tenue, segna comunque un confine
            netto nel punto esatto in cui finisce. Niente sfondo e niente sfocatura propria:
            su queste due pagine resta solo un contenitore per gli elementi (la ricerca ha già
            il suo sfondo a pillola), il vetro sotto non incontra nessun bordo. Sulle altre
            pagine resta come sempre. */}
        {/* L'hamburger è sparito (richiesto dal vivo, "non voglio vedere le linee in alto a
            sinistra da mobile"): era ridondante col pulsante "Altro" del dock, che apre lo
            stesso pannello. La ricerca vive nel pannello "Altro" (Sidebar.jsx), non più qui.
            Niente più barra sticky quando non c'è nulla da mostrarci (solo "Chiedi ai dati",
            admin+AI accesa) — recupera lo spazio vuoto segnalato in cima alla pagina; lo
            spazio per la notch (safe-area-inset-top) si sposta sul contenuto sotto, così resta
            protetto anche senza la barra. */}
        {aiOn && user && user.role === 'admin' && (
          /* Niente più safe-area qui dentro: la riserva lo spazio della notch, una volta
             sola, <main> stesso adesso (sopra) — altrimenti si sommerebbe due volte. */
          <div className={'sticky top-0 z-20 px-4 md:px-8 py-3 flex items-center justify-end gap-3 ' + (['dashboard', 'report'].includes(currentPage) ? '' : 'bg-surface-page/90 backdrop-blur-sm border-b border-gray-800/50')}>
            <AskData token={token} glass={['dashboard', 'report'].includes(currentPage)} />
          </div>
        )}
        {/* pb-28: il dock flottante in basso non deve coprire l'ultimo pezzo di pagina. */}
        <div className="p-4 md:p-8 pb-28">
        {currentPage === 'dashboard' && <DashboardPage user={user} modules={installedModules} token={token} features={features} onNavigate={setCurrentPage} />}
        {currentPage === 'report' && <DashboardPage user={user} modules={installedModules} token={token} page="report" />}
        {currentPage === 'libreria' && user && user.role === 'admin' && <LibreriaPage token={token} onFeaturesChanged={loadTenantName} onRefresh={loadModules} onOpenInBuilder={openInBuilder} onCreateNewModule={openBuilderNewModule} />}
        {currentPage === 'builder' && user && user.role === 'admin' && <BuilderPage token={token} allModules={allModulesForBuilder} onModulesChanged={loadModules} preselectSlug={builderPreselect} onPreselectHandled={() => setBuilderPreselect(null)} openNewModule={builderOpenNew} onNewModuleHandled={() => setBuilderOpenNew(false)} />}
        {currentPage === 'guida' && <GuidaPage modules={installedModules} token={token} onStartTour={() => setShowTour(true)} />}
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
        {(currentPage === 'impostazioni' || currentPage === 'account' || currentPage === 'sito_web' || currentPage === 'export_dati' || currentPage === 'connessioni' || currentPage === 'movimenti') && user &&
          <ImpostazioniPage token={token} user={user} features={features} modules={installedModules} onOpenInBuilder={openInBuilder} onCreateNewModule={openBuilderNewModule} onFeaturesChanged={loadTenantName} initialTab={currentPage === 'impostazioni' ? undefined : currentPage} />}
        {currentModule && !['dashboard', 'utenti', 'report'].includes(currentPage) && <ModulePage module={currentModule} token={token} user={user} onNavigate={setCurrentPage} />}
        </div>
      </main>
      <ToastContainer />
      {token && user && <SetupWizard token={token} user={user} onNavigate={setCurrentPage} onOpenBuilderNewModule={openBuilderNewModule} onStartTour={() => setShowTour(true)} />}
      {showTour && (
        <ProductTour steps={ONBOARDING_STEPS} currentPage={currentPage} onNavigate={setCurrentPage} onFinish={finishTour}
          onStepChange={(step) => setMobileNavOpen(window.innerWidth < 768 && !!step.target && step.target.startsWith('sidebar'))} />
      )}
    </div>
  )
}
