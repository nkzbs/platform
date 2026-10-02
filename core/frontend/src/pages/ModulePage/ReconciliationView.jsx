import React, { useState, useEffect } from 'react'
import useApi from '../../lib/useApi'
import Icon from '../../components/Icon'

function eur(n) {
  return (Number(n) || 0).toLocaleString('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 })
}

// Esegue e mostra un blocco reconciliation (block_type 'reconciliation') — due liste
// affiancate (A = da riconciliare, B = candidati interni liberi), suggerimento
// automatico (stesso importo+direzione, data più vicina — vedi reconciliation.js),
// conferma manuale. Copre RiconciliazioneBancariaPage.jsx in modo generico, guidato
// dalla config del blocco invece che da codice scritto per Coffee.
function ReconciliationView({ config, defaultModuleSlug, token }) {
  const api = useApi(token)
  const [data, setData] = useState(null)
  const [selectedA, setSelectedA] = useState(null)
  const [selectedB, setSelectedB] = useState(null)
  const [saving, setSaving] = useState(false)
  const sourceSlug = config.source_a.module || defaultModuleSlug

  const load = async () => {
    const res = await api.get('/records/' + sourceSlug + '/reconciliation/' + config.key + '/candidates')
    setData(res)
  }
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const amountOf = (row) => Math.abs(Number(row[config.source_a.amount_field]) || 0)
  const directionOf = (row) => {
    if (config.source_a.direction_field) {
      return (config.source_a.direction_positive_values || []).includes(row[config.source_a.direction_field]) ? 'entrata' : 'uscita'
    }
    return (Number(row[config.source_a.amount_field]) || 0) >= 0 ? 'entrata' : 'uscita'
  }
  const bAmountDirection = (row) => {
    const metric = Number(row[config.source_b.metric]) || 0
    const sub = config.source_b.metric_subtract ? (Number(row[config.source_b.metric_subtract]) || 0) : 0
    const net = metric - sub
    return { amount: Math.abs(net), direction: net >= 0 ? 'entrata' : 'uscita' }
  }

  const confirm = async () => {
    if (!selectedA || !selectedB) return
    setSaving(true)
    const res = await api.post('/records/' + sourceSlug + '/reconciliation/' + config.key + '/link', { a_id: selectedA, b_id: selectedB })
    setSaving(false)
    if (res && res.ok) { setSelectedA(null); setSelectedB(null); load() }
  }

  if (!data) return <div className="text-sm text-gray-600 py-6 text-center">Caricamento…</div>

  return (
    <div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-surface-card rounded-md border border-gray-800 p-5">
          <div className="text-sm font-medium text-ink mb-3">Da riconciliare ({data.pending.length})</div>
          <div className="space-y-2">
            {data.pending.map(({ a, suggestion_id }) => {
              const selected = selectedA === a.__id
              return (
                <button key={a.__id} onClick={() => { setSelectedA(a.__id); setSelectedB(suggestion_id || null) }}
                  className={'w-full text-left p-3 rounded-lg border transition ' + (selected ? 'border-accent bg-accent/10' : 'border-gray-800 hover:border-gray-700')}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-ink">{a[config.source_a.label_field] || a.descrizione || ('#' + a.__id)}</span>
                    <span className={'font-mono ' + (directionOf(a) === 'entrata' ? 'text-green-400' : 'text-red-400')}>
                      {directionOf(a) === 'entrata' ? '+' : '-'}{eur(amountOf(a))}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">{a[config.source_a.date_field]}</div>
                  {suggestion_id && <div className="text-xs text-accent mt-1 flex items-center gap-1"><Icon name="check" size={10} />suggerito</div>}
                </button>
              )
            })}
            {data.pending.length === 0 && <div className="text-sm text-gray-600">Tutto riconciliato.</div>}
          </div>
        </div>

        <div className="bg-surface-card rounded-md border border-gray-800 p-5">
          <div className="text-sm font-medium text-ink mb-3">Candidati liberi ({data.candidates.length})</div>
          <div className="space-y-2 max-h-[60vh] overflow-y-auto">
            {data.candidates.map((b) => {
              const { amount, direction } = bAmountDirection(b)
              const selected = selectedB === b.__id
              return (
                <button key={b.__id} onClick={() => setSelectedB(b.__id)} disabled={!selectedA}
                  className={'w-full text-left p-3 rounded-lg border transition disabled:opacity-40 ' + (selected ? 'border-accent bg-accent/10' : 'border-gray-800 hover:border-gray-700')}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-ink">{b[config.source_b.label_field] || ('#' + b.__id)}</span>
                    <span className={'font-mono ' + (direction === 'entrata' ? 'text-green-400' : 'text-red-400')}>
                      {direction === 'entrata' ? '+' : '-'}{eur(amount)}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">{b[config.source_b.date_field]}</div>
                </button>
              )
            })}
            {data.candidates.length === 0 && <div className="text-sm text-gray-600">Nessun candidato libero.</div>}
          </div>
        </div>
      </div>

      {selectedA && selectedB && (
        <div className="mt-4 flex justify-end">
          <button onClick={confirm} disabled={saving}
            className="px-5 py-2.5 rounded-lg bg-accent hover:opacity-90 disabled:opacity-50 text-white text-sm font-medium transition flex items-center gap-2">
            <Icon name="check" size={14} />{saving ? 'Collegamento...' : 'Collega e riconcilia'}
          </button>
        </div>
      )}
    </div>
  )
}

export default ReconciliationView
