import React, { useState } from 'react'
import { API } from '../../lib/api'
import Icon from '../Icon'
import PlatformLogo from '../PlatformLogo'

// Stessa logica di autenticazione di sempre (POST /auth/login, token in
// localStorage) — cambia solo la presentazione: un overlay richiamabile dalla
// homepage pubblica, non più una pagina a sé che sostituisce tutto il resto.
// Secondo passaggio 2FA (2026-08-10) — stesso identico flusso già in uso lato
// tenant (core/frontend/src/components/Login.jsx): /auth/login risponde
// needs_2fa invece del token diretto solo per chi l'ha attivato da sé.
// Sottotitolo "Area riservata — Super Admin" rimosso (2026-08-30, richiesto
// più volte dall'utente) — un tentativo precedente lo aveva reso dinamico
// (Partner Portal vs Super Admin) invece di toglierlo, non era quello che
// veniva chiesto. `mode` resta come prop (App.jsx lo passa comunque) ma non
// è più usato qui dentro.
function LoginModal({ onLogin, onClose, mode }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [pendingToken, setPendingToken] = useState(null)
  const [code, setCode] = useState('')

  const submit = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(API + '/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error); setLoading(false); return }
      if (data.needs_2fa) { setPendingToken(data.pending_token); setLoading(false); return }
      localStorage.setItem('sa_token', data.token)
      onLogin(data.token)
    } catch (e) {
      setError('Errore di connessione')
      setLoading(false)
    }
  }

  const submitCode = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(API + '/auth/login/2fa-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pending_token: pendingToken, code })
      })
      const data = await res.json()
      setLoading(false)
      if (!res.ok) { setError(data.error); return }
      localStorage.setItem('sa_token', data.token)
      onLogin(data.token)
    } catch (e) {
      setError('Errore di connessione')
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-surface-card p-8 rounded-xl w-full max-w-sm border border-gray-800 relative" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-500 hover:text-ink transition">
          <Icon name="x" size={18} />
        </button>
        <div className="mb-6 flex items-center gap-3">
          <PlatformLogo size={32} />
          <div className="font-display text-xl text-ink tracking-tight">Accedi</div>
        </div>
        {error && (
          <div className="bg-red-900/30 text-red-400 text-sm p-3 rounded-lg mb-4 border border-red-900/50">
            {error}
          </div>
        )}
        {!pendingToken ? (
          <div className="space-y-3">
            <input
              autoFocus
              className="w-full bg-surface-page text-ink px-4 py-3 rounded-lg outline-none border border-gray-800 focus:border-cp-primary transition placeholder-gray-600"
              placeholder="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
            <input
              className="w-full bg-surface-page text-ink px-4 py-3 rounded-lg outline-none border border-gray-800 focus:border-cp-primary transition placeholder-gray-600"
              placeholder="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
            <button
              onClick={submit}
              disabled={loading}
              className="w-full bg-cp-primary hover:bg-cp-primary-hover disabled:opacity-50 text-white font-medium py-3 rounded-lg transition"
            >
              {loading ? 'Accesso…' : 'Accedi'}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="text-sm text-gray-400">Inserisci il codice a 6 cifre dalla tua app authenticator (o un codice di recupero).</div>
            <input
              autoFocus
              className="w-full bg-surface-page text-ink px-4 py-3 rounded-lg outline-none border border-gray-800 focus:border-cp-primary transition placeholder-gray-600 text-center tracking-widest font-mono"
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submitCode()}
            />
            <button
              onClick={submitCode}
              disabled={loading}
              className="w-full bg-cp-primary hover:bg-cp-primary-hover disabled:opacity-50 text-white font-medium py-3 rounded-lg transition"
            >
              {loading ? 'Verifica…' : 'Verifica'}
            </button>
            <button onClick={() => { setPendingToken(null); setCode(''); setError('') }} className="w-full text-gray-500 hover:text-ink text-sm py-1 transition">
              &larr; Torna al login
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default LoginModal
