import React, { useState, useEffect, useRef } from 'react'
import Icon from './Icon'
import PlatformLogo from './PlatformLogo'
import GlobalSearch from './GlobalSearch'
import Avatar from './Avatar'
import { API, notifyUnauthorized } from '../lib/api'

// Dock orizzontale flottante in "vetro" (2026-10-31, richiesto esplicitamente dall'utente
// dopo aver visto due proposte — preferita la 2, dock stile barra di WhatsApp/iOS — sulla
// sidebar verticale rail+drawer di prima). Stessa API del componente di prima (stessi prop,
// stessa logica interna: notifiche, cambio password, tema, logout) — cambia solo la
// presentazione, da rail fissa a sinistra a barra flottante in basso, per non dover toccare
// App.jsx né nessun altro chiamante. Un tenant può avere molte più voci di quante ne stiano
// in una barra orizzontale (Finance da sola: 7 moduli + 5 voci admin) — le prime (Dashboard
// + i moduli che vengono per primi) restano fisse nel dock, tutto il resto (gli altri moduli,
// raggruppati come prima, le voci admin, account/notifiche/tema/password/esci) vive dietro
// il pulsante "Altro", un pannello di vetro che si apre sopra il dock.
const PIN_COUNT = 4

function Sidebar({ modules, currentPage, onNavigate, user, onLogout, tenantName, logoUrl, hidePlatformName, features = {}, token, mobileOpen, onMobileClose, collapsed }) {
  const handleNavigate = (slug) => {
    onNavigate(slug)
    closeAltro()
    if (onMobileClose) onMobileClose()
  }

  const [altroOpen, setAltroOpen] = useState(false)
  // Filtro per nome dentro il pannello "Altro" — stile launcher macOS (richiesto dal vivo:
  // "ricerca in alto, togliendola dalla testa della pagina"): riempito da GlobalSearch mentre
  // si scrive, filtra la griglia sotto; si svuota ogni volta che il pannello si chiude.
  const [navFilter, setNavFilter] = useState('')
  const closeAltro = () => { setAltroOpen(false); setNavFilter('') }
  // L'hamburger in App.jsx (solo mobile) apriva il drawer di prima — qui apre il pannello "Altro".
  useEffect(() => { if (mobileOpen) setAltroOpen(true) }, [mobileOpen])

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
      if (notifRef.current && !notifRef.current.contains(e.target)) setNotifOpen(false)
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

  // Stesso ordine di sempre (senza gruppo prima, poi i gruppi nell'ordine di primo incontro) —
  // solo appiattito in un unico elenco, per poter staccare le prime PIN_COUNT voci.
  const senzaGruppo = modules.filter((m) => !m.group_name)
  const conGruppo = modules.filter((m) => m.group_name)
  const gruppi = []
  conGruppo.forEach((m) => { if (!gruppi.includes(m.group_name)) gruppi.push(m.group_name) })
  const ordinate = [...senzaGruppo, ...conGruppo]
  const pinned = ordinate.slice(0, PIN_COUNT)
  const pinnedSlugs = new Set(pinned.map((m) => m.slug))
  const overflowSenzaGruppo = senzaGruppo.filter((m) => !pinnedSlugs.has(m.slug))
  const overflowConGruppo = conGruppo.filter((m) => !pinnedSlugs.has(m.slug))
  const pageInOverflow = overflowSenzaGruppo.some((m) => m.slug === currentPage) || overflowConGruppo.some((m) => m.slug === currentPage) || systemItems.some((m) => m.slug === currentPage) || currentPage === 'account'

  // Ogni icona del dock è un "chip" tondo tinto — stesso linguaggio dei risultati di
  // GlobalSearch (sfondo colore+alpha, icona a tinta piena) — invece del vecchio miscuglio
  // "icone colorate piatte senza sfondo" + "icone di sistema grigie o blu piene": segnalato
  // dal vivo come "irregolare, poca fluidità tra una voce e l'altra" (2026-10-31). Le voci
  // di sistema (Altro/Notifiche/Account) non hanno un colore proprio: usano l'accent, così
  // restano nella stessa famiglia visiva dei pin colorati invece di spiccare in blu pieno.
  // hover:scale-110 + transition-all danno la continuità/fluidità mancante tra un'icona e
  // l'altra, stessa animazione già usata nella griglia del pannello "Altro".
  const DockIcon = ({ slug, dockKey, name, icon, color, active, onClick, badge }) => (
    <button key={slug} data-tour={slug ? 'sidebar-' + slug : undefined} data-dock-key={dockKey} onClick={onClick || (() => handleNavigate(slug))} title={name}
      className={'relative flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200 ease-out hover:scale-110 ' + (active ? 'bg-accent text-white shadow-md' : '')}
      style={!active ? { backgroundColor: color ? color + '22' : 'rgb(var(--accent) / 0.16)', color: color || 'rgb(var(--accent))' } : undefined}>
      <Icon name={icon} size={17} />
      {badge > 0 && <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-accent text-white text-[8px] rounded-full flex items-center justify-center font-bold leading-none border border-surface-card">{badge > 9 ? '9+' : badge}</span>}
    </button>
  )

  // Indicatore che SCORRE da un'icona all'altra invece di comparire/sparire di colpo —
  // segnalato dal vivo ("se mi sposto di voce non vedo lo scorrere"): prima il cambio di
  // voce attiva era solo un cambio di colore istantaneo, nessun movimento visibile tra una
  // voce e l'altra. Un alone dietro l'icona attiva, stessa forma/misura del bottone: si
  // sovrappone perfettamente da fermo (invisibile, perché sotto l'icona già colorata) e si
  // vede SOLO mentre scorre in transizione da una posizione all'altra — misurato dal vivo
  // (data-dock-key su ogni bottone) invece che calcolato a mano, così resta corretto anche
  // se l'ordine o il numero delle voci appuntate cambia.
  const navRef = useRef(null)
  const [indicator, setIndicator] = useState(null) // { left, width } oppure null (nessuna voce attiva da evidenziare)
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

  // Griglia di icone invece della lista (2026-10-31, richiesto dal vivo dopo aver visto un
  // launcher macOS) — stessa logica di navigazione di prima, solo icona sopra + etichetta
  // sotto invece di una riga.
  {/* Icone più grandi + un effetto "ingrandimento" al passaggio del mouse, stile dock
      macOS (richiesto dal vivo con un video di riferimento che non riesco a riprodurre
      direttamente — questa è la mia migliore interpretazione: l'icona cresce e si solleva
      con un'ombra, non solo uno sfondo che cambia). */}
  // Griglia più fitta — 4 colonne, icone 56px invece di 80px, pochissimo padding attorno
  // (2026-10-31, richiesto dal vivo ripetutamente: "troppo spazio tra le icone") — senza
  // etichetta sotto le celle non hanno più bisogno di essere larghe. Un'etichetta vera al
  // passaggio del mouse (non solo il title nativo del browser, troppo lento/invisibile per
  // essere utile: "se passo sopra con il mouse voglio che mi esca l'etichetta") appare
  // subito sopra l'icona via group-hover, sparisce altrettanto in fretta.
  // Niente sfondo attivo sul bottone intero (2026-10-31, segnalato dal vivo: "anche quando
  // selezionata la pagina è bruttissima da vedere") — un rettangolo pieno attorno a
  // un'icona piccola, sproporzionato e brutto. Il riempimento pieno della sola icona
  // (sotto) basta da solo a dire "questa è la pagina attuale".
  const gridTile = (m) => (
    <button key={m.slug} data-tour={'sidebar-' + m.slug} title={m.name} onClick={() => handleNavigate(m.slug)}
      className="group relative flex items-center justify-center p-1 rounded-xl transition hover:bg-white/8">
      <span className={'w-14 h-14 rounded-xl flex items-center justify-center flex-shrink-0 transition-transform duration-150 ease-out group-hover:scale-110 group-hover:shadow-lg ' + (currentPage === m.slug ? 'bg-accent text-white' : 'bg-white/8')} style={currentPage === m.slug ? undefined : { color: m.color }}>
        <Icon name={m.icon} size={22} />
      </span>
      {/* Sotto l'icona, non sopra — sopra veniva tagliata dalla prima riga della griglia
          scorrevole (il suo contenitore inizia subito dopo la ricerca, niente margine per
          farcela stare sopra). */}
      <span className="pointer-events-none absolute top-full mt-1 left-1/2 -translate-x-1/2 whitespace-nowrap bg-black/90 text-white text-[11px] px-2 py-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity duration-100 z-10">
        {m.name}
      </span>
    </button>
  )
  const filtro = navFilter.trim().toLowerCase()
  const passaFiltro = (m) => !filtro || m.name.toLowerCase().includes(filtro)
  const overflowSenzaGruppoF = overflowSenzaGruppo.filter(passaFiltro)
  const overflowConGruppoF = overflowConGruppo.filter(passaFiltro)
  const systemItemsF = systemItems.filter(passaFiltro)
  const nessunRisultato = filtro && !overflowSenzaGruppoF.length && !overflowConGruppoF.length && !systemItemsF.length

  return (
    <>
      {altroOpen && <div className="fixed inset-0 bg-black/30 z-30" onClick={() => { closeAltro(); if (onMobileClose) onMobileClose() }} />}

      {altroOpen && (overflowSenzaGruppo.length > 0 || overflowConGruppo.length > 0 || systemItems.length > 0) && (
        <div ref={panelRef} className="glass-panel fixed left-1/2 z-40 flex flex-col" style={{ transform: 'translateX(-50%)', bottom: 'calc(90px + env(safe-area-inset-bottom))', width: 'min(400px, calc(100vw - 32px))', maxHeight: '70vh', padding: '14px' }}>
          <div className="flex items-center gap-2.5 px-1.5 pb-3 flex-shrink-0">
            {logoUrl ? <img src={logoUrl} alt="" className="w-[24px] h-[24px] rounded-md object-contain flex-shrink-0" /> : <PlatformLogo size={24} letter={hidePlatformName && tenantName ? tenantName.trim()[0] : undefined} />}
            <div className="min-w-0">
              <div className="text-sm text-ink font-bold truncate">{hidePlatformName && tenantName ? tenantName : 'Platform' + (tenantName ? ' ' + tenantName : '')}</div>
              {!hidePlatformName && <div className="text-[11px] text-gray-500">Platform 0.3.56</div>}
            </div>
          </div>
          {/* Ricerca in cima al pannello, stile launcher — spostata qui dalla testa della
              pagina (vedi App.jsx): filtra la griglia sotto mentre si scrive E cerca nei
              record di tutti i moduli (stessa identica GlobalSearch di sempre). */}
          <div className="px-0.5 pb-3 flex-shrink-0">
            <GlobalSearch token={token} onNavigate={handleNavigate} panel onQueryChange={setNavFilter} />
          </div>
          {/* maxHeight fisso invece di flex-1 (2026-10-31, segnalato dal vivo: "troppo spazio
              libero nel launcher") — Safari/WebKit ha un bug noto: flex-grow su un figlio
              dentro un contenitore flex-column il cui UNICO vincolo di altezza è max-height
              (come qui, il pannello sopra) lo fa crescere fino a riempire quel max-height
              anche quando il contenuto reale è molto più corto, lasciando un vuoto enorme
              prima del footer — non riproducibile su Chrome (motore diverso), solo dal vivo
              su iPhone. Un max-height proprio, indipendente dal flex-grow, si adatta sempre
              al contenuto reale e scrolla solo se davvero serve. */}
          <div className="overflow-y-auto border-t border-white/10 pt-3" style={{ maxHeight: 'min(46vh, 380px)' }}>
            {nessunRisultato && <div className="text-center text-sm text-gray-500 py-6">Nessuna voce per "{navFilter}"</div>}
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
          </div>
          <div className="mt-3 pt-3 border-t border-white/10 flex items-center justify-between px-1 flex-shrink-0">
            <button onClick={() => handleNavigate('account')} className={'flex items-center gap-2.5 text-left hover:opacity-80 transition rounded-lg px-2 py-1 -mx-2 ' + (currentPage === 'account' ? 'bg-accent/20' : '')} title="Il mio account">
              <Avatar user={user} size={28} />
              <div className="min-w-0">
                <div className="text-sm text-ink font-medium truncate">{user && user.display_name}</div>
                <div className="text-xs text-gray-500">{user && user.role}</div>
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

      <nav ref={navRef} aria-label="Navigazione principale" className="glass-pill fixed left-1/2 z-40 flex items-center gap-1" style={{ transform: 'translateX(-50%)', bottom: 'calc(18px + env(safe-area-inset-bottom))', padding: '8px 10px' }}>
        {indicator && (
          <div className="absolute top-1.5 bottom-1.5 rounded-full bg-accent/20 pointer-events-none transition-all duration-300 ease-out" style={{ left: indicator.left, width: indicator.width }} />
        )}
        {pinned.map((m) => (
          <DockIcon key={m.slug} slug={m.slug} dockKey={m.slug} name={m.name} icon={m.icon} color={m.color} active={currentPage === m.slug} />
        ))}
        {(overflowSenzaGruppo.length > 0 || overflowConGruppo.length > 0 || systemItems.length > 0) && (
          <>
            <div className="w-px h-6 bg-white/15 mx-1 flex-shrink-0" />
            <div data-dock-altro>
              {/* "grid" invece di "menu" (hamburger) — segnalato dal vivo ("hamburger non mi
                  convince"): l'hamburger legge come "apri la navigazione", confonde qui dove
                  la navigazione principale è già il dock stesso; la griglia dice "altre voci". */}
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
            </div>
          )}
        </div>
        {/* Foto profilo al posto dell'iconcina "user" quando c'è (2026-10-31,
            richiesto dal vivo: "cerchio accanto al nome") — senza foto resta
            DockIcon come ogni altra voce (stesso chip tinto), per non reintrodurre
            l'irregolarità appena corretta sopra con un cerchio di stile diverso. */}
        {user && user.avatar_url ? (
          <button data-dock-key="account" onClick={() => handleNavigate('account')} title={user.display_name || 'Il mio account'}
            className={'relative flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200 ease-out hover:scale-110 ' + (currentPage === 'account' ? 'ring-2 ring-accent' : '')}>
            <Avatar user={user} size={36} />
          </button>
        ) : (
          <DockIcon slug="account" dockKey="account" name={(user && user.display_name) || 'Il mio account'} icon="user" active={currentPage === 'account'} />
        )}
      </nav>

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
    </>
  )
}

export default Sidebar
