import React, { useState, useEffect } from 'react'
import useApi from '../lib/useApi'
import Icon from './Icon'

const eur = (n) => (n == null ? '—' : n.toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' €')
const pctTxt = (n) => (n == null ? null : (n > 0 ? '+' : '') + n.toLocaleString('it-IT', { maximumFractionDigits: 1 }) + '%')
const monthName = (ym) => new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1).toLocaleDateString('it-IT', { month: 'long' })

// "Da inizio anno": stessi conti del mese (stipendi, accantonato, quota alla casa), sommati fino all'ultimo mese concluso e confrontati
// con lo stesso periodo dell'anno prima. I numeri li calcola il programma.
export default function InsightsYear({ token }) {
  const api = useApi(token)
  const [year, setYear] = useState(null)
  const [data, setData] = useState(null)
  const [showLimits, setShowLimits] = useState(false)

  const load = async (y) => {
    const d = await api.get('/insights?period=anno' + (y ? '&year=' + y : ''))
    setData(d)
    if (d && d.year && !y) setYear(d.year)
  }
  useEffect(() => { load(year) }, [year]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return <div className="text-sm text-gray-600 py-6 text-center">Caricamento…</div>
  if (data.available === false) return null


  const thisYear = String(new Date().getFullYear())
  const header = (
    <div className="flex items-center gap-1 text-sm text-gray-400 mb-4">
      <button type="button" onClick={() => setYear(String(Number(data.year) - 1))} className="px-2 py-1 rounded hover:bg-gray-800" aria-label="Anno precedente"><Icon name="chevron-left" size={14} /></button>
      <span className="min-w-[90px] text-center text-ink">{data.year}</span>
      <button type="button" onClick={() => setYear(String(Number(data.year) + 1))} disabled={data.year >= thisYear} className="px-2 py-1 rounded hover:bg-gray-800 disabled:opacity-30" aria-label="Anno successivo"><Icon name="chevron-right" size={14} /></button>
      {!data.vuoto && <span className="ml-2 text-xs text-gray-500">da gennaio a {monthName(data.fino_a)}</span>}
    </div>
  )
  if (data.vuoto) return <div>{header}<div className="text-sm text-gray-500 py-4">Nessun mese concluso in questo anno.</div></div>

  const c = data.confronti && data.confronti.anno_precedente
  const tile = (label, value, sub, tone) => (
    <div className="bg-surface-page border border-gray-800 rounded-lg p-3 min-w-[130px] flex-1">
      <div className="text-[11px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className={'text-lg font-semibold font-mono mt-0.5 ' + (tone || 'text-ink')}>{value}</div>
      {sub && <div className="text-[11px] text-gray-500 mt-0.5">{sub}</div>}
    </div>
  )
  const tot = Math.max(1, data.spese_rate + data.spese_fisse + data.spese_variabili)
  const parts = [['Rate', data.spese_rate, '#F59E0B'], ['Fisse', data.spese_fisse, '#3B82F6'], ['Variabili', data.spese_variabili, '#10B981']]
  const max = Math.max(1, ...(data.categorie || []).map((k) => k.valore))

  return (
    <div>
      {header}
      <div className="flex gap-3 flex-wrap">
        {tile('Entrate sul conto', eur(data.entrate), data.accantonato > 0 ? '+ ' + eur(data.accantonato) + ' accantonati' + (data.accantonato_stimato ? ' (in parte stima)' : '') : null)}
        {tile('Spese', eur(data.spese), c && c.spese_variazione_pct != null ? pctTxt(c.spese_variazione_pct) + ' sul ' + c.anno : null)}
        {tile('Saldo', eur(data.saldo), c ? 'nel ' + c.anno + ': ' + eur(c.saldo) : null, data.saldo >= 0 ? 'text-green-400' : 'text-red-400')}
        {tile('Risparmio', data.risparmio_vero_pct == null ? '—' : data.risparmio_vero_pct.toLocaleString('it-IT', { maximumFractionDigits: 1 }) + '%', data.accantonato > 0 ? 'contando l\'accantonato' : null)}
      </div>

      <div className="mt-5">
        <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-2">Come si dividono le spese</div>
        <div className="flex h-2.5 rounded-full overflow-hidden bg-gray-800">
          {parts.map(([k, v, col]) => <div key={k} style={{ width: Math.round((v / tot) * 100) + '%', backgroundColor: col }} title={k} />)}
        </div>
        <div className="flex gap-4 flex-wrap mt-2 text-xs text-gray-400">
          {parts.map(([k, v, col]) => <span key={k} className="flex items-center gap-1.5"><span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: col }} />{k} <span className="text-gray-200 font-mono">{eur(v)}</span> <span className="text-gray-600">({Math.round((v / tot) * 100)}%)</span></span>)}
        </div>
        <div className="text-[11px] text-gray-600 mt-1">Rate e fisse sono già "impegnate": {Math.round(((data.spese_rate + data.spese_fisse) / tot) * 100)}% delle spese.</div>
      </div>

      {data.categorie && data.categorie.length > 0 && (
        <div className="mt-5">
          <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-2">Dove vanno i soldi (rispetto allo stesso periodo del {c ? c.anno : 'anno scorso'})</div>
          <div className="space-y-1.5">
            {data.categorie.slice(0, 6).map((k) => (
              <div key={k.nome} className="flex items-center gap-3 text-sm">
                <span className="w-32 truncate text-gray-300">{k.nome}</span>
                <div className="flex-1 h-1.5 rounded-full bg-gray-800 overflow-hidden"><div className="h-full rounded-full bg-accent" style={{ width: Math.round((k.valore / max) * 100) + '%' }} /></div>
                <span className="w-24 text-right font-mono text-gray-200">{eur(k.valore)}</span>
                <span className={'w-16 text-right text-xs font-mono ' + (k.variazione_pct == null ? 'text-gray-600' : k.variazione_pct >= 25 ? 'text-amber-400' : 'text-gray-500')}>{pctTxt(k.variazione_pct) || ''}</span>
              </div>
            ))}
          </div>
        </div>
      )}


      <button type="button" onClick={() => setShowLimits(!showLimits)} className="mt-4 text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1">
        <Icon name={showLimits ? 'chevron-down' : 'chevron-right'} size={12} />Cosa conta in questi numeri
      </button>
      {showLimits && <ul className="mt-2 text-xs text-gray-500 space-y-1 list-disc pl-5">{data.limiti.map((l, i) => <li key={i}>{l}</li>)}</ul>}
    </div>
  )
}
