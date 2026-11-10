import React, { useState, useEffect } from 'react'
import { API } from '../lib/api'
import Icon from '../components/Icon'
import VoceMenu from '../components/VoceMenu'
import Select from '../components/Select'
import StatusBadge from '../components/StatusBadge'
import Portal from '../components/Portal'

// Un solo ruolo possibile (Super Admin non ha mai avuto Partner — vedi
// nav-items.js): niente più mappa role→colore/etichetta, bastava un badge fisso.

function UsersPage({ token, embedded, myId }) {
  const [users, setUsers] = useState([])
  const [showNew, setShowNew] = useState(false)
  const [menuUtente, setMenuUtente] = useState(null) // utente con il menu «⋯» aperto
  useEffect(() => { // un tocco fuori dal menu lo chiude
    if (menuUtente === null) return undefined
    const chiudi = (e) => { if (!(e.target.closest && e.target.closest('[data-menu-utente]'))) setMenuUtente(null) }
    document.addEventListener('mousedown', chiudi); document.addEventListener('touchstart', chiudi)
    return () => { document.removeEventListener('mousedown', chiudi); document.removeEventListener('touchstart', chiudi) }
  }, [menuUtente])
  const [form, setForm] = useState({ username: '', password: '', role: 'admin' })
  const [error, setError] = useState('')

  // Rinomina inline — un solo utente alla volta.
  const [renamingId, setRenamingId] = useState(null)
  const [renameValue, setRenameValue] = useState('')

  // Recupero di un altro admin bloccato (2026-10-14, richiesto dall'utente:
  // "Utenti" e "Password/2FA" stavano slegati, nessun modo per sbloccare un
  // collega). Un solo modale per le tre azioni sensibili — tutte richiedono
  // la password di CHI esegue (step-up), mai quella del bersaglio.
  const [action, setAction] = useState(null) // { user, kind: 'password'|'2fa'|'delete', newPassword, adminPassword, error, busy }

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

  const startRename = (u) => { setRenamingId(u.id); setRenameValue(u.username) }
  const saveRename = async (u) => {
    if (!renameValue.trim() || renameValue === u.username) { setRenamingId(null); return }
    const res = await fetch(API + '/users/' + u.id, { method: 'PATCH', headers, body: JSON.stringify({ username: renameValue.trim() }) })
    if (res.ok) { setRenamingId(null); load() }
    else { const d = await res.json().catch(() => ({})); setAction({ user: u, kind: 'rename-error', error: d.error || 'Non riuscito' }) }
  }

  const openAction = (user, kind) => setAction({ user, kind, newPassword: '', adminPassword: '', error: '', busy: false })
  const closeAction = () => setAction(null)

  const submitAction = async () => {
    if (!action) return
    if (action.kind === 'password' && (!action.newPassword || action.newPassword.length < 8)) {
      setAction({ ...action, error: 'La nuova password deve avere almeno 8 caratteri' }); return
    }
    if (!action.adminPassword) {
      setAction({ ...action, error: 'Inserisci la tua password per confermare' }); return
    }
    setAction({ ...action, busy: true, error: '' })
    const path = action.kind === 'password' ? '/reset-password' : action.kind === '2fa' ? '/disable-2fa' : ''
    const method = action.kind === 'delete' ? 'DELETE' : 'POST'
    const body = action.kind === 'password'
      ? { new_password: action.newPassword, admin_password: action.adminPassword }
      : { admin_password: action.adminPassword }
    const res = await fetch(API + '/users/' + action.user.id + path, { method, headers, body: JSON.stringify(body) })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { setAction({ ...action, busy: false, error: data.error || 'Non riuscito' }); return }
    closeAction()
    load()
  }

  const actionTitle = { password: 'Resetta la password di', '2fa': 'Disattiva il 2FA di', delete: 'Elimina' }
  const actionVerb = { password: 'Resetta password', '2fa': 'Disattiva 2FA', delete: 'Elimina per sempre' }

  return (
    <div>
      {!embedded && (
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
      )}
      {embedded && (
        <div className="flex justify-end mb-4">
          <button onClick={() => setShowNew(true)} className="bg-cp-primary hover:bg-cp-primary-hover text-white px-4 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2">
            <Icon name="plus" size={14} />
            Nuovo Utente
          </button>
        </div>
      )}

      <div className="space-y-2">
        {users.map((u) => {
          const isSelf = myId != null && Number(myId) === u.id
          return (
            <div key={u.id} className={'glass-panel px-5 py-4 relative ' + (menuUtente === u.id ? 'overflow-visible z-20' : '')}>
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {renamingId === u.id ? (
                      <input autoFocus value={renameValue} onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') saveRename(u); if (e.key === 'Escape') setRenamingId(null) }}
                        onBlur={() => saveRename(u)}
                        className="bg-surface-page text-ink font-medium font-mono px-2 py-0.5 rounded border border-cp-primary outline-none text-sm" />
                    ) : (
                      <button onClick={() => startRename(u)} className="text-ink font-medium font-mono hover:underline decoration-dotted underline-offset-2" title="Rinomina">
                        {u.username}
                      </button>
                    )}
                    {isSelf && <span className="text-[10px] text-gray-600 border border-gray-800 rounded px-1.5 py-0.5">tu</span>}
                    <StatusBadge tone={u.totp_enabled ? 'blue' : 'gray'}>{u.totp_enabled ? '2FA attivo' : '2FA non attivo'}</StatusBadge>
                  </div>
                  <div className="text-xs text-gray-600 mt-0.5">Ultimo accesso: {u.last_login_at ? new Date(u.last_login_at).toLocaleString('it-IT') : 'Mai'}</div>
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  <span className={'text-xs px-2 py-1 rounded ' + (u.active ? 'bg-green-900/30 text-green-400' : 'bg-gray-800 text-gray-500')}>
                    {u.active ? 'Attivo' : 'Disabilitato'}
                  </span>
                  <div data-menu-utente>
                    <button onClick={() => setMenuUtente((x) => (x === u.id ? null : u.id))} aria-haspopup="menu" aria-expanded={menuUtente === u.id} aria-label="Altre azioni" title="Altre azioni" className="w-9 h-9 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 transition flex items-center justify-center">
                      <Icon name="more" size={18} />
                    </button>
                    {menuUtente === u.id && (
                      <div role="menu" className="absolute left-4 right-4 top-full -mt-1 z-30 sm:left-auto sm:w-80 bg-surface-card border border-gray-700 rounded-xl shadow-lg py-1">
                        <VoceMenu icon={u.active ? 'square' : 'play'} label={u.active ? 'Disabilita' : 'Abilita'} desc={u.active ? 'Non può più entrare; i suoi dati restano' : 'Può di nuovo entrare'} onClick={() => { setMenuUtente(null); toggle(u) }} />
                        {!isSelf && <VoceMenu icon="lock" label="Resetta password" desc="La password attuale smette subito di funzionare" onClick={() => { setMenuUtente(null); openAction(u, 'password') }} />}
                        {!isSelf && u.totp_enabled && <VoceMenu icon="shield" label="Disattiva 2FA" desc="Per chi ha perso il telefono: dovrà configurarlo di nuovo" onClick={() => { setMenuUtente(null); openAction(u, '2fa') }} />}
                        {!isSelf && <div className="my-1 border-t border-gray-800" />}
                        {!isSelf && <VoceMenu danger icon="trash" label="Elimina" desc="L'utente non esiste più; non si torna indietro" onClick={() => { setMenuUtente(null); openAction(u, 'delete') }} />}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {isSelf && (
                <div className="text-[11px] text-gray-600 mt-3 pt-3 border-t border-gray-800/70">La tua password e il tuo 2FA si gestiscono qui sotto, non da questa lista.</div>
              )}
            </div>
          )
        })}
        {users.length === 0 && (
          <div className="glass-panel px-4 py-8 text-center text-sm text-gray-600">Nessun utente ancora</div>
        )}
      </div>

      {showNew && (
        <Portal>
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
        </Portal>
      )}

      {action && action.kind !== 'rename-error' && (
        <Portal>
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-surface-card rounded-md p-6 w-full max-w-md border border-gray-800">
            <h2 className="text-lg font-bold text-ink mb-1">{actionTitle[action.kind]} <span className="font-mono">{action.user.username}</span></h2>
            <p className="text-gray-500 text-sm mb-4">
              {action.kind === 'delete'
                ? 'L\'account sparisce per sempre, non solo disattivato. Conferma con la tua password.'
                : action.kind === '2fa'
                  ? `${action.user.username} dovrà riattivarlo da sé al prossimo accesso. Conferma con la tua password.`
                  : `${action.user.username} dovrà usare subito la nuova password. Conferma con la tua password.`}
            </p>
            {action.error && <div className="bg-red-900/30 text-red-400 text-sm p-3 rounded-lg mb-4">{action.error}</div>}
            <div className="space-y-3 mb-6">
              {action.kind === 'password' && (
                <input type="password" placeholder={`Nuova password per ${action.user.username} (min. 8 caratteri)`} autoFocus
                  className="w-full bg-surface-page text-ink px-4 py-3 rounded-lg outline-none border border-gray-800 focus:border-cp-primary transition placeholder-gray-600"
                  value={action.newPassword} onChange={(e) => setAction({ ...action, newPassword: e.target.value })} />
              )}
              <input type="password" placeholder="La tua password, per confermare" autoFocus={action.kind !== 'password'}
                className="w-full bg-surface-page text-ink px-4 py-3 rounded-lg outline-none border border-gray-800 focus:border-cp-primary transition placeholder-gray-600"
                value={action.adminPassword} onChange={(e) => setAction({ ...action, adminPassword: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && submitAction()} />
            </div>
            <div className="flex gap-3">
              <button onClick={closeAction} className="flex-1 bg-gray-800 hover:bg-gray-700 text-white py-3 rounded-lg transition">Annulla</button>
              <button onClick={submitAction} disabled={action.busy}
                className={'flex-1 py-3 rounded-lg transition font-medium text-white disabled:opacity-50 ' + (action.kind === 'delete' ? 'bg-red-700 hover:bg-red-600' : 'bg-cp-primary hover:bg-cp-primary-hover')}>
                {action.busy ? '...' : actionVerb[action.kind]}
              </button>
            </div>
          </div>
        </div>
        </Portal>
      )}

      {action && action.kind === 'rename-error' && (
        <Portal>
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-surface-card rounded-md p-6 w-full max-w-sm border border-gray-800">
            <div className="bg-red-900/30 text-red-400 text-sm p-3 rounded-lg mb-4">{action.error}</div>
            <button onClick={closeAction} className="w-full bg-gray-800 hover:bg-gray-700 text-white py-2.5 rounded-lg transition">Chiudi</button>
          </div>
        </div>
        </Portal>
      )}
    </div>
  )
}

export default UsersPage
