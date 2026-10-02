import React from 'react'

// Nuovo marchio (2026-08-29, richiesto esplicitamente dall'utente dopo averlo
// visto nel catalogo di progetto docs/platform-catalogo.html): quadrato
// arrotondato con un incavo a due riquadri sfalsati (uno grande in alto a
// sinistra, uno piccolo in basso a destra). Sfondo: stesso gradiente diagonale
// blu→viola della vecchia griglia a 4 riquadri (#2563EB→#7C3AED) — due giri
// intermedi (nero, poi blu pieno) scartati dall'utente, il gradiente storico
// resta l'identità voluta. Colore fisso, non legato al tema chiaro/scuro.
function PlatformLogo({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
      <rect x="0" y="0" width="40" height="40" rx="10" fill="url(#pmg)" />
      <rect x="7" y="7" width="15" height="15" rx="3" fill="#f5f5f4" />
      <rect x="22" y="22" width="11" height="11" rx="2.5" fill="#f5f5f4" />
      <defs>
        <linearGradient id="pmg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#2563EB" />
          <stop offset="100%" stopColor="#7C3AED" />
        </linearGradient>
      </defs>
    </svg>
  )
}

export default PlatformLogo
