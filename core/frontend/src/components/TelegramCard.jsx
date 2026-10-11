import React, { useState, useEffect } from 'react'
import useApi from '../lib/useApi'
import Icon from './Icon'

// Telegram: l'admin collega il bot (una volta); ogni utente collega il proprio telefono con un codice monouso generato qui, da loggato.
// Il bot mostra e fa solo ciò che l'utente può vedere e fare nell'app; il bottone «Pagata» sui messaggi chiude la voce come l'app.
export default function TelegramCard({ token, user, className = '' }) {
  const api = useApi(token)
  const isAdmin = user && user.role === 'admin'
  const [st, setSt] = useState(null)
  const [botToken, setBotToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null) // { ok, text }
  const [code, setCode] = useState(null) // { code, url, expires_in, at }

  const load = async () => { const d = await api.get('/telegram/status'); if (d) setSt(d) }
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (!st) return null
  if (!st.configured && !isAdmin) return null // chi non è admin vede la scheda solo quando il bot c'è

  const connect = async () => {
    setBusy(true); setMsg(null)
    const r = await api.put('/telegram/config', { bot_token: botToken })
    setBusy(false)
    if (r.ok) { setBotToken(''); setMsg({ ok: true, text: 'Bot collegato: @' + r.data.bot_username }); load() } else setMsg({ ok: false, text: (r.data && r.data.error) || 'Non riuscito.' })
  }
  const disconnect = async () => {
    if (!window.confirm('Togliere il bot e scollegare tutti i telefoni?')) return
    setBusy(true); const r = await api.del('/telegram/config'); setBusy(false)
    setCode(null); setMsg(r.ok ? { ok: true, text: 'Bot scollegato.' } : { ok: false, text: 'Non riuscito.' }); load()
  }
  const link = async () => {
    setBusy(true); setMsg(null)
    const r = await api.post('/telegram/link-code', {})
    setBusy(false)
    if (r.ok) setCode({ ...r.data, at: Date.now() }); else setMsg({ ok: false, text: (r.data && r.data.error) || 'Non riuscito.' })
  }
  const unlink = async (l) => {
    if (!window.confirm('Scollegare questo telefono?')) return
    await api.del('/telegram/links/' + l.id); load()
  }
  const lista = isAdmin ? (st.links || []) : (st.mine || [])
  const inp = 'w-full bg-surface-page text-ink px-3 py-2 rounded-lg text-sm outline-none border border-gray-800 focus:border-accent font-mono'

  return (
    <section className={'bg-surface-card border border-gray-800 rounded-xl p-5 ' + className}>
      <div className="flex items-start gap-3 mb-3">
        <div className="w-9 h-9 rounded-lg bg-surface-page border border-gray-800 flex items-center justify-center text-accent flex-shrink-0"><Icon name="bell" size={16} /></div>
        <div>
          <h2 className="text-sm font-semibold text-ink">Telegram</h2>
          <p className="text-xs text-gray-500 mt-0.5 max-w-md">I report arrivano con i bottoni (<b className="text-gray-300">«✅ Pagata»</b> chiude la voce). Puoi anche <b className="text-gray-300">scrivere al bot come parli</b> («ho pagato l'affitto», «quanto ho speso di benzina a settembre?», «ho speso 20 euro di benzina», «smista la bolletta A2A in 3 rate») o mandargli il <b className="text-gray-300">PDF</b> di una bolletta. Ogni modifica ti viene mostrata con un bottone di conferma: senza il tuo tocco non cambia niente. Il bot vede e fa solo ciò che puoi vedere e fare nell'app. Le frasi libere richiedono l'AI accesa (Impostazioni → AI).</p>
        </div>
      </div>

      {!st.configured && isAdmin && (
        <div className="space-y-3">
          <ol className="text-xs text-gray-400 space-y-1 list-decimal ml-4">
            <li>In Telegram cerca <b className="text-gray-300">@BotFather</b> e scrivi <span className="font-mono text-gray-300">/newbot</span>.</li>
            <li>Scegli un nome e un nome utente per il bot (deve finire con «bot»).</li>
            <li>BotFather ti dà un <b className="text-gray-300">codice segreto</b>: incollalo qui sotto. Non darlo a nessun altro.</li>
          </ol>
          <input type="password" autoComplete="off" placeholder="123456789:AA…" className={inp} value={botToken} onChange={(e) => setBotToken(e.target.value)} />
          <button onClick={connect} disabled={busy || !botToken.trim()} className="text-xs bg-accent hover:opacity-90 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg font-medium">{busy ? 'Collego…' : 'Collega il bot'}</button>
        </div>
      )}

      {st.configured && (
        <div className="space-y-3">
          <div className="text-xs text-gray-400">Bot collegato: <span className="font-mono text-gray-200">@{st.bot_username}</span></div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={link} disabled={busy} className="text-xs bg-accent hover:opacity-90 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg font-medium">Collega il mio Telegram</button>
            {isAdmin && <button onClick={disconnect} disabled={busy} className="text-xs bg-gray-800 hover:bg-red-900/40 text-red-300 px-3 py-1.5 rounded-lg">Scollega il bot</button>}
          </div>
          {code && (
            <div className="rounded-lg border border-accent/30 bg-accent/5 p-3 text-xs text-gray-300 space-y-2">
              <div>Dal telefono, tocca il link (si apre Telegram) e premi <b>Avvia</b>:</div>
              {code.url && <a href={code.url} target="_blank" rel="noreferrer" className="inline-block text-accent underline break-all">{code.url}</a>}
              <div className="text-gray-500">Oppure scrivi al bot <span className="font-mono text-gray-300">/start {code.code}</span>. Vale 10 minuti e una volta sola.</div>
            </div>
          )}
          {lista.length > 0 ? (
            <div>
              <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-1">{isAdmin ? 'Telefoni collegati' : 'I miei telefoni'}</div>
              <ul className="divide-y divide-gray-800 border border-gray-800 rounded-lg">
                {lista.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                    <span className="text-gray-200">{l.display_name || l.username || 'utente'}{l.label ? <span className="text-gray-500"> · {l.label}</span> : null}</span>
                    <button onClick={() => unlink(l)} className="text-gray-400 hover:text-red-300">Scollega</button>
                  </li>
                ))}
              </ul>
            </div>
          ) : <div className="text-xs text-gray-500">Nessun telefono collegato.</div>}
        </div>
      )}
      {msg && <div className={'mt-3 text-xs p-2.5 rounded-lg border ' + (msg.ok ? 'bg-green-900/20 text-green-400 border-green-900/40' : 'bg-amber-900/20 text-amber-400 border-amber-900/40')}>{msg.text}</div>}
    </section>
  )
}
