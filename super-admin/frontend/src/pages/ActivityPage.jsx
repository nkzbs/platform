import React, { useState, useEffect } from 'react'
import { API } from '../lib/api'
import Icon from '../components/Icon'
import Select from '../components/Select'
import AnalyticsPage from './AnalyticsPage'

// Log + Monitoring unificati in un solo feed — prima erano due pagine separate
// (azioni amministrative da una parte, errori dall'altra) con descrizioni deboli
// (azione grezza tipo "tenant.redeploy_all", dettagli come "chiave: valore" senza
// una vera frase, e senza distinguere le azioni fatte DENTRO i singoli tenant da
// quelle di Super Admin). Qui: un'unica timeline cronologica, cross-tenant, con una
// descrizione leggibile pre-calcolata lato server (vedi describe-event.js).
function ActivityPage({ token, initialTenantFilter }) {
  const headers = { Authorization: 'Bearer ' + token }
  // Attività + Analytics unificate in una sola voce di menu (richiesto
  // dall'utente 2026-10-14: due voci separate per dati che si guardano
  // insieme, log eventi e metriche nel tempo). Due schede, non due pagine.
  const [tab, setTab] = useState('eventi')
  const [events, setEvents] = useState([])
  const [kindFilter, setKindFilter] = useState('')
  // PLATFORM-UI-REDESIGN-CATALOG.md #27 — pre-filtrato quando si arriva da
  // "Vedi log attività" dentro il pannello di un tenant (TenantsPage.jsx),
  // stesso filtro client-side di sempre, solo con un valore iniziale diverso
  // da vuoto.
  const [tenantFilter, setTenantFilter] = useState(initialTenantFilter || '')
  const [expandedId, setExpandedId] = useState(null)
  // Il backend aggrega da più fonti (log propri + feed di ogni tenant, live)
  // e poi taglia a `limit` — non è un vero offset/cursor, un cambio di limite
  // rialza semplicemente la finestra richiesta e ricarica tutto. Default a 20
  // (richiesto esplicitamente 2026-08-31, prima 100 in un'unica lista lunga
  // era troppo su schermo stretto), con un dropdown per alzarlo invece del
  // precedente bottone "Carica altri" — stessa richiesta, resa esplicita.
  const LIMIT_OPTIONS = [20, 50, 100, 200, 500]
  const [limit, setLimit] = useState(LIMIT_OPTIONS[0])
  // P2 (collaudo operativo 2026-09-03) — prima il tetto di `limit` (max 500) era anche
  // l'orizzonte massimo raggiungibile per sempre, non solo la vista di default: niente
  // permetteva di risalire più indietro. `hasMore`/`loadingMore` pilotano il bottone
  // "Carica altri" sotto, che usa il cursore `before` (vedi loadMore). Il refresh
  // periodico (merge per id, mai un replace secco) non deve MAI far perdere ciò che
  // "Carica altri" ha già portato in vista.
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  const mergeById = (prev, incoming) => {
    const byId = new Map(prev.map((e) => [e.id, e]))
    for (const e of incoming) byId.set(e.id, e)
    return [...byId.values()].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  }

  const load = async (currentLimit) => {
    const res = await fetch(API + '/monitoring/timeline?limit=' + currentLimit, { headers })
    if (!res.ok) return
    const { rows, has_more } = await res.json()
    setEvents((prev) => mergeById(prev, rows))
    setHasMore(has_more)
  }
  useEffect(() => { load(limit); const iv = setInterval(() => load(limit), 15000); return () => clearInterval(iv) }, [limit])

  const loadMore = async () => {
    if (events.length === 0) return
    setLoadingMore(true)
    const oldest = events.reduce((min, e) => (e.created_at < min ? e.created_at : min), events[0].created_at)
    const res = await fetch(API + '/monitoring/timeline?limit=' + limit + '&before=' + encodeURIComponent(oldest), { headers })
    setLoadingMore(false)
    if (!res.ok) return
    const { rows, has_more } = await res.json()
    setEvents((prev) => mergeById(prev, rows))
    setHasMore(has_more)
  }

  const tenantOptions = [...new Map(events.map((e) => [e.tenant_name, e.tenant_name])).values()]
    .sort((a, b) => (a === 'Super Admin' ? -1 : b === 'Super Admin' ? 1 : a.localeCompare(b)))

  const filtered = events
    .filter((e) => !kindFilter || e.kind === kindFilter)
    .filter((e) => !tenantFilter || e.tenant_name === tenantFilter)

  const tabCls = (active) => 'px-3 py-2 text-sm border-b-2 -mb-px transition ' +
    (active ? 'border-cp-primary text-ink font-medium' : 'border-transparent text-gray-500 hover:text-ink')

  return (
    <div>
      <h1 className="text-lg font-bold text-ink tracking-[-0.35px] mb-1">Attività</h1>
      <p className="text-gray-500 text-sm mb-4">Eventi: azioni di Super Admin ed errori tecnici dei tenant. Metriche: come cresce la piattaforma nel tempo. Cosa fanno gli utenti dentro un tenant non si vede da qui: sta nel registro del tenant.</p>

      <div className="flex items-center gap-1 mb-5 border-b border-gray-800">
        <button onClick={() => setTab('eventi')} className={tabCls(tab === 'eventi')}>Eventi</button>
        <button onClick={() => setTab('metriche')} className={tabCls(tab === 'metriche')}>Metriche</button>
      </div>

      {tab === 'eventi' && (
        <>
          <div className="flex items-center gap-3 flex-wrap mb-4">
            <Select value={kindFilter} onChange={setKindFilter} placeholder="Tutti i tipi" className="w-44"
              options={[{ value: '', label: 'Tutti i tipi' }, { value: 'audit', label: 'Solo azioni' }, { value: 'error', label: 'Solo errori' }]} />
            <Select value={tenantFilter} onChange={setTenantFilter} placeholder="Tutti i tenant" className="w-52"
              options={[{ value: '', label: 'Tutti i tenant' }, ...tenantOptions.map((n) => ({ value: n, label: n }))]} />
            <Select value={limit} onChange={(v) => setLimit(Number(v))} className="w-36"
              options={LIMIT_OPTIONS.map((n) => ({ value: n, label: n + ' per pagina' }))} />
          </div>

          <div className="bg-surface-card rounded-md border border-gray-800 divide-y divide-gray-800/70">
            {filtered.length === 0 && <div className="text-gray-600 text-sm p-6">Nessuna attività registrata ancora.</div>}
            {filtered.map((e) => (
              <div key={e.id} className="p-3.5 text-sm">
                <div className={'flex items-start justify-between flex-wrap gap-x-3 gap-y-1 ' + (e.kind === 'error' ? 'cursor-pointer' : '')}
                  onClick={() => e.kind === 'error' && setExpandedId(expandedId === e.id ? null : e.id)}>
                  <div className="min-w-0 flex items-start gap-2">
                    <Icon name={e.kind === 'error' ? 'alert-triangle' : 'check'} size={13}
                      className={'mt-0.5 flex-shrink-0 ' + (e.kind === 'error' ? 'text-red-400' : 'text-green-400/70')} />
                    <div>
                      <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 mr-2">{e.tenant_name}</span>
                      <span className={e.kind === 'error' ? 'text-red-400/90' : 'text-ink font-medium'}>{e.description}</span>
                      {e.kind === 'audit' && <div className="text-xs text-gray-600 mt-0.5">da <span className="font-mono">{e.actor}</span></div>}
                    </div>
                  </div>
                  <div className="text-xs text-gray-600 flex-shrink-0">{new Date(e.created_at).toLocaleString('it-IT')}</div>
                </div>
                {expandedId === e.id && e.stack && (
                  <pre className="mt-2 ml-5 text-[10px] text-gray-500 bg-black/30 rounded-lg p-2.5 overflow-x-auto whitespace-pre-wrap">{e.stack}</pre>
                )}
              </div>
            ))}
          </div>
          {hasMore && (
            <button onClick={loadMore} disabled={loadingMore}
              className="mt-3 text-xs text-cp-primary hover:opacity-80 transition disabled:opacity-50">
              {loadingMore ? 'Carico...' : 'Carica altri →'}
            </button>
          )}
        </>
      )}

      {tab === 'metriche' && <AnalyticsPage token={token} embedded />}
    </div>
  )
}

export default ActivityPage
