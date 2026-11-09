import React, { useState, useEffect, useRef } from 'react'
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
  // Collaudo: parte in background sul server (in una copia isolata); qui si legge l'esito ogni 2 secondi finché non finisce.
  const [col, setCol] = useState(null)
  const timer = useRef(null)
  useEffect(() => () => clearInterval(timer.current), [])
  const leggiCollaudo = async () => {
    const r = await api.get('/builder/collaudo')
    if (!r) return
    setCol(r)
    if (r.stato !== 'in_corso') clearInterval(timer.current)
  }
  const avviaCollaudo = async () => {
    setCol({ stato: 'in_corso', avanzamento: ['Avvio…'] })
    const r = await api.post('/builder/collaudo', {})
    if (!r || !r.ok) { setCol({ stato: 'errore', errore: (r && r.data && r.data.error) || 'Collaudo non avviato.' }); return }
    clearInterval(timer.current); timer.current = setInterval(leggiCollaudo, 2000)
  }
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
        <button onClick={avviaCollaudo} disabled={col && col.stato === 'in_corso'} title="Prova i flussi per davvero in una copia del tenant: crea record, fa avanzare gli stati, controlla automazioni e documenti. I dati veri non si toccano." className="text-xs bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-200 px-3 py-1.5 rounded-lg transition">{col && col.stato === 'in_corso' ? 'Collaudo in corso…' : 'Collaudo completo'}</button>
        <button onClick={esegui} disabled={busy} className="text-xs bg-accent hover:opacity-90 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg transition font-medium">{busy ? 'Controllo…' : v ? 'Ricontrolla' : 'Controlla'}</button>
      </div>
      {err && <div className="text-xs text-amber-500 mt-2">{err}</div>}
      {col && (
        <div className="mt-3 pt-3 border-t border-gray-800 text-xs space-y-2">
          <div className="flex items-center gap-3">
            <div className="font-medium text-ink flex-1">Collaudo completo</div>
            {col.stato === 'finito' && col.risultato && <div className={'text-lg font-semibold ' + (col.risultato.punteggio >= 95 ? 'text-emerald-500' : col.risultato.punteggio >= 80 ? 'text-amber-500' : 'text-red-500')}>{col.risultato.punteggio}<span className="text-xs text-gray-500 font-normal"> / 100</span></div>}
          </div>
          {col.stato === 'in_corso' && <div className="text-gray-400">{(col.avanzamento || []).slice(-1)[0] || 'Un momento…'} <span className="text-gray-600">(circa un minuto; lavora su una copia, i dati veri non si toccano)</span></div>}
          {col.stato === 'errore' && <div className="text-amber-500">{col.errore}</div>}
          {col.stato === 'finito' && col.risultato && (
            <>
              <div className="text-gray-400">{col.risultato.superati} prove superate su {col.risultato.controlli}, in {col.risultato.moduli} moduli.{col.risultato.problemi.length === 0 ? ' Tutto funziona.' : ''}</div>
              {col.risultato.problemi.length > 0 && <ul className="space-y-1">{col.risultato.problemi.map((p, i) => <li key={i} className="text-gray-300"><span className="text-gray-500">{p.modulo} · {p.blocco}:</span> {p.messaggio}</li>)}</ul>}
              {col.risultato.effetti_automazioni.length > 0 && (
                <div className="text-gray-400">Cosa hanno prodotto le automazioni: {col.risultato.effetti_automazioni.map((e) => e.prodotti + ' record in «' + e.in + '» quando «' + e.modulo + '» arriva a «' + e.stato + '»').join(' · ')}.</div>
              )}
            </>
          )}
        </div>
      )}
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
