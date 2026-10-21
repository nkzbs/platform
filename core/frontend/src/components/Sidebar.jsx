import React, { useState, useEffect, useRef } from 'react'
import Icon from './Icon'
import PlatformLogo from './PlatformLogo'
import { API, notifyUnauthorized } from '../lib/api'

function Sidebar({ modules, currentPage, onNavigate, user, onLogout, tenantName, logoUrl, hidePlatformName, features = {}, token, mobileOpen, onMobileClose, collapsed }) {
  // Sotto md: la sidebar è un drawer off-canvas (nascosta di default, aperta
  // dall'hamburger in App.jsx) — sopra md: resta sempre visibile come oggi.
  // Navigare chiude il drawer su mobile, altrimenti coprirebbe il contenuto
  // appena aperto.
  const handleNavigate = (slug) => {
    onNavigate(slug)
    if (onMobileClose) onMobileClose()
  }
  // "Stretta sempre, ma dinamica" (richiesto dall'utente): a riposo è solo
  // icone, ma si allarga al passaggio del mouse invece di restare bloccata —
  // fixed, quindi l'espansione COPRE il contenuto (nessun reflow della
  // pagina, <main> resta sempre con lo stesso margine stretto). Si richiude
  // da sola appena il mouse esce, nessuno stato da ricordare.
  const [hovered, setHovered] = useState(false)
  const expanded = !collapsed || hovered
  // Tema chiaro/scuro — persistito per utente del browser (non per tenant/account),
  // "per comodità" come richiesto: resta possibile tornare al tema scuro in un click.
  // Applicato via attributo su <html> così ogni classe gray-*/surface-*/text-ink
  // già usata in tutti i componenti (vedi tailwind.config.js + index.css) si aggiorna
  // da sola, senza dover ripassare esplicitamente un tema a ogni pagina.
  const [theme, setTheme] = useState(() => localStorage.getItem('platform_theme') || 'dark')
  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    localStorage.setItem('platform_theme', next)
    if (next === 'light') document.documentElement.setAttribute('data-theme', 'light')
    else document.documentElement.removeAttribute('data-theme')
  }

  const [pwOpen, setPwOpen] = useState(false)
  const [pwForm, setPwForm] = useState({ current_password: '', new_password: '' })
  const [pwError, setPwError] = useState('')
  const [pwSaving, setPwSaving] = useState(false)

  const [notifications, setNotifications] = useState([])
  const [notifOpen, setNotifOpen] = useState(false)
  const notifRef = useRef(null)

  const loadNotifications = async () => {
    try {
      const res = await fetch(API + '/notifications', { headers: { Authorization: 'Bearer ' + token } })
      notifyUnauthorized(res)
      if (res.ok) setNotifications(await res.json())
    } catch {}
  }

  useEffect(() => {
    loadNotifications()
    const interval = setInterval(loadNotifications, 30000)
    return () => clearInterval(interval)
  }, [token])

  useEffect(() => {
    const handler = (e) => { if (notifRef.current && !notifRef.current.contains(e.target)) setNotifOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const markAllRead = async () => {
    await fetch(API + '/notifications/read-all', { method: 'POST', headers: { Authorization: 'Bearer ' + token } })
    setNotifications((p) => p.map((n) => ({ ...n, read: 1 })))
  }

  const clearRead = async () => {
    await fetch(API + '/notifications', { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } })
    setNotifications((p) => p.filter((n) => !n.read))
  }

  const unreadCount = notifications.filter((n) => !n.read).length

  const changePassword = async () => {
    if (!pwForm.current_password || !pwForm.new_password) { setPwError('Compila tutti i campi'); return }
    setPwSaving(true); setPwError('')
    const res = await fetch(API + '/users/me/change-password', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(pwForm),
    })
    const data = await res.json()
    setPwSaving(false)
    if (!res.ok) { setPwError(data.error || 'Errore'); return }
    setPwOpen(false)
    setPwForm({ current_password: '', new_password: '' })
    window.dispatchEvent(new CustomEvent('platform:toast', { detail: { message: 'Password aggiornata', type: 'success' } }))
  }

  // 'Automazioni' non è più una voce a sé: ogni automazione vive dentro il modulo a cui
  // appartiene (blocco nel Builder), coerente con "ogni modulo ha la propria
  // integrazione e automazione" — averle come voce globale non era comodo da navigare.
  // 'Connessioni' non è più una voce a sé nemmeno lei: le credenziali sono per tenant
  // (non per modulo), ma la pagina dedicata era comunque innaturale rispetto allo
  // standard modulare — ora vive dentro Store (sezione Connettori in fondo + stato
  // inline su ogni modulo che dichiara requires_connection nel Builder).
  const systemItems = []
  // Strumenti della piattaforma generica — nico non li ha (non è multi-tenant/
  // schema-driven), quindi non c'è un punto "corretto" dove metterli rispetto al
  // suo menu: restano in un blocco a parte sotto ai gruppi, prima di Utenti/Backup
  // che invece in nico sono proprio in fondo.
  // Contenuto tutto lato Builder (campi, relazioni, workflow, automazioni...): un
  // utente 'user' non ha né Store né Builder, quindi non ha nulla a cui applicarlo.
  // "Guida" tolta (2026-08-31, richiesto esplicitamente dall'utente — "la voglio
  // rifare meglio"): GuidaPage.jsx NON cancellata, solo non più raggiungibile
  // finché non viene ricostruita.
  // "Assistenza" rimossa per intero (2026-10-02, richiesto esplicitamente
  // dall'utente, sia qui che lato Super Admin — 0 ticket mai aperti).
  // 'Report' non è più qui: era un modulo generico (widget configurabili, stesso
  // motore della Dashboard) forzato in questo blocco fisso da admin, sempre
  // visibile a chiunque senza poter essere disinstallato/riordinato — sbagliato
  // per qualcosa che è a tutti gli effetti un modulo. Ora è una riga vera in
  // `modules` come qualunque altra, installabile/disinstallabile dallo Store
  // (registro Super Admin, slug 'report') e già dentro l'array `modules` sopra:
  // compare tra i moduli normali, con la sua `sort_order` e il suo `group_name`.
  // Export dati non è più una voce di menu: vive in Impostazioni → Export dati (stesso accesso di prima: tutti tranne l'agente).
  // Store/Builder/Connessioni/Utenti/Backup/Log/Impostazioni: già protetti lato backend
  // (requireAdmin sulle rotte che contano — schema-cache, registry, credenziali...), ma
  // fino ad ora comparivano comunque nel menu di QUALUNQUE utente autenticato, non solo
  // admin. Un ruolo Agente li vedeva e ci cliccava dentro per poi trovarsi pagine che
  // falliscono silenziosamente sulle chiamate API (403) — nessuna fuga di dati, ma un
  // menu che promette funzioni a cui l'utente non ha davvero accesso.
  if (user && user.role === 'admin') {
    if (features.movimenti) systemItems.push({ slug: 'movimenti', name: 'Movimenti', icon: 'credit-card' })
    systemItems.push({ slug: 'libreria', name: 'Libreria', icon: 'store' })
    systemItems.push({ slug: 'builder', name: 'Builder', icon: 'tool' })
    // Sito Web nestato dentro Impostazioni (2026-10-01, richiesto
    // esplicitamente dall'utente come scelta definitiva) — niente più voce
    // Sidebar a sé, vive come tab in ImpostazioniPage.jsx accanto a
    // Moduli/Connessioni. Era già stato provato il 2026-09-05 e riportato qui
    // lo stesso giorno perché nel frattempo era cresciuto a un vero
    // page-builder (nesting, stile, animazioni, popup, canvas WYSIWYG) —
    // quella preoccupazione resta valida (è ancora un editor grande), ma
    // stavolta la richiesta è esplicita e non va ribaltata senza richiedere.
    systemItems.push({ slug: 'audit', name: 'Log attività', icon: 'list' })
    // Backup non è più una voce a sé (2026-08-29, richiesto esplicitamente
    // dall'utente) — vive come tab dentro Export dati (ExportDatiPage.jsx),
    // stesso gate admin-only di prima ma applicato dentro il componente.
    // Utenti & Ruoli non è più una voce a sé — vive come tab dentro Impostazioni
    // (ImpostazioniPage.jsx), insieme ai dati azienda e all'ordine/visibilità moduli.
    systemItems.push({ slug: 'impostazioni', name: 'Impostazioni', icon: 'settings' })
    // Guida ripristinata (2026-09-07) — tolta il 31/8 "la rifaccio meglio",
    // mai rifatta nel frattempo: il contenuto (Percorso guidato/Riferimento/
    // I tuoi moduli, 903 righe) era comunque già completo e mai raggiungibile
    // da nessuna parte. Ripristinata così com'era, non riscritta — questo
    // lavoro (tour di onboarding al primo accesso) la rende il posto naturale
    // dove approfondire dopo, non un sostituto.
    systemItems.push({ slug: 'guida', name: 'Guida', icon: 'info' })
  }

  return (
    <>
      {mobileOpen && (
        <div className="fixed inset-0 bg-black/60 z-30 md:hidden" onClick={onMobileClose} />
      )}
      <div onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
        className={(expanded ? 'w-56' : 'w-14') + ' bg-surface-card border-r border-gray-800 flex flex-col fixed inset-y-0 left-0 z-40 transition-[width,transform] duration-150 md:translate-x-0 ' + (expanded ? 'shadow-2xl' : '') + ' ' + (mobileOpen ? 'translate-x-0' : '-translate-x-full')}>
      <div className={(expanded ? 'px-5' : 'px-3') + ' py-5 border-b border-gray-800'} style={{ paddingTop: 'max(1.25rem, env(safe-area-inset-top))' }}>
        <div className="flex items-center gap-2.5">
          {/* Stessa logica corretta di Login.jsx (2026-08-29): il badge a lettera
              solo per il white-label completo (hidePlatformName), altrimenti il
              marchio Platform vero — prima spariva per quasi ogni tenant. */}
          {logoUrl ? <img src={logoUrl} alt="" className="w-[26px] h-[26px] rounded-md object-contain flex-shrink-0" /> : <PlatformLogo size={26} letter={hidePlatformName && tenantName ? tenantName.trim()[0] : undefined} />}
          {expanded && (
            <div>
              <div className="text-base text-ink tracking-tight">
                {hidePlatformName && tenantName
                  ? <span className="font-bold">{tenantName}</span>
                  : <>
                      <span className="font-bold">Platform</span>{tenantName && <span className="font-normal"> {tenantName}</span>}
                    </>
                }
              </div>
              {/* Numero di versione della piattaforma nel suo complesso, annotato a mano
                  ad ogni chiusura di fase (0.1.1, 0.1.2, 0.1.3...) — non il version del
                  package.json (quello è per app/build), stesso numero mostrato nella
                  sidebar di Super Admin. Nascosto insieme al nome quando il tenant
                  ha attivato hide_platform_name: è comunque testo "Platform" rivolto
                  all'utente del tenant white-label. */}
              {!hidePlatformName && <div className="text-xs text-gray-500">Platform 0.3.8</div>}
            </div>
          )}
        </div>
      </div>
      <nav data-tour="sidebar-nav" className="flex-1 min-h-0 overflow-y-auto py-3">
        {(() => {
          // Le pagine virtuali di "Generale" vanno PRIMA dei moduli reali (così quel
          // gruppo è il primo incontrato, subito dopo Dashboard, come in nico); quelle
          // di "Amministrazione" vanno DOPO (si accodano alla sezione Amministrazione
          // già esistente dai moduli reali, stesso group_name = stessa intestazione,
          // nessun secondo blocco duplicato).
          const visible = modules
          // Ordine delle sezioni = ordine di primo incontro scorrendo i moduli (già
          // ordinati per sort_order dal backend) — niente da configurare a parte, la
          // sezione appare dove appare per primo il modulo con priorità più alta.
          // I moduli senza group_name restano in cima, senza intestazione, come oggi.
          const senzaGruppo = visible.filter((m) => !m.group_name)
          const conGruppo = visible.filter((m) => m.group_name)
          const gruppi = []
          conGruppo.forEach((m) => { if (!gruppi.includes(m.group_name)) gruppi.push(m.group_name) })
          const renderItem = (m) => (
            <button key={m.slug} data-tour={'sidebar-' + m.slug} onClick={() => handleNavigate(m.slug)} title={!expanded ? m.name : undefined}
              className={'w-full flex items-center gap-3 py-2.5 text-sm transition ' + (!expanded ? 'justify-center px-2' : 'px-4') + ' ' + (currentPage === m.slug ? 'bg-accent/20 text-accent border-r-2 border-accent' : 'text-gray-400 hover:text-ink hover:bg-white/5')}>
              <span style={{ color: currentPage === m.slug ? '#60A5FA' : m.color }}><Icon name={m.icon} size={16} /></span>
              {expanded && m.name}
            </button>
          )
          return (
            <>
              {senzaGruppo.map(renderItem)}
              {gruppi.map((g) => (
                <div key={g} className="mt-2">
                  {expanded && <div className="px-4 pt-2 pb-1 text-[10px] font-semibold text-gray-600 uppercase tracking-wider">{g}</div>}
                  {conGruppo.filter((m) => m.group_name === g).map(renderItem)}
                </div>
              ))}
            </>
          )
        })()}
        <div className="mt-3 pt-3 border-t border-gray-800">
          {systemItems.map((item) => (
            <button key={item.slug} data-tour={'sidebar-' + item.slug} onClick={() => handleNavigate(item.slug)} title={!expanded ? item.name : undefined}
              className={'w-full flex items-center gap-3 py-2.5 text-sm transition ' + (!expanded ? 'justify-center px-2' : 'px-4') + ' ' + (currentPage === item.slug ? 'bg-accent/20 text-accent border-r-2 border-accent' : 'text-gray-400 hover:text-ink hover:bg-white/5')}>
              <Icon name={item.icon} size={16} />
              {expanded && item.name}
            </button>
          ))}
        </div>
      </nav>
      <div className={(expanded ? 'px-4' : 'px-2') + ' py-3 border-t border-gray-800 flex-shrink-0'} style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
        <div className={!expanded ? 'flex flex-col items-center gap-3' : 'flex items-center justify-between'}>
          {expanded && (
            <button onClick={() => handleNavigate('account')} className="text-left hover:opacity-80 transition" title="Il mio account">
              <div className="text-sm text-ink font-medium">{user && user.display_name}</div>
              <div className="text-xs text-gray-500">{user && user.role}</div>
            </button>
          )}
          {!expanded && (
            <button onClick={() => handleNavigate('account')} className="w-7 h-7 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-gray-400 hover:text-ink transition" title={(user && user.display_name) || 'Il mio account'}>
              <Icon name="user" size={13} />
            </button>
          )}
          <div className={!expanded ? 'flex flex-col items-center gap-3' : 'flex items-center gap-3'}>
            <div className="relative" ref={notifRef}>
              <button onClick={() => setNotifOpen((s) => !s)} className="relative text-gray-500 hover:text-ink transition" title="Notifiche">
                <Icon name="bell" size={15} />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-accent text-white text-[8px] rounded-full flex items-center justify-center font-bold leading-none">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>
              {notifOpen && (
                <div className="absolute bottom-8 left-0 w-72 bg-surface-card border border-gray-700 rounded-xl shadow-xl z-50 overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800">
                    <span className="text-xs font-semibold text-ink">Notifiche</span>
                    <div className="flex gap-2">
                      {unreadCount > 0 && <button onClick={markAllRead} className="text-[10px] text-accent hover:opacity-80 transition">Segna tutte lette</button>}
                      <button onClick={clearRead} className="text-[10px] text-gray-500 hover:text-gray-300 transition">Pulisci lette</button>
                    </div>
                  </div>
                  <div className="max-h-64 overflow-y-auto">
                    {notifications.length === 0 ? (
                      <div className="text-xs text-gray-600 text-center py-6">Nessuna notifica</div>
                    ) : notifications.map((n) => (
                      <div key={n.id} className={'px-3 py-2.5 border-b border-gray-800/60 ' + (n.read ? 'opacity-50' : '')}>
                        <div className="flex items-start gap-2">
                          {!n.read && <div className="w-1.5 h-1.5 rounded-full bg-accent mt-1.5 flex-shrink-0" />}
                          {n.read && <div className="w-1.5 h-1.5 flex-shrink-0" />}
                          <div className="flex-1 min-w-0">
                            <div className="text-xs text-gray-300 leading-snug">{n.message}</div>
                            {n.module_slug && <div className="text-[10px] text-gray-600 mt-0.5">{n.module_slug}{n.record_id ? ' #' + n.record_id : ''}</div>}
                            <div className="text-[10px] text-gray-700 mt-0.5">{new Date(n.created_at).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <button onClick={toggleTheme} className="text-gray-500 hover:text-ink transition" title={theme === 'dark' ? 'Passa al tema chiaro' : 'Passa al tema scuro'}>
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={15} />
            </button>
            <button onClick={() => setPwOpen(true)} className="text-gray-500 hover:text-ink transition" title="Cambia password">
              <Icon name="key" size={15} />
            </button>
            <button onClick={onLogout} className="text-gray-500 hover:text-ink transition">
              <Icon name="logout" size={16} />
            </button>
          </div>
        </div>
      </div>

      {pwOpen && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-surface-card rounded-md p-6 w-full max-w-sm border border-gray-800">
            <h2 className="text-base font-bold text-ink mb-4">Cambia password</h2>
            <div className="space-y-3 mb-5">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Password attuale</label>
                <input type="password" autoComplete="current-password"
                  className="w-full bg-surface-page text-ink px-4 py-3 rounded-lg text-sm outline-none border border-gray-800 focus:border-accent transition"
                  value={pwForm.current_password} onChange={(e) => setPwForm({ ...pwForm, current_password: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Nuova password (min. 8 caratteri)</label>
                <input type="password" autoComplete="new-password"
                  className="w-full bg-surface-page text-ink px-4 py-3 rounded-lg text-sm outline-none border border-gray-800 focus:border-accent transition"
                  value={pwForm.new_password} onChange={(e) => setPwForm({ ...pwForm, new_password: e.target.value })} />
              </div>
            </div>
            {pwError && <div className="text-xs text-red-400 mb-3">{pwError}</div>}
            <div className="flex gap-3">
              <button onClick={() => { setPwOpen(false); setPwForm({ current_password: '', new_password: '' }); setPwError('') }}
                className="flex-1 bg-gray-800 hover:bg-gray-700 text-white py-3 rounded-lg transition text-sm">Annulla</button>
              <button onClick={changePassword} disabled={pwSaving}
                className="flex-1 bg-accent hover:opacity-90 disabled:opacity-50 text-white py-3 rounded-lg transition text-sm font-medium">
                {pwSaving ? 'Salvataggio...' : 'Aggiorna'}
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </>
  )
}

export default Sidebar
