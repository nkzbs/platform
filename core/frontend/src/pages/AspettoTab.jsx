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

  // Dati dell'azienda: intestazione di PDF e documenti. Il logo si incorpora nel record (immagine piccola), così
  // non dipende da un indirizzo esterno. PUT sostituisce la riga: si rimanda l'oggetto completo.
  const salvaAzienda = async (campi) => {
    setErrore('')
    const r = await api.put('/settings/azienda', { ...azienda, ...campi })
    if (!r.ok) { setErrore((r.data && r.data.error) || 'Non riuscito.'); return false }
    setAzienda((a) => ({ ...a, ...campi }))
    setSalvo(true)
    setTimeout(() => setSalvo(false), 2000)
    return true
  }
  const scegliLogo = (e) => {
    const file = e.target.files && e.target.files[0]
    e.target.value = ''
    if (!file) return
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { setErrore('Il logo deve essere PNG, JPEG o WebP.'); return }
    if (file.size > 650 * 1024) { setErrore('Immagine troppo pesante (massimo circa 650 KB): riducila e riprova.'); return }
    const lettore = new FileReader()
    lettore.onload = () => salvaAzienda({ logo_url: lettore.result })
    lettore.readAsDataURL(file)
  }

  if (!azienda) return <p className="text-sm text-gray-500">Carico…</p>

  const colore = azienda.accent_color || '#2563EB'

  return (
    <div className="max-w-2xl">
      <p className="text-sm text-gray-500 mb-4">Il colore principale dell'app — anche nell'icona se la salvi sul dock come app. Utile per distinguere due verticali diverse a colpo d'occhio.</p>
      {errore && <div className="text-xs text-amber-400 mb-3">{errore}</div>}
      <div className="glass-panel p-4 flex items-center justify-between gap-4">
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

      <p className="text-sm text-gray-500 mt-6 mb-3">I dati dell'azienda compaiono nell'intestazione dei PDF (per esempio il report di valutazione).</p>
      <div className="glass-panel p-4 space-y-3">
        {[['ragione_sociale', 'Ragione sociale'], ['indirizzo', 'Indirizzo'], ['piva', 'Partita IVA']].map(([k, etichetta]) => (
          <label key={k} className="block">
            <span className="text-xs text-gray-500">{etichetta}</span>
            <input defaultValue={azienda[k] || ''} onBlur={(e) => { if ((e.target.value || '') !== (azienda[k] || '')) salvaAzienda({ [k]: e.target.value.trim() || null }) }}
              className="mt-1 w-full bg-surface-page border border-gray-800 rounded-lg px-3 py-2 text-sm text-ink" />
          </label>
        ))}
        <div>
          <span className="text-xs text-gray-500">Logo</span>
          <div className="mt-1 flex items-center gap-3">
            {azienda.logo_url ? <img src={azienda.logo_url} alt="Logo" className="h-12 max-w-[200px] object-contain rounded border border-gray-800" /> : <span className="text-xs text-gray-600">Nessun logo</span>}
            <label className="text-xs px-2.5 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200 cursor-pointer">
              {azienda.logo_url ? 'Cambia' : 'Carica'}
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={scegliLogo} className="hidden" />
            </label>
            {azienda.logo_url && <button onClick={() => salvaAzienda({ logo_url: null })} className="text-xs text-gray-500 hover:text-gray-300">Togli</button>}
          </div>
        </div>
      </div>
    </div>
  )
}
