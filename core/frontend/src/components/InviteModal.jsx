import React, { useState, useEffect } from 'react'
import useApi from '../lib/useApi'
import InviteShare from '@shared/InviteShare.jsx'

// «Invita»: si scrive nome, email (facoltativa) e ruolo; nasce un link monouso con cui la persona sceglie da sé utente e password. Il link si vede UNA volta (nel database resta solo
// la sua impronta): si copia, si manda su WhatsApp o Telegram, oppure parte per mail dalla posta di Super Admin se c'è. Sotto, gli inviti recenti, con «Annulla» per quelli ancora aperti.
const STATI = { in_attesa: 'In attesa', usato: 'Usato', scaduto: 'Scaduto', annullato: 'Annullato' }
const input = 'w-full bg-surface-page text-ink px-3 py-2 rounded-lg text-sm outline-none border border-gray-800 focus:border-accent'

export default function InviteModal({ token, onClose }) {
  const api = useApi(token)
  const [roles, setRoles] = useState([{ name: 'user', label: 'Utente' }, { name: 'admin', label: 'Admin' }])
  const [f, setF] = useState({ nome: '', email: '', role: 'user', mail: false })
  const [busy, setBusy] = useState(false)
  const [errore, setErrore] = useState('')
  const [fatto, setFatto] = useState(null) // { link, email }
  const [lista, setLista] = useState([])
  const [progetto, setProgetto] = useState(window.location.hostname) // nome del progetto per il messaggio: la ragione sociale se c'è
  const carica = () => api.get('/invites').then((d) => Array.isArray(d) && setLista(d))
  useEffect(() => { api.get('/settings/azienda').then((d) => d && d.ragione_sociale && setProgetto(d.ragione_sociale)); api.get('/roles').then((d) => Array.isArray(d) && d.length && setRoles(d)); carica() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const crea = async () => {
    setBusy(true); setErrore('')
    const r = await api.post('/invites', { nome: f.nome, email: f.email || undefined, role: f.role, invia_email: f.mail && !!f.email, link_base: window.location.origin })
    setBusy(false)
    if (!r.ok) { setErrore((r.data && r.data.error) || 'Non riuscito.'); return }
    setFatto({ link: window.location.origin + '/invito/' + r.data.token, email: r.data.email, ore: r.data.ore }); carica()
  }
  const annulla = async (i) => { await api.del('/invites/' + i.id); carica() }
  const nuovo = () => { setFatto(null); setF({ nome: '', email: '', role: 'user', mail: false }) }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-surface-card rounded-xl w-full max-w-lg border border-gray-800 p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-ink mb-1">Invita una persona</h2>
        {fatto ? (
          <div className="mt-2 space-y-3">
            <p className="text-sm text-gray-400">L'invito è pronto. <b className="text-ink">Il link si vede solo adesso</b>: mandalo subito.</p>
            {fatto.email && <p className={'text-xs ' + (fatto.email.sent ? 'text-green-400' : 'text-amber-400')}>{fatto.email.sent ? 'Mail partita.' : 'La mail non è partita: ' + (fatto.email.reason || '') + ' Usa il link qui sotto.'}</p>}
            <InviteShare link={fatto.link} nome={f.nome} progetto={progetto} ore={fatto.ore} />
            <div className="flex gap-2"><button onClick={nuovo} className="text-sm px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200">Un altro invito</button><button onClick={onClose} className="text-sm px-4 py-2 rounded-lg bg-accent hover:opacity-90 text-white">Chiudi</button></div>
          </div>
        ) : (
          <div className="mt-2 space-y-3">
            <p className="text-xs text-gray-500">La persona riceve un link e sceglie da sé il nome utente e la password: nessuna password gira per mail o chat.</p>
            <div><label className="text-xs text-gray-500 block mb-1">Nome</label><input className={input} value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} /></div>
            <div><label className="text-xs text-gray-500 block mb-1">Ruolo</label>
              <select className={input} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{roles.map((r) => <option key={r.name} value={r.name}>{r.label || r.name}</option>)}</select></div>
            <div><label className="text-xs text-gray-500 block mb-1">Email (facoltativa)</label><input className={input} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
              <label className={'flex items-center gap-2 mt-2 text-xs ' + (f.email ? 'text-gray-400 cursor-pointer' : 'text-gray-600')}><input type="checkbox" disabled={!f.email} checked={f.mail && !!f.email} onChange={(e) => setF({ ...f, mail: e.target.checked })} />Manda anche una mail con il link (dalla posta di Super Admin, se è configurata)</label></div>
            {errore && <div className="text-xs text-amber-400">{errore}</div>}
            <div className="flex gap-2 justify-end"><button onClick={onClose} className="text-sm px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300">Annulla</button><button onClick={crea} disabled={busy} className="text-sm px-4 py-2 rounded-lg bg-accent hover:opacity-90 disabled:opacity-50 text-white">{busy ? 'Creo…' : 'Crea l\'invito'}</button></div>
          </div>
        )}
        {lista.length > 0 && (
          <div className="mt-5 pt-4 border-t border-gray-800">
            <div className="text-xs text-gray-500 mb-2">Inviti recenti</div>
            <div className="divide-y divide-gray-800">{lista.slice(0, 8).map((i) => (
              <div key={i.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                <div className="min-w-0"><div className="text-ink truncate">{i.nome || i.email || 'Senza nome'} <span className="text-xs text-gray-500">· {i.role}</span></div>{i.used_username && <div className="text-xs text-gray-500">utente «{i.used_username}»</div>}</div>
                <div className="flex items-center gap-3 flex-shrink-0"><span className={'text-xs ' + (i.stato === 'usato' ? 'text-green-400' : i.stato === 'in_attesa' ? 'text-amber-400' : 'text-gray-500')}>{STATI[i.stato]}</span>{i.stato === 'in_attesa' && <button onClick={() => annulla(i)} className="text-xs text-gray-500 hover:text-red-400">Annulla</button>}</div>
              </div>))}</div>
          </div>
        )}
      </div>
    </div>
  )
}
