import React, { useState, useEffect } from 'react'
import useApi from '@app/lib/useApi'

// Potenziamenti AI del modulo (Builder): ogni modulo accende da solo quelli che vuole. Senza i ruoli che servono (Ruoli del modulo)
// il potenziamento resta fermo e qui si legge cosa manca. Collegato: "Smistare". Gli altri si collegano uno alla volta.
export default function ModuleAiSection({ token, baseUrl, slug }) {
  const api = useApi(token, baseUrl)
  const [list, setList] = useState(null)
  const load = () => api.get('/module-ai/' + slug).then((d) => setList(Array.isArray(d) ? d : []))
  useEffect(() => { setList(null); load() }, [slug]) // eslint-disable-line react-hooks/exhaustive-deps

  const [key, setKey] = useState(null) // stato della chiave Mistral di questo progetto
  const [keyInput, setKeyInput] = useState('')
  const [keyMsg, setKeyMsg] = useState(null)
  const loadKey = () => api.get('/ai/settings').then((d) => setKey(d && d.key ? d.key : null))
  useEffect(() => { loadKey() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const saveKey = async () => {
    setKeyMsg(null)
    const res = await api.put('/ai/key', { key: keyInput })
    if (res.ok) { setKeyInput(''); setKeyMsg({ ok: true, text: 'Chiave salvata.' }); loadKey() }
    else setKeyMsg({ ok: false, text: (res.data && res.data.error) || 'Non sono riuscito a salvare la chiave.' })
  }

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
      {list.some((f) => f.enabled) && (
        <div className="mt-2 text-[10.5px]">
          {key && key.configured
            ? <div className="text-gray-500">Chiave Mistral {key.source === 'tenant' ? 'di questo progetto' : 'generale'}{key.hint ? ' (' + key.hint + ')' : ''}.</div>
            : <div className="text-amber-500">Manca la chiave Mistral: senza, l'AI non funziona.</div>}
          <div className="flex gap-1.5 mt-1.5">
            <input type="password" autoComplete="off" spellCheck="false" value={keyInput} onChange={(e) => setKeyInput(e.target.value)} placeholder="Incolla la chiave"
              className="flex-1 min-w-0 bg-surface-page text-ink px-2 py-1 rounded-lg outline-none border border-gray-800 focus:border-accent text-xs" />
            <button type="button" onClick={saveKey} disabled={!keyInput.trim()} className="bg-accent hover:opacity-90 disabled:opacity-50 text-white px-2.5 py-1 rounded-lg text-xs">Salva</button>
          </div>
          {keyMsg && <div className={'mt-1 ' + (keyMsg.ok ? 'text-green-500' : 'text-amber-500')}>{keyMsg.text}</div>}
        </div>
      )}
      <div className="text-[10.5px] text-gray-600 mt-1.5">"Smistare" propone nell'elenco del modulo; "Spiegare" aggiunge il pulsante nei report del modulo. "Importare" arriva a breve.</div>
    </div>
  )
}
