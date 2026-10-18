import React, { useState, useEffect } from 'react'
import useApi from '../lib/useApi'
import Icon from './Icon'

// Email di notifica per i lead del Sito Web — l'indirizzo a cui arrivano le
// email vere quando qualcuno compila un blocco 'form'. L'invio vero richiede
// ANCHE la connessione 'email_resend' qui sopra: qui c'è solo il destinatario,
// non le credenziali del mittente. Spostato da Sito Web (era lì fino al
// 2026-10-18) perché è una destinazione di notifica, non una pagina del sito.
export default function SiteLeadEmailPanel({ token, nested = false }) {
  const api = useApi(token)
  const [email, setEmail] = useState('')
  const [saved, setSaved] = useState(false)
  useEffect(() => { api.get('/site-pages/settings').then((s) => s && setEmail(s.lead_notification_email || '')) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    const res = await api.patch('/site-pages/settings', { lead_notification_email: email.trim() })
    if (res.ok) { setSaved(true); setTimeout(() => setSaved(false), 1800) }
  }

  return (
    <section className={nested ? 'mt-4 pt-4 border-t border-gray-800' : 'bg-surface-card border border-gray-800 rounded-xl p-5'}>
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-surface-page border border-gray-800 flex items-center justify-center text-accent flex-shrink-0"><Icon name="mail" size={16} /></div>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink">Notifiche richieste Sito Web</h2>
          <p className="text-xs text-gray-500 mt-0.5 max-w-md">Indirizzo a cui arrivano le email quando qualcuno compila un modulo di contatto.</p>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap mt-3">
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="info@tuodominio.it"
          className="bg-surface-page border border-gray-800 rounded-lg px-2.5 py-1.5 text-sm text-ink flex-1 min-w-[220px] outline-none focus:border-accent" />
        <button onClick={save} className="text-xs bg-accent hover:opacity-90 text-white px-3 py-1.5 rounded-lg transition font-medium">
          {saved ? 'Salvato ✓' : 'Salva'}
        </button>
      </div>
    </section>
  )
}
