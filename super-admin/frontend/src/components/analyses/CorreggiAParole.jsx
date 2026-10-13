import React, { useState } from 'react'

// «Correggi a parole»: si scrive cosa cambiare («togli la fatturazione, aggiungi i turni»), l'AI lo traduce in poche operazioni, qui si vedono in italiano e
// SOLO con «Applica» si scrivono nell'analisi. Il codice ricontrolla tutto prima (processi e moduli veri). req(method, path, body) → { ok, data }.
export default function CorreggiAParole({ analysisId, req, onApplied, btn, ghost, input }) {
  const [testo, setTesto] = useState('')
  const [prop, setProp] = useState(null) // { operazioni, descrizioni }
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const proponi = async () => {
    setBusy(true); setMsg(null); setProp(null)
    const r = await req('POST', '/' + analysisId + '/correggi', { istruzione: testo })
    setBusy(false)
    if (!r.ok) { setMsg((r.data && r.data.error) || 'Non riuscito.'); return }
    if (!r.data.operazioni.length) { setMsg('Non ho capito cosa cambiare, o non posso farlo da qui. Prova a dirlo in modo più preciso.'); return }
    setProp(r.data)
  }
  const applica = async () => {
    setBusy(true)
    const r = await req('POST', '/' + analysisId + '/correggi/applica', { operazioni: prop.operazioni })
    setBusy(false)
    if (r.ok) { setProp(null); setTesto(''); setMsg('Fatto.'); onApplied(r.data) } else setMsg((r.data && r.data.error) || 'Non riuscito.')
  }
  return (
    <div>
      <div className="text-xs text-gray-500 mb-1.5">Correggi a parole</div>
      <div className="flex gap-2 flex-wrap">
        <input className={input + ' flex-1 min-w-[220px]'} placeholder="Es. togli la fatturazione e aggiungi la gestione dei turni" value={testo} onChange={(e) => setTesto(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && testo.trim().length >= 5 && !busy) proponi() }} />
        <button type="button" className={ghost} disabled={busy || testo.trim().length < 5} onClick={proponi}>{busy && !prop ? 'Penso…' : 'Proponi'}</button>
      </div>
      {msg && <div className="text-xs text-gray-400 mt-1.5">{msg}</div>}
      {prop && (
        <div className="mt-2 border border-gray-800 rounded-lg p-3">
          <div className="text-xs text-gray-500 mb-1.5">Farei questo. Non cambia niente finché non confermi:</div>
          <ul className="text-sm text-ink space-y-1 list-disc pl-5">{prop.descrizioni.map((d, i) => <li key={i}>{d}</li>)}</ul>
          <div className="flex gap-2 mt-3"><button type="button" className={btn} disabled={busy} onClick={applica}>{busy ? 'Applico…' : 'Applica'}</button><button type="button" className={ghost} disabled={busy} onClick={() => setProp(null)}>Annulla</button></div>
        </div>
      )}
    </div>
  )
}
