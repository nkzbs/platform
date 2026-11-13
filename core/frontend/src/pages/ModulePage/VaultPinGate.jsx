import React, { useState, useEffect } from 'react'
import { API } from '../../lib/api'
import useApi from '../../lib/useApi'

// Chiede (o fa impostare) il PIN del vault per mostrare i campi cifrati di un record.
export default function VaultPinGate({ token, userId, onUnlocked }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)
  const [settingUp, setSettingUp] = useState(false)
  const [setupPin, setSetupPin] = useState('')
  const [setupPin2, setSetupPin2] = useState('')
  const [hasPinLoaded, setHasPinLoaded] = useState(false)
  const [hasPin, setHasPin] = useState(false)

  useEffect(() => {
    fetch('/api/users/me/vault-pin/status', { headers: { Authorization: 'Bearer ' + token } })
      .then((r) => r.json()).then((d) => { setHasPin(!!d.has_pin); setHasPinLoaded(true) })
      .catch(() => { setHasPinLoaded(true) })
  }, [token])

  const verify = async () => {
    setChecking(true); setError('')
    const res = await fetch('/api/users/me/vault-pin/verify', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    })
    const data = await res.json()
    setChecking(false)
    if (data.no_pin || data.ok) {
      sessionStorage.setItem('vault_unlocked_' + userId, '1')
      onUnlocked()
    } else {
      setError('PIN non corretto')
    }
  }

  const setupVaultPin = async () => {
    if (setupPin.length < 4) { setError('PIN di almeno 4 cifre'); return }
    if (setupPin !== setupPin2) { setError('I PIN non coincidono'); return }
    setChecking(true); setError('')
    await fetch('/api/users/me/vault-pin/setup', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: setupPin }),
    })
    setChecking(false)
    sessionStorage.setItem('vault_unlocked_' + userId, '1')
    onUnlocked()
  }

  if (!hasPinLoaded) return <div className="text-gray-500 text-sm py-4 text-center">Verifica PIN vault...</div>

  if (!hasPin && !settingUp) {
    return (
      <div className="py-4 text-center">
        <div className="text-sm text-gray-400 mb-4">Questo record contiene campi cifrati. Imposta un PIN vault per proteggerli.</div>
        <button onClick={() => setSettingUp(true)} className="bg-accent hover:opacity-90 text-white px-5 py-2 rounded-lg text-sm transition">Imposta PIN vault</button>
        <button onClick={onUnlocked} className="block mx-auto mt-2 text-xs text-gray-600 hover:text-gray-400 transition">Salta (mostra senza PIN)</button>
      </div>
    )
  }

  if (!hasPin && settingUp) {
    return (
      <div className="py-4 space-y-3">
        <div className="text-sm text-gray-400 mb-2">Scegli un PIN (min. 4 cifre) per proteggere i campi cifrati:</div>
        <input type="password" inputMode="numeric" maxLength={12} placeholder="Nuovo PIN"
          className="w-full bg-surface-page text-ink px-4 py-3 rounded-lg text-sm outline-none border border-gray-800 focus:border-accent transition"
          value={setupPin} onChange={(e) => setSetupPin(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && document.getElementById('setup-pin2').focus()} />
        <input id="setup-pin2" type="password" inputMode="numeric" maxLength={12} placeholder="Conferma PIN"
          className="w-full bg-surface-page text-ink px-4 py-3 rounded-lg text-sm outline-none border border-gray-800 focus:border-accent transition"
          value={setupPin2} onChange={(e) => setSetupPin2(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && setupVaultPin()} />
        {error && <div className="text-xs text-red-400">{error}</div>}
        <button onClick={setupVaultPin} disabled={checking} className="w-full bg-accent hover:opacity-90 disabled:opacity-50 text-white py-2.5 rounded-lg text-sm transition font-medium">
          {checking ? 'Impostazione...' : 'Conferma PIN'}
        </button>
      </div>
    )
  }

  return (
    <div className="py-4 space-y-3">
      <div className="text-sm text-gray-400 mb-2">Inserisci il PIN vault per visualizzare i campi cifrati:</div>
      <input type="password" inputMode="numeric" maxLength={12} placeholder="PIN vault" autoFocus
        className="w-full bg-surface-page text-ink px-4 py-3 rounded-lg text-sm outline-none border border-gray-800 focus:border-accent transition"
        value={pin} onChange={(e) => setPin(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && verify()} />
      {error && <div className="text-xs text-red-400">{error}</div>}
      <button onClick={verify} disabled={checking} className="w-full bg-accent hover:opacity-90 disabled:opacity-50 text-white py-2.5 rounded-lg text-sm transition font-medium">
        {checking ? 'Verifica...' : 'Sblocca'}
      </button>
    </div>
  )
}
