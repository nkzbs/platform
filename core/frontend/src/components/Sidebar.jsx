import React, { useState, useEffect, useRef } from 'react'
import Icon from './Icon'
import PlatformLogo from './PlatformLogo'
import GlobalSearch from './GlobalSearch'
import Avatar from './Avatar'
import { API, notifyUnauthorized } from '../lib/api'
import Portal from './Portal'
import { risolviAppuntate, alternaAppuntata } from '@shared/dock-pins'

// Due rese della stessa navigazione, non due componenti — rail verticale fissa a sinistra
// su desktop (richiesto dal vivo, 2026-11-01, dopo aver provato il dock ovunque: "da pc/mac
// il menù debba essere ancora laterale, la pillola la terrei solo per la versione mobile").
// Il dock flottante in vetro (introdotto 31/10) resta SOLO sotto il breakpoint md. Stesso
// stato e stessa logica (notifiche, tema, password, logout, voci/gruppi) alimentano
// entrambe le rese — quale delle due sta nel DOM lo decide il CSS (hidden md:flex /
// flex md:hidden), non JS: niente query di resize da gestire a mano, coerente con come il
// resto della piattaforma gestisce i breakpoint.
const PIN_COUNT = 4

function Sidebar({ modules, currentPage, onNavigate, user, onLogout, tenantName, logoUrl, hidePlatformName, features = {}, token, mobileOpen, onMobileClose, collapsed }) {
  const handleNavigate = (slug) => {
    onNavigate(slug)
    closeAltro()
    if (onMobileClose) onMobileClose()
  }

  const [altroOpen, setAltroOpen] = useState(false)
  // Filtro per nome dentro il pannello "Altro" (dock, mobile) — stile launcher macOS,
  // riempito da GlobalSearch mentre si scrive, filtra la griglia sotto.
  const [navFilter, setNavFilter] = useState('')
  // Modifica delle voci appuntate nel dock: scelta esplicita dell'utente (tasto "Modifica"
  // nel pannello "Altro"), salvata su questo dispositivo — mai un riordino automatico.
  const [editPins, setEditPins] = useState(false)
  const closeAltro = () => { setAltroOpen(false); setNavFilter(''); setEditPins(false) }
  const pinsKey = 'platform_dock_pins_' + ((user && (user.id || user.username)) || '')
  const [pinPrefs, setPinPrefs] = useState(null)
  useEffect(() => {
    try { const v = JSON.parse(localStorage.getItem(pinsKey)); setPinPrefs(Array.isArray(v) ? v : null) } catch { setPinPrefs(null) }
  }, [pinsKey])
  const savePins = (slugs) => {
    setPinPrefs(slugs)
    try { if (slugs) localStorage.setItem(pinsKey, JSON.stringify(slugs)); else localStorage.removeItem(pinsKey) } catch { /* senza storage resta valido per la sessione */ }
  }
  // L'hamburger in App.jsx (solo mobile) apre il pannello "Altro" del dock.
  useEffect(() => { if (mobileOpen) setAltroOpen(true) }, [mobileOpen])

  // Rail (desktop): stretta a riposo, si allarga al passaggio del mouse — stesso
  // comportamento di prima del dock, incluso il ritardo d'intenzione (180ms) per non
  // scattare attraversandola solo di striscio col mouse diretti altrove.
  const [hovered, setHovered] = useState(false)
  const railExpanded = !collapsed || hovered
  const hoverTimer = useRef(null)
  const handleRailEnter = () => { hoverTimer.current = setTimeout(() => setHovered(true), 180) }
  const handleRailLeave = () => { clearTimeout(hoverTimer.current); setHovered(false) }

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
  const railNotifRef = useRef(null)
  const panelRef = useRef(null)

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
    const handler = (e) => {
      if (notifRef.current && !notifRef.current.contains(e.target) && railNotifRef.current && !railNotifRef.current.contains(e.target)) setNotifOpen(false)
      if (panelRef.current && !panelRef.current.contains(e.target) && !e.target.closest('[data-dock-altro]')) closeAltro()
    }
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

  const systemItems = []
  if (user && user.role === 'admin') {
    systemItems.push({ slug: 'libreria', name: 'Libreria', icon: 'store' })
    systemItems.push({ slug: 'builder', name: 'Builder', icon: 'tool' })
    systemItems.push({ slug: 'audit', name: 'Log attività', icon: 'list' })
    systemItems.push({ slug: 'impostazioni', name: 'Impostazioni', icon: 'settings' })
    systemItems.push({ slug: 'guida', name: 'Guida', icon: 'info' })
  }

  // Gruppi nell'ordine di primo incontro scorrendo i moduli — usato dalla rail (tutte le
  // voci, nessun limite) e come base per pinned/overflow del dock sotto.
  const senzaGruppo = modules.filter((m) => !m.group_name)
  const conGruppo = modules.filter((m) => m.group_name)
  const gruppi = []
  conGruppo.forEach((m) => { if (!gruppi.includes(m.group_name)) gruppi.push(m.group_name) })

  // ───────────────────────────── Rail (desktop) ─────────────────────────────
  const renderRailItem = (m) => (
    <button key={m.slug} data-tour={'sidebar-' + m.slug} onClick={() => handleNavigate(m.slug)} title={!railExpanded ? m.name : undefined}
      className={'w-full flex items-center gap-3 py-2.5 text-sm transition ' + (!railExpanded ? 'justify-center px-2' : 'px-4') + ' ' + (currentPage === m.slug ? 'bg-accent/20 text-accent border-r-2 border-accent' : 'text-gray-400 hover:text-ink hover:bg-white/5')}>
      <span style={{ color: currentPage === m.slug ? '#60A5FA' : m.color }}><Icon name={m.icon} size={16} /></span>
      {railExpanded && m.name}
    </button>
  )

  // ───────────────────────────── Dock (mobile) ─────────────────────────────
  const ordinate = [...senzaGruppo, ...conGruppo]
  const pool = [...ordinate, ...systemItems]
  const defaultPins = ordinate.slice(0, PIN_COUNT).map((m) => m.slug)
  const pinSlugs = risolviAppuntate(pinPrefs, defaultPins, pool.map((m) => m.slug), PIN_COUNT)
  const pinned = pinSlugs.map((sl) => pool.find((m) => m.slug === sl))
  const togglePin = (slug) => {
    const next = alternaAppuntata(pinSlugs, slug, PIN_COUNT)
    if (next !== pinSlugs) savePins(next)
  }
  const pinnedSlugs = new Set(pinned.map((m) => m.slug))
  const systemItemsRest = systemItems.filter((m) => !pinnedSlugs.has(m.slug))
  const overflowSenzaGruppo = senzaGruppo.filter((m) => !pinnedSlugs.has(m.slug))
  const overflowConGruppo = conGruppo.filter((m) => !pinnedSlugs.has(m.slug))
  const pageInOverflow = overflowSenzaGruppo.some((m) => m.slug === currentPage) || overflowConGruppo.some((m) => m.slug === currentPage) || systemItemsRest.some((m) => m.slug === currentPage) || currentPage === 'account'

  const DockIcon = ({ slug, dockKey, name, icon, color, active, onClick, badge }) => (
    <button key={slug} data-tour={slug ? 'sidebar-' + slug : undefined} data-dock-key={dockKey} onClick={onClick || (() => handleNavigate(slug))} title={name}
      className={'relative flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200 ease-out hover:scale-110 ' + (active ? 'bg-accent text-white shadow-md' : '')}
      style={!active ? { backgroundColor: color ? color + '22' : 'rgb(var(--accent) / 0.16)', color: color || 'rgb(var(--accent))' } : undefined}>
      <Icon name={icon} size={17} />
      {badge > 0 && <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-accent text-white text-[8px] rounded-full flex items-center justify-center font-bold leading-none border border-surface-card">{badge > 9 ? '9+' : badge}</span>}
    </button>
  )

  const navRef = useRef(null)
  const [indicator, setIndicator] = useState(null)
  const activeDockKey = currentPage === 'account' ? 'account'
    : pinned.some((m) => m.slug === currentPage) ? currentPage
    : (altroOpen || pageInOverflow) ? 'altro'
    : null
  useEffect(() => {
    const measure = () => {
      if (!navRef.current || !activeDockKey) { setIndicator(null); return }
      const el = navRef.current.querySelector('[data-dock-key="' + activeDockKey + '"]')
      if (!el) { setIndicator(null); return }
      const navRect = navRef.current.getBoundingClientRect()
      const elRect = el.getBoundingClientRect()
      setIndicator({ left: elRect.left - navRect.left, width: elRect.width })
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [activeDockKey, pinned.map((m) => m.slug).join(',')])

  const gridTile = (m) => {
    const attiva = currentPage === m.slug
    const appuntata = pinSlugs.includes(m.slug)
    return (
      <button key={m.slug} data-tour={'sidebar-' + m.slug} title={m.name} onClick={() => (editPins ? togglePin(m.slug) : handleNavigate(m.slug))}
        className="group relative flex flex-col items-center gap-1 p-1 rounded-xl transition hover:bg-white/8 min-w-0">
        <span className={'relative w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 transition-transform duration-150 ease-out group-hover:scale-105 ' + (attiva ? 'bg-accent text-white' : 'bg-white/8') + (editPins && appuntata ? ' ring-2 ring-accent' : '')} style={attiva ? undefined : { color: m.color }}>
          <Icon name={m.icon} size={21} />
          {editPins && <span className={'absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold leading-none ' + (appuntata ? 'bg-accent text-white' : 'bg-white/25 text-ink')}>{appuntata ? '✓' : '+'}</span>}
        </span>
        <span className="w-full text-[11px] leading-tight text-center text-ink/80 line-clamp-2 break-words">{m.name}</span>
      </button>
    )
  }
  const filtro = navFilter.trim().toLowerCase()
  const passaFiltro = (m) => !filtro || m.name.toLowerCase().includes(filtro)
  const overflowSenzaGruppoF = overflowSenzaGruppo.filter(passaFiltro)
  const overflowConGruppoF = overflowConGruppo.filter(passaFiltro)
  const systemItemsF = systemItemsRest.filter(passaFiltro)
  const poolF = pool.filter(passaFiltro)
  const nessunRisultato = filtro && (editPins ? !poolF.length : (!overflowSenzaGruppoF.length && !overflowConGruppoF.length && !systemItemsF.length))

  const notificationList = (
    <div className="max-h-64 overflow-y-auto">
      {notifications.length === 0 ? (
        <div className="text-xs text-gray-600 text-center py-6">Nessuna notifica</div>
      ) : notifications.map((n) => (
        <div key={n.id} className={'px-3 py-2.5 border-b border-white/5 ' + (n.read ? 'opacity-50' : '')}>
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
  )

  return (
    <>
      {/* ═══════════════════════ Rail — desktop (md e oltre) ═══════════════════════ */}
      <div onMouseEnter={handleRailEnter} onMouseLeave={handleRailLeave}
        className={'hidden md:flex ' + (railExpanded ? 'w-56' : 'w-14') + ' bg-surface-card border-r border-gray-800 flex-col fixed inset-y-0 left-0 z-40 transition-[width] duration-150 ' + (railExpanded ? 'shadow-2xl' : '')}>
        <div className={(railExpanded ? 'px-5' : 'px-3') + ' py-5 border-b border-gray-800'} style={{ paddingTop: 'max(1.25rem, env(safe-area-inset-top))' }}>
          <div className="flex items-center gap-2.5">
            {logoUrl ? <img src={logoUrl} alt="" className="w-[26px] h-[26px] rounded-md object-contain flex-shrink-0" /> : <PlatformLogo size={26} letter={hidePlatformName && tenantName ? tenantName.trim()[0] : undefined} />}
            {railExpanded && (
              <div>
                <div className="text-base text-ink tracking-tight">
                  {hidePlatformName && tenantName
                    ? <span className="font-bold">{tenantName}</span>
                    : <><span className="font-bold">Platform</span>{tenantName && <span className="font-normal"> {tenantName}</span>}</>
                  }
                </div>
                <div className="text-xs text-gray-500">Platform 0.5.33</div>
              </div>
            )}
          </div>
        </div>
        <nav data-tour="sidebar-nav" className="flex-1 min-h-0 overflow-y-auto py-3">
          {senzaGruppo.map(renderRailItem)}
          {gruppi.map((g) => (
            <div key={g} className="mt-2">
              {railExpanded && <div className="px-4 pt-2 pb-1 text-[10px] font-semibold text-gray-600 uppercase tracking-wider">{g}</div>}
              {conGruppo.filter((m) => m.group_name === g).map(renderRailItem)}
            </div>
          ))}
          <div className="mt-3 pt-3 border-t border-gray-800">
            {systemItems.map((item) => (
              <button key={item.slug} data-tour={'sidebar-' + item.slug} onClick={() => handleNavigate(item.slug)} title={!railExpanded ? item.name : undefined}
                className={'w-full flex items-center gap-3 py-2.5 text-sm transition ' + (!railExpanded ? 'justify-center px-2' : 'px-4') + ' ' + (currentPage === item.slug ? 'bg-accent/20 text-accent border-r-2 border-accent' : 'text-gray-400 hover:text-ink hover:bg-white/5')}>
                <Icon name={item.icon} size={16} />
                {railExpanded && item.name}
              </button>
            ))}
          </div>
        </nav>
        <div className={(railExpanded ? 'px-4' : 'px-2') + ' py-3 border-t border-gray-800 flex-shrink-0'} style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
          <div className={!railExpanded ? 'flex flex-col items-center gap-3' : 'flex items-center justify-between'}>
            {railExpanded ? (
              <button onClick={() => handleNavigate('account')} className="text-left hover:opacity-80 transition min-w-0" title="Il mio account">
                <Avatar user={user} size={28} />
              </button>
            ) : (
              <button onClick={() => handleNavigate('account')} className="w-7 h-7 rounded-full overflow-hidden flex items-center justify-center text-gray-400 hover:text-ink transition" title={(user && user.display_name) || 'Il mio account'}>
                <Avatar user={user} size={28} />
              </button>
            )}
            <div className={!railExpanded ? 'flex flex-col items-center gap-3' : 'flex items-center gap-3'}>
              <div className="relative" ref={railNotifRef}>
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
                    {notificationList}
                  </div>
                )}
              </div>
              <button onClick={toggleTheme} className="text-gray-500 hover:text-ink transition" title={theme === 'dark' ? 'Passa al tema chiaro' : 'Passa al tema scuro'}>
                <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={15} />
              </button>
              <button onClick={() => setPwOpen(true)} className="text-gray-500 hover:text-ink transition" title="Cambia password">
                <Icon name="key" size={15} />
              </button>
              <button onClick={onLogout} className="text-gray-500 hover:text-ink transition" title="Esci">
                <Icon name="logout" size={16} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ═══════════════════════ Dock — mobile (sotto md) ═══════════════════════ */}
      <div className="md:hidden">
        {altroOpen && <div className="fixed inset-0 bg-black/30 z-30" onClick={() => { closeAltro(); if (onMobileClose) onMobileClose() }} />}

        {altroOpen && (overflowSenzaGruppo.length > 0 || overflowConGruppo.length > 0 || systemItemsRest.length > 0 || pool.length > 0) && (
          <div ref={panelRef} className="glass-panel fixed left-1/2 z-40 flex flex-col" style={{ transform: 'translateX(-50%)', bottom: 'calc(90px + env(safe-area-inset-bottom))', width: 'min(400px, calc(100vw - 32px))', maxHeight: '70vh', padding: '12px' }}>
            <div className="flex items-center gap-2.5 px-1.5 pb-2.5 flex-shrink-0">
              {logoUrl ? <img src={logoUrl} alt="" className="w-[24px] h-[24px] rounded-md object-contain flex-shrink-0" /> : <PlatformLogo size={24} letter={hidePlatformName && tenantName ? tenantName.trim()[0] : undefined} />}
              <div className="min-w-0 flex-1">
                <div className="text-sm text-ink font-bold truncate">{hidePlatformName && tenantName ? tenantName : 'Platform' + (tenantName ? ' ' + tenantName : '')}</div>
                <div className="text-[11px] text-gray-500">Platform 0.5.33</div>
              </div>
              <button onClick={() => setEditPins((x) => !x)} className={'text-xs px-2.5 py-1 rounded-full transition flex-shrink-0 ' + (editPins ? 'bg-accent text-white' : 'text-accent hover:bg-white/8')}>{editPins ? 'Fine' : 'Modifica'}</button>
            </div>
            <div className="px-0.5 pb-2.5 flex-shrink-0">
              <GlobalSearch token={token} onNavigate={handleNavigate} panel onQueryChange={setNavFilter} />
            </div>
            <div className="overflow-y-auto border-t border-white/10 pt-2.5" style={{ maxHeight: 'min(46vh, 380px)' }}>
              {editPins && (
                <div className="px-1.5 pb-2 text-[11px] text-gray-500">
                  Tocca per appuntare nel dock (massimo {PIN_COUNT}){pinSlugs.length >= PIN_COUNT ? ' — ne hai già ' + PIN_COUNT + ', togline una per sceglierne un\'altra' : ''}.
                  {pinPrefs && <button onClick={() => savePins(null)} className="ml-1 text-accent hover:opacity-80">Ripristina</button>}
                </div>
              )}
              {nessunRisultato && <div className="text-center text-sm text-gray-500 py-6">Nessuna voce per "{navFilter}"</div>}
              {editPins ? (
                poolF.length > 0 && <div className="grid grid-cols-4 gap-1">{poolF.map(gridTile)}</div>
              ) : (
                <>
                  {overflowSenzaGruppoF.length > 0 && (
                    <div className="grid grid-cols-4 gap-1">{overflowSenzaGruppoF.map(gridTile)}</div>
                  )}
                  {gruppi.map((g) => {
                    const items = overflowConGruppoF.filter((m) => m.group_name === g)
                    if (!items.length) return null
                    return (
                      <div key={g} className="mt-2">
                        <div className="px-1.5 pb-1 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">{g}</div>
                        <div className="grid grid-cols-4 gap-1">{items.map(gridTile)}</div>
                      </div>
                    )
                  })}
                  {systemItemsF.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-white/10">
                      <div className="grid grid-cols-4 gap-1">{systemItemsF.map(gridTile)}</div>
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="mt-2.5 pt-2.5 border-t border-white/10 flex items-center justify-between px-1 flex-shrink-0">
              <button onClick={() => handleNavigate('account')} className={'flex items-center gap-2.5 text-left hover:opacity-80 transition rounded-lg px-2 py-1 -mx-2 ' + (currentPage === 'account' ? 'bg-accent/20' : '')} title="Il mio account">
                <Avatar user={user} size={28} />
                <div className="min-w-0">
                  <div className="text-sm text-ink font-medium truncate">{user && user.display_name}</div>
                  <div className="text-xs text-gray-500">{user && user.role}<span> · Platform 0.5.33</span></div>
                </div>
              </button>
              <div className="flex items-center gap-3">
                <button onClick={toggleTheme} className="text-gray-400 hover:text-ink transition" title={theme === 'dark' ? 'Passa al tema chiaro' : 'Passa al tema scuro'}>
                  <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={15} />
                </button>
                <button onClick={() => setPwOpen(true)} className="text-gray-400 hover:text-ink transition" title="Cambia password">
                  <Icon name="key" size={15} />
                </button>
                <button onClick={onLogout} className="text-gray-400 hover:text-ink transition" title="Esci">
                  <Icon name="logout" size={16} />
                </button>
              </div>
            </div>
          </div>
        )}

        <nav ref={navRef} aria-label="Navigazione principale" className="glass-pill glass-dock fixed left-1/2 z-40 flex items-center gap-1" style={{ transform: 'translateX(-50%)', bottom: 'calc(18px + env(safe-area-inset-bottom))', padding: '8px 10px' }}>
          {indicator && (
            <div className="absolute top-1.5 bottom-1.5 rounded-full bg-accent/20 pointer-events-none transition-all duration-300 ease-out" style={{ left: indicator.left, width: indicator.width }} />
          )}
          {pinned.map((m) => (
            <DockIcon key={m.slug} slug={m.slug} dockKey={m.slug} name={m.name} icon={m.icon} color={m.color} active={currentPage === m.slug} />
          ))}
          {(overflowSenzaGruppo.length > 0 || overflowConGruppo.length > 0 || systemItemsRest.length > 0 || pool.length > 0) && (
            <>
              <div className="w-px h-6 bg-white/15 mx-1 flex-shrink-0" />
              <div data-dock-altro>
                <DockIcon dockKey="altro" name="Altro" icon="grid" active={altroOpen || pageInOverflow} onClick={() => setAltroOpen((x) => !x)} />
              </div>
            </>
          )}
          <div className="relative" ref={notifRef}>
            <DockIcon name="Notifiche" icon="bell" active={notifOpen} badge={unreadCount} onClick={() => setNotifOpen((s) => !s)} />
            {notifOpen && (
              <div className="glass-panel absolute bottom-[52px] left-1/2 w-72 z-50 overflow-hidden" style={{ transform: 'translateX(-50%)' }}>
                <div className="flex items-center justify-between px-3 py-2.5 border-b border-white/10">
                  <span className="text-xs font-semibold text-ink">Notifiche</span>
                  <div className="flex gap-2">
                    {unreadCount > 0 && <button onClick={markAllRead} className="text-[10px] text-accent hover:opacity-80 transition">Segna tutte lette</button>}
                    <button onClick={clearRead} className="text-[10px] text-gray-500 hover:text-gray-300 transition">Pulisci lette</button>
                  </div>
                </div>
                {notificationList}
              </div>
            )}
          </div>
          {user && user.avatar_url ? (
            <button data-dock-key="account" onClick={() => handleNavigate('account')} title={user.display_name || 'Il mio account'}
              className={'relative flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200 ease-out hover:scale-110 ' + (currentPage === 'account' ? 'ring-2 ring-accent' : '')}>
              <Avatar user={user} size={36} />
            </button>
          ) : (
            <DockIcon slug="account" dockKey="account" name={(user && user.display_name) || 'Il mio account'} icon="user" active={currentPage === 'account'} />
          )}
        </nav>
      </div>

      {pwOpen && (
        <Portal>
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
        </Portal>
      )}
    </>
  )
}

export default Sidebar
