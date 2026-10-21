import React, { useState } from 'react'
import Icon from './Icon'
import PlatformLogo from './PlatformLogo'
import { NAV_ITEMS, MENU_HIDDEN } from '../lib/nav-items'

// Semplificazione 2026-09-27: rimossa la modalità 'partner' (side project a
// uso personale, un solo pannello, un solo utente — vedi nav-items.js).
function Sidebar({ page, onNavigate, onLogout, mobileOpen, onMobileClose, payload, token }) {
  const items = NAV_ITEMS.filter((i) => !MENU_HIDDEN.has(i.id))
  const brandLabel = 'Admin'
  // Numero di versione annotato a mano a ogni chiusura di fase, non il version del package.json.
  const brandSub = 'versione 0.3.8'
  // Chiude subito l'espansione al click (2026-08-29, bug reale trovato dal
  // vivo): senza, il cursore resta fermo sopra la voce appena cliccata e la
  // sidebar resta espansa SOPRA il contenuto appena caricato (nessun reflow,
  // vedi nota sopra su `expanded`) finché il mouse non si sposta davvero —
  // titolo/prima colonna della pagina nuova restano coperti nel frattempo.
  const handleNavigate = (id) => { setHovered(false); onNavigate(id); if (onMobileClose) onMobileClose() }
  // Stretta a riposo (solo icone), si allarga al passaggio del mouse — stesso
  // pattern già in uso nell'app tenant (core/frontend/Sidebar.jsx), richiesto
  // dall'utente anche qui. Fixed, quindi l'espansione copre il contenuto
  // (nessun reflow di <main>, che resta sempre a ml-14).
  // Bug reale segnalato dall'utente ("l'hamburger in partner mostra Core"):
  // su mobile `mobileOpen` apriva il pannello ma l'espansione dipendeva SOLO
  // da `hovered`, che su touch non scatta mai — il menu aperto mostrava solo
  // icone, mai le etichette (incluso il nome brand Core/Partner), leggibile
  // solo passando davvero il mouse (desktop) o mai (touch). Aprire il menu
  // mobile deve mostrare le etichette per definizione, non serve l'hover.
  const [hovered, setHovered] = useState(false)
  const expanded = hovered || mobileOpen
  // Tema chiaro/scuro — stesso meccanismo dell'app tenant (core/frontend/Sidebar.jsx).
  // PLATFORM-UI-RESKIN-PLAN.md, Fase 1 (2026-08-23): DEFAULT ora SCURO (era
  // chiaro dal 2026-08-15) — il mockup di riferimento è solo scuro. Il chiaro
  // resta scelto esplicitamente, invertito rispetto a prima. Applicato anche
  // prima del mount in index.html (evita il lampo di tema sbagliato al refresh).
  const [theme, setTheme] = useState(() => localStorage.getItem('platform_theme') || 'dark')
  const toggleTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light'
    setTheme(next)
    localStorage.setItem('platform_theme', next)
    if (next === 'light') document.documentElement.setAttribute('data-theme', 'light')
    else document.documentElement.removeAttribute('data-theme')
  }

  return (
    <>
      {mobileOpen && (
        <div className="fixed inset-0 bg-black/60 z-30 md:hidden" onClick={onMobileClose} />
      )}
      {/* PLATFORM-UI-RESKIN-PLAN.md, Fase 2 — larghezza espansa passata a
          w-36 (144px, il brief chiede 145px fisso) mantenendo però il
          comportamento a riposo/hover già costruito su richiesta esplicita
          dell'utente (non negoziabile romperlo per un cambio di stile): il
          mockup non prevede un collasso, ma qui resta perché è una funzione
          reale già in uso, non solo estetica. */}
      <div onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
        className={(expanded ? 'w-56' : 'w-14') + ' bg-surface-card border-r border-gray-800 flex flex-col h-screen h-[100dvh] fixed left-0 top-0 z-40 transition-[width,transform] duration-150 md:translate-x-0 ' + (expanded ? 'shadow-2xl' : '') + ' ' + (mobileOpen ? 'translate-x-0' : '-translate-x-full')}>
        <div className={(expanded ? 'px-5' : 'px-3') + ' py-5 border-b border-gray-800'}>
          <div className="flex items-center gap-2.5">
            <PlatformLogo size={28} />
            {expanded && (
              <div>
                <div className="text-base text-ink tracking-tight"><span className="font-bold">Platform</span> <span className="font-normal">{brandLabel}</span></div>
                <div className="text-xs text-gray-500">{brandSub}</div>
              </div>
            )}
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto py-3">
          {items.map((item) => (
            <button
              key={item.id}
              onClick={() => handleNavigate(item.id)}
              title={!expanded ? item.label : undefined}
              className={
                'w-full flex items-center gap-2.5 py-2.5 text-sm transition ' + (expanded ? 'px-3' : 'justify-center px-2') + ' ' +
                (page === item.id
                  // text-white fisso, non text-ink (2026-09-07, segnalato dall'utente
                  // su schermata reale in tema chiaro): bg-cp-nav-active è lo stesso
                  // blu navy scuro in ENTRAMBI i temi (mai swappato in
                  // :root[data-theme="light"]), ma text-ink sì — in chiaro diventava
                  // quasi nero su blu scuro, illeggibile. Stesso bug già corretto una
                  // volta per i badge di stato (28/08), qui mancato.
                  ? 'bg-cp-nav-active text-white'
                  : 'text-gray-400 hover:text-ink hover:bg-white/5')
              }
            >
              <span style={page === item.id ? undefined : { color: item.color }}><Icon name={item.icon} size={16} /></span>
              {expanded && <span className="truncate">{item.label}</span>}
            </button>
          ))}
        </nav>
        <div className={(expanded ? 'px-4' : 'px-2') + ' py-4 border-t border-gray-800'} style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
          <div className={!expanded ? 'flex flex-col items-center gap-3' : 'flex items-center justify-between'}>
            {expanded && (
              <button onClick={() => handleNavigate('impostazioni')} className="text-left hover:opacity-80 transition min-w-0" title="Il mio account">
                <div className="text-xs text-ink font-medium truncate">{payload && payload.username}</div>
                <div className="text-[10px] text-gray-500 truncate">{payload && payload.role}</div>
              </button>
            )}
            {!expanded && (
              <button onClick={() => handleNavigate('impostazioni')} className="w-7 h-7 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-gray-400 hover:text-ink transition" title={(payload && payload.username) || 'Il mio account'}>
                <Icon name="user" size={13} />
              </button>
            )}
            <div className={!expanded ? 'flex flex-col items-center gap-3' : 'flex items-center gap-2.5 flex-shrink-0'}>
              <button onClick={toggleTheme} className="text-gray-500 hover:text-ink transition" title={theme === 'dark' ? 'Passa al tema chiaro' : 'Passa al tema scuro'}>
                <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={14} />
              </button>
              <button onClick={() => handleNavigate('impostazioni')} className="text-gray-500 hover:text-ink transition" title="Password e sicurezza">
                <Icon name="key" size={14} />
              </button>
              <button onClick={onLogout} className="text-gray-500 hover:text-ink transition" title="Esci">
                <Icon name="logout" size={15} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

export default Sidebar
