import React, { useState, useEffect } from 'react'
import { API } from '../lib/api'
import Icon from '../components/Icon'
import Select from '../components/Select'

// Stesso stile a card-riga di core/frontend/src/pages/UsersPage.jsx (Tenant) —
// prima questa pagina (Core) usava una tabella piatta, quella dei Partner
// (SettingsPage.jsx, tile "Team") righe scarne senza stato/ruolo: 3 stili
// diversi per lo stesso concetto (richiesto esplicitamente dall'utente,
// 2026-08-31: "la schermata utente va unificata ovunque"). Solo l'aspetto è
// cambiato — nessun permesso nuovo, Core resta con un solo ruolo 'admin'.
const ROLE_COLOR = { admin: '#2563EB', partner: '#8b5cf6', partner_viewer: '#6B7280' }
const ROLE_LABEL = { admin: 'Admin', partner: 'Partner', partner_viewer: 'Partner (sola lettura)' }

function UsersPage({ token }) {
  const [users, setUsers] = useState([])
  const [showNew, setShowNew] = useState(false)
  const [form, setForm] = useState({ username: '', password: '', role: 'admin' })
  const [error, setError] = useState('')

  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }

  const load = async () => {
    const res = await fetch(API + '/users', { headers })
    if (res.ok) setUsers(await res.json())
  }

  useEffect(() => { load() }, [])

  const create = async () => {
    setError('')
    const res = await fetch(API + '/users', { method: 'POST', headers, body: JSON.stringify(form) })
    const data = await res.json()
    if (!res.ok) return setError(data.error)
    setShowNew(false)
    setForm({ username: '', password: '', role: 'admin' })
    load()
  }

  const toggle = async (u) => {
    await fetch(API + '/users/' + u.id, { method: 'PATCH', headers, body: JSON.stringify({ active: u.active ? 0 : 1 }) })
    load()
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold text-ink tracking-[-0.35px]">Utenti Super Admin</h1>
          <p className="text-gray-500 text-sm mt-0.5">Gestisci gli accessi a questo pannello</p>
        </div>
        <button onClick={() => setShowNew(true)} className="bg-cp-primary hover:bg-cp-primary-hover text-white px-4 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2">
          <Icon name="plus" size={14} />
          Nuovo Utente
        </button>
      </div>

      <div className="space-y-2">
        {users.map((u) => (
          <div key={u.id} className="bg-surface-card rounded-md border border-gray-800 px-5 py-4 flex items-center justify-between flex-wrap gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-ink font-medium font-mono">{u.username}</span>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: ROLE_COLOR[u.role] || '#6B7280' }} />
                  <span className="text-xs text-gray-400">{ROLE_LABEL[u.role] || u.role}</span>
                </span>
              </div>
              <div className="text-xs text-gray-600 mt-0.5">Ultimo accesso: {u.last_login_at ? new Date(u.last_login_at).toLocaleString('it-IT') : 'Mai'}</div>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <span className={'text-xs px-2 py-1 rounded ' + (u.active ? 'bg-green-900/30 text-green-400' : 'bg-gray-800 text-gray-500')}>
                {u.active ? 'Attivo' : 'Disabilitato'}
              </span>
              <button onClick={() => toggle(u)} className="text-sm text-gray-500 hover:text-ink transition">
                {u.active ? 'Disabilita' : 'Abilita'}
              </button>
            </div>
          </div>
        ))}
        {users.length === 0 && (
          <div className="bg-surface-card rounded-md border border-gray-800 border-dashed px-4 py-8 text-center text-sm text-gray-600">Nessun utente ancora</div>
        )}
      </div>

      {showNew && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-surface-card rounded-md p-6 w-full max-w-md border border-gray-800">
            <h2 className="text-lg font-bold text-ink mb-4">Nuovo Utente</h2>
            {error && <div className="bg-red-900/30 text-red-400 text-sm p-3 rounded-lg mb-4">{error}</div>}
            <div className="space-y-3 mb-6">
              <input className="w-full bg-surface-page text-ink px-4 py-3 rounded-lg outline-none border border-gray-800 focus:border-cp-primary transition placeholder-gray-600" placeholder="Username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
              <input className="w-full bg-surface-page text-ink px-4 py-3 rounded-lg outline-none border border-gray-800 focus:border-cp-primary transition placeholder-gray-600" placeholder="Password" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              <Select className="w-full" value={form.role} onChange={(val) => setForm({ ...form, role: val })}
                options={[{ value: 'admin', label: 'Admin' }]} />
            </div>
            <div className="flex gap-3">
              <button onClick={() => { setShowNew(false); setError('') }} className="flex-1 bg-gray-800 hover:bg-gray-700 text-white py-3 rounded-lg transition">Annulla</button>
              <button onClick={create} className="flex-1 bg-cp-primary hover:bg-cp-primary-hover text-white py-3 rounded-lg transition font-medium">Crea</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default UsersPage
