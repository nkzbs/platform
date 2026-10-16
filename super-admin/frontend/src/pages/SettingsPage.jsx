import React, { useState, useEffect } from 'react'
import { API } from '../lib/api'
import Icon from '../components/Icon'
import StatusBadge from '../components/StatusBadge'
import UsersPage from './UsersPage'
import { startRegistration, browserSupportsWebAuthn } from '@simplewebauthn/browser'

// PLATFORM-UI-REDESIGN-CATALOG.md #8 — unico pezzo mancante di questa pagina
// (la navigazione a tile per sotto-sezioni esiste già): un indicatore di
// forza per la nuova password. Solo un aiuto visivo, non una regola
// bloccante — l'unico vincolo reale imposto dal backend resta la lunghezza
// minima di 8 caratteri (routes/auth.js), qui non duplicata come limite,
// solo mostrata più chiaramente.
function passwordStrength(pw) {
  if (!pw) return { score: 0, label: '' }
  let score = 0
  if (pw.length >= 8) score++
  if (pw.length >= 12) score++
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++
  if (/\d/.test(pw)) score++
  if (/[^A-Za-z0-9]/.test(pw)) score++
  const levels = ['Debole', 'Debole', 'Discreta', 'Buona', 'Forte', 'Forte']
  const colors = ['bg-red-500', 'bg-red-500', 'bg-amber-500', 'bg-yellow-500', 'bg-emerald-500', 'bg-emerald-500']
  return { score, label: levels[score], color: colors[score] }
}

// ─── IMPOSTAZIONI ───────────────────────────────────────────────────────────────
function SettingsPage({ token, myId }) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)

  // 2FA — resa possibile (2026-08-10), stesso meccanismo self-service già in
  // uso lato tenant (AccountPage.jsx): ognuno attiva/disattiva SOLO il
  // proprio, mai un endpoint per attivarlo su qualcun altro.
  const [twofaEnabled, setTwofaEnabled] = useState(null)
  const [twofaSetup, setTwofaSetup] = useState(null) // { secret, qr_data_uri }
  const [twofaCode, setTwofaCode] = useState('')
  const [twofaError, setTwofaError] = useState('')
  const [backupCodes, setBackupCodes] = useState(null)
  const [confirming, setConfirming] = useState(false)
  const [disablePassword, setDisablePassword] = useState('')
  const [showDisable, setShowDisable] = useState(false)
  const [disabling, setDisabling] = useState(false)

  // Chiavi AI: quella di Super Admin (distinta da quelle dei tenant) e il ripiego dei tenant senza chiave propria
  const [keys, setKeys] = useState(null) // { admin, generale_presente, ripiego_tenant, tenant_con_chiave_propria }
  const [keyInput, setKeyInput] = useState('')
  const [keyMsg, setKeyMsg] = useState(null)
  const [keyBusy, setKeyBusy] = useState(false)

  // Sicurezza della piattaforma (2026-10-15, richiesto dall'utente: "lato
  // sicurezza la struttura regge? un pannello dove controllo lo stato della
  // piattaforma", scelto esplicitamente "stato attuale + log di eventi
  // sospetti"). Legge solo /security-status, che a sua volta legge solo dati
  // di Super Admin su se stesso — vedi commento nella route.
  const [secStatus, setSecStatus] = useState(null)
  const loadSecStatus = () => fetch(API + '/security-status', { headers }).then((r) => r.json()).then((d) => d && setSecStatus(d))

  const [copied, setCopied] = useState(false)
  const copySecret = () => {
    navigator.clipboard.writeText(twofaSetup.secret).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })
  }

  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }

  const loadTwofaStatus = () => fetch(API + '/auth/2fa/status', { headers }).then((r) => r.json()).then((d) => setTwofaEnabled(d.enabled))

  const loadKeys = () => fetch(API + '/ai-usage/keys', { headers }).then((r) => r.json()).then((d) => d && d.admin && setKeys(d))

  // Passkey (2026-10-14, richiesto dall'utente: "oltre alle 2FA voglio
  // passkey ovunque") — self-service come il 2FA sopra.
  const [passkeys, setPasskeys] = useState(null)
  const [pkNickname, setPkNickname] = useState('')
  const [pkBusy, setPkBusy] = useState(false)
  const [pkError, setPkError] = useState('')
  const loadPasskeys = () => fetch(API + '/webauthn/list', { headers }).then((r) => r.json()).then((d) => Array.isArray(d) && setPasskeys(d))
  const addPasskey = async () => {
    setPkError(''); setPkBusy(true)
    try {
      const optRes = await fetch(API + '/webauthn/register-options', { method: 'POST', headers })
      const opt = await optRes.json()
      if (!optRes.ok) { setPkError(opt.error || 'Errore'); return }
      const attestation = await startRegistration({ optionsJSON: opt.options })
      const verRes = await fetch(API + '/webauthn/register-verify', { method: 'POST', headers, body: JSON.stringify({ pending_token: opt.pending_token, response: attestation, nickname: pkNickname }) })
      const verBody = await verRes.json()
      if (!verRes.ok) { setPkError(verBody.error || 'Errore'); return }
      setPkNickname('')
      loadPasskeys()
    } catch (e) {
      if (e.name !== 'NotAllowedError') setPkError('Creazione della passkey non riuscita')
    } finally {
      setPkBusy(false)
    }
  }
  const removePasskey = async (id) => { await fetch(API + '/webauthn/' + id, { method: 'DELETE', headers }); loadPasskeys() }

  useEffect(() => {
    loadTwofaStatus()
    loadKeys()
    loadPasskeys()
    loadSecStatus()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const keyCall = async (method, path, body) => {
    setKeyBusy(true); setKeyMsg(null)
    const res = await fetch(API + '/ai-usage/keys' + path, { method, headers, body: body ? JSON.stringify(body) : undefined })
    const data = await res.json().catch(() => ({}))
    setKeyBusy(false)
    if (!res.ok) { setKeyMsg({ ok: false, text: data.error || 'Non riuscito.' }); return }
    setKeys(data); setKeyInput(''); setKeyMsg({ ok: true, text: 'Fatto.' })
  }

  const changePassword = async () => {
    setMsg(null)
    if (newPassword !== confirmPassword) { setMsg({ ok: false, text: 'Le due password non coincidono' }); return }
    setSaving(true)
    const res = await fetch(API + '/auth/change-password', {
      method: 'POST', headers, body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
    })
    const data = await res.json()
    setSaving(false)
    if (!res.ok) { setMsg({ ok: false, text: data.error || 'Errore' }); return }
    setMsg({ ok: true, text: 'Password cambiata.' })
    setCurrentPassword(''); setNewPassword(''); setConfirmPassword('')
  }

  const startTwofaSetup = async () => {
    setTwofaError('')
    const res = await fetch(API + '/auth/2fa/setup', { method: 'POST', headers })
    const data = await res.json()
    if (!res.ok) { setTwofaError(data.error || 'Errore'); return }
    setTwofaSetup(data)
  }

  const confirmTwofaSetup = async () => {
    setTwofaError('')
    setConfirming(true)
    const res = await fetch(API + '/auth/2fa/confirm', { method: 'POST', headers, body: JSON.stringify({ code: twofaCode }) })
    const data = await res.json()
    setConfirming(false)
    if (!res.ok) { setTwofaError(data.error || 'Codice non valido'); return }
    setBackupCodes(data.backup_codes)
    setTwofaSetup(null)
    setTwofaCode('')
    loadTwofaStatus()
  }

  const disableTwofa = async () => {
    setTwofaError('')
    setDisabling(true)
    const res = await fetch(API + '/auth/2fa/disable', { method: 'POST', headers, body: JSON.stringify({ password: disablePassword }) })
    const data = await res.json()
    setDisabling(false)
    if (!res.ok) { setTwofaError(data.error || 'Errore'); return }
    setShowDisable(false)
    setDisablePassword('')
    loadTwofaStatus()
  }

  const inputCls = 'w-full bg-surface-page text-ink px-3.5 py-2.5 rounded-lg outline-none border border-gray-800 focus:border-cp-primary transition text-sm placeholder-gray-600'
  const primaryBtn = 'bg-cp-primary hover:bg-cp-primary-hover disabled:opacity-50 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition'
  const ghostBtn = 'px-4 py-2.5 rounded-lg text-sm bg-surface-page hover:bg-gray-800 text-gray-300 transition border border-gray-800'

  const SectionHead = ({ icon, title, sub, right }) => (
    <div className="flex items-start justify-between gap-4 mb-5">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-surface-page border border-gray-800 flex items-center justify-center text-cp-primary flex-shrink-0">
          <Icon name={icon} size={16} />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          <p className="text-xs text-gray-500 mt-0.5">{sub}</p>
        </div>
      </div>
      {right}
    </div>
  )

  return (
    <div className="max-w-2xl">
      <h1 className="text-lg font-bold text-ink tracking-[-0.35px] mb-1">Impostazioni</h1>
      <p className="text-gray-500 text-sm mb-6">Chi ha accesso a questo pannello, e il tuo accesso.</p>

      {/* UTENTI SUPER ADMIN — prima era una voce di menu a sé (2026-10-14,
          richiesto dall'utente: stava vicino a Impostazioni ma senza reset
          password/2FA, che restano qui sotto come self-service). Reset
          password/2FA di un ALTRO admin non esistono: ognuno gestisce solo
          il proprio (vedi sezione Due fattori più sotto). */}
      <section className="bg-surface-card border border-gray-800 rounded-xl p-5 mb-4">
        <SectionHead icon="users" title="Utenti Super Admin" sub="Chi ha accesso a questo pannello. Password e 2FA restano a chi accede, qui sotto — nessun admin può resettarli per un altro." />
        <UsersPage token={token} embedded myId={myId} />
      </section>

      {/* IL TUO ACCESSO — Password, 2FA e Passkey nidificati in UNA sezione
          (2026-10-14, segnalato dall'utente guardandola dal vivo: stavano
          allo stesso livello di "Utenti Super Admin" e "Chiavi AI", senza
          dire che queste tre sono le TUE, mai quelle di un altro admin —
          vedi "Utenti Super Admin" sopra per il motivo). Subito sotto
          "Utenti Super Admin" (non dopo "Chiavi AI", segnalato dall'utente
          il giorno stesso): sono entrambe questioni di accesso/identità,
          "Chiavi AI" è un'altra categoria (configurazione di sistema). */}
      <section className="bg-surface-card border border-gray-800 rounded-xl p-5 mb-4">
        <SectionHead icon="user" title="Il tuo accesso" sub="Password, due fattori e passkey — solo tu li cambi, mai un altro admin al posto tuo." />

        {/* PASSWORD */}
        <div className="text-sm font-semibold text-ink mb-3">Password</div>
        <div className="space-y-2.5 max-w-sm">
          <input type="password" placeholder="Password attuale" className={inputCls} value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
          <input type="password" placeholder="Nuova password (min. 8 caratteri)" className={inputCls} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          {newPassword && (() => {
            const strength = passwordStrength(newPassword)
            return (
              <div>
                <div className="flex gap-1 h-1">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <div key={i} className={'flex-1 rounded-full ' + (i < strength.score ? strength.color : 'bg-gray-800')} />
                  ))}
                </div>
                <div className="text-[11px] text-gray-500 mt-1">{strength.label}</div>
              </div>
            )
          })()}
          <input type="password" placeholder="Ripeti nuova password" className={inputCls} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
        </div>
        {msg && (
          <div className={'mt-3 text-xs p-3 rounded-lg max-w-sm ' + (msg.ok ? 'bg-green-900/30 text-green-400' : 'bg-amber-900/30 text-amber-400')}>{msg.text}</div>
        )}
        <button onClick={changePassword} disabled={saving || !currentPassword || !newPassword} className={'mt-4 ' + primaryBtn}>
          {saving ? 'Salvo...' : 'Cambia password'}
        </button>

        {/* DUE FATTORI */}
        <div className="border-t border-gray-800 mt-6 pt-5">
          <div className="flex items-center justify-between gap-3 mb-1">
            <div className="text-sm font-semibold text-ink">Autenticazione a due fattori</div>
            {twofaEnabled !== null && <StatusBadge tone={twofaEnabled ? 'green' : 'gray'}>{twofaEnabled ? 'Attiva' : 'Non attiva'}</StatusBadge>}
          </div>
          <p className="text-xs text-gray-500 mb-4">Oltre alla password, serve un codice che cambia ogni 30 secondi, generato dal telefono.</p>

        {twofaError && <div className="bg-red-900/30 text-red-400 text-sm p-3 rounded-lg mb-4 border border-red-900/50">{twofaError}</div>}

        {backupCodes && (
          <div className="bg-amber-900/20 border border-amber-900/40 rounded-lg p-4 mb-4">
            <div className="text-amber-400 text-sm font-medium mb-1">Salva questi codici di recupero: non saranno più mostrati</div>
            <div className="text-xs text-gray-500 mb-3">Usane uno se perdi l'accesso all'app authenticator. Ognuno funziona una sola volta.</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 font-mono text-sm text-gray-200 mb-3">
              {backupCodes.map((c) => <div key={c} className="bg-surface-page border border-gray-800 px-2.5 py-1.5 rounded text-center">{c}</div>)}
            </div>
            <button onClick={() => setBackupCodes(null)} className="text-xs bg-amber-700 hover:bg-amber-600 text-white px-3 py-1.5 rounded-lg transition">Li ho salvati</button>
          </div>
        )}

        {twofaEnabled === null && <div className="text-sm text-gray-600">Caricamento...</div>}

        {twofaEnabled === false && !twofaSetup && !backupCodes && (
          <button onClick={startTwofaSetup} className={primaryBtn}>Attiva 2FA</button>
        )}

        {twofaSetup && (
          <div className="flex flex-col sm:flex-row gap-6 items-start">
            <img src={twofaSetup.qr_data_uri} alt="QR 2FA" className="w-44 h-44 rounded-lg bg-white p-2 flex-shrink-0 self-center sm:self-start" />
            <ol className="space-y-4 text-sm text-gray-400 min-w-0 flex-1">
              <li className="flex gap-3">
                <span className="w-5 h-5 rounded-full bg-surface-page border border-gray-700 text-[11px] text-gray-300 flex items-center justify-center flex-shrink-0 mt-0.5">1</span>
                <span>Apri la tua app authenticator (Google Authenticator, Authy…) e <span className="text-ink">scansiona il QR</span>.</span>
              </li>
              <li className="flex gap-3">
                <span className="w-5 h-5 rounded-full bg-surface-page border border-gray-700 text-[11px] text-gray-300 flex items-center justify-center flex-shrink-0 mt-0.5">2</span>
                <div className="min-w-0">
                  <div>Non riesci a scansionarlo? Inserisci questa chiave a mano:</div>
                  <div className="flex items-center gap-2 mt-1.5">
                    <code className="font-mono text-xs text-gray-300 bg-surface-page border border-gray-800 rounded px-2.5 py-1.5 truncate select-all">{twofaSetup.secret}</code>
                    <button onClick={copySecret} className="text-xs text-gray-400 hover:text-ink transition flex-shrink-0">{copied ? 'Copiata ✓' : 'Copia'}</button>
                  </div>
                </div>
              </li>
              <li className="flex gap-3">
                <span className="w-5 h-5 rounded-full bg-surface-page border border-gray-700 text-[11px] text-gray-300 flex items-center justify-center flex-shrink-0 mt-0.5">3</span>
                <div>
                  <div>Scrivi il <span className="text-ink">codice a 6 cifre</span> che vedi nell'app:</div>
                  <div className="flex flex-wrap items-center gap-2 mt-1.5">
                    <input className={inputCls.replace('w-full ', '') + ' w-36 text-center tracking-[0.3em] font-mono'} inputMode="numeric" maxLength={6} placeholder="000000"
                      value={twofaCode} onChange={(e) => setTwofaCode(e.target.value.replace(/\D/g, ''))}
                      onKeyDown={(e) => e.key === 'Enter' && twofaCode.length === 6 && confirmTwofaSetup()} />
                    <button onClick={confirmTwofaSetup} disabled={confirming || twofaCode.length !== 6} className={primaryBtn}>{confirming ? 'Verifica...' : 'Conferma'}</button>
                    <button onClick={() => { setTwofaSetup(null); setTwofaCode(''); setTwofaError('') }} className={ghostBtn}>Annulla</button>
                  </div>
                </div>
              </li>
            </ol>
          </div>
        )}

        {twofaEnabled === true && !showDisable && (
          <button onClick={() => setShowDisable(true)} className="text-sm text-red-400 hover:text-red-300 transition">Disattiva 2FA</button>
        )}
        {showDisable && (
          <div className="max-w-sm space-y-2.5">
            <div className="text-xs text-gray-500">Conferma la tua password per disattivare.</div>
            <input type="password" className={inputCls} placeholder="Password" value={disablePassword} onChange={(e) => setDisablePassword(e.target.value)} />
            <div className="flex gap-2">
              <button onClick={disableTwofa} disabled={disabling} className="bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition">
                {disabling ? 'Disattivazione...' : 'Disattiva'}
              </button>
              <button onClick={() => { setShowDisable(false); setDisablePassword(''); setTwofaError('') }} className={ghostBtn}>Annulla</button>
            </div>
          </div>
        )}
        </div>

        {/* PASSKEY */}
        {browserSupportsWebAuthn() && (
          <div className="border-t border-gray-800 mt-6 pt-5">
            <div className="text-sm font-semibold text-ink mb-1">Passkey</div>
            <p className="text-xs text-gray-500 mb-4">Entra con l'impronta, il volto o il PIN del dispositivo, senza username né password. Puoi averne più di una.</p>

            {pkError && <div className="bg-red-900/30 text-red-400 text-sm p-3 rounded-lg mb-4 border border-red-900/50">{pkError}</div>}

            <div className="space-y-2 mb-4">
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
              <input className={inputCls + ' flex-1 min-w-[180px]'} placeholder="Nome (facoltativo, es. Il mio iPhone)" value={pkNickname} onChange={(e) => setPkNickname(e.target.value)} />
              <button onClick={addPasskey} disabled={pkBusy} className={primaryBtn}>{pkBusy ? 'Creazione...' : 'Aggiungi una passkey'}</button>
            </div>
          </div>
        )}
      </section>

      {/* CHIAVI AI */}
      <section className="bg-surface-card border border-gray-800 rounded-xl p-5">
        <SectionHead icon="key" title="Chiavi AI" sub="La chiave di Super Admin è solo sua: serve a costruire i tenant e ad analizzare i processi. Non la usa mai un tenant." />
        {keys && (
          <div className="space-y-4">
            <div className="text-xs">
              {keys.admin.source === 'admin' && <div className="text-green-400">Chiave di Super Admin salvata ({keys.admin.hint})</div>}
              {keys.admin.source === 'generale' && <div className="text-gray-400">Super Admin usa la chiave generale (variabile d'ambiente del backend). Inserisci qui una chiave sua per separare la spesa.</div>}
              {!keys.admin.configured && <div className="text-amber-400">Nessuna chiave: l'AI di Super Admin non funziona finché non ne inserisci una.</div>}
            </div>
            <div className="flex gap-2 flex-wrap">
              <input type="password" autoComplete="off" spellCheck="false" value={keyInput} onChange={(e) => setKeyInput(e.target.value)} placeholder="Incolla la chiave Mistral di Super Admin" className={inputCls + ' flex-1 min-w-[220px]'} />
              <button type="button" onClick={() => keyCall('PUT', '/admin', { key: keyInput })} disabled={keyBusy || !keyInput.trim()} className={primaryBtn}>Salva</button>
              {keys.admin.source === 'admin' && <button type="button" onClick={() => keyCall('DELETE', '/admin')} disabled={keyBusy} className={ghostBtn}>Togli</button>}
            </div>
            <div className="border-t border-gray-800 pt-4">
              <label className="flex items-start gap-2.5 cursor-pointer text-sm text-gray-300">
                <input type="checkbox" className="mt-1" checked={keys.ripiego_tenant} onChange={(e) => keyCall('PUT', '/fallback', { on: e.target.checked })} disabled={keyBusy} />
                <span>I tenant senza una chiave propria usano la chiave generale
                  <span className="block text-xs text-gray-500 mt-0.5">{keys.generale_presente ? 'La chiave generale è presente.' : 'Non c\'è nessuna chiave generale: con o senza questa opzione, un tenant senza chiave sua non ha AI.'} Spenta questa opzione, ogni tenant deve inserire la sua (Impostazioni → AI del tenant).</span>
                </span>
              </label>
              <div className="text-xs text-gray-500 mt-3">Tenant con chiave propria: {keys.tenant_con_chiave_propria.length ? keys.tenant_con_chiave_propria.join(', ') : 'nessuno'}</div>
            </div>
            {keyMsg && <div className={'text-xs ' + (keyMsg.ok ? 'text-green-400' : 'text-amber-400')}>{keyMsg.text}</div>}
            <div className="text-xs text-gray-600">Le chiavi sono controllate con Mistral e conservate cifrate. Non vengono mostrate di nuovo.</div>
          </div>
        )}
      </section>

      {/* SICUREZZA DELLA PIATTAFORMA */}
      <section className="bg-surface-card border border-gray-800 rounded-xl p-5 mt-4">
        <SectionHead icon="shield" title="Sicurezza della piattaforma" sub="Stato attuale e ultimi eventi sospetti — solo i dati di Super Admin, mai quelli dentro un tenant." />
        {!secStatus && <div className="text-sm text-gray-600">Caricamento...</div>}
        {secStatus && (() => {
          const u = secStatus.users
          const tfaAll = u.total > 0 && u.with_2fa === u.total
          const tfaNone = u.with_2fa === 0
          const pkAll = u.total > 0 && u.with_passkey === u.total
          const ssl = secStatus.cloudflare.ssl_mode
          const sslTone = !secStatus.cloudflare.configured ? 'gray' : (ssl === 'strict' || ssl === 'full' ? 'green' : (ssl === 'flexible' ? 'amber' : 'red'))
          const sslLabel = !secStatus.cloudflare.configured ? 'Non verificabile' : ssl === 'strict' ? 'Full (strict)' : ssl === 'full' ? 'Full' : ssl === 'flexible' ? 'Flexible (in chiaro verso il NAS)' : ssl === 'off' ? 'Spenta (nessuna cifratura)' : (ssl || 'Sconosciuta')
          const actionLabels = {
            'auth.login_failed': 'Accesso con password non riuscito',
            'auth.2fa_verify_failed': 'Codice 2FA errato',
            'auth.login_blocked_disabled': 'Accesso bloccato (utente disattivato)',
            'auth.webauthn_login_failed': 'Accesso con passkey non riuscito',
          }
          return (
            <div className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div className="bg-surface-page border border-gray-800 rounded-lg p-3">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-xs text-gray-500">Due fattori</span>
                    <StatusBadge tone={tfaAll ? 'green' : tfaNone ? 'red' : 'amber'}>{u.with_2fa}/{u.total}</StatusBadge>
                  </div>
                  <div className="text-[11px] text-gray-600">Admin con 2FA attiva</div>
                </div>
                <div className="bg-surface-page border border-gray-800 rounded-lg p-3">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-xs text-gray-500">Passkey</span>
                    <StatusBadge tone={pkAll ? 'green' : 'gray'}>{u.with_passkey}/{u.total}</StatusBadge>
                  </div>
                  <div className="text-[11px] text-gray-600">Admin con almeno una passkey</div>
                </div>
                <div className="bg-surface-page border border-gray-800 rounded-lg p-3">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-xs text-gray-500">Cifratura in transito</span>
                    <StatusBadge tone={sslTone}>{ssl ? sslLabel.split(' (')[0] : '—'}</StatusBadge>
                  </div>
                  <div className="text-[11px] text-gray-600">{sslLabel}</div>
                </div>
              </div>

              <div>
                <div className="text-xs font-semibold text-gray-400 mb-2">Limiti ai tentativi (anti brute-force)</div>
                <div className="space-y-1">
                  {secStatus.rate_limits.map((rl) => (
                    <div key={rl.name} className="flex items-center justify-between text-xs text-gray-500 bg-surface-page border border-gray-800 rounded-lg px-3 py-2">
                      <span>{rl.name}</span>
                      <span className="text-gray-400">max {rl.max} ogni {rl.window} · {rl.fail_mode === 'closed' ? 'blocca se il contatore non risponde' : 'passa se il contatore non risponde'}</span>
                    </div>
                  ))}
                </div>
              </div>

              {secStatus.known_gaps.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-gray-400 mb-2">Da sapere</div>
                  <div className="space-y-1.5">
                    {secStatus.known_gaps.map((g, i) => (
                      <div key={i} className="text-xs text-amber-400 bg-amber-900/20 border border-amber-900/40 rounded-lg px-3 py-2">{g}</div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <div className="text-xs font-semibold text-gray-400 mb-2">Ultimi eventi sospetti</div>
                {secStatus.recent_suspicious_events.length === 0 && <div className="text-xs text-gray-600">Nessuno negli ultimi eventi registrati.</div>}
                <div className="space-y-1">
                  {secStatus.recent_suspicious_events.map((e, i) => (
                    <div key={i} className="flex items-center justify-between gap-3 text-xs bg-surface-page border border-gray-800 rounded-lg px-3 py-2">
                      <span className="text-gray-300 truncate">{actionLabels[e.action] || e.action}{e.target ? ' — ' + e.target : ''}</span>
                      <span className="text-gray-600 flex-shrink-0">{new Date(e.created_at).toLocaleString('it-IT')}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )
        })()}
      </section>
    </div>
  )
}

export default SettingsPage
