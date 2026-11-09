import React, { useState } from 'react'
import useApi from '../lib/useApi'

// Impostazioni → Moduli: «Controlla il tenant». Legge tutti gli schemi installati e dice quanti riferimenti stanno in piedi (relazioni, stati, requisiti, automazioni, documenti, viste, calcoli).
// Sola lettura: non crea né cambia nulla. Le cose che può mettere solo una persona (servizi esterni da collegare) stanno in un elenco a parte e non tolgono punti.
const TITOLI = { flusso: 'Flussi e stati', requisiti: 'Requisiti per stato', relazioni: 'Relazioni', automazioni: 'Automazioni', documenti: 'Documenti', viste: 'Viste (calendario, mappa, abbinamento)', permessi: 'Ruoli e permessi', calcoli: 'Calcoli' }
export default function VerificaTenantPanel({ token }) {
  const api = useApi(token)
  const [v, setV] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [aperto, setAperto] = useState(false)
  const esegui = async () => {
    setBusy(true); setErr('')
    const r = await api.get('/builder/verifica')
    setBusy(false)
    if (!r || r.error) { setErr((r && r.error) || 'Controllo non riuscito.'); return }
    setV(r); setAperto(true)
  }
  const colore = !v ? '' : v.punteggio >= 95 ? 'text-emerald-500' : v.punteggio >= 80 ? 'text-amber-500' : 'text-red-500'
  return (
    <div className="glass-panel p-3 mb-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-ink">Controlla il tenant</div>
          <div className="text-xs text-gray-500">Verifica che relazioni, stati, requisiti, automazioni, documenti e viste dei moduli stiano in piedi. Non cambia nulla.</div>
        </div>
        {v && <div className={'text-2xl font-semibold ' + colore} aria-label={'Punteggio ' + v.punteggio + ' su 100'}>{v.punteggio}<span className="text-xs text-gray-500 font-normal"> / 100</span></div>}
        <button onClick={esegui} disabled={busy} className="text-xs bg-accent hover:opacity-90 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg transition font-medium">{busy ? 'Controllo…' : v ? 'Ricontrolla' : 'Controlla'}</button>
      </div>
      {err && <div className="text-xs text-amber-500 mt-2">{err}</div>}
      {v && aperto && (
        <div className="mt-3 pt-3 border-t border-gray-800 text-xs space-y-3">
          <div className="text-gray-400">{v.superati} controlli superati su {v.controlli}, in {v.moduli} moduli.{v.problemi.length === 0 ? ' Nessun problema.' : ''}</div>
          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1">
            {Object.entries(v.categorie).map(([k, c]) => (
              <div key={k} className="flex justify-between gap-3"><span className="text-gray-300">{TITOLI[k] || k}</span><span className={c.superati === c.controlli ? 'text-emerald-500' : 'text-amber-500'}>{c.superati} / {c.controlli}</span></div>
            ))}
          </div>
          {v.problemi.length > 0 && (
            <div>
              <div className="font-medium text-ink mb-1">Da sistemare ({v.problemi.length})</div>
              <ul className="space-y-1">
                {v.problemi.map((p, i) => <li key={i} className="text-gray-300"><span className="text-gray-500">{p.modulo} · {p.blocco}:</span> {p.messaggio}</li>)}
              </ul>
            </div>
          )}
          {v.da_completare_a_mano.length > 0 && (
            <div>
              <div className="font-medium text-ink mb-1">Da completare a mano ({v.da_completare_a_mano.length})</div>
              <ul className="space-y-1">
                {v.da_completare_a_mano.map((m, i) => <li key={i} className="text-gray-400"><span className="text-gray-500">{m.modulo}:</span> {m.cosa} <span className="text-gray-600">({m.dove})</span></li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
