import React, { useState, useEffect, useRef } from 'react'
import Icon from './Icon'
import { API } from '../lib/api'
import { NAV_ITEMS } from '../lib/nav-items'

// Dock orizzontale flottante in "vetro" (2026-11-01, richiesto dal vivo: "voglio una linea
// comune su tutta la piattaforma" dopo aver visto che Super Admin era rimasta con la vecchia
// rail verticale mentre core/frontend era già passata al dock il 31/10). Stesso linguaggio
// visivo di core/frontend/src/components/Sidebar.jsx (chip tondi tinti, pillola di vetro
// flottante in basso, pannello "Altro" per il resto) — qui molto più semplice perché le voci
// di Super Admin sono una lista FISSA di 8 pagine di sistema, non moduli dinamici di un
// tenant: niente ricerca, niente gruppi, niente logica di overflow per-utente. Notifiche e
// account (prima in Topbar.jsx, ora rimosso: vedi App.jsx) vivono nel dock stesso, come in
// core. L'indicatore che scorre da un'icona all'altra (core, misurato dal vivo col DOM) non
// è stato riportato qui: 8 voci fisse non ne hanno lo stesso bisogno, e lo stato "attivo" resta
// comunque leggibile dal solo riempimento pieno dell'icona.
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

  const [theme, setTheme] = useState(() => localStorage.getItem('platform_theme') || 'dark')
  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    localStorage.setItem('platform_theme', next)
    if (next === 'light') document.documentElement.setAttribute('data-theme', 'light')
    else document.documentElement.removeAttribute('data-theme')
  }

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
      if (accountRef.current && !accountRef.current.contains(e.target)) setAccountOpen(false)
      if (notifRef.current && !notifRef.current.contains(e.target)) setNotifOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const pinned = NAV_ITEMS.slice(0, PIN_COUNT)
  const overflow = NAV_ITEMS.slice(PIN_COUNT)
  const pageInOverflow = overflow.some((i) => i.id === page)

  const username = (payload && payload.username) || ''
  const initials = username ? username.trim().slice(0, 2).toUpperCase() : '?'

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
      {altroOpen && <div className="fixed inset-0 bg-black/30 z-30" onClick={() => setAltroOpen(false)} />}

      {/* Solo 3 voci al massimo (lista fissa, non moduli di un tenant): niente bisogno del
          pannello-griglia-con-intestazione di core (pensato per decine di moduli + ricerca) —
          segnalato dal vivo come "troppo spazio" per così poche voci. Un'altra pillola di chip,
          stessa identica DockIcon della riga sotto, appena sopra il dock: stesso linguaggio,
          dimensione proporzionata al contenuto reale. */}
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
              {/* Numero di versione annotato a mano a ogni chiusura di fase — prima viveva
                  nell'intestazione del pannello "Altro" (tolta: troppo spazio per 3 sole voci,
                  segnalato dal vivo), qui è l'unico posto rimasto che ha senso mostrarla. */}
              <div className="px-2.5 pt-1.5 mt-1 border-t border-white/10 text-[10px] text-gray-600">versione 0.4.8</div>
            </div>
          )}
        </div>
      </nav>
    </>
  )
}

export default Sidebar
