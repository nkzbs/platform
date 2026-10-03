import React, { useState, useEffect } from 'react'
import useApi from '../../lib/useApi'

// Ruoli del modulo (Builder): a cosa serve il modulo e quali suoi campi sono importo, data, scadenza...
// Le funzioni (Come sta andando, riepilogo del mattino, regole Gmail) leggono questa dichiarazione invece di nomi scritti nel codice.
const KINDS = [['', 'Nessuno'], ['spesa', 'Spese'], ['entrata', 'Entrate']]
const USES = [['riepiloghi', 'Entra nei riepiloghi ("Come sta andando")'], ['avvisi', 'Entra negli avvisi e nel riepilogo del mattino'], ['mail', 'Può ricevere righe dalle mail (Gmail)']]
const ROLES = [['importo', 'Importo'], ['data', 'Data'], ['scadenza', 'Scadenza'], ['categoria', 'Categoria'], ['descrizione', 'Descrizione'], ['stato', 'Stato'], ['gruppo', 'Gruppo'], ['fisso', 'Spesa fissa']]
const sel = 'w-full bg-surface-page text-ink px-2.5 py-1.5 rounded-lg text-xs outline-none border border-gray-800 focus:border-accent'

const RP0 = { exclude_categories: [], exclude_groups: [], exclude_descriptions: [], salary_categories: [], savings_categories: [], savings_field: '' }
const AV0 = { states: { nuovo: '', da_fare: '' }, nuovo: false, scadenze: false, tag: 'scadenza', label: '', noun_s: 'riga', noun_p: 'righe' }
const txt = 'w-full bg-surface-page text-ink px-2.5 py-1.5 rounded-lg text-xs outline-none border border-gray-800 focus:border-accent placeholder-gray-600'

export default function ModuleRolesSection({ token, baseUrl, slug, fields, states }) {
  const api = useApi(token, baseUrl)
  const [cfg, setCfg] = useState(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => { setCfg(null); api.get('/module-roles/' + slug).then((d) => setCfg(d && d.module_slug ? { ...d, riepiloghi: { ...RP0, ...(d.riepiloghi || {}) }, avvisi: { ...AV0, ...(d.avvisi || {}), states: { ...AV0.states, ...((d.avvisi || {}).states || {}) } } } : { kind: null, uses: [], roles: {}, avvisi: AV0, riepiloghi: RP0 })) }, [slug]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (next) => {
    setCfg(next); setSaved(false)
    const res = await api.put('/module-roles/' + slug, { kind: next.kind || null, uses: next.uses, roles: next.roles, avvisi: next.avvisi, riepiloghi: next.riepiloghi })
    if (res.ok) setSaved(true)
  }
  if (!cfg) return null
  const options = [...(fields || []).map((f) => [f.key, f.label || f.key]), ['_stato', 'Stato del flusso (workflow)']]
  const setRole = (k, v) => save({ ...cfg, roles: { ...cfg.roles, [k]: v || undefined } })
  const setRp = (patch) => save({ ...cfg, riepiloghi: { ...cfg.riepiloghi, ...patch } })
  const setAv = (patch) => save({ ...cfg, avvisi: { ...cfg.avvisi, ...patch } })
  const setAvState = (k, v) => save({ ...cfg, avvisi: { ...cfg.avvisi, states: { ...cfg.avvisi.states, [k]: v } } })
  const stateOpts = (states || []).map((st) => [st.key, st.label || st.key])
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
          {cfg.uses.includes('riepiloghi') && cfg.kind === 'entrata' && (
            <div className="mt-3 pt-2 border-t border-gray-800">
              <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1.5">Criteri dei riepiloghi</div>
              <div className="text-[10.5px] text-gray-600 mb-1.5">Elenchi separati da virgola. Cosa non conta come entrata, cosa è stipendio, cosa è risparmio.</div>
              {[['exclude_categories', 'Categorie escluse'], ['exclude_groups', 'Gruppi esclusi'], ['exclude_descriptions', 'Descrizioni escluse'], ['salary_categories', 'Categorie stipendio'], ['savings_categories', 'Categorie di risparmio']].map(([k, l]) => (
                <div key={k} className="mb-1.5">
                  <div className="text-[11px] text-gray-500 mb-0.5">{l}</div>
                  <input className={txt} placeholder="es. Risparmi, Fondo" defaultValue={(cfg.riepiloghi[k] || []).join(', ')} key={slug + k} onBlur={(e) => setRp({ [k]: e.target.value })} />
                </div>
              ))}
              <div className="text-[11px] text-gray-500 mb-0.5">Campo con l'accantonamento suggerito</div>
              <select className={sel} value={cfg.riepiloghi.savings_field || ''} onChange={(e) => setRp({ savings_field: e.target.value })}>
                <option value="">—</option>
                {(fields || []).map((f) => <option key={f.key} value={f.key}>{f.label || f.key}</option>)}
              </select>
            </div>
          )}
          {cfg.uses.includes('avvisi') && (
            <div className="mt-3 pt-2 border-t border-gray-800">
              <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1.5">Avvisi WhatsApp</div>
              {[['nuovo', 'Stato "nuovo" (da smistare)'], ['da_fare', 'Stato "da fare" (da pagare)']].map(([k, l]) => (
                <div key={k} className="mb-1.5">
                  <div className="text-[11px] text-gray-500 mb-0.5">{l}</div>
                  {stateOpts.length > 0 ? (
                    <select className={sel} value={cfg.avvisi.states[k] || ''} onChange={(e) => setAvState(k, e.target.value)}>
                      <option value="">—</option>
                      {stateOpts.map(([v, lab]) => <option key={v} value={v}>{lab}</option>)}
                    </select>
                  ) : (
                    <input className={txt} placeholder="valore dello stato" defaultValue={cfg.avvisi.states[k] || ''} key={slug + k} onBlur={(e) => setAvState(k, e.target.value)} />
                  )}
                </div>
              ))}
              <label className="flex items-start gap-2 py-1 cursor-pointer text-[11px] text-gray-300 leading-tight"><input type="checkbox" className="mt-0.5" checked={cfg.avvisi.nuovo} onChange={() => setAv({ nuovo: !cfg.avvisi.nuovo })} />Avvisa quando arriva una riga nuova</label>
              <label className="flex items-start gap-2 py-1 cursor-pointer text-[11px] text-gray-300 leading-tight"><input type="checkbox" className="mt-0.5" checked={cfg.avvisi.scadenze} onChange={() => setAv({ scadenze: !cfg.avvisi.scadenze })} />Mette le scadenze nel riepilogo del mattino</label>
              <div className="grid grid-cols-2 gap-1.5 mt-1.5">
                <input className={txt} placeholder="Una riga (es. bolletta)" defaultValue={cfg.avvisi.noun_s} key={slug + 'ns'} onBlur={(e) => setAv({ noun_s: e.target.value })} />
                <input className={txt} placeholder="Più righe (es. bollette)" defaultValue={cfg.avvisi.noun_p} key={slug + 'np'} onBlur={(e) => setAv({ noun_p: e.target.value })} />
                <input className={txt} placeholder="Etichetta breve (es. casa)" defaultValue={cfg.avvisi.label} key={slug + 'lb'} onBlur={(e) => setAv({ label: e.target.value })} />
                <input className={txt} placeholder="Tag destinatari" defaultValue={cfg.avvisi.tag} key={slug + 'tg'} onBlur={(e) => setAv({ tag: e.target.value })} />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
