import React, { useState } from 'react'
import Icon from '../../components/Icon'
import { parseSchemaFrontend } from '../../lib/schema-v3-frontend'

// ─── GUIDA PER MODULO — AUTO-GENERATA ───────────────────────────────────────
// Fase 7 del redesign (2026-08-30) — "meccanismo di costruzione guida in
// base al modulo installato", richiesto dall'utente. Nessun backend nuovo:
// `modules` (già in memoria in App.jsx, GET /modules/installed include
// sempre schema_json) viene solo riletto con lo stesso parser che usa già
// ModulePage/schema-v3-frontend.js — installare/rimuovere un modulo, o
// cambiarne lo schema nel Builder, aggiorna questa pagina da sé, zero
// manutenzione manuale di un testo scritto a mano.
const TYPE_LABEL = {
  text: 'Testo', textarea: 'Testo lungo', number: 'Numero', currency: 'Valuta',
  date: 'Data', datetime: 'Data e ora', checkbox: 'Sì/No', select: 'Scelta singola',
  email: 'Email', phone: 'Telefono', url: 'Link', mappa: 'Indirizzo/mappa',
  computed: 'Calcolato', file: 'Allegato', color: 'Colore',
}

function ModuleGuide({ modules }) {
  const real = (modules || []).filter((m) => m.slug !== 'dashboard')
  const [selectedSlug, setSelectedSlug] = useState(real[0] ? real[0].slug : null)
  const selected = real.find((m) => m.slug === selectedSlug)
  const parsed = selected ? parseSchemaFrontend(selected.schema_json) : null

  return (
    <div className="flex flex-col md:flex-row gap-6">
      <div className="w-full md:w-64 flex-shrink-0">
        <div className="text-xs text-gray-500 mb-2">Un argomento per ogni modulo installato — sparisce da solo se il modulo viene rimosso.</div>
        <div className="bg-surface-card border border-gray-800 rounded-xl divide-y divide-gray-800/70 max-h-[70vh] overflow-y-auto">
          {real.map((m) => (
            <button key={m.slug} onClick={() => setSelectedSlug(m.slug)}
              className={'w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition ' + (selectedSlug === m.slug ? 'bg-accent/10 text-accent' : 'text-gray-400 hover:text-ink hover:bg-white/5')}>
              <Icon name={m.icon || 'box'} size={13} className="flex-shrink-0" />
              <span className="text-sm truncate">{m.name}</span>
            </button>
          ))}
          {real.length === 0 && <div className="text-xs text-gray-600 text-center py-8">Nessun modulo installato ancora.</div>}
        </div>
      </div>

      <div className="flex-1 min-w-0">
        {!selected || !parsed ? (
          <div className="text-sm text-gray-500">Scegli un modulo dalla lista a sinistra.</div>
        ) : (
          <div className="bg-surface-card border border-gray-800 rounded-xl p-6 max-w-2xl">
            <div className="flex items-center gap-3 mb-1">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: (selected.color || '#2563EB') + '22', color: selected.color || '#2563EB' }}>
                <Icon name={selected.icon || 'box'} size={16} />
              </div>
              <h2 className="text-xl font-bold text-ink">{selected.name}</h2>
            </div>
            <p className="text-xs text-gray-600 mb-5">Come usare questo modulo — generato dalla sua struttura reale, sempre allineato.</p>

            {parsed.fields && parsed.fields.length > 0 && (
              <div className="mb-6">
                <div className="text-xs font-semibold text-ink uppercase tracking-wide mb-2">Campi</div>
                <div className="space-y-1.5">
                  {parsed.fields.map((f) => (
                    <div key={f.key} className="flex items-center justify-between text-sm bg-surface-page rounded-lg px-3 py-2">
                      <span className="text-gray-300">{f.label}{f.required ? ' *' : ''}</span>
                      <span className="text-xs text-gray-600">{TYPE_LABEL[f.type] || f.type}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {parsed.relations && parsed.relations.length > 0 && (
              <div className="mb-6">
                <div className="text-xs font-semibold text-ink uppercase tracking-wide mb-2">Relazioni</div>
                <div className="space-y-1.5">
                  {parsed.relations.map((r) => (
                    <div key={r.key} className="text-sm bg-surface-page rounded-lg px-3 py-2">
                      <span className="text-gray-300">{r.label}</span>
                      <span className="text-xs text-gray-600"> — collegato a "{r.target_module}"</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {parsed.workflow && parsed.workflow.states && parsed.workflow.states.length > 0 && (
              <div className="mb-6">
                <div className="text-xs font-semibold text-ink uppercase tracking-wide mb-2">Stati del flusso</div>
                <div className="flex flex-wrap gap-1.5">
                  {parsed.workflow.states.map((s) => (
                    <span key={s.key} className="text-xs font-medium px-2.5 py-1 rounded-full" style={{ background: (s.color || '#6B7280') + '22', color: s.color || '#6B7280' }}>
                      {s.label}{s.initial ? ' (iniziale)' : ''}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {parsed.permissions && parsed.permissions.rules && parsed.permissions.rules.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-ink uppercase tracking-wide mb-2">Permessi per ruolo</div>
                <div className="space-y-1.5">
                  {parsed.permissions.rules.map((r) => (
                    <div key={r.role} className="text-xs text-gray-400 bg-surface-page rounded-lg px-3 py-2">
                      <span className="text-gray-300 font-medium">{r.role}</span>: {[r.view && 'vede', r.create && 'crea', r.edit && 'modifica', r.delete && 'elimina'].filter(Boolean).join(', ') || 'nessun accesso'}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(!parsed.fields || parsed.fields.length === 0) && (!parsed.relations || parsed.relations.length === 0) && (
              <div className="text-sm text-gray-600">Questo modulo non ha ancora campi configurati.</div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default ModuleGuide
