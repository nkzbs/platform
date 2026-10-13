import React, { useState } from 'react'
import { API } from '../lib/api'
import InviteShare from '@shared/InviteShare.jsx'

// «Invita» il primo admin di un tenant (o chi serve): il tenant crea un link monouso, la persona sceglie da sé utente e password (nessuna password gira). Il link si vede UNA volta:
// si copia, si manda su WhatsApp o Telegram (messaggio già scritto), oppure parte per mail dalla posta di Super Admin se c'è e il tenant ha un dominio.
const input = 'w-full bg-surface-page text-ink px-3 py-2 rounded-lg text-sm outline-none border border-gray-800 focus:border-cp-primary'

export default function InviteTenantModal({ token, tenant, onClose }) {
  const [f, setF] = useState({ nome: '', email: '', ruolo: 'admin', mail: false })
  const [busy, setBusy] = useState(false)
  const [errore, setErrore] = useState('')
  const [fatto, setFatto] = useState(null)
  const crea = async () => {
    setBusy(true); setErrore('')
    try {
      const r = await fetch(API + '/tenants/' + tenant.slug + '/invite', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ nome: f.nome, email: f.email || undefined, role: f.ruolo, invia_email: f.mail && !!f.email }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { setErrore(d.error || 'Non riuscito.'); return }
      // Senza dominio il link si compone come quello di «Apri →»: host corrente + porta del tenant.
      const base = d.link ? null : (window.location.protocol + '//' + window.location.hostname + ':' + d.porta)
      setFatto({ link: d.link || base + '/invito/' + d.token, mail: d.mail, ore: d.ore })
    } catch (e) { setErrore('Errore di rete, riprova.') } finally { setBusy(false) }
  }
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-surface-card rounded-xl w-full max-w-md border border-gray-800 p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-ink mb-1">Invita su «{tenant.name}»</h2>
        {fatto ? (
          <div className="mt-2 space-y-3">
            <p className="text-sm text-gray-400">L'invito è pronto. <b className="text-ink">Il link si vede solo adesso</b>: mandalo subito.</p>
            {fatto.mail && <p className={'text-xs ' + (fatto.mail.sent ? 'text-green-400' : 'text-amber-400')}>{fatto.mail.sent ? 'Mail partita.' : 'La mail non è partita: ' + (fatto.mail.reason || '') + ' Usa il link qui sotto.'}</p>}
            <InviteShare link={fatto.link} nome={f.nome} progetto={tenant.name} ore={fatto.ore} />
            <div className="flex gap-2"><button onClick={() => setFatto(null)} className="text-sm px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200">Un altro invito</button><button onClick={onClose} className="text-sm px-4 py-2 rounded-lg bg-cp-primary hover:bg-cp-primary-hover text-white">Chiudi</button></div>
          </div>
        ) : (
          <div className="mt-2 space-y-3">
            <p className="text-xs text-gray-500">La persona riceve un link e sceglie da sé nome utente e password. Vale 72 ore e si usa una volta sola.</p>
            <div><label className="text-xs text-gray-500 block mb-1">Nome</label><input className={input} value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} /></div>
            <div><label className="text-xs text-gray-500 block mb-1">Ruolo</label><select className={input} value={f.ruolo} onChange={(e) => setF({ ...f, ruolo: e.target.value })}><option value="admin">Admin (gestisce il progetto)</option><option value="user">Utente</option></select></div>
            <div><label className="text-xs text-gray-500 block mb-1">Email (facoltativa)</label><input className={input} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
              <label className={'flex items-center gap-2 mt-2 text-xs ' + (f.email ? 'text-gray-400 cursor-pointer' : 'text-gray-600')}><input type="checkbox" disabled={!f.email} checked={f.mail && !!f.email} onChange={(e) => setF({ ...f, mail: e.target.checked })} />Manda anche una mail con il link (serve la posta configurata e un dominio sul tenant)</label></div>
            {errore && <div className="text-xs text-amber-400">{errore}</div>}
            <div className="flex gap-2 justify-end"><button onClick={onClose} className="text-sm px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300">Annulla</button><button onClick={crea} disabled={busy} className="text-sm px-4 py-2 rounded-lg bg-cp-primary hover:bg-cp-primary-hover disabled:opacity-50 text-white">{busy ? 'Creo…' : 'Crea l\'invito'}</button></div>
          </div>
        )}
      </div>
    </div>
  )
}
