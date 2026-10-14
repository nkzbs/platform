import React, { useState } from 'react'
import { API, setAuth } from '../lib/api'
import PlatformLogo from './PlatformLogo'
import { randomLoginIllustration } from '@shared/login-illustrations'

function Login({ onLogin, tenantName, logoUrl, hidePlatformName, cms }) {
  // Un'illustrazione diversa a ogni accesso (2026-10-14, richiesto
  // dall'utente) — scelta una sola volta al montaggio di questo componente,
  // non ad ogni render (altrimenti cambierebbe da sola mentre si digita).
  const [illustration] = useState(randomLoginIllustration)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  // Secondo passaggio, solo se l'utente ha il 2FA attivo (vedi POST /auth/login,
  // risponde needs_2fa invece del token diretto quando succede).
  const [pendingToken, setPendingToken] = useState(null)
  const [code, setCode] = useState('')

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

  // Pannello sinistro: SEMPRE un'illustrazione, non più il testo "benvenuto"
  // configurabile (2026-10-14, richiesto dall'utente — "al posto del
  // benvenuto"). Un tenant che ha comunque caricato una propria immagine
  // (Impostazioni → Azienda, login_hero_image_url) la vede al posto del
  // disegno casuale — unica personalizzazione rispettata, il resto del CMS
  // login (titolo/sottotitolo/testo) non si mostra più qui.
  const heroImage = (cms && cms.heroImageUrl) || illustration

  return (
    <div className="min-h-screen bg-surface-page flex flex-col md:flex-row">
      <div className="md:w-1/2 flex items-center justify-center px-8 py-16 md:px-16 bg-surface-card border-b md:border-b-0 md:border-r border-gray-800">
        <img src={heroImage} alt="" className="login-illustration w-full max-w-sm object-contain" />
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

export default Login
