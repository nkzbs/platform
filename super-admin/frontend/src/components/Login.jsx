import React, { useState } from 'react'
import { API } from '../lib/api'
import PlatformLogo from './PlatformLogo'

function Login({ onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const submit = async () => {
    try {
      const res = await fetch(API + '/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      })
      const data = await res.json()
      if (!res.ok) return setError(data.error)
      localStorage.setItem('sa_token', data.token)
      onLogin(data.token)
    } catch (e) {
      setError('Errore di connessione')
    }
  }

  return (
    <div className="min-h-screen bg-surface-page flex items-center justify-center">
      <div className="bg-surface-card p-8 rounded-xl w-full max-w-sm border border-gray-800">
        <div className="flex items-center justify-center gap-3 mb-8">
          <PlatformLogo size={36} />
          <div>
            <div className="text-2xl text-ink tracking-tight"><span className="font-bold">Platform</span> <span className="font-normal">Core</span></div>
            <div className="text-xs text-gray-500">Super Admin</div>
          </div>
        </div>
        {error && (
          <div className="bg-red-900/30 text-red-400 text-sm p-3 rounded-lg mb-4 border border-red-900/50">
            {error}
          </div>
        )}
        <div className="space-y-3">
          <input
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
            className="w-full bg-cp-primary hover:bg-cp-primary-hover text-white font-medium py-3 rounded-lg transition"
          >
            Accedi
          </button>
        </div>
      </div>
    </div>
  )
}

export default Login
