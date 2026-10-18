import TelegramCard from '../components/TelegramCard'
import React, { useState, useEffect } from 'react'
import useApi from '../lib/useApi'
import Icon from '../components/Icon'
import { startRegistration, browserSupportsWebAuthn } from '@simplewebauthn/browser'

// ─── ACCOUNT — pagina self-service ──────────────────────────────────────────────
// Accessibile a QUALUNQUE utente loggato (non admin-gated come UsersPage.jsx) —
// ognuno gestisce SOLO il proprio 2FA, mai quello di qualcun altro. Sempre
// incorporata come tab dentro ImpostazioniPage (mai più una pagina a sé — il
// vecchio ingresso da un click sul nome in Sidebar è stato ritirato il
// 2026-08-29), quindi niente header di pagina qui: il Tile del genitore lo
// mostra già. Pairing/Migrazione dati (2026-09-04, richiesto dall'utente:
// "una cosa sono le impostazioni sistema, un conto quelle dell'utente") NON
// sono più qui — riguardano il tenant, non l'utente loggato, spostati nella
// scheda di sistema "Istanza" in ImpostazioniPage.jsx (IstanzaTab).
import { API } from '../lib/api'
const ROLE_LABEL = { admin: 'Amministratore', user: 'Utente', agent: 'Agente' }

function AccountPage({ token, user }) {
  const api = useApi(token)
  const [pw, setPw] = useState({ current_password: '', new_password: '' })
  const [pwBusy, setPwBusy] = useState(false)
  const [pwMsg, setPwMsg] = useState(null) // { ok, text }
  const changePassword = async () => {
    if (!pw.current_password || !pw.new_password) { setPwMsg({ ok: false, text: 'Compila tutti i campi' }); return }
    setPwBusy(true); setPwMsg(null)
    const res = await fetch(API + '/users/me/change-password', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(pw) })
    const data = await res.json().catch(() => ({}))
    setPwBusy(false)
    if (!res.ok) { setPwMsg({ ok: false, text: data.error || 'Errore' }); return }
    setPw({ current_password: '', new_password: '' }); setPwMsg({ ok: true, text: 'Password aggiornata' })
  }
  const [enabled, setEnabled] = useState(null)
  const [setup, setSetup] = useState(null) // { secret, qr_data_uri } — mentre si configura
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [backupCodes, setBackupCodes] = useState(null) // mostrati una sola volta dopo /confirm
  const [confirming, setConfirming] = useState(false)
  const [disablePassword, setDisablePassword] = useState('')
  const [showDisable, setShowDisable] = useState(false)
  const [disabling, setDisabling] = useState(false)

  const loadStatus = () => api.get('/auth/2fa/status').then((d) => { if (d) setEnabled(d.enabled) })
  useEffect(() => { loadStatus() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const startSetup = async () => {
    setError('')
    const res = await api.post('/auth/2fa/setup', {})
    if (!res.ok) return setError(res.data?.error || 'Errore nell\'avvio della configurazione')
    setSetup(res.data)
  }

  const confirmSetup = async () => {
    setError('')
    setConfirming(true)
    const res = await api.post('/auth/2fa/confirm', { code })
    setConfirming(false)
    if (!res.ok) return setError(res.data?.error || 'Codice non valido')
    setBackupCodes(res.data.backup_codes)
    setSetup(null)
    setCode('')
    loadStatus()
  }

  const disable2fa = async () => {
    setError('')
    setDisabling(true)
    const res = await api.post('/auth/2fa/disable', { password: disablePassword })
    setDisabling(false)
    if (!res.ok) return setError(res.data?.error || 'Errore')
    setShowDisable(false)
    setDisablePassword('')
    loadStatus()
  }

  // Passkey (2026-10-14, richiesto dall'utente: "oltre alle 2FA voglio
  // passkey ovunque") — AGGIUNTIVA al 2FA sopra, self-service come quello:
  // ognuno gestisce solo le proprie.
  const [passkeys, setPasskeys] = useState(null)
  const [pkNickname, setPkNickname] = useState('')
  const [pkBusy, setPkBusy] = useState(false)
  const [pkError, setPkError] = useState('')
  const loadPasskeys = () => api.get('/webauthn/list').then((d) => { if (d) setPasskeys(d) })
  useEffect(() => { loadPasskeys() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const addPasskey = async () => {
    setPkError(''); setPkBusy(true)
    try {
      const optRes = await api.post('/webauthn/register-options', {})
      if (!optRes.ok) { setPkError(optRes.data?.error || 'Errore'); return }
      const attestation = await startRegistration({ optionsJSON: optRes.data.options })
      const verRes = await api.post('/webauthn/register-verify', { pending_token: optRes.data.pending_token, response: attestation, nickname: pkNickname })
      if (!verRes.ok) { setPkError(verRes.data?.error || 'Errore'); return }
      setPkNickname('')
      loadPasskeys()
    } catch (e) {
      if (e.name !== 'NotAllowedError') setPkError('Creazione della passkey non riuscita')
    } finally {
      setPkBusy(false)
    }
  }

  const removePasskey = async (id) => {
    await api.del('/webauthn/' + id)
    loadPasskeys()
  }

  const inputCls = 'w-full bg-surface-page text-ink px-4 py-3 rounded-lg text-sm outline-none border border-gray-800 focus:border-accent transition'
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 max-w-4xl items-start">
      <div className="lg:col-span-2 text-[11px] font-semibold uppercase tracking-wide text-gray-600 -mb-1">Profilo</div>
      <div className="bg-surface-card rounded-md p-6 border border-gray-800">
        <div className="flex items-center gap-4 mb-5">
          <div className="w-12 h-12 rounded-full bg-accent/15 text-accent flex items-center justify-center text-lg font-semibold flex-shrink-0">
            {((user && (user.display_name || user.username)) || '?').trim().charAt(0).toUpperCase()}
          </div>
          <div>
            <div className="text-ink font-medium">{(user && user.display_name) || 'Utente'}</div>
            <div className="text-xs text-gray-500">{ROLE_LABEL[user && user.role] || (user && user.role) || ''}</div>
          </div>
        </div>
        <div className="text-xs text-gray-500 mb-1">Nome utente</div>
        <div className="text-sm text-ink font-mono">{(user && user.username) || '—'}</div>
      </div>

      <div className="bg-surface-card rounded-md p-6 border border-gray-800">
        <div className="text-ink font-medium mb-1">Password</div>
        <div className="text-sm text-gray-500 mb-4">Minimo 8 caratteri.</div>
        {pwMsg && <div className={'text-sm p-3 rounded-lg mb-3 border ' + (pwMsg.ok ? 'bg-green-900/20 text-green-400 border-green-900/40' : 'bg-red-900/30 text-red-400 border-red-900/50')}>{pwMsg.text}</div>}
        <div className="space-y-2.5">
          <input type="password" autoComplete="current-password" placeholder="Password attuale" className={inputCls} value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} />
          <input type="password" autoComplete="new-password" placeholder="Nuova password" className={inputCls} value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} />
        </div>
        <button onClick={changePassword} disabled={pwBusy} className="mt-3 bg-accent hover:opacity-90 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition">{pwBusy ? 'Salvataggio...' : 'Cambia password'}</button>
      </div>

      <div className="lg:col-span-2 text-[11px] font-semibold uppercase tracking-wide text-gray-600 mt-2 -mb-1">Sicurezza</div>
      <div className="bg-surface-card rounded-md p-6 border border-gray-800 lg:col-span-2">
        <div className="flex items-start gap-4 mb-5">
          <div className="w-10 h-10 rounded-lg bg-cp-purple/20 flex items-center justify-center flex-shrink-0">
            <Icon name="shield" size={20} className="text-cp-purple" />
          </div>
          <div>
            <div className="text-ink font-medium mb-1 flex items-center gap-2">
              Autenticazione a due fattori
              {enabled && <span className="text-[10px] bg-green-900/30 text-green-400 px-2 py-0.5 rounded">Attiva</span>}
            </div>
            <div className="text-sm text-gray-500">Un codice in più, generato dal tuo telefono, oltre alla password — attivabile e disattivabile solo da te.</div>
          </div>
        </div>

        {error && <div className="bg-red-900/30 text-red-400 text-sm p-3 rounded-lg mb-4 border border-red-900/50">{error}</div>}

        {backupCodes && (
          <div className="bg-amber-900/20 border border-amber-900/40 rounded-lg p-4 mb-4">
            <div className="text-amber-400 text-sm font-medium mb-2">Salva questi codici di recupero — non saranno più mostrati</div>
            <div className="text-xs text-gray-500 mb-3">Usane uno se perdi l'accesso all'app authenticator. Ognuno funziona una sola volta.</div>
            <div className="grid grid-cols-2 gap-2 font-mono text-sm text-gray-200 mb-3">
              {backupCodes.map((c) => <div key={c} className="bg-surface-page px-2 py-1.5 rounded">{c}</div>)}
            </div>
            <button onClick={() => setBackupCodes(null)} className="text-xs bg-amber-700 hover:bg-amber-600 text-white px-3 py-1.5 rounded-lg transition">Li ho salvati</button>
          </div>
        )}

        {enabled === null && <div className="text-sm text-gray-600">Caricamento...</div>}

        {enabled === false && !setup && !backupCodes && (
          <button onClick={startSetup} className="bg-accent hover:opacity-90 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition">
            Attiva 2FA
          </button>
        )}

        {setup && (
          <div className="space-y-3">
            <div className="text-sm text-gray-400">Scansiona il QR con la tua app authenticator (Google Authenticator, Authy, ecc.), poi inserisci il codice a 6 cifre per confermare.</div>
            <img src={setup.qr_data_uri} alt="QR 2FA" className="w-40 h-40 rounded-lg bg-white p-2" />
            <div className="text-xs text-gray-600">Oppure inserisci a mano: <span className="font-mono text-gray-400">{setup.secret}</span></div>
            <input className="w-full bg-surface-page text-ink px-4 py-3 rounded-lg text-sm outline-none border border-gray-800 focus:border-accent transition text-center tracking-widest font-mono"
              placeholder="000000" value={code} onChange={(e) => setCode(e.target.value)} />
            <div className="flex gap-2">
              <button onClick={confirmSetup} disabled={confirming} className="flex-1 bg-accent hover:opacity-90 disabled:opacity-50 text-white py-2.5 rounded-lg text-sm font-medium transition">
                {confirming ? 'Verifica...' : 'Conferma'}
              </button>
              <button onClick={() => { setSetup(null); setCode(''); setError('') }} className="px-4 py-2.5 rounded-lg text-sm bg-gray-800 hover:bg-gray-700 text-gray-300 transition">Annulla</button>
            </div>
          </div>
        )}

        {enabled === true && !showDisable && (
          <button onClick={() => setShowDisable(true)} className="text-sm text-red-400 hover:text-red-300 transition">Disattiva 2FA</button>
        )}
        {showDisable && (
          <div className="space-y-2">
            <div className="text-xs text-gray-500">Conferma la tua password per disattivare.</div>
            <input type="password" className="w-full bg-surface-page text-ink px-4 py-3 rounded-lg text-sm outline-none border border-gray-800 focus:border-accent transition"
              placeholder="Password" value={disablePassword} onChange={(e) => setDisablePassword(e.target.value)} />
            <div className="flex gap-2">
              <button onClick={disable2fa} disabled={disabling} className="flex-1 bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white py-2.5 rounded-lg text-sm font-medium transition">
                {disabling ? 'Disattivazione...' : 'Disattiva'}
              </button>
              <button onClick={() => { setShowDisable(false); setDisablePassword(''); setError('') }} className="px-4 py-2.5 rounded-lg text-sm bg-gray-800 hover:bg-gray-700 text-gray-300 transition">Annulla</button>
            </div>
          </div>
        )}
      </div>

      {browserSupportsWebAuthn() && (
        <div className="bg-surface-card rounded-md p-6 border border-gray-800 lg:col-span-2">
          <div className="flex items-start gap-4 mb-5">
            <div className="w-10 h-10 rounded-lg bg-cp-purple/20 flex items-center justify-center flex-shrink-0">
              <Icon name="key" size={20} className="text-cp-purple" />
            </div>
            <div>
              <div className="text-ink font-medium mb-1">Passkey</div>
              <div className="text-sm text-gray-500">Entra con l'impronta, il volto o il PIN del dispositivo — senza scrivere username né password. Puoi averne più di una (telefono, computer...).</div>
            </div>
          </div>

          {pkError && <div className="bg-red-900/30 text-red-400 text-sm p-3 rounded-lg mb-4 border border-red-900/50">{pkError}</div>}

          <div className="space-y-2 mb-5">
            {passkeys === null && <div className="text-sm text-gray-600">Caricamento...</div>}
            {passkeys && passkeys.length === 0 && <div className="text-sm text-gray-600">Nessuna passkey ancora.</div>}
            {passkeys && passkeys.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 bg-surface-page rounded-lg px-4 py-3 border border-gray-800">
                <div className="min-w-0">
                  <div className="text-sm text-ink truncate">{p.nickname || 'Passkey senza nome'}</div>
                  <div className="text-xs text-gray-600 mt-0.5">
                    Aggiunta il {new Date(p.created_at).toLocaleDateString('it-IT')}
                    {p.last_used_at && ' · usata l\'ultima volta il ' + new Date(p.last_used_at).toLocaleDateString('it-IT')}
                  </div>
                </div>
                <button onClick={() => removePasskey(p.id)} className="text-xs text-red-400 hover:text-red-300 transition flex-shrink-0">Rimuovi</button>
              </div>
            ))}
          </div>

          <div className="flex gap-2 flex-wrap">
            <input className="flex-1 min-w-[180px] bg-surface-page text-ink px-3.5 py-2.5 rounded-lg text-sm outline-none border border-gray-800 focus:border-accent transition placeholder-gray-600"
              placeholder="Nome (facoltativo, es. Il mio iPhone)" value={pkNickname} onChange={(e) => setPkNickname(e.target.value)} />
            <button onClick={addPasskey} disabled={pkBusy} className="bg-accent hover:opacity-90 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition">
              {pkBusy ? 'Creazione...' : 'Aggiungi una passkey'}
            </button>
          </div>
        </div>
      )}

      <div className="lg:col-span-2 text-[11px] font-semibold uppercase tracking-wide text-gray-600 mt-2 -mb-1">Notifiche</div>
      <TelegramCard token={token} user={user} mode="telefono" className="lg:col-span-2" />
    </div>
  )
}

export default AccountPage
