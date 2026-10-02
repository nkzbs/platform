import React from 'react'
import Icon from '../../components/Icon'
import { computeValidations } from './validation'

const TRIGGER_LABEL = {
  nuovo_record: 'Nuovo record',
  cambio_stato: 'Cambio stato',
  modifica_campo: 'Modifica campo',
  schedulato: 'Pianificato',
}

// Riassunto testuale del livello di accesso di una regola permessi — stessa
// logica di sostanza della tabella di checkbox già editabile dentro il
// blocco Permessi nel canvas, qui solo un colpo d'occhio in sola lettura.
function accessLevel(r) {
  if (!r || !r.view) return 'Nessun accesso'
  const write = r.create || r.edit
  if (r.create && r.edit && r.delete) return 'Accesso completo' + (r.view_own_only ? ' (solo i propri)' : '')
  if (write) return 'Lettura / Scrittura' + (r.view_own_only ? ' limitata' : '')
  return 'Lettura' + (r.view_own_only ? ' limitata' : '')
}

// Builder 2.0 — pannello inferiore persistente (Validazioni / Automazioni /
// Permessi), stessa idea dello spec che l'utente ha mostrato: aggrega dati
// che nel canvas vivono già dentro i singoli blocchi, in una vista d'insieme
// leggibile senza aprire ogni blocco uno a uno. Storico Versioni vive nel
// pannello Proprietà a destra (tab "Cronologia"), non qui — stesso posto del
// mockup mostrato dall'utente. Sola lettura: editing resta nei blocchi del
// canvas per non duplicare la stessa logica di scrittura in due posti.
function BottomPanel({ schema, fieldCache, allRoles, activeTab, setActiveTab, collapsed, setCollapsed }) {
  if (!schema) return null
  const { errors, warnings } = computeValidations(schema, fieldCache, allRoles)
  const automations = (schema.steps || []).filter((s) => s.block_type === 'automation')
  const permissionsBlock = (schema.steps || []).find((s) => s.block_type === 'permissions')

  const TABS = [
    { key: 'validazioni', label: 'Validazioni', count: errors.length + warnings.length, badgeColor: errors.length > 0 ? 'bg-red-900/40 text-red-400' : (warnings.length > 0 ? 'bg-amber-900/40 text-amber-400' : '') },
    { key: 'automazioni', label: 'Automazioni', count: automations.length },
    { key: 'permessi', label: 'Permessi', count: null },
  ]

  return (
    <div className="mt-6 bg-surface-card border border-gray-800 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between border-b border-gray-800 px-2">
        <div className="flex items-center gap-1 overflow-x-auto">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => { setActiveTab(t.key); setCollapsed(false) }}
              className={'px-3 py-2.5 text-xs whitespace-nowrap transition border-b-2 -mb-px flex items-center gap-1.5 ' + (!collapsed && activeTab === t.key ? 'border-cp-primary text-ink font-medium' : 'border-transparent text-gray-500 hover:text-gray-300')}>
              {t.label}
              {t.count != null && t.count > 0 && (
                <span className={'text-[10px] px-1.5 py-0.5 rounded-full ' + (t.badgeColor || 'bg-gray-800 text-gray-400')}>{t.count}</span>
              )}
            </button>
          ))}
        </div>
        <button onClick={() => setCollapsed((c) => !c)} className="text-gray-500 hover:text-ink transition px-2 flex-shrink-0" title={collapsed ? 'Espandi' : 'Comprimi'}>
          <Icon name={collapsed ? 'chevron-up' : 'chevron-down'} size={14} />
        </button>
      </div>

      {!collapsed && (
        <div className="p-4 max-h-64 overflow-y-auto">
          {activeTab === 'validazioni' && (
            errors.length === 0 && warnings.length === 0 ? (
              <div className="text-xs text-gray-600 flex items-center gap-1.5"><Icon name="check" size={13} className="text-green-500" />Nessun problema rilevato su questo modulo.</div>
            ) : (
              <div className="space-y-1.5">
                {errors.map((e, i) => (
                  <div key={'e' + i} className="flex items-start gap-2 text-xs text-red-400">
                    <Icon name="x" size={12} className="flex-shrink-0 mt-0.5" />
                    <span>{e.msg}</span>
                  </div>
                ))}
                {warnings.map((w, i) => (
                  <div key={'w' + i} className="flex items-start gap-2 text-xs text-amber-400">
                    <Icon name="info" size={12} className="flex-shrink-0 mt-0.5" />
                    <span>{w.msg}</span>
                  </div>
                ))}
              </div>
            )
          )}

          {activeTab === 'automazioni' && (
            automations.length === 0 ? (
              <div className="text-xs text-gray-600">Nessuna automazione su questo modulo.</div>
            ) : (
              <div className="space-y-1.5">
                {automations.map((a) => (
                  <div key={a.id} className="flex items-center justify-between gap-3 text-xs bg-surface-page rounded-lg px-3 py-2 border border-gray-800">
                    <div className="min-w-0">
                      <div className="text-ink font-medium truncate">{a.label || 'Senza nome'}</div>
                      <div className="text-gray-500 text-[10.5px] mt-0.5">{TRIGGER_LABEL[a.trigger && a.trigger.evento] || '—'} · {(a.azioni || []).length} azion{(a.azioni || []).length === 1 ? 'e' : 'i'}</div>
                    </div>
                    <span className={'text-[10px] px-2 py-0.5 rounded-full flex-shrink-0 flex items-center gap-1 ' + (a.enabled === false ? 'bg-gray-800 text-gray-500' : 'bg-green-900/30 text-green-400')}>
                      <span className={'w-1.5 h-1.5 rounded-full ' + (a.enabled === false ? 'bg-gray-600' : 'bg-green-400')} />
                      {a.enabled === false ? 'In pausa' : 'Attiva'}
                    </span>
                  </div>
                ))}
              </div>
            )
          )}

          {activeTab === 'permessi' && (
            !permissionsBlock ? (
              <div className="text-xs text-gray-600">Nessun blocco Permessi configurato — tutti i ruoli hanno accesso pieno.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-500"><th className="text-left font-medium pb-2">Ruolo</th><th className="text-left font-medium pb-2">Accesso</th></tr>
                  </thead>
                  <tbody>
                    {allRoles.map((role) => {
                      const r = (permissionsBlock.rules || []).find((x) => x.role === role.name) || { view: true, create: true, edit: true, delete: true }
                      return (
                        <tr key={role.name} className="border-t border-gray-800">
                          <td className="py-1.5 text-gray-300">{role.label}</td>
                          <td className="py-1.5 text-gray-400">{accessLevel(r)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )
          )}
        </div>
      )}
    </div>
  )
}

export default BottomPanel
