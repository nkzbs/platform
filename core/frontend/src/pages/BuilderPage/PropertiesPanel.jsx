import React from 'react'
import Icon from '../../components/Icon'
import { MODULE_ICON_CHOICES, MODULE_COLOR_CHOICES } from './constants'
import ModuleRolesSection from './ModuleRolesSection'

// Builder 2.0 — pannello destro "Proprietà"/"Cronologia" (dal mockup mostrato
// dall'utente). Prima questi stessi controlli erano tutti ammassati in una
// riga che andava a capo sopra il canvas — qui solo riorganizzati in un posto
// fisso, nessun campo nuovo inventato: ogni toggle scrive una colonna reale
// già esistente su modules (vedi PATCH /modules/:slug). "Moduli correlati" è
// calcolato da fieldCache (stessa fonte di ModelCanvas), zero nuove chiamate.
function PropertiesPanel({ token, baseUrl, mod, schema, fieldCache, allModules, onUpdate, onSelectModule, showIconPicker, setShowIconPicker, history, restoreVersion, tab, setTab }) {
  if (!mod) return null

  const related = []
  const ownRels = (fieldCache.find((m) => m.slug === mod.slug)?.relations || [])
  ownRels.forEach((r) => {
    if (r.target_module && r.target_module !== mod.slug) related.push({ slug: r.target_module, via: r.label })
  })
  fieldCache.forEach((m) => {
    if (m.slug === mod.slug) return
    ;(m.relations || []).forEach((r) => {
      if (r.target_module === mod.slug) related.push({ slug: m.slug, via: r.label })
    })
  })
  const relatedUnique = Array.from(new Map(related.map((r) => [r.slug, r])).values())

  const fileFields = (schema?.steps || []).filter((s) => s.block_type === 'field' && s.type === 'file')
  const selectFields = (schema?.steps || []).filter((s) => s.block_type === 'field' && s.type === 'select')

  const Toggle = ({ checked, onChange, label, hint }) => (
    <label className="flex items-start gap-2.5 cursor-pointer py-1.5">
      <button type="button" onClick={() => onChange(!checked)}
        className={'w-8 h-[18px] rounded-full flex-shrink-0 transition relative mt-0.5 ' + (checked ? 'bg-accent' : 'bg-gray-700')}>
        <span className={'absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white transition ' + (checked ? 'left-[18px]' : 'left-[2px]')} />
      </button>
      <span className="text-xs text-gray-300 leading-tight">
        {label}
        {hint && <span className="block text-[10.5px] text-gray-600 mt-0.5">{hint}</span>}
      </span>
    </label>
  )

  return (
    <div className="w-64 flex-shrink-0">
      <div className="sticky top-4 bg-surface-card border border-gray-800 rounded-xl overflow-hidden">
        <div className="flex border-b border-gray-800">
          <button onClick={() => setTab('proprieta')} className={'flex-1 text-xs font-semibold py-2.5 transition ' + (tab === 'proprieta' ? 'text-ink border-b-2 border-accent -mb-px' : 'text-gray-500 hover:text-gray-300')}>PROPRIETÀ</button>
          <button onClick={() => setTab('cronologia')} className={'flex-1 text-xs font-semibold py-2.5 transition ' + (tab === 'cronologia' ? 'text-ink border-b-2 border-accent -mb-px' : 'text-gray-500 hover:text-gray-300')}>CRONOLOGIA</button>
        </div>

        {tab === 'proprieta' ? (
          <div className="p-4 space-y-4 max-h-[75vh] overflow-y-auto">
            <div className="relative">
              <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1.5">Icona e colore</div>
              <button onClick={() => setShowIconPicker((s) => !s)}
                className="w-9 h-9 rounded-lg flex items-center justify-center hover:ring-2 hover:ring-gray-700 transition"
                style={{ backgroundColor: (mod.color || '#2563EB') + '22', color: mod.color || '#2563EB' }}>
                <Icon name={mod.icon || 'box'} size={16} />
              </button>
              {showIconPicker && (
                <div className="absolute top-11 left-0 z-30 bg-surface-page border border-gray-700 rounded-xl p-3 shadow-xl w-56">
                  <div className="grid grid-cols-6 gap-1.5 mb-3">
                    {MODULE_ICON_CHOICES.map((ic) => (
                      <button key={ic} type="button" onClick={() => onUpdate({ icon: ic })}
                        className={'w-7 h-7 rounded-lg flex items-center justify-center transition border ' + (mod.icon === ic ? 'border-accent bg-accent/20 text-accent' : 'border-gray-800 bg-gray-800/50 text-gray-500 hover:text-gray-300')}>
                        <Icon name={ic} size={13} />
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-1.5 flex-wrap">
                    {MODULE_COLOR_CHOICES.map((c) => (
                      <button key={c} type="button" onClick={() => onUpdate({ color: c })}
                        className={'w-6 h-6 rounded-lg transition border-2 ' + (mod.color === c ? 'border-white' : 'border-transparent')}
                        style={{ backgroundColor: c }} />
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div>
              <label className="text-[10px] text-gray-500 uppercase tracking-wide mb-1.5 block">Sezione menu</label>
              <input className="w-full bg-surface-page text-ink px-2.5 py-1.5 rounded-lg text-xs outline-none border border-gray-800 focus:border-accent transition"
                placeholder="es. CRM & Vendite" defaultValue={mod.group_name || ''} key={'group_' + mod.slug}
                onBlur={(e) => { if (e.target.value !== (mod.group_name || '')) onUpdate({ group_name: e.target.value }) }} />
            </div>

            <div className="border-t border-gray-800 pt-3">
              <Toggle checked={mod.active !== 0} onChange={(v) => onUpdate({ active: v })} label="Visibile in sidebar" />
              <Toggle checked={!mod.support_module} onChange={(v) => onUpdate({ support_module: !v })} label="Modulo primario" hint="Un modulo di supporto non compare nello Store né nel menu." />
              <Toggle checked={mod.quick_toggle !== 0} onChange={(v) => onUpdate({ quick_toggle: v })} label="Cerchio rapido in tabella" hint="Utile per pagamenti/scadenze, fuorviante su workflow generici." />
              <Toggle checked={mod.list_view === 'card_grid'} onChange={(v) => onUpdate({ list_view: v ? 'card_grid' : 'table' })} label="Vista a card" hint="Griglia di card colorate invece di una tabella." />
            </div>

            {fileFields.length > 0 && (
              <div className="border-t border-gray-800 pt-3">
                <label className="text-[10px] text-gray-500 uppercase tracking-wide mb-1.5 block">Upload batch</label>
                <select value={mod.batch_upload_field || ''} onChange={(e) => onUpdate({ batch_upload_field: e.target.value || null })}
                  className="w-full bg-surface-page text-ink px-2.5 py-1.5 rounded-lg text-xs outline-none border border-gray-800 focus:border-accent transition mb-2">
                  <option value="">Disattivo</option>
                  {fileFields.map((f) => <option key={f.key} value={f.key}>Su "{f.label}"</option>)}
                </select>
                {mod.batch_upload_field && selectFields.length > 0 && (
                  <select value={mod.batch_upload_category_field || ''} onChange={(e) => onUpdate({ batch_upload_category_field: e.target.value || null })}
                    className="w-full bg-surface-page text-ink px-2.5 py-1.5 rounded-lg text-xs outline-none border border-gray-800 focus:border-accent transition">
                    <option value="">Nessuna categoria richiesta</option>
                    {selectFields.map((f) => <option key={f.key} value={f.key}>Chiedi "{f.label}"</option>)}
                  </select>
                )}
              </div>
            )}

            <ModuleRolesSection token={token} baseUrl={baseUrl} slug={mod.slug} fields={(schema?.steps || []).filter((s) => s.block_type === 'field')} />

            <div className="border-t border-gray-800 pt-3">
              <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1.5">Moduli correlati ({relatedUnique.length})</div>
              {relatedUnique.length === 0 ? (
                <div className="text-[11px] text-gray-600">Nessuna relazione ancora.</div>
              ) : (
                <div className="space-y-1">
                  {relatedUnique.map((r) => {
                    const rm = allModules.find((m) => m.slug === r.slug)
                    return (
                      <button key={r.slug} onClick={() => onSelectModule(r.slug)}
                        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/[0.04] transition text-left">
                        <span className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0" style={{ backgroundColor: (rm?.color || '#2563EB') + '22', color: rm?.color || '#2563EB' }}>
                          <Icon name={rm?.icon || 'box'} size={11} />
                        </span>
                        <span className="text-xs text-gray-300 truncate">{rm?.name || r.slug}</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="p-4 max-h-[75vh] overflow-y-auto">
            {history.length === 0 ? (
              <div className="text-xs text-gray-600">Nessuna versione pubblicata ancora.</div>
            ) : (
              <div className="space-y-1.5">
                {history.map((h) => (
                  <div key={h.id} className="bg-surface-page rounded-lg p-2.5 border border-gray-800">
                    <div className="text-ink text-xs font-mono">v{h.version}</div>
                    <div className="text-[10.5px] text-gray-500 mt-0.5 mb-1.5">{new Date(h.published_at).toLocaleString('it-IT')}</div>
                    <button onClick={() => restoreVersion(h.id)} className="text-[11px] text-accent hover:opacity-80 transition">Ripristina</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default PropertiesPanel
