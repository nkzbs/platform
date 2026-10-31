import React, { useState, useEffect } from 'react'
import useApi from '../lib/useApi'
import StatusBadge from './StatusBadge'

// Versione ridotta per tenant del pannello di Super Admin (2026-10-15,
// stessa richiesta dell'utente). Legge SOLO /security-status di QUESTO
// tenant — niente Cloudflare/TLS, quello è a livello di piattaforma e si
// vede solo da Super Admin.
const ACTION_LABELS = {
  'auth.login_failed': 'Accesso con password non riuscito',
  'auth.2fa_verify_failed': 'Codice 2FA errato',
  'auth.webauthn_login_failed': 'Accesso con passkey non riuscito',
}

export default function SicurezzaTab({ token }) {
  const api = useApi(token)
  const [status, setStatus] = useState(null)
  const [accettaBusy, setAccettaBusy] = useState(false)
  const load = () => api.get('/security-status').then((d) => d && setStatus(d))
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (!status) return <p className="text-sm text-gray-500">Carico…</p>

  const u = status.users
  const tfaAll = u.total > 0 && u.with_2fa === u.total
  const tfaNone = u.with_2fa === 0
  const pkAll = u.total > 0 && u.with_passkey === u.total
  const integ = status.integrity

  const accettaIntegrita = async () => {
    setAccettaBusy(true)
    await api.post('/security-status/accetta-integrita', {})
    setAccettaBusy(false)
    load()
  }

  return (
    <div className="max-w-2xl space-y-5">
      <p className="text-sm text-gray-500">Stato della sicurezza di questo progetto e ultimi eventi sospetti.</p>

      {integ && integ.disponibile && !integ.ok && (
        <div className="bg-red-900/20 border border-red-900/40 rounded-lg p-4">
          <div className="text-sm text-red-400 font-medium mb-1.5">⚠ Il database montato sembra diverso da quello visto l'ultima volta</div>
          <div className="text-xs text-gray-400 space-y-0.5 mb-3">
            {integ.persi.length > 0 && <div>Moduli non più presenti: {integ.persi.join(', ')}</div>}
            {integ.calo_drastico && <div>I record totali sono scesi drasticamente rispetto al riferimento.</div>}
            <div>Riferimento del {new Date(integ.riferimento_del).toLocaleString('it-IT')}.</div>
          </div>
          <div className="text-xs text-gray-500 mb-3">Se è un errore (database sbagliato montato), va corretto prima di continuare. Se è un ripristino voluto, conferma qui sotto.</div>
          <button onClick={accettaIntegrita} disabled={accettaBusy} className="bg-red-900/40 hover:bg-red-900/60 disabled:opacity-50 text-red-300 px-3 py-2 rounded-lg text-xs font-medium transition">
            {accettaBusy ? 'Confermo...' : 'È voluto: aggiorna il riferimento'}
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <div className="glass-panel p-3">
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-xs text-gray-500">Due fattori</span>
            <StatusBadge tone={tfaAll ? 'green' : tfaNone ? 'red' : 'amber'}>{u.with_2fa}/{u.total}</StatusBadge>
          </div>
          <div className="text-[11px] text-gray-600">Utenti attivi con 2FA</div>
        </div>
        <div className="glass-panel p-3">
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-xs text-gray-500">Passkey</span>
            <StatusBadge tone={pkAll ? 'green' : 'gray'}>{u.with_passkey}/{u.total}</StatusBadge>
          </div>
          <div className="text-[11px] text-gray-600">Utenti con almeno una passkey</div>
        </div>
      </div>

      <div>
        <div className="text-xs font-semibold text-gray-400 mb-2">Limiti ai tentativi (anti brute-force)</div>
        <div className="space-y-1">
          {status.rate_limits.map((rl) => (
            <div key={rl.name} className="flex items-center justify-between text-xs text-gray-500 glass-panel px-3 py-2">
              <span>{rl.name}</span>
              <span className="text-gray-400">max {rl.max} ogni {rl.window}</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="text-xs font-semibold text-gray-400 mb-2">Ultimi eventi sospetti</div>
        {status.recent_suspicious_events.length === 0 && <div className="text-xs text-gray-600">Nessuno negli ultimi eventi registrati.</div>}
        <div className="space-y-1">
          {status.recent_suspicious_events.map((e, i) => (
            <div key={i} className="flex items-center justify-between gap-3 text-xs glass-panel px-3 py-2">
              <span className="text-gray-300 truncate">{ACTION_LABELS[e.action] || e.action}{e.target ? ' — ' + e.target : ''}</span>
              <span className="text-gray-600 flex-shrink-0">{new Date(e.created_at).toLocaleString('it-IT')}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
