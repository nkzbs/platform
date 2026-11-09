import React, { useState, useEffect, useRef } from 'react'

// Quanto è operativo il tenant nato dall'analisi: il controllo di coerenza (fatto alla creazione) e il collaudo completo in copia isolata (parte da solo, si può rilanciare).
// req(method, path, body) → { ok, data }
export default function OperativoTenant({ analysisId, req, ghost }) {
  const [d, setD] = useState(null)
  const [err, setErr] = useState('')
  const timer = useRef(null)
  const carica = async () => { const r = await req('GET', '/' + analysisId + '/operativo'); if (!r.ok) { setErr((r.data && r.data.error) || 'Non riesco a leggere il tenant.'); return } setErr(''); setD(r.data); if (r.data.collaudo && r.data.collaudo.stato !== 'in_corso') { clearInterval(timer.current); timer.current = null } }
  useEffect(() => { carica(); timer.current = setInterval(carica, 5000); return () => clearInterval(timer.current) }, [analysisId]) // eslint-disable-line react-hooks/exhaustive-deps
  const rilancia = async () => { await req('POST', '/' + analysisId + '/operativo/collaudo', {}); timer.current = timer.current || setInterval(carica, 5000); carica() }
  if (err && !d) return <div className="mt-3 text-xs text-amber-300">{err}</div>
  if (!d) return <div className="mt-3 text-xs text-gray-500">Controllo il tenant…</div>
  const v = d.verifica, c = d.collaudo || {}, r = c.risultato
  const colore = (n) => (n >= 95 ? 'text-green-400' : n >= 80 ? 'text-amber-300' : 'text-red-300')
  return (
    <div className="mt-4 pt-3 border-t border-gray-800 text-xs space-y-2.5">
      <div className="text-sm font-medium text-ink">Quanto è operativo</div>
      <div className="flex items-baseline gap-2"><span className={'text-xl font-semibold ' + colore(v.punteggio)}>{v.punteggio}</span><span className="text-gray-500">/ 100 coerenza dei moduli ({v.superati} controlli su {v.controlli})</span></div>
      {v.problemi.length > 0 && <ul className="space-y-1">{v.problemi.slice(0, 8).map((p, i) => <li key={i} className="text-gray-300"><span className="text-gray-500">{p.modulo} · {p.blocco}:</span> {p.messaggio}</li>)}{v.problemi.length > 8 && <li className="text-gray-500">…e altri {v.problemi.length - 8}: li trovi in Impostazioni → Moduli del tenant.</li>}</ul>}
      <div className="flex items-baseline gap-2">
        {c.stato === 'in_corso' && <span className="text-gray-400">Collaudo in corso… (circa un minuto)</span>}
        {c.stato === 'finito' && r && <><span className={'text-xl font-semibold ' + colore(r.punteggio)}>{r.punteggio}</span><span className="text-gray-500">/ 100 collaudo dei flussi ({r.superati} prove su {r.controlli})</span></>}
        {c.stato === 'errore' && <span className="text-amber-300">Collaudo non riuscito: {c.errore}</span>}
        {(!c.stato || c.stato === 'mai_eseguito') && <span className="text-gray-500">Collaudo non ancora eseguito.</span>}
        {c.stato !== 'in_corso' && <button type="button" onClick={rilancia} className="text-cp-primary hover:opacity-80 transition ml-auto">Rilancia il collaudo</button>}
      </div>
      {c.stato === 'finito' && r && r.problemi.length > 0 && <ul className="space-y-1">{r.problemi.slice(0, 8).map((p, i) => <li key={i} className="text-gray-300"><span className="text-gray-500">{p.modulo} · {p.blocco}:</span> {p.messaggio}</li>)}</ul>}
      {v.da_completare_a_mano.length > 0 && (
        <div><div className="text-gray-400 mb-1">Da completare a mano ({v.da_completare_a_mano.length})</div>
          <ul className="space-y-0.5">{v.da_completare_a_mano.slice(0, 8).map((m, i) => <li key={i} className="text-gray-500">{m.modulo}: {m.cosa}</li>)}</ul></div>
      )}
      <div className="text-gray-500">La guida d'uso è già scritta dentro il tenant (Impostazioni → Guida) e si rifinisce lì. Per provarlo con delle schede: Impostazioni → Moduli → Dati di esempio.</div>
    </div>
  )
}
