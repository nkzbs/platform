import React, { useState, useEffect } from 'react'

// La pagina pubblica di un invito (/invito/<token>): senza login. Mostra a chi è rivolto e fa scegliere nome utente e password. Il link vale una volta sola: dopo, o se è scaduto
// o annullato, lo dice. Nessun dato del progetto oltre al nome.
const input = 'w-full bg-surface-page text-ink px-4 py-3 rounded-lg text-sm outline-none border border-gray-800 focus:border-accent transition'

export default function InvitePage({ token }) {
  const [info, setInfo] = useState(null)
  const [f, setF] = useState({ username: '', password: '', conferma: '' })
  const [errore, setErrore] = useState('')
  const [busy, setBusy] = useState(false)
  const [fatto, setFatto] = useState(null)
  useEffect(() => { fetch('/api/public-invite/' + encodeURIComponent(token)).then((r) => r.json()).then(setInfo).catch(() => setInfo({ valido: false, motivo: 'Non riesco a contattare il server.' })) }, [token])
  const invia = async (e) => {
    e.preventDefault(); setErrore('')
    if (f.password !== f.conferma) { setErrore('Le due password non coincidono.'); return }
    setBusy(true)
    try {
      const r = await fetch('/api/public-invite/' + encodeURIComponent(token), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: f.username, password: f.password }) })
      const d = await r.json().catch(() => ({}))
      if (r.ok) setFatto(d.username); else setErrore(d.error || 'Non riuscito.')
    } catch (x) { setErrore('Non riesco a contattare il server.') } finally { setBusy(false) }
  }
  return (
    <div className="min-h-screen bg-surface-page flex items-center justify-center p-4">
      <div className="bg-surface-card border border-gray-800 rounded-xl w-full max-w-sm p-6">
        {!info ? <p className="text-sm text-gray-500">Un momento…</p>
          : fatto ? (
            <div className="space-y-3 text-center">
              <h1 className="text-lg font-bold text-ink">Fatto, {fatto}</h1>
              <p className="text-sm text-gray-400">Il tuo accesso è pronto. Entra con il nome utente e la password che hai scelto.</p>
              <a href="/" className="block w-full bg-accent hover:opacity-90 text-white py-2.5 rounded-lg text-sm font-medium transition">Vai all'accesso</a>
            </div>
          ) : !info.valido ? (
            <div className="space-y-3 text-center"><h1 className="text-lg font-bold text-ink">Invito non valido</h1><p className="text-sm text-gray-400">{info.motivo}</p><p className="text-xs text-gray-500">Chiedi a chi ti ha invitato di mandartene uno nuovo.</p></div>
          ) : (
            <form onSubmit={invia} className="space-y-3">
              <h1 className="text-lg font-bold text-ink">{info.nome ? 'Ciao ' + info.nome : 'Benvenuto'}</h1>
              <p className="text-sm text-gray-400">{info.progetto ? 'Sei stato invitato su ' + info.progetto + '. ' : 'Sei stato invitato. '}Scegli il tuo nome utente e la tua password.</p>
              <input className={input} placeholder="Nome utente" autoComplete="username" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} />
              <input className={input} type="password" placeholder="Password (almeno 10 caratteri)" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
              <input className={input} type="password" placeholder="Ripeti la password" autoComplete="new-password" value={f.conferma} onChange={(e) => setF({ ...f, conferma: e.target.value })} />
              {errore && <div className="text-xs text-amber-400">{errore}</div>}
              <button type="submit" disabled={busy || !f.username || !f.password} className="w-full bg-accent hover:opacity-90 disabled:opacity-50 text-white py-2.5 rounded-lg text-sm font-medium transition">{busy ? 'Un momento…' : 'Crea il mio accesso'}</button>
            </form>
          )}
      </div>
    </div>
  )
}
