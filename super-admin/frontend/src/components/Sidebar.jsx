import React, { useState, useEffect, useRef } from 'react'
import Icon from './Icon'
import PlatformLogo from './PlatformLogo'
import { API } from '../lib/api'
import { NAV_ITEMS } from '../lib/nav-items'

// Rail verticale su desktop/Mac, dock orizzontale flottante solo su mobile
// (2026-11-01, richiesto dal vivo: "da pc/mac il menù debba essere ancora
// laterale, la pillola la terrei solo per la versione mobile — per tutti:
// admin, finance e zucca"). Stesso identico pattern appena costruito per
// core/frontend/src/components/Sidebar.jsx: UN solo componente, stato
// condiviso (tema, notifiche, account), reso due volte e selezionato via
// classi responsive Tailwind (`hidden md:flex` per la rail, `md:hidden` per
// il dock) — nessun listener di resize in JS, coerente col resto del
// codebase. Il dock sotto è il dock del 11/01 lasciato intatto; la rail è
// ripresa da git show 34b948b^ (versione pre-dock), adattata per condividere
// stato/notifiche/account col dock invece di duplicarli.
const PIN_COUNT = 5

function timeAgo(iso) {
  const diffMs = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diffMs / 60000)
  if (min < 1) return 'adesso'
  if (min < 60) return min + ' min fa'
  const h = Math.floor(min / 60)
  if (h < 24) return h + (h === 1 ? ' ora fa' : ' ore fa')
  const d = Math.floor(h / 24)
  return d + (d === 1 ? ' giorno fa' : ' giorni fa')
}

function Sidebar({ page, onNavigate, onLogout, payload, token }) {
  const handleNavigate = (id) => { onNavigate(id); setAltroOpen(false) }

  const [altroOpen, setAltroOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const panelRef = useRef(null)
  const accountRef = useRef(null)
  const notifRef = useRef(null)
  // Refs separati per i popover della rail: rail e dock vivono entrambi nel
  // DOM in contemporanea (solo nascosti via CSS) e condividono lo stesso
  // stato open/closed, quindi il click-fuori deve controllare entrambi i nodi.
  const railAccountRef = useRef(null)
  const railNotifRef = useRef(null)

  const [theme, setTheme] = useState(() => localStorage.getItem('platform_theme') || 'dark')
  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    localStorage.setItem('platform_theme', next)
    if (next === 'light') document.documentElement.setAttribute('data-theme', 'light')
    else document.documentElement.removeAttribute('data-theme')
  }

  // Rail: stretta a riposo, si allarga al passaggio del mouse — stesso
  // pattern di core/frontend, ripreso dalla vecchia rail di Super Admin
  // (git show 34b948b^) con un piccolo ritardo d'intenzione in entrata (180ms,
  // come in core) per non aprire la rail su un passaggio accidentale del
  // cursore, chiusura invece istantanea.
  const [hovered, setHovered] = useState(false)
  const [collapsed] = useState(true)
  const railExpanded = !collapsed || hovered
  const hoverTimer = useRef(null)
  const handleRailEnter = () => { hoverTimer.current = setTimeout(() => setHovered(true), 180) }
  const handleRailLeave = () => { clearTimeout(hoverTimer.current); setHovered(false) }

  // Notifiche — stessa logica che prima viveva in Topbar.jsx (eventi reali da
  // GET /monitoring/timeline, "letto" tracciato in localStorage), solo spostata qui.
  const [events, setEvents] = useState([])
  const [lastSeen, setLastSeen] = useState(() => localStorage.getItem('platform_notif_last_seen') || '')
  useEffect(() => {
    if (!token) return
    const load = () => {
      fetch(API + '/monitoring/timeline?limit=8', { headers: { Authorization: 'Bearer ' + token } })
        .then((r) => (r.ok ? r.json() : { rows: [] }))
        .then((d) => setEvents(d.rows || []))
        .catch(() => {})
    }
    load()
    const interval = setInterval(load, 30000)
    return () => clearInterval(interval)
  }, [token])
  const combined = events.slice(0, 12)
  const unreadCount = combined.filter((e) => (lastSeen ? e.created_at > lastSeen : true)).length
  const markAllSeen = () => {
    const now = events[0] ? events[0].created_at : new Date().toISOString()
    localStorage.setItem('platform_notif_last_seen', now)
    setLastSeen(now)
  }

  useEffect(() => {
    const handler = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target) && !e.target.closest('[data-dock-altro]')) setAltroOpen(false)
      if (accountRef.current && !accountRef.current.contains(e.target) && railAccountRef.current && !railAccountRef.current.contains(e.target)) setAccountOpen(false)
      if (notifRef.current && !notifRef.current.contains(e.target) && railNotifRef.current && !railNotifRef.current.contains(e.target)) setNotifOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const pinned = NAV_ITEMS.slice(0, PIN_COUNT)
  const overflow = NAV_ITEMS.slice(PIN_COUNT)
  const pageInOverflow = overflow.some((i) => i.id === page)

  const username = (payload && payload.username) || ''
  const initials = username ? username.trim().slice(0, 2).toUpperCase() : '?'

  // Blocco notifiche condiviso fra il popover della rail (non-portal, come
  // nella vecchia rail) e quello del dock (glass-panel) — stessa riga di
  // markup, nessuna duplicazione del JSX.
  const notificationList = (
    <div className="max-h-64 overflow-y-auto">
      {combined.length === 0 ? (
        <div className="text-xs text-gray-600 text-center py-6">Nessuna notifica</div>
      ) : combined.map((e) => {
        const isRead = lastSeen && e.created_at <= lastSeen
        return (
          <div key={e.id} className={'px-3 py-2.5 border-b border-white/5 ' + (isRead ? 'opacity-50' : '')}>
            <div className={'text-xs leading-snug ' + (e.kind === 'error' ? 'text-red-400' : 'text-gray-300')}>{e.description}</div>
            <div className="text-[10px] text-gray-700 mt-0.5">{timeAgo(e.created_at)}</div>
          </div>
        )
      })}
    </div>
  )

  const renderRailItem = (item) => (
    <button
      key={item.id}
      onClick={() => handleNavigate(item.id)}
      title={!railExpanded ? item.label : undefined}
      className={
        'w-full flex items-center gap-2.5 py-2.5 text-sm transition ' + (railExpanded ? 'px-3' : 'justify-center px-2') + ' ' +
        (page === item.id ? 'bg-cp-nav-active text-white' : 'text-gray-400 hover:text-ink hover:bg-white/5')
      }
    >
      <span style={page === item.id ? undefined : { color: item.color }}><Icon name={item.icon} size={16} /></span>
      {railExpanded && <span className="truncate">{item.label}</span>}
    </button>
  )

  // Stesso "chip" tondo tinto del dock di core/frontend — icona a tinta piena su sfondo
  // colore+alpha quando non attiva, pieno in accent quando attiva.
  const DockIcon = ({ name, icon, color, active, onClick, badge }) => (
    <button onClick={onClick} title={name}
      className={'relative flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200 ease-out hover:scale-110 ' + (active ? 'bg-cp-primary text-white shadow-md' : '')}
      style={!active ? { backgroundColor: color ? color + '22' : 'rgb(var(--cp-primary) / 0.16)', color: color || 'rgb(var(--cp-primary))' } : undefined}>
      <Icon name={icon} size={17} />
      {badge > 0 && <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-cp-primary text-white text-[8px] rounded-full flex items-center justify-center font-bold leading-none border border-surface-card">{badge > 9 ? '9+' : badge}</span>}
    </button>
  )

  return (
    <>
      {/* ---------- Rail verticale — solo desktop/Mac ---------- */}
      <div onMouseEnter={handleRailEnter} onMouseLeave={handleRailLeave}
        className={'hidden md:flex ' + (railExpanded ? 'w-56' : 'w-14') + ' bg-surface-card border-r border-gray-800 flex-col h-screen h-[100dvh] fixed left-0 top-0 z-40 transition-[width] duration-150 ' + (railExpanded ? 'shadow-2xl' : '')}>
        <div className={(railExpanded ? 'px-5' : 'px-3') + ' py-5 border-b border-gray-800'}>
          <div className="flex items-center gap-2.5">
            <PlatformLogo size={28} />
            {railExpanded && (
              <div>
                <div className="text-base text-ink tracking-tight"><span className="font-bold">Platform</span> <span className="font-normal">Admin</span></div>
                <div className="text-xs text-gray-500">versione 0.4.10</div>
              </div>
            )}
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto py-3">
          {NAV_ITEMS.map(renderRailItem)}
        </nav>
        <div className={(railExpanded ? 'px-4' : 'px-2') + ' py-4 border-t border-gray-800'} style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
          <div className={!railExpanded ? 'flex flex-col items-center gap-3' : 'flex items-center justify-between'}>
            <div className="relative" ref={railAccountRef}>
              {railExpanded ? (
                <button onClick={() => setAccountOpen((s) => !s)} className="flex items-center gap-2 text-left hover:opacity-80 transition min-w-0" title="Il mio account">
                  <span className="w-7 h-7 rounded-full bg-cp-primary text-white text-[11px] font-semibold flex items-center justify-center flex-shrink-0">{initials}</span>
                  <span className="min-w-0">
                    <div className="text-xs text-ink font-medium truncate">{username}</div>
                    <div className="text-[10px] text-gray-500 truncate">{payload && payload.role}</div>
                  </span>
                </button>
              ) : (
                <button onClick={() => setAccountOpen((s) => !s)} className="w-7 h-7 rounded-full bg-cp-primary text-white text-[11px] font-semibold flex items-center justify-center transition hover:scale-110" title={username || 'Il mio account'}>
                  {initials}
                </button>
              )}
              {accountOpen && (
                <div className="glass-panel absolute bottom-full left-0 mb-2 w-56 z-50 overflow-hidden p-1.5">
                  {username && <div className="px-2.5 py-2 text-xs text-gray-500 border-b border-white/10 mb-1 truncate">{username}{payload && payload.role ? ' · ' + payload.role : ''}</div>}
                  <button onClick={() => { setAccountOpen(false); handleNavigate('impostazioni') }} className="w-full text-left px-2.5 py-2 text-sm text-gray-300 hover:bg-white/5 hover:text-ink rounded-lg transition flex items-center gap-2">
                    <Icon name="settings" size={14} />Impostazioni
                  </button>
                  <button onClick={onLogout} className="w-full text-left px-2.5 py-2 text-sm text-gray-300 hover:bg-white/5 hover:text-ink rounded-lg transition flex items-center gap-2">
                    <Icon name="logout" size={14} />Esci
                  </button>
                </div>
              )}
            </div>
            <div className={!railExpanded ? 'flex flex-col items-center gap-3' : 'flex items-center gap-2.5 flex-shrink-0'}>
              <div className="relative" ref={railNotifRef}>
                <button onClick={() => setNotifOpen((s) => !s)} className="relative text-gray-500 hover:text-ink transition" title="Notifiche">
                  <Icon name="bell" size={14} />
                  {unreadCount > 0 && <span className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 bg-cp-primary text-white text-[8px] rounded-full flex items-center justify-center font-bold leading-none">{unreadCount > 9 ? '9+' : unreadCount}</span>}
                </button>
                {notifOpen && (
                  <div className="glass-panel absolute bottom-full left-0 mb-2 w-72 z-50 overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-2.5 border-b border-white/10">
                      <span className="text-xs font-semibold text-ink">Notifiche</span>
                      {unreadCount > 0 && <button onClick={markAllSeen} className="text-[10px] text-cp-primary hover:opacity-80 transition">Segna tutte lette</button>}
                    </div>
                    {notificationList}
                  </div>
                )}
              </div>
              <button onClick={toggleTheme} className="text-gray-500 hover:text-ink transition" title={theme === 'dark' ? 'Passa al tema chiaro' : 'Passa al tema scuro'}>
                <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={14} />
              </button>
              <button onClick={onLogout} className="text-gray-500 hover:text-ink transition" title="Esci">
                <Icon name="logout" size={15} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ---------- Dock flottante — solo mobile ---------- */}
      <div className="md:hidden">
        {altroOpen && <div className="fixed inset-0 bg-black/30 z-30" onClick={() => setAltroOpen(false)} />}

        {altroOpen && overflow.length > 0 && (
          <div ref={panelRef} className="glass-pill fixed left-1/2 z-40 flex items-center gap-1" style={{ transform: 'translateX(-50%)', bottom: 'calc(72px + env(safe-area-inset-bottom))', padding: '8px 10px' }}>
            {overflow.map((item) => (
              <DockIcon key={item.id} name={item.label} icon={item.icon} color={item.color} active={page === item.id} onClick={() => handleNavigate(item.id)} />
            ))}
          </div>
        )}

        <nav aria-label="Navigazione principale" className="glass-pill fixed left-1/2 z-40 flex items-center gap-1" style={{ transform: 'translateX(-50%)', bottom: 'calc(18px + env(safe-area-inset-bottom))', padding: '8px 10px' }}>
          {pinned.map((item) => (
            <DockIcon key={item.id} name={item.label} icon={item.icon} color={item.color} active={page === item.id} onClick={() => handleNavigate(item.id)} />
          ))}
          {overflow.length > 0 && (
            <>
              <div className="w-px h-6 bg-white/15 mx-1 flex-shrink-0" />
              <div data-dock-altro>
                <DockIcon name="Altro" icon="grid" active={altroOpen || pageInOverflow} onClick={() => setAltroOpen((x) => !x)} />
              </div>
            </>
          )}

          <div className="relative" ref={notifRef}>
            <DockIcon name="Notifiche" icon="bell" active={notifOpen} badge={unreadCount} onClick={() => setNotifOpen((s) => !s)} />
            {notifOpen && (
              <div className="glass-panel absolute bottom-[52px] left-1/2 w-72 z-50 overflow-hidden" style={{ transform: 'translateX(-50%)' }}>
                <div className="flex items-center justify-between px-3 py-2.5 border-b border-white/10">
                  <span className="text-xs font-semibold text-ink">Notifiche</span>
                  {unreadCount > 0 && <button onClick={markAllSeen} className="text-[10px] text-cp-primary hover:opacity-80 transition">Segna tutte lette</button>}
                </div>
                {notificationList}
              </div>
            )}
          </div>

          <div className="relative" ref={accountRef}>
            <button onClick={() => setAccountOpen((s) => !s)} title={username || 'Il mio account'}
              className={'relative flex-shrink-0 w-10 h-10 rounded-full bg-cp-primary text-white text-xs font-semibold flex items-center justify-center transition-all duration-200 ease-out hover:scale-110 ' + (accountOpen ? 'ring-2 ring-cp-primary ring-offset-2 ring-offset-surface-page' : '')}>
              {initials}
            </button>
            {accountOpen && (
              <div className="glass-panel absolute bottom-[52px] right-0 w-56 z-50 overflow-hidden p-1.5">
                {username && <div className="px-2.5 py-2 text-xs text-gray-500 border-b border-white/10 mb-1 truncate">{username}{payload && payload.role ? ' · ' + payload.role : ''}</div>}
                <button onClick={toggleTheme} className="w-full text-left px-2.5 py-2 text-sm text-gray-300 hover:bg-white/5 hover:text-ink rounded-lg transition flex items-center gap-2">
                  <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={14} />{theme === 'dark' ? 'Tema chiaro' : 'Tema scuro'}
                </button>
                <button onClick={() => { setAccountOpen(false); handleNavigate('impostazioni') }} className="w-full text-left px-2.5 py-2 text-sm text-gray-300 hover:bg-white/5 hover:text-ink rounded-lg transition flex items-center gap-2">
                  <Icon name="settings" size={14} />Impostazioni
                </button>
                <button onClick={onLogout} className="w-full text-left px-2.5 py-2 text-sm text-gray-300 hover:bg-white/5 hover:text-ink rounded-lg transition flex items-center gap-2">
                  <Icon name="logout" size={14} />Esci
                </button>
                <div className="px-2.5 pt-1.5 mt-1 border-t border-white/10 text-[10px] text-gray-600">versione 0.4.10</div>
              </div>
            )}
          </div>
        </nav>
      </div>
    </>
  )
}

export default Sidebar
