import React, { useState, useEffect } from 'react'
import { API } from './lib/api'
import LoginModal from './components/Home/LoginModal'
import Sidebar from './components/Sidebar'
import Topbar from './components/Topbar'
import Icon from './components/Icon'
import DashboardPage from './pages/DashboardPage'
import TenantsPage from './pages/TenantsPage'
import LibreriaPage from './pages/LibreriaPage'
import ActivityPage from './pages/ActivityPage'
import UsersPage from './pages/UsersPage'
import TenantBuilderPage from './pages/TenantBuilderPage'
import UpdateManagerPage from './pages/UpdateManagerPage'
import SettingsPage from './pages/SettingsPage'
import AnalyticsPage from './pages/AnalyticsPage'
import GuidaPage from './pages/GuidaPage'

// Semplificazione 2026-09-27: Platform torna a essere un side project a uso
// personale — rimossi il Partner Portal, il CRM (Clienti/Clienti Core) e
// fatturazione/licenze, tutti pensati per una scala commerciale con
// rivenditori terzi mai perseguita. Un solo pannello (admin.platform-core.it),
// un solo utente, un'unica modalità: niente più `mode`/host-detection.
// Il payload di un JWT non è cifrato, solo base64url — decodificarlo qui non
// serve più a decidere una modalità (rimossa), resta solo per mostrare
// username/ruolo nella sidebar. L'enforcement vero resta lato server su ogni
// singola route.
function decodeJwtPayload(token) {
  try {
    return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
  } catch (e) {
    return null
  }
}
const DEFAULT_PAGE = 'dashboard'

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('sa_token'))

  // Login automatico da "Apri →" su PartnersPage.jsx (2026-08-31), stesso identico
  // meccanismo già in uso su core/frontend/src/App.jsx per i tenant: apre questa app
  // con ?token=... invece del solito form di login. Verificato con GET /auth/me (mai
  // fidarsi del contenuto del JWT senza controllo server) prima di considerarlo valido,
  // poi ripulito subito dalla barra indirizzi — non deve restare in cronologia/preferiti.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const urlToken = params.get('token')
    if (!urlToken) return
    fetch(API + '/auth/me', { headers: { Authorization: 'Bearer ' + urlToken } })
      .then((res) => (res.ok ? res.json() : null))
      .then((me) => {
        if (!me) return
        localStorage.setItem('sa_token', urlToken)
        setToken(urlToken)
      })
      .finally(() => {
        const url = new URL(window.location.href)
        url.searchParams.delete('token')
        window.history.replaceState({}, '', url.toString())
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const payload = token ? decodeJwtPayload(token) : null
  const [page, setPage] = useState(DEFAULT_PAGE)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  // PLATFORM-UI-REDESIGN-CATALOG.md #27 — "vedi log attività di questo tenant"
  // da TenantsPage.jsx: naviga alla pagina Attività già esistente, pre-filtrata
  // sul suo `tenant_name`, invece di duplicare il feed dentro il pannello
  // Tenant (il filtro per-tenant su quella pagina esisteva già, mancava solo
  // un modo per arrivarci con un click invece che dal menu a tendina).
  const [activityTenantFilter, setActivityTenantFilter] = useState('')
  const viewTenantActivity = (tenantName) => { setActivityTenantFilter(tenantName); setPage('attivita') }
  // "Crea questo modulo" da un processo senza copertura (2026-09-08,
  // ClientCard.jsx/ProcessoEditor.jsx) — stesso pattern di supportPrefill
  // sopra: apre Super Builder col pannello AI già pronto invece di lasciare
  // l'utente a ridigitare nome/descrizione da zero.
  const [builderPrefill, setBuilderPrefill] = useState(null)
  const openBuilderWithPrefill = (prefill) => { setBuilderPrefill(prefill); setPage('super-builder') }
  useEffect(() => {
    if (page !== 'super-builder' && builderPrefill) setBuilderPrefill(null)
  }, [page]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    document.title = 'Platform Admin'
  }, [])

  const logout = () => {
    localStorage.removeItem('sa_token')
    setToken(null)
  }

  // Fallimento silenzioso, parte 2 (vedi lib/api.js per il dettaglio) — qui
  // si reagisce ai due eventi che ogni fetch fallita ormai emette. Un 401
  // non deve più lasciare una pagina vuota che sembra "0 dati": riporta
  // subito al login, che è la causa reale in quasi tutti i casi visti in
  // sessione (token scaduto). Qualunque altro errore su un caricamento in
  // background mostra un avviso che sparisce da solo — non blocca nulla,
  // serve solo a non far scambiare "il server non risponde" per "non c'è
  // niente da vedere".
  const [loadError, setLoadError] = useState(null)
  useEffect(() => {
    const onUnauthorized = () => logout()
    const onLoadError = () => {
      setLoadError('Errore di rete — impossibile caricare alcuni dati. Riprova.')
      clearTimeout(onLoadError._t)
      onLoadError._t = setTimeout(() => setLoadError(null), 5000)
    }
    window.addEventListener('platform:unauthorized', onUnauthorized)
    window.addEventListener('platform:load-error', onLoadError)
    return () => {
      window.removeEventListener('platform:unauthorized', onUnauthorized)
      window.removeEventListener('platform:load-error', onLoadError)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Brochure (HomePage.jsx) temporaneamente sospesa su richiesta esplicita —
  // solo il login, nessuna pagina marketing davanti. Codice della brochure
  // lasciato intatto per un ripristino futuro, non cancellato.
  if (!token) return (
    <div className="min-h-screen bg-surface-page">
      <LoginModal onLogin={setToken} onClose={() => {}} />
    </div>
  )

  return (
    <div className="flex min-h-screen bg-surface-page">
      {loadError && (
        <div className="fixed bottom-4 right-4 z-50 bg-red-900/90 border border-red-800 text-red-200 text-sm px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 max-w-sm">
          <Icon name="x" size={14} className="flex-shrink-0" />
          {loadError}
        </div>
      )}
      <Sidebar page={page} onNavigate={setPage} onLogout={logout}
        mobileOpen={mobileNavOpen} onMobileClose={() => setMobileNavOpen(false)}
        payload={payload} token={token} />
      <main className="md:ml-14 flex-1 min-w-0">
        <Topbar payload={payload} page={page} onNavigate={setPage} onLogout={logout} onOpenMobileMenu={() => setMobileNavOpen(true)} token={token} />
        <div className="p-4 md:p-8">
          {page === 'dashboard' && <DashboardPage token={token} onNavigate={setPage} />}
          {page === 'tenants' && <TenantsPage token={token} onViewActivity={viewTenantActivity} onNavigate={setPage} />}
          {page === 'libreria' && <LibreriaPage token={token} />}
          {page === 'super-builder' && <TenantBuilderPage token={token} initialPrompt={builderPrefill?.prompt} initialModuleName={builderPrefill?.moduleName} />}
          {page === 'update-manager' && <UpdateManagerPage token={token} />}
          {page === 'attivita' && <ActivityPage token={token} initialTenantFilter={activityTenantFilter} />}
          {page === 'analytics' && <AnalyticsPage token={token} />}
          {page === 'impostazioni' && <SettingsPage token={token} />}
          {page === 'guida' && <GuidaPage token={token} />}
          {page === 'users' && <UsersPage token={token} />}
        </div>
      </main>
    </div>
  )
}
