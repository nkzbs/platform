import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import useApi from '../lib/useApi'
import Icon from './Icon'

// «Parti da un modello»: i verticali proposti (gruppi di moduli che funzionano insieme) a tessere. Un tocco apre l'elenco dei moduli: si toglie
// la spunta a quelli che non servono e si installa il resto in un colpo solo (i moduli già presenti restano come sono). Poi si collegano e si
// modificano come tutti gli altri. Se la Libreria non risponde o non ci sono verticali, la sezione non compare.
// Il testo della guida all'uso di un modello: da dove cominciare e, per ogni modulo, a cosa serve e cosa si compila. Viene da Super Admin, costruita dagli
// schemi dei moduli (nessun testo scritto per un settore).
function GuidaTesto({ v, chiaro }) {
  const g = v.guida
  const t = chiaro ? { ink: '#1c1917', sub: '#57534e', line: '#e7e5e4' } : { ink: 'var(--ink, #e5e7eb)', sub: '#9ca3af', line: '#374151' }
  if (!g) return <p className="text-sm text-gray-500">Per questo modello non c'è ancora una guida.</p>
  return (
    <div style={{ color: t.ink, fontSize: 13.5, lineHeight: 1.55 }}>
      <p style={{ margin: '0 0 8px', color: t.sub }}>{v.description}</p>
      <h3 style={{ fontSize: 14, fontWeight: 600, margin: '10px 0 4px' }}>Da dove cominciare</h3>
      <ol style={{ margin: 0, paddingLeft: 20 }}>
        <li>Installa i moduli e usa «Collega i moduli» per creare i collegamenti tra loro.</li>
        <li>Inserisci i dati in quest'ordine, perché ogni modulo si appoggia ai precedenti: <b>{g.ordine.join(' → ')}</b>.</li>
        <li>Aggiungi le persone in Impostazioni → Utenti &amp; Ruoli e, se serve, gli avvisi in Impostazioni → Connessioni.</li>
      </ol>
      <h3 style={{ fontSize: 14, fontWeight: 600, margin: '14px 0 4px' }}>Modulo per modulo</h3>
      {g.moduli.map((m) => (
        <div key={m.nome} style={{ borderTop: '1px solid ' + t.line, padding: '8px 0', breakInside: 'avoid' }}>
          <div style={{ fontWeight: 600 }}>{m.nome}</div>
          {m.descrizione && <div style={{ color: t.sub }}>{m.descrizione}</div>}
          {m.campi.length > 0 && <div><b>Si compila: </b>{m.campi.map((f) => f.nome).join(', ')}.</div>}
          {m.stati.length > 0 && <div><b>Stati: </b>{m.stati.join(' → ')}.</div>}
          {m.collegamenti.length > 0 && <div><b>Si collega a: </b>{m.collegamenti.join(', ')}.</div>}
        </div>
      ))}
    </div>
  )
}

export default function VerticaliLibreria({ token, installatiSlugs, onInstalled, richiestaGuida, onGuidaAperta }) {
  const api = useApi(token)
  const [verticali, setVerticali] = useState([])
  const [aperto, setAperto] = useState(null)
  const [scelti, setScelti] = useState([])
  const [stato, setStato] = useState({ busy: false, errore: '' })
  const [scheda, setScheda] = useState('moduli') // 'moduli' | 'guida'
  useEffect(() => { api.get('/modules/registry-verticals').then((d) => Array.isArray(d) && setVerticali(d)) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // «Guida del modello» dal messaggio dopo un'installazione: riapre quel modello direttamente sulla guida.
  useEffect(() => {
    if (!richiestaGuida) return
    const v = verticali.find((x) => x.id === richiestaGuida)
    if (v) { setAperto(v); setScheda('guida'); setStato({ busy: false, errore: '' }) }
    if (onGuidaAperta) onGuidaAperta()
  }, [richiestaGuida, verticali.length]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!verticali.length) return null

  const apri = (v) => { setScheda('moduli'); setAperto(v); setScelti(v.moduli.filter((m) => !installatiSlugs.has(m.slug)).map((m) => m.id)); setStato({ busy: false, errore: '' }) }
  const chiudi = () => { if (!stato.busy) setAperto(null) }
  const installa = async () => {
    setStato({ busy: true, errore: '' })
    const r = await api.post('/modules/registry/bulk-install', { ids: scelti })
    if (r.ok) { setStato({ busy: false, errore: '' }); setAperto(null); onInstalled(r.data, aperto) } else setStato({ busy: false, errore: (r.data && r.data.error) || 'Installazione non riuscita.' })
  }
  const toggle = (id) => setScelti((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))

  return (
    <div data-tour="libreria-modelli" className="mb-6">
      <h2 className="text-sm font-semibold text-ink mb-1">Parti da un modello</h2>
      <p className="text-gray-500 text-xs mb-3">Un gruppo di moduli già pensati per funzionare insieme. Scegli quali tenere, poi li modifichi come tutti gli altri.</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {verticali.map((v) => {
          const presenti = v.moduli.filter((m) => installatiSlugs.has(m.slug)).length
          return (
            <button key={v.id} onClick={() => apri(v)} className="glass-panel hover:bg-white/5 transition p-4 flex flex-col items-center text-center gap-2">
              <div className="w-12 h-12 rounded-xl bg-accent/15 text-accent flex items-center justify-center"><Icon name={v.icon || 'box'} size={22} /></div>
              <div className="text-ink font-medium text-sm">{v.name}</div>
              <div className="text-[11px] text-gray-500">{v.moduli.length} moduli{presenti > 0 ? ' · ' + presenti + ' già installati' : ''}</div>
            </button>
          )
        })}
      </div>

      {aperto && scheda === 'guida' && createPortal(
        <div className="guida-stampa-portal" style={{ display: 'none', background: '#fff', color: '#1c1917', padding: 24, fontFamily: 'system-ui,-apple-system,sans-serif' }}>
          <style>{'@media print{body > *:not(.guida-stampa-portal){display:none!important}.guida-stampa-portal{display:block!important}@page{size:A4;margin:16mm 14mm}}'}</style>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.08em', color: '#78716c', fontWeight: 700 }}>Guida all'uso</div>
          <h1 style={{ fontSize: 24, margin: '2px 0 8px', fontWeight: 600 }}>{aperto.name}</h1>
          <GuidaTesto v={aperto} chiaro />
        </div>, document.body)}

      {aperto && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={chiudi}>
          <div className="bg-surface-card rounded-xl w-full max-w-md border border-gray-800 p-5 max-h-[88vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-ink mb-2">{aperto.name}</h2>
            <div className="flex gap-1 mb-3 border-b border-gray-800">
              {[['moduli', 'Moduli'], ['guida', 'Come si usa']].map(([k, l]) => <button key={k} onClick={() => setScheda(k)} className={'text-sm px-3 py-2 -mb-px border-b-2 transition ' + (scheda === k ? 'border-accent text-ink' : 'border-transparent text-gray-500 hover:text-ink')}>{l}</button>)}
            </div>
            {scheda === 'guida' ? (
              <>
                <GuidaTesto v={aperto} />
                <button onClick={() => window.print()} className="mt-3 text-xs px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200 flex items-center gap-1.5"><Icon name="download" size={12} />Stampa o salva in PDF</button>
              </>
            ) : (
              <>
                {aperto.description && <p className="text-sm text-gray-400 mb-3">{aperto.description}</p>}
                <div className="divide-y divide-gray-800 border border-gray-800 rounded-lg">
                  {aperto.moduli.map((m) => {
                    const gia = installatiSlugs.has(m.slug)
                    return (
                      <label key={m.id} className={'flex items-start gap-3 px-3 py-2.5 ' + (gia ? 'opacity-60' : 'cursor-pointer hover:bg-gray-800/40')}>
                        <input type="checkbox" className="mt-1 flex-shrink-0" disabled={gia} checked={gia || scelti.includes(m.id)} onChange={() => toggle(m.id)} />
                        <div className="min-w-0"><div className="text-sm text-ink">{m.name}{gia ? <span className="text-xs text-gray-500"> · già installato</span> : null}</div>{m.description && <div className="text-xs text-gray-500 line-clamp-2">{m.description}</div>}</div>
                      </label>
                    )
                  })}
                </div>
                <p className="text-xs text-gray-500 mt-2">I moduli di cui questi hanno bisogno (per esempio i clienti) vengono aggiunti da soli.</p>
              </>
            )}
            {stato.errore && <div className="text-xs text-amber-400 mt-2">{stato.errore}</div>}
            <div className="flex gap-2 mt-4 justify-end">
              <button onClick={chiudi} disabled={stato.busy} className="text-sm px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300">{scheda === 'guida' ? 'Chiudi' : 'Annulla'}</button>
              {scheda === 'moduli' && <button onClick={installa} disabled={stato.busy || !scelti.length} className="text-sm px-4 py-2 rounded-lg bg-accent hover:opacity-90 disabled:opacity-50 text-white">{stato.busy ? 'Installo…' : 'Installa ' + scelti.length + ' moduli'}</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
