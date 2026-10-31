import React from 'react'
import PlatformLogo from './PlatformLogo'

// Sfondo "Liquid Glass" condiviso — lo sfumato dietro i pannelli di vetro (vedi
// .glass-mesh-bg/.glass-panel in index.css), estratto da DashboardPage.jsx (2026-10-31,
// richiesto dall'utente: "aggiornare al liquid glass anche il resto della piattaforma,
// 100% delle pagine") per non duplicare lo stesso markup in ogni pagina top-level che lo
// usa — un solo punto da cui cambiare logo/sfocatura/colori in futuro. Chi lo usa avvolge
// SOLO il proprio contenuto qui dentro: eventuali modali/drawer della pagina restano
// FUORI (come già in DashboardPage), apposta per non finire dentro il containing block
// creato dal backdrop-filter (vedi FormDrawer.jsx).
function GlassPageBackground({ children }) {
  return (
    <div className="relative">
      <div className="glass-mesh-bg" aria-hidden="true">
        <div className="glass-mesh-logo">
          <PlatformLogo size={520} />
        </div>
      </div>
      <div className="relative z-10">{children}</div>
    </div>
  )
}

export default GlassPageBackground
