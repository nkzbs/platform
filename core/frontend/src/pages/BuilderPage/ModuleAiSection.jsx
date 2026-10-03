import React, { useState, useEffect } from 'react'
import useApi from '../../lib/useApi'

// Potenziamenti AI del modulo (Builder): ogni modulo accende da solo quelli che vuole. Senza i ruoli che servono (Ruoli del modulo)
// il potenziamento resta fermo e qui si legge cosa manca. Gli interruttori si salvano; i potenziamenti si collegano uno alla volta.
export default function ModuleAiSection({ token, baseUrl, slug }) {
  const api = useApi(token, baseUrl)
  const [list, setList] = useState(null)
  const load = () => api.get('/module-ai/' + slug).then((d) => setList(Array.isArray(d) ? d : []))
  useEffect(() => { setList(null); load() }, [slug]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = async (key) => {
    const on = list.filter((f) => f.enabled).map((f) => f.key)
    const next = on.includes(key) ? on.filter((k) => k !== key) : [...on, key]
    const res = await api.put('/module-ai/' + slug, { features: next })
    if (res.ok) load()
  }
  if (!list) return null
  return (
    <div className="border-t border-gray-800 pt-3">
      <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1.5">Potenziamenti AI</div>
      {list.map((f) => (
        <div key={f.key} className="py-1">
          <label className="flex items-start gap-2 cursor-pointer text-[11px] text-gray-300 leading-tight">
            <input type="checkbox" className="mt-0.5" checked={f.enabled} onChange={() => toggle(f.key)} />
            <span>{f.label}<span className="block text-[10.5px] text-gray-600 mt-0.5">{f.description}</span></span>
          </label>
          {f.enabled && f.missing_roles.length > 0 && (
            <div className="ml-5 mt-1 text-[10.5px] text-amber-500">Per lavorare servono questi ruoli: {f.missing_roles.join(', ')}.</div>
          )}
        </div>
      ))}
      <div className="text-[10.5px] text-gray-600 mt-1.5">In arrivo: gli interruttori si salvano, ma i potenziamenti non sono ancora collegati.</div>
    </div>
  )
}
