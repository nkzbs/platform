import React, { useEffect, useState } from 'react'
import useApi from '../lib/useApi'

function eur(n) {
  return (n || 0).toLocaleString('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
}

// Stessa tiered-commission di nico (calcoloProvvigioneAgente): sceglie lo scaglione
// con soglia più alta <= fatturato, applica la sua percentuale; aggiunge il bonus
// target se il fatturato raggiunge il target_fatturato dell'agente.
function calcolaProvvigione(agente, fatturato) {
  let scaglioni = []
  try { scaglioni = JSON.parse(agente.scaglioni_provvigione || '[]'); if (!Array.isArray(scaglioni)) scaglioni = [] } catch (e) { scaglioni = [] }
  let perc = Number(agente.provvigione_base) || 0
  scaglioni.forEach((s) => { if (fatturato >= Number(s.soglia)) perc = Number(s.perc) })
  let totale = fatturato * (perc / 100)
  const target = Number(agente.target_fatturato) || 0
  if (target > 0 && fatturato >= target) totale += Number(agente.bonus_target) || 0
  return { perc, totale }
}

function Bar({ pct, color }) {
  return (
    <div className="h-1.5 rounded-full bg-gray-800 overflow-hidden">
      <div className="h-full rounded-full" style={{ width: Math.min(100, pct) + '%', backgroundColor: color || '#2563EB' }} />
    </div>
  )
}

function AnalysisDate(iso) {
  if (!iso) return ''
  return new Date(iso.replace(' ', 'T') + 'Z').toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// Due report, stessa aggregazione client-side di nico (ReportisticaView): performance
// agenti (ricavi da fatture, provvigione a scaglioni, margine netto) e marginalità
// prodotto (unità vendute dalle righe fattura, margine su prezzo di listino).
function ReportisticaPage({ token }) {
  const api = useApi(token)
  const [loading, setLoading] = useState(true)
  const [agentiRows, setAgentiRows] = useState([])
  const [prodottiRows, setProdottiRows] = useState([])
  // Analisi Mistral (2026-09-28, richiesto dall'utente: "vorrei che mistral mi
  // analizzasse i dati", "non voglio troppe chiamate") — SOLO un bottone
  // manuale, mai generata da sola all'apertura pagina: all'avvio si legge
  // solo l'ultima analisi già in cache (GET, zero costo AI).
  const [analysis, setAnalysis] = useState(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeError, setAnalyzeError] = useState(null)

  useEffect(() => {
    (async () => {
      const [agenti, fatture, ordini, prodotti, fattureRighe, cachedAnalysis] = await Promise.all([
        api.get('/records/agenti'),
        api.get('/records/fatture'),
        api.get('/records/ordini'),
        api.get('/records/prodotti'),
        api.get('/records/fatture_righe'),
        api.get('/reportistica/analysis'),
      ])
      if (cachedAnalysis) setAnalysis(cachedAnalysis)
      if (!agenti || !fatture || !prodotti || !fattureRighe) { setLoading(false); return }

      const aRows = agenti.map((a) => {
        const fatt = fatture.filter((f) => String(f.data.agente) === String(a.id))
        const ricavi = fatt.reduce((s, f) => s + (Number(f.data.imponibile_calcolato) || 0), 0)
        const { perc, totale: provvigione } = calcolaProvvigione(a.data, ricavi)
        const nOrdini = (ordini || []).filter((o) => String(o.data.agente) === String(a.id)).length
        return {
          id: a.id,
          nome: [a.data.nome, a.data.cognome].filter(Boolean).join(' '),
          zona: a.data.zona,
          ricavi, provvigione, perc,
          margine: ricavi - provvigione,
          ordini: nOrdini,
        }
      }).filter((r) => r.ricavi > 0).sort((x, y) => y.ricavi - x.ricavi)
      setAgentiRows(aRows)

      const pRows = prodotti.map((p) => {
        const unita = fattureRighe.filter((r) => String(r.data.prodotto) === String(p.id))
          .reduce((s, r) => s + (Number(r.data.quantita) || 0), 0)
        const prezzo = Number(p.data.prezzo_listino) || 0
        const costo = Number(p.data.costo_acquisto) || 0
        const ricavi = unita * prezzo
        const costi = unita * costo
        const margPct = prezzo > 0 ? ((prezzo - costo) / prezzo) * 100 : 0
        return { id: p.id, nome: p.data.nome, categoria: p.data.categoria, unita, ricavi, costi, margPct }
      }).filter((r) => r.unita > 0).sort((x, y) => y.ricavi - x.ricavi)
      setProdottiRows(pRows)

      setLoading(false)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const runAnalysis = async () => {
    setAnalyzing(true)
    setAnalyzeError(null)
    const res = await api.post('/reportistica/analyze', { data: { agenti: agentiRows, prodotti: prodottiRows } })
    setAnalyzing(false)
    if (res.ok) setAnalysis(res.data)
    else setAnalyzeError(res.data?.error || 'Analisi non riuscita, riprova più tardi')
  }

  if (loading) return <div className="text-gray-500 text-sm">Caricamento...</div>

  const maxRicaviAgente = Math.max(1, ...agentiRows.map((r) => r.ricavi))
  const maxRicaviProdotto = Math.max(1, ...prodottiRows.map((r) => r.ricavi))

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold text-ink tracking-[-0.35px]">Reportistica</h1>
          <p className="text-gray-500 text-sm mt-0.5">Performance agenti e marginalità prodotto, calcolate su tutte le fatture emesse.</p>
        </div>
        <button onClick={runAnalysis} disabled={analyzing || (agentiRows.length === 0 && prodottiRows.length === 0)}
          className="text-sm bg-accent hover:bg-accent/90 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg transition flex-shrink-0 whitespace-nowrap">
          {analyzing ? 'Analisi in corso...' : 'Analizza con Mistral'}
        </button>
      </div>

      {analyzeError && (
        <div className="mb-6 text-sm text-red-400 bg-red-950/30 border border-red-900 rounded-md px-3 py-2">{analyzeError}</div>
      )}

      {analysis && (
        <div className="bg-surface-card rounded-md border border-gray-800 p-5 mb-6">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-medium text-ink">Commento AI</div>
            <div className="text-xs text-gray-500">generato il {AnalysisDate(analysis.created_at)}{analysis.generated_by ? ' da ' + analysis.generated_by : ''}</div>
          </div>
          <div className="text-sm text-gray-300 whitespace-pre-wrap">{analysis.result_text}</div>
        </div>
      )}

      <div className="bg-surface-card rounded-md border border-gray-800 p-5 mb-6">
        <div className="text-sm font-medium text-ink mb-4">Performance agenti</div>
        {agentiRows.length === 0 && <div className="text-sm text-gray-600">Nessun agente con fatture emesse.</div>}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 uppercase tracking-wider border-b border-gray-800">
                <th className="pb-2 pr-3 font-normal">Agente</th>
                <th className="pb-2 pr-3 font-normal">Zona</th>
                <th className="pb-2 pr-3 font-normal">Ordini</th>
                <th className="pb-2 pr-3 font-normal">Ricavi</th>
                <th className="pb-2 pr-3 font-normal">Provvigione</th>
                <th className="pb-2 pr-3 font-normal">Margine netto</th>
                <th className="pb-2 font-normal w-32">Ricavi (rel.)</th>
              </tr>
            </thead>
            <tbody>
              {agentiRows.map((r) => (
                <tr key={r.id} className="border-b border-gray-800/50">
                  <td className="py-2 pr-3 text-ink">{r.nome}</td>
                  <td className="py-2 pr-3 text-gray-400">{r.zona || '—'}</td>
                  <td className="py-2 pr-3 text-gray-400">{r.ordini}</td>
                  <td className="py-2 pr-3 font-mono text-gray-200">{eur(r.ricavi)}</td>
                  <td className="py-2 pr-3 font-mono text-gray-400">{eur(r.provvigione)} <span className="text-gray-600">({r.perc}%)</span></td>
                  <td className="py-2 pr-3 font-mono text-green-400">{eur(r.margine)}</td>
                  <td className="py-2"><Bar pct={(r.ricavi / maxRicaviAgente) * 100} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-surface-card rounded-md border border-gray-800 p-5">
        <div className="text-sm font-medium text-ink mb-4">Marginalità prodotto</div>
        {prodottiRows.length === 0 && <div className="text-sm text-gray-600">Nessun prodotto venduto tramite fattura.</div>}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 uppercase tracking-wider border-b border-gray-800">
                <th className="pb-2 pr-3 font-normal">Prodotto</th>
                <th className="pb-2 pr-3 font-normal">Categoria</th>
                <th className="pb-2 pr-3 font-normal">Unità vendute</th>
                <th className="pb-2 pr-3 font-normal">Ricavi</th>
                <th className="pb-2 pr-3 font-normal">Costi</th>
                <th className="pb-2 pr-3 font-normal">Margine %</th>
                <th className="pb-2 font-normal w-32">Ricavi (rel.)</th>
              </tr>
            </thead>
            <tbody>
              {prodottiRows.map((r) => (
                <tr key={r.id} className="border-b border-gray-800/50">
                  <td className="py-2 pr-3 text-ink">{r.nome}</td>
                  <td className="py-2 pr-3 text-gray-400">{r.categoria || '—'}</td>
                  <td className="py-2 pr-3 text-gray-400">{r.unita}</td>
                  <td className="py-2 pr-3 font-mono text-gray-200">{eur(r.ricavi)}</td>
                  <td className="py-2 pr-3 font-mono text-gray-400">{eur(r.costi)}</td>
                  <td className="py-2 pr-3 font-mono text-green-400">{r.margPct.toFixed(1)}%</td>
                  <td className="py-2"><Bar pct={(r.ricavi / maxRicaviProdotto) * 100} color="#10B981" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default ReportisticaPage
