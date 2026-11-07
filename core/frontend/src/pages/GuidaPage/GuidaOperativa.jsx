import React, { useState, useEffect, useMemo } from 'react'
import useApi from '../../lib/useApi'
import RichText from '../../components/RichText'
import CapitoloModulo from '../../components/CapitoloModulo'
import Icon from '../../components/Icon'

// «Come si lavora»: la guida d'uso scritta dal pacchetto del verticale (introduzione, passi per il tuo ruolo, flussi, un capitolo per modulo installato, glossario),
// con in ogni capitolo la parte ricavata dagli schemi. Cerca in tutto il testo. Nessun nome di settore qui: tutto arriva da /api/guida.
const includes = (t, q) => String(t || '').toLowerCase().includes(q)

export default function GuidaOperativa({ modules, token, user, onVuota }) {
  const api = useApi(token)
  const [g, setG] = useState(null)
  const [query, setQuery] = useState('')
  const [aperto, setAperto] = useState(null)

  useEffect(() => { api.get('/guida').then((d) => { setG(d || { presente: false }); if (d && !d.presente && onVuota) onVuota() }).catch(() => setG({ presente: false })) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const q = query.trim().toLowerCase()

  const capitoli = useMemo(() => {
    if (!g) return []
    return (modules || []).filter((m) => g.capitoli && g.capitoli[m.slug]).map((m) => ({ m, c: g.capitoli[m.slug] }))
      .filter(({ m, c }) => !q || includes(m.name, q) || includes(c.scopo, q) || (c.come_si_usa || []).some((p) => includes(p, q)) || (c.consigli || []).some((p) => includes(p, q)))
  }, [g, modules, q])

  if (!g) return <div className="text-sm text-gray-600 py-6">Caricamento…</div>
  if (!g.presente) return <div className="text-sm text-gray-500 py-6">Nessuna guida d'uso per questo spazio di lavoro. Il «Percorso guidato» e il «Riferimento» spiegano Platform.</div>

  const ruolo = (g.per_ruolo && (g.per_ruolo[user && user.role] || g.per_ruolo.default)) || null
  const flussi = (g.flussi || []).filter((f) => !q || includes(f.titolo, q) || f.passi.some((p) => includes(p, q)))
  const glossario = (g.glossario || []).filter((x) => !q || includes(x.termine, q) || includes(x.significato, q))

  return (
    <div className="max-w-3xl">
      {g.introduzione && (
        <div className="mb-6">
          <h2 className="text-lg font-bold text-ink mb-2">{g.introduzione.titolo}</h2>
          {(g.introduzione.testo || []).map((p, i) => <p key={i} className="text-sm text-gray-300 leading-relaxed mb-2"><RichText text={p} /></p>)}
        </div>
      )}
      <div className="relative mb-6 max-w-sm">
        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600 pointer-events-none"><Icon name="search" size={13} /></div>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cerca nella guida…" aria-label="Cerca nella guida" className="w-full bg-surface-card text-ink pl-9 pr-3 py-2 rounded-lg text-sm outline-none border border-gray-800 focus:border-accent transition placeholder-gray-600" />
      </div>

      {ruolo && !q && (
        <div className="glass-panel p-5 mb-6">
          <div className="text-sm font-semibold text-ink mb-2">{ruolo.titolo}</div>
          <ol className="space-y-2 list-decimal pl-5 text-sm text-gray-300 leading-relaxed marker:text-accent">{(ruolo.passi || []).map((p, i) => <li key={i}><RichText text={p} /></li>)}</ol>
        </div>
      )}

      {flussi.length > 0 && (
        <div className="mb-8">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Il lavoro, passo per passo</div>
          <div className="space-y-3">
            {flussi.map((f) => (
              <div key={f.titolo} className="glass-panel p-5">
                <div className="text-sm font-semibold text-ink mb-2">{f.titolo}</div>
                <ol className="space-y-1.5 list-decimal pl-5 text-sm text-gray-300 leading-relaxed marker:text-accent">{f.passi.map((p, i) => <li key={i}><RichText text={p} /></li>)}</ol>
              </div>
            ))}
          </div>
        </div>
      )}

      {capitoli.length > 0 && (
        <div className="mb-8">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Un capitolo per modulo</div>
          <div className="space-y-2">
            {capitoli.map(({ m, c }) => {
              const open = aperto === m.slug || !!q
              return (
                <div key={m.slug} className="glass-panel overflow-hidden">
                  <button type="button" onClick={() => setAperto(open && !q ? null : m.slug)} aria-expanded={open} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.03]">
                    <span className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: (m.color || '#2563EB') + '22', color: m.color || '#2563EB' }}><Icon name={m.icon || 'box'} size={15} /></span>
                    <span className="flex-1 min-w-0"><span className="block text-sm font-semibold text-ink">{m.name}</span><span className="block text-xs text-gray-500 truncate">{c.scopo}</span></span>
                    <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} className="text-gray-500 flex-shrink-0" />
                  </button>
                  {open && <div className="px-4 pb-5 pt-1"><CapitoloModulo modulo={m} capitolo={c} /></div>}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {glossario.length > 0 && (
        <div className="mb-8">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Parole usate</div>
          <dl className="glass-panel divide-y divide-gray-800/70">
            {glossario.map((x) => (<div key={x.termine} className="px-4 py-3"><dt className="text-sm font-semibold text-ink">{x.termine}</dt><dd className="text-sm text-gray-400 mt-0.5 leading-relaxed">{x.significato}</dd></div>))}
          </dl>
        </div>
      )}
      {q && !flussi.length && !capitoli.length && !glossario.length && <div className="text-sm text-gray-500">Niente per «{query}».</div>}
    </div>
  )
}
