import React, { useState, useEffect } from 'react'
import useApi from '../../lib/useApi'

// Bilancio di Verifica / Conto Economico / Stato Patrimoniale, calcolati da
// GET /records/:slug/financial-statement/:key (records.js + financial-statement.js) —
// equivalente dichiarativo di ContabilitaGeneralePage.jsx: qui la configurazione (quale
// relazione verso il piano dei conti, quali campi dare/avere, quale filtro) è quella
// decisa nel Builder (blocco "Bilancio contabile"), non scritta a mano.
function eur(n) {
  return (n || 0).toLocaleString('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 })
}

function Card({ title, children }) {
  return (
    <div className="bg-surface-card rounded-md border border-gray-800 p-5">
      <div className="text-sm font-medium text-ink mb-3">{title}</div>
      {children}
    </div>
  )
}

function Row({ label, value, bold, color }) {
  return (
    <div className={'flex items-center justify-between text-sm py-1.5 ' + (bold ? 'border-t border-gray-800 mt-1 pt-2 font-medium' : '')}>
      <span className={bold ? 'text-ink' : 'text-gray-400'}>{label}</span>
      <span className={'font-mono ' + (bold ? 'text-ink' : 'text-gray-300')} style={color ? { color } : undefined}>{eur(value)}</span>
    </div>
  )
}

const TABS = [
  { key: 'bilancio_verifica', label: 'Bilancio di Verifica' },
  { key: 'conto_economico', label: 'Conto Economico' },
  { key: 'stato_patrimoniale', label: 'Stato Patrimoniale' },
]

function FinancialStatementView({ config, defaultModuleSlug, token }) {
  const api = useApi(token)
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('bilancio_verifica')

  useEffect(() => {
    setLoading(true); setError('')
    api.get('/records/' + defaultModuleSlug + '/financial-statement/' + config.key).then((res) => {
      if (!res) { setError('Impossibile calcolare il bilancio'); setLoading(false); return }
      setData(res); setLoading(false)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultModuleSlug, config.key])

  if (loading) return <div className="text-gray-500 text-sm">Calcolo…</div>
  if (error) return <div className="text-sm text-red-400">{error}</div>
  if (!data) return null

  return (
    <div>
      <div className="flex gap-1 mb-4 border-b border-gray-800 overflow-x-auto">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={'px-4 py-2.5 text-sm whitespace-nowrap transition border-b-2 -mb-px ' + (tab === t.key ? 'border-accent text-accent' : 'border-transparent text-gray-500 hover:text-gray-300')}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'bilancio_verifica' && (
        <Card title="Bilancio di Verifica">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 uppercase tracking-wider border-b border-gray-800">
                  <th className="pb-2 pr-3 font-normal">Conto</th>
                  <th className="pb-2 pr-3 font-normal text-right">Totale Dare</th>
                  <th className="pb-2 pr-3 font-normal text-right">Totale Avere</th>
                  <th className="pb-2 font-normal text-right">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {data.bilancio.map((c) => (
                  <tr key={c.conto_id} className="border-b border-gray-800/50">
                    <td className="py-2 pr-3 text-ink">{c.codice} — {c.nome}</td>
                    <td className="py-2 pr-3 text-right font-mono text-gray-300">{eur(c.dare)}</td>
                    <td className="py-2 pr-3 text-right font-mono text-gray-300">{eur(c.avere)}</td>
                    <td className="py-2 text-right font-mono text-gray-200">{eur(Math.abs(c.saldo))} <span className="text-gray-600">{c.saldo >= 0 ? 'D' : 'A'}</span></td>
                  </tr>
                ))}
                {data.bilancio.length === 0 && <tr><td colSpan={4} className="py-4 text-sm text-gray-600">Nessun conto.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'conto_economico' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Card title="Ricavi">
            {data.conto_economico.ricavi.map((r) => <Row key={r.codice} label={r.nome} value={r.importo} />)}
            <Row label="Totale ricavi" value={data.conto_economico.totRicavi} bold />
          </Card>
          <Card title="Costi">
            {data.conto_economico.costi.map((r) => <Row key={r.codice} label={r.nome} value={r.importo} />)}
            <Row label="Totale costi" value={data.conto_economico.totCosti} bold />
          </Card>
          <div className="col-span-2">
            <Card title="Utile netto">
              <Row label="Ricavi − Costi" value={data.conto_economico.utile} bold color={data.conto_economico.utile >= 0 ? '#10B981' : '#F87171'} />
            </Card>
          </div>
        </div>
      )}

      {tab === 'stato_patrimoniale' && (
        <div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <Card title="Attività">
              {data.stato_patrimoniale.attivo.map((r) => <Row key={r.codice} label={r.nome} value={r.importo} />)}
              <Row label="Totale attività" value={data.stato_patrimoniale.totAttivo} bold />
            </Card>
            <Card title="Passività e patrimonio netto">
              {data.stato_patrimoniale.passivo.map((r) => <Row key={r.codice} label={r.nome} value={r.importo} />)}
              {data.stato_patrimoniale.capitale.map((r) => <Row key={r.codice} label={r.nome} value={r.importo} />)}
              <Row label="Utile dell'esercizio" value={data.stato_patrimoniale.utile} color={data.stato_patrimoniale.utile >= 0 ? '#10B981' : '#F87171'} />
              <Row label="Totale passività + PN" value={data.stato_patrimoniale.totPassivo + data.stato_patrimoniale.totPatrimonio} bold />
            </Card>
          </div>
          <div className={'rounded-xl border p-4 text-sm text-center ' + (data.stato_patrimoniale.pareggio ? 'bg-green-900/20 border-green-800 text-green-400' : 'bg-red-900/20 border-red-800 text-red-400')}>
            {data.stato_patrimoniale.pareggio ? 'Stato patrimoniale in pareggio' : 'Attenzione: attività e passività+PN non coincidono'}
          </div>
        </div>
      )}
    </div>
  )
}

export default FinancialStatementView
