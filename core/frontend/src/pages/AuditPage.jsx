import React, { useState, useEffect } from 'react'
import useApi from '../lib/useApi'
import Icon from '../components/Icon'
import GlassPageBackground from '../components/GlassPageBackground'

const ESITO_STYLE = {
  ok: 'bg-green-900/30 text-green-400',
  simulato: 'bg-amber-900/30 text-amber-400',
  eseguito: 'bg-accent/30 text-accent',
  parziale: 'bg-orange-900/30 text-orange-400',
  errore: 'bg-red-900/30 text-red-400',
  chiamata_reale: 'bg-green-900/30 text-green-400',
}

// ─── LOG ATTIVITÀ (tenant) ──────────────────────────────────────────────────────
// Paginazione reale (2026-09-03, richiesto dall'utente: "il paging va sistemato
// ovunque ora") — prima /audit-log rispondeva con un array nudo tagliato a un
// massimo di 500 righe lato server, senza offset: la cronologia oltre quel numero
// era semplicemente irraggiungibile, non solo "tutta nel DOM insieme" come negli
// altri casi sistemati in questo stesso giro. Ora {rows, total}, offset calcolato
// dalla pagina corrente.
const LOG_PAGE_SIZE = 50
const AUTO_LOG_PAGE_SIZE = 50
function AuditPage({ token }) {
  const api = useApi(token)
  const [log, setLog] = useState([])
  const [logTotal, setLogTotal] = useState(0)
  const [logPage, setLogPage] = useState(1)
  const [autoLog, setAutoLog] = useState([])
  const [autoLogTotal, setAutoLogTotal] = useState(0)
  const [autoLogPage, setAutoLogPage] = useState(1)
  const [showAutoLog, setShowAutoLog] = useState(false)

  const load = async (page) => {
    const data = await api.get('/audit-log?limit=' + LOG_PAGE_SIZE + '&offset=' + ((page - 1) * LOG_PAGE_SIZE))
    if (data) { setLog(data.rows); setLogTotal(data.total) }
  }
  const loadAutoLog = async (page) => {
    const data = await api.get('/automations/log?limit=' + AUTO_LOG_PAGE_SIZE + '&offset=' + ((page - 1) * AUTO_LOG_PAGE_SIZE))
    if (data) { setAutoLog(data.rows); setAutoLogTotal(data.total) }
  }
  useEffect(() => {
    load(logPage)
    const iv = setInterval(() => load(logPage), 10000)
    return () => clearInterval(iv)
  }, [logPage]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (showAutoLog) loadAutoLog(autoLogPage) }, [showAutoLog, autoLogPage]) // eslint-disable-line react-hooks/exhaustive-deps

  const PageFooter = ({ page, setPage, total, pageSize }) => {
    const totalPages = Math.ceil(total / pageSize) || 1
    if (totalPages <= 1) return null
    return (
      <div className="flex items-center justify-between px-3.5 py-2.5 border-t border-gray-800">
        <div className="text-xs text-gray-500">{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} di {total}</div>
        <div className="flex items-center gap-1">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
            className="px-2 py-1 rounded text-gray-400 hover:text-ink disabled:opacity-30 transition text-xs">
            <Icon name="chevron-left" size={14} />
          </button>
          {Array.from({ length: totalPages }, (_, i) => i + 1).filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 1).map((p, idx, arr) => (
            <React.Fragment key={p}>
              {idx > 0 && arr[idx - 1] !== p - 1 && <span className="text-gray-600 text-xs px-1">…</span>}
              <button onClick={() => setPage(p)}
                className={'px-2.5 py-1 rounded text-xs transition ' + (p === page ? 'bg-accent text-white' : 'text-gray-400 hover:text-ink')}>
                {p}
              </button>
            </React.Fragment>
          ))}
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}
            className="px-2 py-1 rounded text-gray-400 hover:text-ink disabled:opacity-30 transition text-xs">
            <Icon name="chevron-right" size={14} />
          </button>
        </div>
      </div>
    )
  }

  const ACTION_LABELS = {
    'module.create': 'Modulo creato', 'module.publish': 'Modulo pubblicato', 'module.install': 'Modulo installato',
    'module.uninstall': 'Modulo disinstallato', 'module.delete': 'Modulo eliminato', 'module.install_from_registry': 'Modulo installato dal registro',
    'user.create': 'Utente creato', 'user.update': 'Utente modificato', 'user.deactivate': 'Utente disabilitato',
    'connection.connect': 'Connessione attivata', 'connection.disconnect': 'Connessione disattivata',
    'record.delete': 'Record eliminato',
  }

  return (
    <GlassPageBackground>
      <h1 className="text-lg font-bold text-ink tracking-[-0.35px] mb-1">Log attività</h1>
      <p className="text-gray-500 text-sm mb-6">Azioni amministrative fatte in questa istanza — moduli, utenti, connessioni, record eliminati.</p>
      <div className="glass-panel overflow-hidden divide-y divide-gray-800/70">
        {log.length === 0 && <div className="text-gray-600 text-sm p-6">Nessuna attività registrata ancora.</div>}
        {log.map((l) => (
          <div key={l.id} className="p-3.5 flex items-start justify-between text-sm flex-wrap gap-x-3 gap-y-1">
            <div className="min-w-0">
              <span className="text-ink font-medium">{ACTION_LABELS[l.action] || l.action}</span>
              {l.target && <span className="text-gray-500 font-mono text-xs ml-2">{l.target}</span>}
              <div className="text-xs text-gray-600 mt-0.5">da <span className="font-mono">{l.actor}</span>{l.details ? ' — ' + Object.entries(l.details).map(([k, v]) => k + ': ' + v).join(', ') : ''}</div>
            </div>
            <div className="text-xs text-gray-600 flex-shrink-0">{new Date(l.created_at).toLocaleString('it-IT')}</div>
          </div>
        ))}
        <PageFooter page={logPage} setPage={setLogPage} total={logTotal} pageSize={LOG_PAGE_SIZE} />
      </div>

      <div className="mt-8">
        <button onClick={() => setShowAutoLog((s) => !s)} className="text-xs text-gray-500 hover:text-gray-300 transition flex items-center gap-1.5 mb-3">
          <Icon name={showAutoLog ? 'chevron-down' : 'chevron-right'} size={12} />
          Log automazioni ({autoLogTotal} totali, da tutti i moduli)
        </button>
        {showAutoLog && (
          <div className="glass-panel overflow-hidden divide-y divide-gray-800/70">
            {autoLog.length === 0 && <div className="text-gray-600 text-sm p-4">Nessuna esecuzione ancora — scatterà qualcosa qui appena un'automazione di un modulo si attiva.</div>}
            {autoLog.map((l) => (
              <div key={l.id} className="p-3 flex items-start justify-between text-sm flex-wrap gap-x-3 gap-y-1">
                <div className="min-w-0">
                  <span className="text-ink font-medium">{l.automation_label}</span>
                  <span className="text-gray-600 mx-2">·</span>
                  <span className="text-gray-500 font-mono text-xs">{l.module_slug}</span>
                  <div className="text-xs text-gray-500 mt-0.5">{l.trigger_desc} &#8594; {l.action_desc}</div>
                </div>
                <div className="text-right flex-shrink-0">
                  <span className={'text-[10px] px-2 py-0.5 rounded ' + (ESITO_STYLE[l.esito] || ESITO_STYLE.simulato)}>{l.esito}</span>
                  <div className="text-[10px] text-gray-600 mt-1">{new Date(l.created_at).toLocaleString('it-IT')}</div>
                </div>
              </div>
            ))}
            <PageFooter page={autoLogPage} setPage={setAutoLogPage} total={autoLogTotal} pageSize={AUTO_LOG_PAGE_SIZE} />
          </div>
        )}
      </div>
    </GlassPageBackground>
  )
}

export default AuditPage
