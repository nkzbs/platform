import React, { useState, useEffect } from 'react'
import useApi from '../lib/useApi'
import Icon from './Icon'

// «Collega i moduli»: le relazioni che mancano tra i moduli installati, proposte dal nome (es. «Righe ordine» → «Ordini»). Si spuntano
// quelle giuste e si conferma: nessun collegamento nasce da solo. Il campo di testo che c'era resta com'è (si toglie dal Builder).
export default function CollegaModuli({ token, onClose, onDone }) {
  const api = useApi(token)
  const [lista, setLista] = useState(null)
  const [scelte, setScelte] = useState({})
  const [stato, setStato] = useState({ busy: false, esito: null, errore: '' })
  useEffect(() => {
    api.get('/modules/collegamenti/proposte').then((d) => {
      const l = Array.isArray(d) ? d : []
      setLista(l); setScelte(Object.fromEntries(l.map((p) => [p.da + '>' + p.a, true])))
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const scelti = (lista || []).filter((p) => scelte[p.da + '>' + p.a])
  const applica = async () => {
    setStato({ busy: true, esito: null, errore: '' })
    const r = await api.post('/modules/collegamenti/applica', { links: scelti.map((p) => ({ da: p.da, a: p.a })) })
    if (r.ok) { setStato({ busy: false, esito: r.data, errore: '' }); if (onDone) onDone() } else setStato({ busy: false, esito: null, errore: (r.data && r.data.error) || 'Non riuscito.' })
  }
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => !stato.busy && onClose()}>
      <div className="bg-surface-card rounded-xl w-full max-w-lg border border-gray-800 p-5 max-h-[88vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-ink mb-1 flex items-center gap-2"><Icon name="link" size={16} />Collega i moduli</h2>
        {stato.esito ? (
          <>
            <p className="text-sm text-ink mt-2">{stato.esito.creati.length} collegamenti creati.{stato.esito.saltati.length > 0 ? ' ' + stato.esito.saltati.length + ' saltati.' : ''}</p>
            <p className="text-xs text-gray-500 mt-1">Li ritrovi nel Builder, in ogni modulo, come campo «relazione».</p>
            <button onClick={onClose} className="mt-4 text-sm px-4 py-2 rounded-lg bg-accent hover:opacity-90 text-white">Chiudi</button>
          </>
        ) : lista === null ? <p className="text-sm text-gray-500 mt-2">Guardo i moduli…</p>
        : lista.length === 0 ? (
          <>
            <p className="text-sm text-gray-400 mt-2">Non vedo collegamenti ovvi da proporre. Quelli che servono li crei nel Builder, in un modulo, con un campo «relazione».</p>
            <button onClick={onClose} className="mt-4 text-sm px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300">Chiudi</button>
          </>
        ) : (
          <>
            <p className="text-xs text-gray-500 mb-3">Proposti guardando i nomi dei moduli e dei campi. Togli la spunta a quelli che non servono: ogni riga è «questo modulo punta a quest'altro».</p>
            <div className="divide-y divide-gray-800 border border-gray-800 rounded-lg">
              {lista.map((p) => {
                const k = p.da + '>' + p.a
                return (
                  <label key={k} className="flex items-start gap-3 px-3 py-2.5 cursor-pointer hover:bg-gray-800/40">
                    <input type="checkbox" className="mt-1 flex-shrink-0" checked={!!scelte[k]} onChange={() => setScelte((s) => ({ ...s, [k]: !s[k] }))} />
                    <div className="min-w-0 text-sm"><div className="text-ink">{p.da_nome} <span className="text-gray-500">→</span> {p.a_nome}</div><div className="text-xs text-gray-500">{p.motivo}</div></div>
                  </label>
                )
              })}
            </div>
            {stato.errore && <div className="text-xs text-amber-400 mt-2">{stato.errore}</div>}
            <div className="flex gap-2 mt-4 justify-end">
              <button onClick={onClose} disabled={stato.busy} className="text-sm px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300">Non ora</button>
              <button onClick={applica} disabled={stato.busy || !scelti.length} className="text-sm px-4 py-2 rounded-lg bg-accent hover:opacity-90 disabled:opacity-50 text-white">{stato.busy ? 'Creo…' : 'Crea ' + scelti.length + ' collegamenti'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
