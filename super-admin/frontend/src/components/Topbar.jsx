import React, { useState, useRef, useEffect } from 'react'
import Icon from './Icon'
import { API } from '../lib/api'
import { NAV_ITEMS } from '../lib/nav-items'

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

// Prima non esisteva nessuna topbar su desktop (solo un hamburger su mobile) —
// segnalato dall'utente confrontando con lo stile del mockup Builder (help,
// notifiche, avatar in alto a destra). Niente ricerca globale qui: non esiste
// ancora un endpoint che cerchi davvero tra tenant/partner/clienti insieme, e
// una barra di ricerca che non cerca nulla sarebbe peggio che non averla.
// PLATFORM-UI-RESKIN-PLAN.md, Fase 2 (2026-08-23): il brief del mockup chiede
// anche qui un campo ricerca compatto e una campanella con badge notifiche —
// stesso motivo di sopra per la ricerca (nessun endpoint unificato reale,
// nemmeno con l'indice FTS5 di G12, che è solo sui record di un tenant, non
// su tenant/partner/clienti insieme); la campanella richiederebbe un vero
// concetto di notifica in-app che oggi non esiste (le notifiche reali sono
// via email, vedi backend/src/notifier.js) — omesse entrambe invece di
// costruire un'icona finta, altezza/colori aggiornati al resto.
//
// Breadcrumb (2026-08-15, segnalato dall'utente con uno screenshot dello
// stile esatto voluto): "Core" > Nome pagina, stesso linguaggio visivo del
// mockup (testo con ">" — il primo segmento smorzato, l'ultimo in grassetto).
// Il pill "v1.2.0 (Draft)" del mockup è specifico al Builder (versione/bozza
// di un modulo) — non esiste un concetto equivalente per le pagine di Super
// Admin, quindi omesso qui invece di inventarne uno finto.
function Topbar({ payload, page, onNavigate, onLogout, onOpenMobileMenu, token }) {
  const pageLabel = (NAV_ITEMS.find((i) => i.id === page) || {}).label || ''
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)
  useEffect(() => {
    const handler = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])
  const username = (payload && payload.username) || ''
  const initials = username ? username.trim().slice(0, 2).toUpperCase() : '?'

  // Campanella notifiche — spostata qui dal fondo della sidebar (richiesto
  // dall'utente, 2026-08-30 — "notifiche in header invece che in fondo alla
  // sidebar"). Eventi reali (audit/errori, GET /monitoring/timeline), "letto"
  // tracciato in localStorage.
  const [events, setEvents] = useState([])
  const [notifOpen, setNotifOpen] = useState(false)
  const [lastSeen, setLastSeen] = useState(() => localStorage.getItem('platform_notif_last_seen') || '')
  const notifRef = useRef(null)
  useEffect(() => {
    if (!token) return
    const load = () => {
      // Bug reale, produzione (2026-09-03): /monitoring/timeline è passata da un array
      // nudo a {rows, has_more} nello stesso giro (paginazione con cursore) — questo
      // punto di consumo non era stato aggiornato, "j.map is not a function" sulla
      // Dashboard al primo render, schermata bianca per chiunque.
      fetch(API + '/monitoring/timeline?limit=8', { headers: { Authorization: 'Bearer ' + token } })
        .then((r) => (r.ok ? r.json() : { rows: [] }))
        .then((d) => setEvents(d.rows || []))
        .catch(() => {})
    }
    load()
    const interval = setInterval(load, 30000)
    return () => clearInterval(interval)
  }, [token])
  useEffect(() => {
    const handler = (e) => { if (notifRef.current && !notifRef.current.contains(e.target)) setNotifOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])
  const combined = events.slice(0, 12)
  const unreadCount = combined.filter((e) => (lastSeen ? e.created_at > lastSeen : true)).length
  const markAllSeen = () => {
    const now = events[0] ? events[0].created_at : new Date().toISOString()
    localStorage.setItem('platform_notif_last_seen', now)
    setLastSeen(now)
  }

  return (
    <div className="sticky top-0 z-20 h-12 bg-surface-page/90 backdrop-blur-sm border-b border-gray-800/50 px-4 md:px-6 flex items-center justify-between gap-3">
      <button onClick={onOpenMobileMenu} className="md:hidden text-gray-400 hover:text-ink transition flex-shrink-0" title="Apri menu">
        <Icon name="menu" size={20} />
      </button>
      <div className="flex-1 md:hidden" />
      <div className="hidden md:flex flex-1 items-center gap-2 text-sm min-w-0">
        <span className="text-gray-500 truncate">Core</span>
        {pageLabel && (
          <>
            <Icon name="chevron-right" size={13} className="text-gray-700 flex-shrink-0" />
            <span className="text-ink font-medium truncate">{pageLabel}</span>
          </>
        )}
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        <div className="relative" ref={notifRef}>
          <button onClick={() => setNotifOpen((s) => !s)} className="relative text-gray-500 hover:text-ink transition" title="Notifiche">
            <Icon name="bell" size={17} />
            {unreadCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 bg-cp-primary text-white text-[8px] rounded-full flex items-center justify-center font-bold leading-none">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>
          {notifOpen && (
            <div className="absolute top-9 right-0 w-72 bg-surface-card border border-gray-700 rounded-xl shadow-xl z-50 overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800">
                <span className="text-xs font-semibold text-ink">Notifiche</span>
                {unreadCount > 0 && <button onClick={markAllSeen} className="text-[10px] text-cp-primary hover:opacity-80 transition">Segna tutte lette</button>}
              </div>
              <div className="max-h-64 overflow-y-auto">
                {combined.length === 0 ? (
                  <div className="text-xs text-gray-600 text-center py-6">Nessuna notifica</div>
                ) : combined.map((e) => {
                  const isRead = lastSeen && e.created_at <= lastSeen
                  return (
                    <div key={e.id} className={'px-3 py-2.5 border-b border-gray-800/60 ' + (isRead ? 'opacity-50' : '')}>
                      <div className={'text-xs leading-snug flex items-center gap-1.5 ' + (e.kind === 'error' ? 'text-cp-danger' : 'text-gray-300')}>
                        {e.description}
                      </div>
                      <div className="text-[10px] text-gray-700 mt-0.5">{timeAgo(e.created_at)}</div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
        {/* Bug reale trovato in un collaudo dal vivo (2026-09-03): il tooltip prometteva
            "Guida e supporto" ma portava dritto al Supporto — la Guida esisteva già (pagina
            completa, backend funzionante) ma non era mai stata ricollegata a questa icona. */}
        <button onClick={() => onNavigate('guida')} className="text-gray-500 hover:text-ink transition" title="Guida e supporto">
          <Icon name="info" size={17} />
        </button>
        <div className="relative" ref={menuRef}>
          <button onClick={() => setMenuOpen((s) => !s)}
            className="w-8 h-8 rounded-full bg-cp-primary text-white text-xs font-semibold flex items-center justify-center hover:opacity-90 transition">
            {initials}
          </button>
          {menuOpen && (
            <div className="absolute top-10 right-0 w-48 bg-surface-card border border-gray-800 rounded-xl shadow-xl z-50 overflow-hidden py-1">
              {username && <div className="px-3 py-2 text-xs text-gray-500 border-b border-gray-800 truncate">{username}</div>}
              <button onClick={() => { setMenuOpen(false); onNavigate('impostazioni') }}
                className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-white/5 hover:text-ink transition flex items-center gap-2">
                <Icon name="settings" size={14} />Impostazioni
              </button>
              <button onClick={() => { setMenuOpen(false); onLogout() }}
                className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-white/5 hover:text-ink transition flex items-center gap-2">
                <Icon name="logout" size={14} />Esci
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default Topbar
