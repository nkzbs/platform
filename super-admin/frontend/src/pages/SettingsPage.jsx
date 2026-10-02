import React, { useState, useEffect } from 'react'
import { API } from '../lib/api'
import Icon from '../components/Icon'
import StatusBadge from '../components/StatusBadge'

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
function SettingsPage({ token }) {
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

  const [copied, setCopied] = useState(false)
  const copySecret = () => {
    navigator.clipboard.writeText(twofaSetup.secret).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })
  }

  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }

  const loadTwofaStatus = () => fetch(API + '/auth/2fa/status', { headers }).then((r) => r.json()).then((d) => setTwofaEnabled(d.enabled))

  useEffect(() => {
    loadTwofaStatus()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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
      <p className="text-gray-500 text-sm mb-6">Il tuo accesso a questo pannello.</p>

      {/* PASSWORD */}
      <section className="bg-surface-card border border-gray-800 rounded-xl p-5 mb-4">
        <SectionHead icon="key" title="Password" sub="Cambia la password con cui accedi a Super Admin." />
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
      </section>

      {/* DUE FATTORI */}
      <section className="bg-surface-card border border-gray-800 rounded-xl p-5">
        <SectionHead icon="shield" title="Autenticazione a due fattori"
          sub="Oltre alla password, serve un codice che cambia ogni 30 secondi, generato dal telefono."
          right={twofaEnabled === null ? null : <StatusBadge tone={twofaEnabled ? 'green' : 'gray'}>{twofaEnabled ? 'Attiva' : 'Non attiva'}</StatusBadge>} />

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
      </section>
    </div>
  )
}

export default SettingsPage
