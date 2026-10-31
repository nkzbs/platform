import React from 'react'
import PlatformLogo from './PlatformLogo'

// Sfondo "Liquid Glass" condiviso — copia di core/frontend/src/components/GlassPageBackground.jsx
// (2026-11-01, "anche super admin aggiornato al Liquid Glass"). Stessa scelta di tenerli come due
// file separati invece di uno condiviso in shared/: qui vive sotto PlatformLogo di QUESTA app,
// non quello del tenant — null in più da gestire per un vantaggio minimo.
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
