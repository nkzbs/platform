import React, { useState, useEffect } from 'react'
import useApi from '../lib/useApi'
import Icon from './Icon'

const eur = (n) => (n == null ? '—' : n.toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' €')
const pctTxt = (n) => (n == null ? null : (n > 0 ? '+' : '') + n.toLocaleString('it-IT', { maximumFractionDigits: 1 }) + '%')
const monthLabel = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' }) }
const shift = (ym, d) => { const [y, m] = ym.split('-').map(Number); const t = y * 12 + (m - 1) + d; return Math.floor(t / 12) + '-' + String((t % 12) + 1).padStart(2, '0') }

// "Come sta andando": i numeri del mese li calcola il programma; l'assistente, se lo chiedi, li racconta.
export default function InsightsCard({ token, onNavigate }) {
  const api = useApi(token)
  const [month, setMonth] = useState(null) // null = ultimo mese concluso (lo decide il server)
  const [data, setData] = useState(null)
  const [explain, setExplain] = useState(null) // { busy } | { text, cached } | { error }
  const [showLimits, setShowLimits] = useState(false)

  const load = async (m) => {
    const d = await api.get('/insights' + (m ? '?month=' + m : ''))
    setData(d)
    setExplain(d && d.explanation && !d.explanation.stale ? { text: d.explanation.text, cached: true } : null)
    if (d && d.month && !m) setMonth(d.month)
  }
  useEffect(() => { load(month) }, [month]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!data || data.available === false) return null

  const ask = async (refresh) => {
    setExplain({ busy: true })
    const res = await api.post('/insights/explain', { month: data.month, refresh: !!refresh })
    if (res.ok && res.data.text) setExplain({ text: res.data.text, cached: res.data.cached })
    else if (res.data && res.data.code === 'ai_budget_exceeded') setExplain({ error: 'Il tetto di spesa mensile dell\'assistente è raggiunto: riprende il mese prossimo.' })
    else if (res.data && res.data.code === 'ai_unverified') setExplain({ error: 'Non sono riuscito a scrivere una spiegazione affidabile. Riprova.' })
    else if (res.data && res.data.code === 'ai_not_configured') setExplain({ error: 'Manca la chiave Mistral: inseriscila in Impostazioni → Assistente AI.' })
    else setExplain({ error: 'L\'assistente non è disponibile in questo momento.' })
  }

  const c = data.confronti || {}
  const positivo = data.saldo >= 0
  const tile = (label, value, sub, tone) => (
    <div className="bg-surface-page border border-gray-800 rounded-lg p-3 min-w-[130px] flex-1">
      <div className="text-[11px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className={'text-lg font-semibold font-mono mt-0.5 ' + (tone || 'text-ink')}>{value}</div>
      {sub && <div className="text-[11px] text-gray-500 mt-0.5">{sub}</div>}
    </div>
  )
  const max = Math.max(1, ...(data.categorie || []).map((x) => x.valore))
  const cur = new Date().toISOString().slice(0, 7)

  return (
    <section className="bg-surface-card border border-gray-800 rounded-xl p-5 mb-6">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <div className="flex items-center gap-2">
          <Icon name="bar-chart" size={16} className="text-accent" />
          <h2 className="text-sm font-semibold text-ink">Come sta andando</h2>
        </div>
        <div className="flex items-center gap-1 text-sm text-gray-400">
          <button type="button" onClick={() => setMonth(shift(data.month, -1))} className="px-2 py-1 rounded hover:bg-gray-800" aria-label="Mese precedente"><Icon name="chevron-left" size={14} /></button>
          <span className="min-w-[120px] text-center capitalize text-ink">{monthLabel(data.month)}{data.in_corso ? ' (in corso)' : ''}</span>
          <button type="button" onClick={() => setMonth(shift(data.month, 1))} disabled={data.month >= cur} className="px-2 py-1 rounded hover:bg-gray-800 disabled:opacity-30" aria-label="Mese successivo"><Icon name="chevron-right" size={14} /></button>
        </div>
      </div>

      <div className="flex gap-3 flex-wrap">
        {tile('Entrate sul conto', eur(data.entrate), data.accantonato > 0 ? '+ ' + eur(data.accantonato) + ' accantonati' + (data.accantonato_stimato ? ' (stima)' : '') : null)}
        {tile('Spese', eur(data.spese), c.mese_precedente && c.mese_precedente.spese_variazione_pct != null ? pctTxt(c.mese_precedente.spese_variazione_pct) + ' sul mese prima' : null)}
        {tile('Saldo', eur(data.saldo), null, data.entrate ? (positivo ? 'text-green-400' : 'text-red-400') : 'text-gray-500')}
        {tile('Risparmio', (data.risparmio_vero_pct == null ? '—' : data.risparmio_vero_pct.toLocaleString('it-IT', { maximumFractionDigits: 1 }) + '%'), data.accantonato > 0 ? 'contando l\'accantonato' + (data.accantonato_stimato ? ' (stimato)' : '') : (c.media_12_mesi && c.media_12_mesi.spese ? 'spese medie ' + eur(c.media_12_mesi.spese) : null))}
      </div>

      {data.categorie && data.categorie.length > 0 && (
        <div className="mt-5">
          <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-2">Dove vanno i soldi</div>
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
          <div className="text-[11px] text-gray-600 mt-1.5">Il confronto è con la media dei mesi precedenti.</div>
        </div>
      )}

      {data.banca && (
        <div className="mt-5 rounded-lg bg-surface-page border border-gray-800 p-3 text-xs text-gray-300">
          <span className="text-gray-500">In banca (conto personale): </span>
          entrate {eur(data.banca.entrate_reali)}, uscite reali {eur(data.banca.uscite_reali)}
          {data.banca.non_registrate_n > 0
            ? <span className="text-amber-400">, di cui {eur(data.banca.non_registrate)} non registrati in Finance ({data.banca.non_registrate_n} movimenti)</span>
            : <span className="text-green-400">, tutte registrate in Finance</span>}
          {onNavigate && <button type="button" onClick={() => onNavigate('movimenti')} className="ml-2 text-accent hover:underline">Vedi i movimenti →</button>}
        </div>
      )}

      {data.anomalie && data.anomalie.length > 0 && (
        <div className="mt-5 rounded-lg bg-amber-900/15 border border-amber-900/40 p-3">
          <div className="text-xs font-medium text-amber-400 mb-1">Da guardare</div>
          <ul className="text-xs text-gray-300 space-y-0.5">
            {data.anomalie.map((a) => (
              <li key={a.nome}>{a.tipo === 'categoria_nuova'
                ? a.nome + ': ' + eur(a.valore) + ', una voce che nei mesi scorsi non c\'era'
                : a.nome + ': ' + eur(a.valore) + ', ' + pctTxt(a.variazione_pct) + ' rispetto alla media (' + eur(a.media_6m) + ')'}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-5 pt-4 border-t border-gray-800">
        <div className="flex items-center gap-3 flex-wrap">
          <button type="button" onClick={() => ask(false)} disabled={!!(explain && explain.busy)} className="flex items-center gap-2 text-sm text-accent hover:underline disabled:opacity-60 disabled:no-underline">
            <Icon name="wand" size={14} />{explain && explain.busy ? 'Sto leggendo i numeri…' : explain && explain.text ? 'Aggiorna la spiegazione' : 'Spiega con l\'assistente'}
          </button>
          {explain && explain.text && !explain.busy && <button type="button" onClick={() => ask(true)} className="text-xs text-gray-500 hover:text-gray-300">Riscrivi</button>}
        </div>
        {data.explanation && data.explanation.stale && !(explain && explain.text) && <div className="mt-2 text-xs text-gray-500">I numeri sono cambiati dall'ultima spiegazione.</div>}
        {explain && explain.text && (
          <div className="mt-3 rounded-lg bg-surface-page border border-gray-800 p-4 text-sm text-gray-300 leading-relaxed whitespace-pre-line">
            {explain.text}
            <div className="text-xs text-gray-600 mt-3">Scritto dall'assistente a partire dai numeri qui sopra; ogni cifra citata è controllata, ma verifica sempre sulle spese.</div>
          </div>
        )}
        {explain && explain.error && <div className="mt-3 text-sm text-amber-400">{explain.error}</div>}
      </div>

      <button type="button" onClick={() => setShowLimits(!showLimits)} className="mt-4 text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1">
        <Icon name={showLimits ? 'chevron-down' : 'chevron-right'} size={12} />Cosa conta in questi numeri
      </button>
      {showLimits && <ul className="mt-2 text-xs text-gray-500 space-y-1 list-disc pl-5">{data.limiti.map((l, i) => <li key={i}>{l}</li>)}</ul>}
    </section>
  )
}
