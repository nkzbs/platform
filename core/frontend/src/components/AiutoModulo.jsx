import React, { useState } from 'react'
import useApi from '../lib/useApi'
import Portal from './Portal'
import Icon from './Icon'
import CapitoloModulo from './CapitoloModulo'

// Il «?» accanto al titolo di un modulo: apre il capitolo di guida di QUEL modulo (testi del pacchetto, se ci sono, e la parte ricavata dallo schema), senza lasciare la pagina.
export default function AiutoModulo({ mod, token }) {
  const api = useApi(token)
  const [aperto, setAperto] = useState(false)
  const [capitolo, setCapitolo] = useState(null)
  const apri = () => {
    setAperto(true)
    if (capitolo === null) api.get('/guida').then((g) => setCapitolo((g && g.capitoli && g.capitoli[mod.slug]) || {})).catch(() => setCapitolo({}))
  }
  return (
    <>
      <button type="button" onClick={apri} aria-label={'Aiuto: come si usa ' + mod.name} title={'Come si usa ' + mod.name} className="w-7 h-7 rounded-full border border-gray-700 text-gray-400 hover:text-accent hover:border-accent flex items-center justify-center text-sm font-semibold flex-shrink-0 transition">?</button>
      {aperto && (
        <Portal>
          <div className="fixed inset-0 bg-black/70 flex items-start sm:items-center justify-center z-50 p-3" onClick={() => setAperto(false)}>
            <div role="dialog" aria-label={'Come si usa ' + mod.name} onClick={(e) => e.stopPropagation()} className="bg-surface-card rounded-md p-5 sm:p-6 w-full max-w-xl border border-gray-800 max-h-[88vh] overflow-y-auto">
              <div className="flex items-center gap-2 mb-4">
                <h2 className="flex-1 text-base font-bold text-ink">Come si usa «{mod.name}»</h2>
                <button type="button" onClick={() => setAperto(false)} aria-label="Chiudi" className="text-gray-500 hover:text-ink"><Icon name="x" size={16} /></button>
              </div>
              {capitolo === null ? <div className="text-sm text-gray-600">Caricamento…</div> : <CapitoloModulo modulo={mod} capitolo={capitolo} />}
            </div>
          </div>
        </Portal>
      )}
    </>
  )
}
