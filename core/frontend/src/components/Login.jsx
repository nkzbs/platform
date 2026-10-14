import React, { useState } from 'react'
import { API, setAuth } from '../lib/api'
import PlatformLogo from './PlatformLogo'
import { startAuthentication, browserSupportsWebAuthn } from '@simplewebauthn/browser'

function Login({ onLogin, tenantName, logoUrl, hidePlatformName, cms }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  // Secondo passaggio, solo se l'utente ha il 2FA attivo (vedi POST /auth/login,
  // risponde needs_2fa invece del token diretto quando succede).
  const [pendingToken, setPendingToken] = useState(null)
  const [code, setCode] = useState('')
  // Passkey (2026-10-14, richiesto dall'utente: "oltre alle 2FA voglio
  // passkey ovunque") — AGGIUNTIVA, mai sostituisce password+2FA: un accesso
  // completo a sé, senza scrivere username (discoverable, vedi
  // routes/webauthn.js). "NotAllowedError" è anche quello che il browser dà
  // quando l'utente chiude lui stesso il pannello di sistema — non è un
  // errore da mostrare, solo un annullamento.
  const [passkeyBusy, setPasskeyBusy] = useState(false)
  const loginWithPasskey = async () => {
    setError(''); setPasskeyBusy(true)
    try {
      const optRes = await fetch(API + '/webauthn/login-options', { method: 'POST' })
      const opt = await optRes.json()
      if (!optRes.ok) { setError(opt.error || 'Errore'); return }
      const assertion = await startAuthentication({ optionsJSON: opt.options })
      const res = await fetch(API + '/webauthn/login-verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pending_token: opt.pending_token, response: assertion }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Accesso con passkey non riuscito'); return }
      await setAuth(data.token, data.user)
      onLogin(data.token, data.user)
    } catch (e) {
      if (e.name !== 'NotAllowedError') setError('Accesso con passkey non riuscito')
    } finally {
      setPasskeyBusy(false)
    }
  }

  const submit = async () => {
    try {
      const res = await fetch(API + '/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      })
      const data = await res.json()
      if (!res.ok) return setError(data.error)
      if (data.needs_2fa) { setPendingToken(data.pending_token); setError(''); return }
      await setAuth(data.token, data.user)
      onLogin(data.token, data.user)
    } catch (e) {
      setError('Errore di connessione al server')
    }
  }

  const submitCode = async () => {
    try {
      const res = await fetch(API + '/auth/login/2fa-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pending_token: pendingToken, code })
      })
      const data = await res.json()
      if (!res.ok) return setError(data.error)
      await setAuth(data.token, data.user)
      onLogin(data.token, data.user)
    } catch (e) {
      setError('Errore di connessione al server')
    }
  }

  // Bug reale segnalato dall'utente (2026-08-29): il badge a lettera scattava per
  // OGNI tenant con un nome (quasi tutti) anche quando il testo accanto diceva
  // ancora "Platform X" — icona e testo raccontavano due identità diverse. Il
  // badge a lettera ha senso SOLO quando il brand Platform è davvero nascosto
  // (hidePlatformName, white-label completo) e non c'è un logo proprio caricato
  // — altrimenti l'icona mostra sempre il marchio Platform vero, coerente col
  // testo "Platform X".
  const brandHeader = (
    <div className="flex items-center justify-center gap-3 mb-8">
      {logoUrl
        ? <img src={logoUrl} alt="" className="w-9 h-9 rounded-lg object-contain" />
        : <PlatformLogo size={36} letter={hidePlatformName && tenantName ? tenantName.trim()[0] : undefined} />}
      <div>
        <div className="text-2xl text-ink tracking-tight">
          {hidePlatformName && tenantName
            ? <span className="font-bold">{tenantName}</span>
            : <>
                <span className="font-bold">Platform</span>{tenantName && <span className="font-normal"> {tenantName}</span>}
              </>
          }
        </div>
        <div className="text-xs text-gray-500">Accedi al tuo spazio</div>
      </div>
    </div>
  )

  const formBlock = (
    <>
      {error && <div className="bg-red-900/30 text-red-400 text-sm p-3 rounded-lg mb-4 border border-red-900/50">{error}</div>}
      {!pendingToken ? (
        <div className="space-y-3">
          {browserSupportsWebAuthn() && (
            <>
              <button onClick={loginWithPasskey} disabled={passkeyBusy} className="w-full flex items-center justify-center gap-2 bg-surface-page hover:bg-gray-800 disabled:opacity-50 text-ink font-medium py-3 rounded-lg transition border border-gray-800">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="5" /><path d="M20 21a8 8 0 0 0-16 0" /></svg>
                {passkeyBusy ? 'Verifica...' : 'Accedi con passkey'}
              </button>
              <div className="flex items-center gap-3 py-1">
                <div className="h-px bg-gray-800 flex-1" /><span className="text-xs text-gray-600">oppure</span><div className="h-px bg-gray-800 flex-1" />
              </div>
            </>
          )}
          <input className="w-full bg-surface-page text-ink px-4 py-3 rounded-lg outline-none border border-gray-800 focus:border-accent transition placeholder-gray-600" placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
          <input className="w-full bg-surface-page text-ink px-4 py-3 rounded-lg outline-none border border-gray-800 focus:border-accent transition placeholder-gray-600" placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
          <button onClick={submit} className="w-full bg-accent hover:opacity-90 text-white font-medium py-3 rounded-lg transition">Accedi</button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="text-sm text-gray-400">Inserisci il codice a 6 cifre dalla tua app authenticator (o un codice di recupero).</div>
          <input className="w-full bg-surface-page text-ink px-4 py-3 rounded-lg outline-none border border-gray-800 focus:border-accent transition placeholder-gray-600 text-center tracking-widest font-mono" placeholder="000000" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submitCode()} autoFocus />
          <button onClick={submitCode} className="w-full bg-accent hover:opacity-90 text-white font-medium py-3 rounded-lg transition">Verifica</button>
          <button onClick={() => { setPendingToken(null); setCode(''); setError('') }} className="w-full text-gray-500 hover:text-ink text-sm py-1 transition">&larr; Torna al login</button>
        </div>
      )}
    </>
  )

  // CMS pagina di accesso: attiva solo se il tenant ha configurato un titolo
  // in Impostazioni → Azienda (login_headline) — altrimenti resta la card
  // centrata di sempre, invariata per chi non la usa.
  if (cms) {
    return (
      <div className="min-h-screen bg-surface-page flex flex-col md:flex-row">
        <div className="md:w-1/2 flex flex-col justify-center px-8 py-16 md:px-16 bg-surface-card border-b md:border-b-0 md:border-r border-gray-800">
          {cms.heroImageUrl && <img src={cms.heroImageUrl} alt="" className="w-full max-w-md rounded-xl object-cover mb-8" />}
          <h1 className="text-3xl md:text-4xl font-bold text-ink tracking-tight mb-3">{cms.headline}</h1>
          {cms.subheadline && <p className="text-lg text-gray-400 mb-4">{cms.subheadline}</p>}
          {cms.body && <p className="text-sm text-gray-500 whitespace-pre-line leading-relaxed max-w-md">{cms.body}</p>}
        </div>
        <div className="md:w-1/2 flex items-center justify-center px-8 py-16">
          <div className="w-full max-w-sm">
            {brandHeader}
            {formBlock}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-surface-page flex items-center justify-center">
      <div className="bg-surface-card p-8 rounded-xl w-full max-w-sm border border-gray-800">
        {brandHeader}
        {formBlock}
      </div>
    </div>
  )
}

export default Login
