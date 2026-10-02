import React, { useState, useEffect } from 'react'
import useApi from '../lib/useApi'
import Icon from '../components/Icon'

function UsersPage({ token }) {
  const api = useApi(token)
  const [users, setUsers] = useState([])
  const [roles, setRoles] = useState([])
  const [modules, setModules] = useState([])
  const [showNew, setShowNew] = useState(false)
  const [form, setForm] = useState({ username: '', password: '', display_name: '', role: 'user', linked_module_slug: '', linked_record_id: '' })
  const [error, setError] = useState('')
  const [linkRecords, setLinkRecords] = useState([])
  const [showNewRole, setShowNewRole] = useState(false)
  const [roleForm, setRoleForm] = useState({ name: '', label: '', color: '#6B7280' })
  const [roleError, setRoleError] = useState('')
  const [expandedUser, setExpandedUser] = useState(null)
  const [userModules, setUserModules] = useState({})
  const [savingModules, setSavingModules] = useState(null)
  const [resetUserId, setResetUserId] = useState(null)
  const [resetPassword, setResetPassword] = useState('')
  const [resetSaving, setResetSaving] = useState(false)

  const loadUsers = async () => {
    const data = await api.get('/users')
    if (data) setUsers(data)
  }
  const loadRoles = async () => {
    const data = await api.get('/roles')
    if (data) setRoles(data)
  }
  const loadModules = async () => {
    const data = await api.get('/modules')
    if (data) setModules(data.filter((m) => m.installed && m.slug !== 'dashboard'))
  }

  useEffect(() => { loadUsers(); loadRoles(); loadModules() }, [])

  const loadUserModules = async (userId) => {
    const data = await api.get('/users/' + userId + '/modules')
    if (data !== null) setUserModules((p) => ({ ...p, [userId]: data }))
  }

  const toggleExpand = async (userId) => {
    if (expandedUser === userId) { setExpandedUser(null); return }
    setExpandedUser(userId)
    if (!userModules[userId]) await loadUserModules(userId)
  }

  const toggleModuleForUser = (userId, slug) => {
    setUserModules((p) => {
      const current = p[userId] || []
      return { ...p, [userId]: current.includes(slug) ? current.filter((s) => s !== slug) : [...current, slug] }
    })
  }

  const saveUserModules = async (userId) => {
    setSavingModules(userId)
    const slugs = userModules[userId] || []
    await api.put('/users/' + userId + '/modules', { slugs })
    setSavingModules(null)
    window.dispatchEvent(new CustomEvent('platform:toast', { detail: { message: 'Accesso moduli salvato', type: 'success' } }))
  }

  const loadLinkRecords = async (slug) => {
    if (!slug) { setLinkRecords([]); return }
    const data = await api.get('/records/' + slug)
    if (data) setLinkRecords(data)
  }

  const create = async () => {
    setError('')
    const { ok, data } = await api.post('/users', form)
    if (!ok) return setError(data.error)
    setShowNew(false)
    setForm({ username: '', password: '', display_name: '', role: 'user', linked_module_slug: '', linked_record_id: '' })
    setLinkRecords([])
    loadUsers()
  }

  const toggle = async (u) => {
    await api.patch('/users/' + u.id, { active: u.active ? 0 : 1 })
    loadUsers()
  }

  const doResetPassword = async () => {
    if (!resetPassword || resetPassword.length < 6) return
    setResetSaving(true)
    await api.patch('/users/' + resetUserId, { password: resetPassword })
    setResetSaving(false)
    setResetUserId(null)
    setResetPassword('')
    window.dispatchEvent(new CustomEvent('platform:toast', { detail: { message: 'Password aggiornata', type: 'success' } }))
  }

  const createRole = async () => {
    setRoleError('')
    const { ok, data } = await api.post('/roles', roleForm)
    if (!ok) return setRoleError(data.error)
    setShowNewRole(false)
    setRoleForm({ name: '', label: '', color: '#6B7280' })
    loadRoles()
  }

  const deleteRole = async (name) => {
    if (!window.confirm('Eliminare il ruolo "' + name + '"?')) return
    const { ok, data } = await api.del('/roles/' + name)
    if (!ok) window.alert(data.error)
    else loadRoles()
  }

  const roleColor = (name) => { const r = roles.find((r) => r.name === name); return r ? r.color : '#6B7280' }
  const roleLabel = (name) => { const r = roles.find((r) => r.name === name); return r ? r.label : name }

  return (
    <div>
      <div className="flex items-center justify-end mb-6">
        <button onClick={() => setShowNew(true)} className="bg-accent hover:opacity-90 text-white px-4 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2">
          <Icon name="plus" size={14} />Nuovo Utente
        </button>
      </div>

      <div className="space-y-2 mb-8">
        {users.map((u) => (
          <div key={u.id} className="bg-surface-card rounded-md border border-gray-800 overflow-hidden">
            <div className="px-5 py-4 flex items-center justify-between flex-wrap gap-3">
              <div>
                <div className="text-ink font-medium">{u.display_name}</div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-sm text-gray-500 font-mono">{u.username}</span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: roleColor(u.role) }} />
                    <span className="text-xs text-gray-400">{roleLabel(u.role)}</span>
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <span className={'text-xs px-2 py-1 rounded ' + (u.active ? 'bg-green-900/30 text-green-400' : 'bg-gray-800 text-gray-500')}>
                  {u.active ? 'Attivo' : 'Disabilitato'}
                </span>
                <button onClick={() => toggle(u)} className="text-sm text-gray-500 hover:text-ink transition">{u.active ? 'Disabilita' : 'Abilita'}</button>
                <button onClick={() => { setResetUserId(u.id); setResetPassword('') }} className="text-sm text-gray-500 hover:text-ink transition">Reimposta password</button>
                {u.role !== 'admin' && modules.length > 0 && (
                  <button onClick={() => toggleExpand(u.id)} className="text-gray-600 hover:text-gray-300 transition" title="Accesso moduli">
                    <Icon name={expandedUser === u.id ? 'chevron-up' : 'chevron-down'} size={14} />
                  </button>
                )}
              </div>
            </div>
            {expandedUser === u.id && u.role !== 'admin' && (
              <div className="border-t border-gray-800 px-5 py-4 bg-surface-page/40">
                <div className="text-xs text-gray-500 mb-3">
                  Moduli accessibili — se nessuno è selezionato, l'utente vede tutti i moduli installati.
                </div>
                <div className="flex flex-wrap gap-2 mb-3">
                  {modules.map((m) => {
                    const checked = (userModules[u.id] || []).includes(m.slug)
                    return (
                      <button key={m.slug} onClick={() => toggleModuleForUser(u.id, m.slug)}
                        className={'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition border ' +
                          (checked ? 'bg-accent/20 border-accent/50 text-accent' : 'bg-gray-800/50 border-gray-700 text-gray-500 hover:text-gray-300')}>
                        <Icon name={m.icon || 'box'} size={11} />
                        {m.name}
                        {checked && <Icon name="check" size={10} />}
                      </button>
                    )
                  })}
                </div>
                <button onClick={() => saveUserModules(u.id)} disabled={savingModules === u.id}
                  className="text-xs bg-accent hover:opacity-90 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg transition">
                  {savingModules === u.id ? 'Salvataggio...' : 'Salva accesso moduli'}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
        <h2 className="text-lg font-semibold text-ink">Ruoli</h2>
        <button onClick={() => setShowNewRole(true)} className="bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5">
          <Icon name="plus" size={12} />Nuovo Ruolo
        </button>
      </div>
      <div className="flex flex-wrap gap-2 mb-6">
        {roles.map((r) => (
          <div key={r.name} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-card border border-gray-800">
            <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: r.color }} />
            <span className="text-sm text-gray-300">{r.label}</span>
            <span className="text-xs text-gray-600 font-mono">{r.name}</span>
            {!r.builtin && (
              <button onClick={() => deleteRole(r.name)} className="text-gray-700 hover:text-red-400 transition ml-1"><Icon name="x" size={12} /></button>
            )}
          </div>
        ))}
      </div>

      {showNew && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-surface-card rounded-md p-6 w-full max-w-md border border-gray-800">
            <h2 className="text-lg font-bold text-ink mb-4">Nuovo Utente</h2>
            {error && <div className="bg-red-900/30 text-red-400 text-sm p-3 rounded-lg mb-4">{error}</div>}
            <div className="space-y-3 mb-6">
              <input className="w-full bg-surface-page text-ink px-4 py-3 rounded-lg outline-none border border-gray-800 focus:border-accent transition placeholder-gray-600" placeholder="Nome visualizzato" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} />
              <input className="w-full bg-surface-page text-ink px-4 py-3 rounded-lg outline-none border border-gray-800 focus:border-accent transition placeholder-gray-600" placeholder="Username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
              <input className="w-full bg-surface-page text-ink px-4 py-3 rounded-lg outline-none border border-gray-800 focus:border-accent transition placeholder-gray-600" placeholder="Password" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              <select className="w-full bg-surface-page text-ink px-4 py-3 rounded-lg outline-none border border-gray-800 focus:border-accent transition" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                {roles.map((r) => <option key={r.name} value={r.name}>{r.label}</option>)}
              </select>
              <div className="pt-2 border-t border-gray-800">
                <div className="text-xs text-gray-500 mb-2">Record collegato (opzionale) — per ruoli tipo "Agente" che devono vedere solo i dati assegnati a un record specifico (es. la propria scheda agente), invece di scoping "chi ha creato il record".</div>
                <select className="w-full bg-surface-page text-ink px-4 py-3 rounded-lg outline-none border border-gray-800 focus:border-accent transition mb-2"
                  value={form.linked_module_slug}
                  onChange={(e) => { const slug = e.target.value; setForm({ ...form, linked_module_slug: slug, linked_record_id: '' }); loadLinkRecords(slug) }}>
                  <option value="">Nessuno</option>
                  {modules.map((m) => <option key={m.slug} value={m.slug}>{m.name}</option>)}
                </select>
                {form.linked_module_slug && (
                  <select className="w-full bg-surface-page text-ink px-4 py-3 rounded-lg outline-none border border-gray-800 focus:border-accent transition"
                    value={form.linked_record_id} onChange={(e) => setForm({ ...form, linked_record_id: e.target.value })}>
                    <option value="">Seleziona record...</option>
                    {linkRecords.map((r) => (
                      <option key={r.id} value={r.id}>{r.data.nome || r.data.ragione_sociale || r.data.titolo || r.data.label || ('#' + r.id)}</option>
                    ))}
                  </select>
                )}
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowNew(false)} className="flex-1 bg-gray-800 hover:bg-gray-700 text-white py-3 rounded-lg transition">Annulla</button>
              <button onClick={create} className="flex-1 bg-accent hover:opacity-90 text-white py-3 rounded-lg transition font-medium">Crea</button>
            </div>
          </div>
        </div>
      )}

      {resetUserId !== null && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-surface-card rounded-md p-6 w-full max-w-sm border border-gray-800">
            <h2 className="text-lg font-bold text-ink mb-1">Reimposta password</h2>
            <p className="text-xs text-gray-500 mb-4">{users.find((u) => u.id === resetUserId)?.display_name}</p>
            <input className="w-full bg-surface-page text-ink px-4 py-3 rounded-lg outline-none border border-gray-800 focus:border-accent transition placeholder-gray-600 mb-6"
              placeholder="Nuova password (min. 6 caratteri)" type="text" value={resetPassword} onChange={(e) => setResetPassword(e.target.value)} autoFocus />
            <div className="flex gap-3">
              <button onClick={() => setResetUserId(null)} className="flex-1 bg-gray-800 hover:bg-gray-700 text-white py-3 rounded-lg transition">Annulla</button>
              <button onClick={doResetPassword} disabled={resetPassword.length < 6 || resetSaving}
                className="flex-1 bg-accent hover:opacity-90 disabled:opacity-50 text-white py-3 rounded-lg transition font-medium">
                {resetSaving ? 'Salvataggio...' : 'Salva'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showNewRole && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-surface-card rounded-md p-6 w-full max-w-md border border-gray-800">
            <h2 className="text-lg font-bold text-ink mb-4">Nuovo Ruolo</h2>
            {roleError && <div className="bg-red-900/30 text-red-400 text-sm p-3 rounded-lg mb-4">{roleError}</div>}
            <div className="space-y-3 mb-6">
              <input className="w-full bg-surface-page text-ink px-4 py-3 rounded-lg outline-none border border-gray-800 focus:border-accent transition placeholder-gray-600" placeholder="Nome (es. venditore)" value={roleForm.name} onChange={(e) => setRoleForm({ ...roleForm, name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })} />
              <input className="w-full bg-surface-page text-ink px-4 py-3 rounded-lg outline-none border border-gray-800 focus:border-accent transition placeholder-gray-600" placeholder="Etichetta (es. Venditore)" value={roleForm.label} onChange={(e) => setRoleForm({ ...roleForm, label: e.target.value })} />
              <div className="flex items-center gap-3">
                <label className="text-xs text-gray-400">Colore</label>
                <input type="color" value={roleForm.color} onChange={(e) => setRoleForm({ ...roleForm, color: e.target.value })} className="w-10 h-10 rounded cursor-pointer bg-transparent border-0" />
                <span className="text-sm text-gray-400 font-mono">{roleForm.color}</span>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowNewRole(false)} className="flex-1 bg-gray-800 hover:bg-gray-700 text-white py-3 rounded-lg transition">Annulla</button>
              <button onClick={createRole} className="flex-1 bg-accent hover:opacity-90 text-white py-3 rounded-lg transition font-medium">Crea Ruolo</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default UsersPage
