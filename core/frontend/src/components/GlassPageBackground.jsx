import React from 'react'
import PlatformLogo from './PlatformLogo'
import { useIdentitaApp } from './IdentitaApp'
import Icon from './Icon'

// Sfondo "Liquid Glass" condiviso — lo sfumato dietro i pannelli di vetro (vedi
// .glass-mesh-bg/.glass-panel in index.css), estratto da DashboardPage.jsx (2026-10-31,
// richiesto dall'utente: "aggiornare al liquid glass anche il resto della piattaforma,
// 100% delle pagine") per non duplicare lo stesso markup in ogni pagina top-level che lo
// usa — un solo punto da cui cambiare logo/sfocatura/colori in futuro. Chi lo usa avvolge
// SOLO il proprio contenuto qui dentro: eventuali modali/drawer della pagina restano
// FUORI (come già in DashboardPage), apposta per non finire dentro il containing block
// creato dal backdrop-filter (vedi FormDrawer.jsx).
// `colore` + `icona` (opzionali, quelli del modulo della pagina) danno alla sezione il suo sfondo: alone del colore, motivo a punti e l'icona grande e trasparente.
// Senza, resta lo sfondo di Platform (marchio sfumato).
function GlassPageBackground({ children, colore, icona }) {
  // Il marchio sfumato dietro i pannelli è quello dell'app: il logo scelto in Aspetto (stessa sfocatura e trasparenza di .glass-mesh-logo, valgono per qualunque immagine);
  // senza un logo, il marchio Platform o l'iniziale del nome scelto.
  const { logoUrl, letter } = useIdentitaApp()
  return (
    <div className="relative">
      <div className={'glass-mesh-bg' + (colore ? ' sezione' : '')} aria-hidden="true" style={colore ? { '--sez': colore } : undefined}>
        {colore ? (
          <>
            <div className="sezione-punti" />
            <div className="sezione-icona"><Icon name={icona || 'box'} size={380} /></div>
          </>
        ) : (
          <div className="glass-mesh-logo">
            {logoUrl
              ? <img src={logoUrl} alt="" style={{ width: 520, height: 520, objectFit: 'contain', display: 'block' }} />
              : <PlatformLogo size={520} letter={letter} />}
          </div>
        )}
      </div>
      <div className="relative z-10">{children}</div>
    </div>
  )
}

export default GlassPageBackground
