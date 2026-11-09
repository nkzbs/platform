import React, { useState, useEffect } from 'react'
import useApi from '../lib/useApi'

// Impostazioni → Moduli: «Dati di esempio». Carica qualche scheda inventata in ogni modulo (collegate tra loro e sparse sugli stati del flusso) per provare o mostrare il tenant; si tolgono tutte insieme.
// I dati veri non si toccano: i record di esempio portano un segno e solo quelli si cancellano. Non fanno partire automazioni, mail o avvisi.
export default function DatiEsempioPanel({ token }) {
  const api = useApi(token)
  const [d, setD] = useState(null)
  const [quanti, setQuanti] = useState(5)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(''); const [err, setErr] = useState('')
  const carica = async () => { const r = await api.get('/builder/dati-esempio'); if (r && !r.error) setD(r) }
  useEffect(() => { carica() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const avvisa = (m, e = false) => { e ? setErr(m) : setMsg(m); setTimeout(() => { setMsg(''); setErr('') }, 4000) }
  const aggiungi = async () => {
    setBusy(true); const r = await api.post('/builder/dati-esempio', { quanti }); setBusy(false)
    if (!r.ok) { avvisa((r.data && r.data.error) || 'Non riuscito.', true); return }
    avvisa('Caricati: ' + Object.entries(r.data.creati).map(([m, n]) => n + ' in «' + m + '»').join(' · ') + '.'); carica()
  }
  const togli = async () => {
    if (!window.confirm('Togliere tutti i dati di esempio? I dati veri non si toccano.')) return
    setBusy(true); const r = await api.del('/builder/dati-esempio'); setBusy(false)
    if (!r.ok) { avvisa('Rimozione non riuscita.', true); return }
    avvisa('Tolti: ' + (Object.entries(r.data.rimossi || {}).map(([m, n]) => n + ' in «' + m + '»').join(' · ') || 'niente') + '.'); carica()
  }
  if (!d) return null
  return (
    <div className="glass-panel p-3 mb-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-ink">Dati di esempio</div>
          <div className="text-xs text-gray-500">{d.totale > 0 ? 'Presenti: ' + Object.entries(d.presenti).map(([m, n]) => n + ' in «' + m + '»').join(' · ') + '.' : 'Qualche scheda inventata in ogni modulo, collegate tra loro e sparse sugli stati, per provare o mostrare il tenant. Non parte nessuna automazione né mail.'}</div>
        </div>
        {d.totale > 0 ? (
          <button onClick={togli} disabled={busy} className="text-xs bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-200 px-3 py-1.5 rounded-lg transition">Togli i dati di esempio</button>
        ) : (
          <>
            <label className="text-xs text-gray-500 flex items-center gap-1.5">schede per modulo <input type="number" min="1" max="30" value={quanti} onChange={(e) => setQuanti(e.target.value)} className="w-16 bg-surface-card border border-gray-700 rounded-lg px-2 py-1 text-sm text-ink" /></label>
            <button onClick={aggiungi} disabled={busy} className="text-xs bg-accent hover:opacity-90 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg transition font-medium">{busy ? 'Carico…' : 'Carica i dati di esempio'}</button>
          </>
        )}
      </div>
      {msg && <div className="text-xs text-emerald-500 mt-2">{msg}</div>}{err && <div className="text-xs text-amber-500 mt-2">{err}</div>}
    </div>
  )
}
