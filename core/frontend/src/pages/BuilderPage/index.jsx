import React, { useState } from 'react'
import SharedBuilder from '@shared/builder/index.jsx'
import useApi from '../../lib/useApi'
import Icon from '../../components/Icon'
import ProponiAllaLibreriaModal from '../../components/ProponiAllaLibreria'
import GlassPageBackground from '../../components/GlassPageBackground'

// Il Builder è uno solo, in shared/frontend/builder/ (lo usa anche Super Admin — NON
// toccato qui per non retemare anche quella UI, che ha un suo linguaggio visivo a sé).
// Qui sul tenant aggiunge solo la «promozione» del modulo aperto (Proponi alla Libreria)
// e lo sfondo di vetro dietro — solo l'ambiente, i pannelli interni di SharedBuilder
// restano come sono.
export default function BuilderPage(props) {
  const api = useApi(props.token)
  const [proposta, setProposta] = useState(null)
  return (
    <GlassPageBackground>
      <SharedBuilder {...props} moduleActions={(mod) => mod && (
        <button onClick={() => setProposta(mod)} title="Manda la struttura di questo modulo a Super Admin: se la approva entra nella Libreria per tutti"
          className="text-xs text-gray-500 hover:text-ink transition flex items-center gap-1"><Icon name="upload" size={12} />Proponi alla Libreria</button>
      )} />
      {proposta && <ProponiAllaLibreriaModal api={api} module={proposta} onClose={() => setProposta(null)} />}
    </GlassPageBackground>
  )
}
