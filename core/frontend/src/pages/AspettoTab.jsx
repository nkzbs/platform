import React, { useState, useEffect } from 'react'
import useApi from '../lib/useApi'

// Colore dell'app (tenant_settings.accent_color) — colonna già esistente da
// agosto ("white-label minimo") e già letta da App.jsx per colorare l'interfaccia,
// ma senza un posto da cui impostarla. Richiesto il 21/10: due verticali diverse
// (due tenant/container distinti) salvate come app sul dock devono avere icone di
// colore diverso per distinguerle a colpo d'occhio — il colore scelto qui arriva
// anche lì: core/backend/src/pwa-icon.js ricolora icon-192/512/apple-touch-icon e
// il theme_color del manifest ogni volta che questo endpoint viene salvato.
// PUT /settings/azienda sostituisce l'intera riga: si rimanda sempre indietro
// l'oggetto completo già caricato (solo accent_color cambiato), altrimenti gli
// altri campi (logo_url, login_*...) verrebbero azzerati in silenzio.
export default function AspettoTab({ token }) {
  const api = useApi(token)
  const [azienda, setAzienda] = useState(null)
  const [salvo, setSalvo] = useState(false)
  const [errore, setErrore] = useState('')

  useEffect(() => { api.get('/settings/azienda').then((d) => d && setAzienda(d)) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const salva = async (accent_color) => {
    setErrore('')
    setAzienda((a) => ({ ...a, accent_color }))
    const r = await api.put('/settings/azienda', { ...azienda, accent_color })
    if (!r.ok) { setErrore((r.data && r.data.error) || 'Non riuscito.'); return }
    setSalvo(true)
    setTimeout(() => setSalvo(false), 2000)
  }

  if (!azienda) return <p className="text-sm text-gray-500">Carico…</p>

  const colore = azienda.accent_color || '#2563EB'

  return (
    <div className="max-w-2xl">
      <p className="text-sm text-gray-500 mb-4">Il colore principale dell'app — anche nell'icona se la salvi sul dock come app. Utile per distinguere due verticali diverse a colpo d'occhio.</p>
      {errore && <div className="text-xs text-amber-400 mb-3">{errore}</div>}
      <div className="bg-surface-card border border-gray-800 rounded-xl p-4 flex items-center justify-between gap-4">
        <div>
          <div className="text-ink text-sm font-medium">Colore dell'app</div>
          <div className="text-xs text-gray-500 mt-0.5">{colore.toUpperCase()}</div>
        </div>
        <div className="flex items-center gap-3">
          {salvo && <span className="text-xs text-emerald-400">Salvato</span>}
          <input type="color" value={colore} onChange={(e) => salva(e.target.value)}
            className="w-12 h-9 bg-transparent border border-gray-800 rounded cursor-pointer" />
        </div>
      </div>
    </div>
  )
}
