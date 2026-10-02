import React, { useState, useEffect } from 'react'
import useApi from '../lib/useApi'
import Icon from '../components/Icon'

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
function AccountPage({ token }) {
  const api = useApi(token)
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

  return (
    <div>
      <div className="bg-surface-card rounded-md p-6 border border-gray-800 max-w-lg">
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
    </div>
  )
}

export default AccountPage
