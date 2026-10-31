import React, { useState, useEffect, useRef } from 'react'
import useApi from '../lib/useApi'
import Icon from './Icon'

// «Distacca su un tuo server»: una COPIA di questo progetto su un server Linux tuo, via SSH, che continua a funzionare da sola. Qui non si ferma né si cancella niente.
// Tre passi: 1) i dati del server (e la password del tuo account), 2) la verifica di sola lettura con l'impronta del server da confermare, 3) la copia vera con l'avanzamento.
// Le credenziali SSH restano in questa pagina e vanno al server solo per il tempo della copia: non si salvano.
const FASI = { connessione: 'Mi collego', controlli: 'Controllo il server', dati: 'Copio il database', allegati: 'Copio gli allegati', segreti: 'Scrivo i segreti (file riservato)', immagine: 'Carico il programma (la parte più lunga)', avvio: 'Avvio', prova: 'Provo che risponda' }
const input = 'w-full bg-surface-page text-ink px-3 py-2 rounded-lg text-sm outline-none border border-gray-800 focus:border-accent'

export default function ExportServerCard({ token }) {
  const api = useApi(token)
  const [aperto, setAperto] = useState(false)
  const [f, setF] = useState({ host: '', port: '22', username: '', accesso: 'password', password: '', privateKey: '', passphrase: '', porta_web: '8090', cartella: '', account: '' })
  const [passo, setPasso] = useState('form') // form | verificato | copia
  const [busy, setBusy] = useState(false)
  const [errore, setErrore] = useState('')
  const [ver, setVer] = useState(null) // { fingerprint, controlli, ok }
  const [conferma, setConferma] = useState(false)
  const [job, setJob] = useState(null)
  const poll = useRef(null)
  useEffect(() => () => clearInterval(poll.current), [])

  const corpo = () => ({
    password: f.account,
    server: { host: f.host.trim(), port: Number(f.port) || 22, username: f.username.trim(), ...(f.accesso === 'password' ? { password: f.password } : { privateKey: f.privateKey, passphrase: f.passphrase || undefined }) },
    opzioni: { porta_web: Number(f.porta_web), cartella: f.cartella.trim() || undefined },
  })
  const pronto = f.host.trim() && f.username.trim() && f.account && (f.accesso === 'password' ? f.password : f.privateKey.trim()) && f.porta_web

  const verifica = async () => {
    setBusy(true); setErrore('')
    const r = await api.post('/export-server/verifica', corpo())
    setBusy(false)
    if (!r.ok) { setErrore((r.data && r.data.error) || 'Non riuscito.'); return }
    setVer(r.data); setConferma(false); setPasso('verificato')
  }
  const avvia = async () => {
    setBusy(true); setErrore('')
    const r = await api.post('/export-server/avvia', { ...corpo(), fingerprint: ver.fingerprint })
    setBusy(false)
    if (!r.ok) { setErrore((r.data && r.data.error) || 'Non riuscito.'); return }
    setPasso('copia'); setJob({ fase: 'connessione', passi: [] })
    // Le credenziali non servono più: si tolgono dalla pagina.
    setF((x) => ({ ...x, password: '', privateKey: '', passphrase: '', account: '' }))
    clearInterval(poll.current)
    poll.current = setInterval(async () => {
      const s = await api.get('/export-server/stato/' + r.data.id)
      if (s && s.fase) { setJob(s); if (s.fine) clearInterval(poll.current) }
    }, 2000)
  }
  const ricomincia = () => { clearInterval(poll.current); setPasso('form'); setVer(null); setJob(null); setErrore(''); setConferma(false) }
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })

  return (
    <div className="glass-panel p-5 flex flex-col md:col-span-2 xl:col-span-3">
      <button type="button" onClick={() => setAperto(!aperto)} className="flex items-center justify-between gap-3 text-left w-full">
        <div className="flex items-center gap-3"><div className="w-9 h-9 rounded-lg bg-accent/15 text-accent flex items-center justify-center flex-shrink-0"><Icon name="upload" size={16} /></div>
          <div><div className="text-ink font-medium text-sm">Distacca su un tuo server</div><div className="text-gray-500 text-xs mt-0.5">Una copia che funziona da sola, su un server Linux tuo, via SSH.</div></div></div>
        <Icon name={aperto ? 'chevron-down' : 'chevron-right'} size={14} />
      </button>

      {aperto && passo === 'form' && (
        <div className="mt-4 space-y-3 max-w-xl">
          <p className="text-xs text-gray-500">Serve un server Linux (processore x86-64) con Docker, e un utente che lo possa usare. Questo progetto <b className="text-ink">resta com'è</b>: non viene fermato né cancellato.</p>
          <div className="grid grid-cols-3 gap-2"><div className="col-span-2"><label className="text-xs text-gray-500 block mb-1">Indirizzo del server</label><input className={input} placeholder="es. miosrv.example.com" value={f.host} onChange={set('host')} /></div><div><label className="text-xs text-gray-500 block mb-1">Porta SSH</label><input className={input} value={f.port} onChange={set('port')} /></div></div>
          <div><label className="text-xs text-gray-500 block mb-1">Utente</label><input className={input} autoComplete="off" value={f.username} onChange={set('username')} /></div>
          <div>
            <div className="flex gap-1 mb-1">{[['password', 'Password'], ['chiave', 'Chiave privata']].map(([k, l]) => <button type="button" key={k} onClick={() => setF({ ...f, accesso: k })} className={'text-xs px-2.5 py-1 rounded-full border ' + (f.accesso === k ? 'border-accent bg-accent/15 text-ink' : 'border-gray-800 text-gray-500')}>{l}</button>)}</div>
            {f.accesso === 'password' ? <input type="password" autoComplete="off" className={input} placeholder="Password SSH" value={f.password} onChange={set('password')} />
              : <><textarea autoComplete="off" spellCheck={false} className={input + ' font-mono text-xs min-h-[90px]'} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" value={f.privateKey} onChange={set('privateKey')} /><input type="password" autoComplete="off" className={input + ' mt-2'} placeholder="Frase della chiave (se c'è)" value={f.passphrase} onChange={set('passphrase')} /></>}
          </div>
          <div className="grid grid-cols-2 gap-2"><div><label className="text-xs text-gray-500 block mb-1">Porta web sul server</label><input className={input} value={f.porta_web} onChange={set('porta_web')} /></div><div><label className="text-xs text-gray-500 block mb-1">Cartella (facoltativa)</label><input className={input} placeholder="platform-…" value={f.cartella} onChange={set('cartella')} /></div></div>
          <div><label className="text-xs text-gray-500 block mb-1">La password di questo account</label><input type="password" autoComplete="current-password" className={input} value={f.account} onChange={set('account')} /></div>
          {errore && <div className="text-xs text-amber-400">{errore}</div>}
          <button type="button" onClick={verifica} disabled={busy || !pronto} className="text-sm px-4 py-2 rounded-lg bg-accent hover:opacity-90 disabled:opacity-50 text-white">{busy ? 'Controllo…' : 'Controlla il server'}</button>
          <p className="text-xs text-gray-600">In questo passo si legge soltanto: non si scrive niente sul server.</p>
        </div>
      )}

      {aperto && passo === 'verificato' && ver && (
        <div className="mt-4 space-y-3 max-w-xl">
          <div className="divide-y divide-gray-800 border border-gray-800 rounded-lg">{ver.controlli.map((c) => <div key={c.nome} className="flex items-start gap-2 px-3 py-2 text-sm"><span className={c.ok ? 'text-green-400' : 'text-amber-400'}>{c.ok ? '✓' : '✗'}</span><div><span className="text-ink">{c.nome}</span> <span className="text-xs text-gray-500">{c.dettaglio}</span></div></div>)}</div>
          <div className="bg-surface-page border border-gray-800 rounded-lg p-3"><div className="text-xs text-gray-500 mb-1">Impronta del server</div><div className="font-mono text-xs text-ink break-all">{ver.fingerprint}</div>
            <label className="flex items-start gap-2 mt-2 text-xs text-gray-400 cursor-pointer"><input type="checkbox" className="mt-0.5" checked={conferma} onChange={(e) => setConferma(e.target.checked)} />È l'impronta del mio server (la leggi sul server con <span className="font-mono">ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub</span>). Se è diversa, qualcuno si sta mettendo in mezzo: non andare avanti.</label></div>
          <p className="text-xs text-gray-500">Dopo la copia il progetto sul server funziona da solo: <b className="text-ink">l'AI, la Libreria e gli aggiornamenti di Super Admin non ci sono</b>. Davanti ci metti tu un proxy con HTTPS.</p>
          {errore && <div className="text-xs text-amber-400">{errore}</div>}
          <div className="flex gap-2"><button type="button" onClick={ricomincia} disabled={busy} className="text-sm px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300">Indietro</button>
            <button type="button" onClick={avvia} disabled={busy || !ver.ok || !conferma} className="text-sm px-4 py-2 rounded-lg bg-accent hover:opacity-90 disabled:opacity-50 text-white">{busy ? 'Avvio…' : 'Copia il progetto sul server'}</button></div>
          {!ver.ok && <p className="text-xs text-amber-400">Qualche controllo non è superato: sistemalo sul server e ricontrolla.</p>}
        </div>
      )}

      {aperto && passo === 'copia' && job && (
        <div className="mt-4 space-y-3 max-w-xl">
          <div className="space-y-1.5 text-sm">{Object.keys(FASI).map((k) => {
            const fatta = job.passi.some((p) => p.fase === k) && job.fase !== k || (job.fine && !job.errore); const incorso = job.fase === k && !job.fine
            return <div key={k} className={fatta ? 'text-green-400' : incorso ? 'text-ink' : 'text-gray-600'}>{fatta ? '✓ ' : incorso ? '… ' : '· '}{FASI[k]}{incorso && k === 'immagine' && job.byte_immagine ? ' (' + Math.round(job.byte_immagine / 1048576) + ' MB inviati)' : ''}</div>
          })}</div>
          {job.errore && <div className="text-sm text-amber-400">Non è andata a buon fine: {job.errore}</div>}
          {job.esito && (
            <div className="border border-green-900/50 rounded-lg p-3 text-sm space-y-1">
              <div className="text-green-400">Fatto. Il progetto gira sul tuo server.</div>
              <div className="text-ink">Indirizzo: <span className="font-mono">{job.esito.url}</span></div>
              <div className="text-xs text-gray-500">Cartella: <span className="font-mono">{job.esito.cartella}</span> (database, allegati e il file «env» con i segreti, leggibile solo dal tuo utente). Container: <span className="font-mono">{job.esito.container}</span>, riparte da solo. Entra con le stesse credenziali di qui. Mettici davanti un proxy con HTTPS prima di usarlo davvero, e fai tu i backup della cartella.</div>
            </div>
          )}
          {job.fine && <button type="button" onClick={ricomincia} className="text-sm px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300">Chiudi</button>}
        </div>
      )}
    </div>
  )
}
