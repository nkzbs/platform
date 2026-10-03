import React, { useState, useEffect } from 'react'
import useApi from '../../lib/useApi'

// Ruoli del modulo (Builder): a cosa serve il modulo e quali suoi campi sono importo, data, scadenza...
// Le funzioni (Come sta andando, riepilogo del mattino, regole Gmail) leggono questa dichiarazione invece di nomi scritti nel codice.
const KINDS = [['', 'Nessuno'], ['spesa', 'Spese'], ['entrata', 'Entrate']]
const USES = [['riepiloghi', 'Entra nei riepiloghi ("Come sta andando")'], ['avvisi', 'Entra negli avvisi e nel riepilogo del mattino'], ['mail', 'Può ricevere righe dalle mail (Gmail)']]
const ROLES = [['importo', 'Importo'], ['data', 'Data'], ['scadenza', 'Scadenza'], ['categoria', 'Categoria'], ['descrizione', 'Descrizione'], ['stato', 'Stato'], ['gruppo', 'Gruppo'], ['fisso', 'Spesa fissa']]
const sel = 'w-full bg-surface-page text-ink px-2.5 py-1.5 rounded-lg text-xs outline-none border border-gray-800 focus:border-accent'

export default function ModuleRolesSection({ token, baseUrl, slug, fields }) {
  const api = useApi(token, baseUrl)
  const [cfg, setCfg] = useState(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => { setCfg(null); api.get('/module-roles/' + slug).then((d) => setCfg(d && d.module_slug ? d : { kind: null, uses: [], roles: {} })) }, [slug]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (next) => {
    setCfg(next); setSaved(false)
    const res = await api.put('/module-roles/' + slug, { kind: next.kind || null, uses: next.uses, roles: next.roles })
    if (res.ok) setSaved(true)
  }
  if (!cfg) return null
  const options = [...(fields || []).map((f) => [f.key, f.label || f.key]), ['_stato', 'Stato del flusso (workflow)']]
  const setRole = (k, v) => save({ ...cfg, roles: { ...cfg.roles, [k]: v || undefined } })
  const toggleUse = (u) => save({ ...cfg, uses: cfg.uses.includes(u) ? cfg.uses.filter((x) => x !== u) : [...cfg.uses, u] })

  return (
    <div className="border-t border-gray-800 pt-3">
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-[10px] text-gray-500 uppercase tracking-wide">Ruoli del modulo</div>
        {saved && <span className="text-[10px] text-green-500">Salvato</span>}
      </div>
      <select className={sel} value={cfg.kind || ''} onChange={(e) => save({ ...cfg, kind: e.target.value || null })}>
        {KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      {cfg.kind && (
        <>
          <div className="mt-2">
            {USES.map(([u, l]) => (
              <label key={u} className="flex items-start gap-2 py-1 cursor-pointer text-[11px] text-gray-300 leading-tight">
                <input type="checkbox" className="mt-0.5" checked={cfg.uses.includes(u)} onChange={() => toggleUse(u)} />{l}
              </label>
            ))}
          </div>
          <div className="mt-2 space-y-1.5">
            {ROLES.filter(([k]) => cfg.kind === 'spesa' ? k !== 'gruppo' : k !== 'fisso').map(([k, l]) => (
              <div key={k} className="flex items-center gap-2">
                <span className="text-[11px] text-gray-500 w-16 flex-shrink-0">{l}</span>
                <select className={sel} value={cfg.roles[k] || ''} onChange={(e) => setRole(k, e.target.value)}>
                  <option value="">—</option>
                  {options.map(([v, lab]) => <option key={v} value={v}>{lab}</option>)}
                </select>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
