import React, { useState, useEffect } from 'react'
import useApi from '../lib/useApi'
import Icon from './Icon'
import WhatsAppRecipientsPanel from './WhatsAppRecipientsPanel'

// Riepilogo del mattino su WhatsApp: un solo messaggio al giorno con le spese da pagare oggi, domani
// e in ritardo, al posto di un messaggio per ogni riga. Spento finché non lo si accende.
const HOURS = [6, 7, 8, 9, 10, 11]

// *testo* è il grassetto di WhatsApp: nell'anteprima lo si mostra come tale.
function renderWa(text) {
  return text.split(/(\*[^*\n]+\*)/g).map((part, i) => (/^\*[^*\n]+\*$/.test(part) ? <strong key={i} className="text-ink">{part.slice(1, -1)}</strong> : part))
}

export default function DigestSettingsTab({ token, features = {} }) {
  const api = useApi(token)
  const [s, setS] = useState(null) // { enabled, hour, last_sent }
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState(null) // { text } | { empty: true }
  const [sendResult, setSendResult] = useState(null)

  const load = async () => { const d = await api.get('/digest/settings'); if (d) setS(d) }
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (patch) => {
    setBusy(true)
    const res = await api.put('/digest/settings', patch)
    setBusy(false)
    if (res.ok) setS(res.data)
  }
  const showPreview = async () => {
    setBusy(true); setSendResult(null)
    const d = await api.get('/digest/preview')
    setBusy(false)
    setPreview(d && d.text ? { text: d.text } : { empty: true })
  }
  const sendNow = async () => {
    setBusy(true)
    const res = await api.post('/digest/send-now', {})
    setBusy(false)
    setSendResult(res.ok ? res.data : { esito: 'FALLITO', motivo: (res.data && res.data.error) || 'Invio non riuscito' })
  }

  const msgFor = (r) => {
    if (r.esito === 'inviato') return { ok: true, text: 'Messaggio inviato: controlla il telefono.' }
    if (r.esito === 'nulla da segnalare') return { ok: true, text: 'Nessuna scadenza oggi, domani o in ritardo: non c\'era nulla da mandare.' }
    if (r.esito === 'non configurato') return { ok: false, text: r.motivo }
    return { ok: false, text: (r.esito === 'parziale' ? 'Inviato solo ad alcuni destinatari. ' : 'Messaggio NON inviato. ') + (r.dettaglio || r.motivo || '') }
  }

  return (
    <div className="max-w-2xl space-y-4">
      {features.riepilogo_mattino && (
      <>
      <section className="bg-surface-card border border-gray-800 rounded-xl p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-surface-page border border-gray-800 flex items-center justify-center text-accent flex-shrink-0"><Icon name="bell" size={16} /></div>
            <div>
              <h2 className="text-sm font-semibold text-ink">Riepilogo del mattino</h2>
              <p className="text-xs text-gray-500 mt-0.5 max-w-md">Un solo messaggio WhatsApp al giorno con le spese da pagare <span className="text-gray-300">oggi</span>, <span className="text-gray-300">domani</span> e <span className="text-gray-300">in ritardo</span>, invece di un messaggio per ogni riga. Se non c'è nulla da segnalare non manda niente.</p>
            </div>
          </div>
          {s && (
            <button type="button" role="switch" aria-checked={s.enabled} onClick={() => save({ enabled: !s.enabled })} disabled={busy}
              className={'w-10 h-[22px] rounded-full transition-colors relative flex-shrink-0 mt-1 disabled:opacity-60 ' + (s.enabled ? 'bg-accent' : 'bg-gray-700')}>
              <span className={'absolute top-[3px] left-0 w-4 h-4 rounded-full bg-white transition-transform ' + (s.enabled ? 'translate-x-[21px]' : 'translate-x-[3px]')} />
            </button>
          )}
        </div>

        {s && (
          <div className="mt-4 pt-4 border-t border-gray-800 space-y-3">
            <div className="flex items-center gap-3 text-sm">
              <label htmlFor="digest-hour" className="text-gray-400">Ogni giorno alle</label>
              <select id="digest-hour" value={s.hour} onChange={(e) => save({ hour: parseInt(e.target.value, 10) })} disabled={busy}
                className="bg-surface-page text-ink px-2.5 py-1.5 rounded-lg text-sm outline-none border border-gray-800 focus:border-accent">
                {HOURS.map((h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
              </select>
              <span className="text-xs text-gray-600">ora italiana</span>
            </div>
            <div className="text-xs text-gray-500 space-y-1">
              <div>Lo ricevono i destinatari con il tag <span className="font-mono text-gray-300">scadenza</span> in «Destinatari WhatsApp».</div>
              {s.enabled && <div className="text-amber-400/90">Con il riepilogo acceso gli avvisi «scadenza oggi» per singola riga non partono più: arrivano tutti qui dentro.</div>}
              {s.last_sent && <div>Ultimo invio: {s.last_sent}</div>}
            </div>
          </div>
        )}
      </section>

      <section className="bg-surface-card border border-gray-800 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-ink mb-1">Provalo adesso</h2>
        <p className="text-xs text-gray-500 mb-3">L'anteprima mostra il messaggio che partirebbe in questo momento, senza inviare nulla.</p>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={showPreview} disabled={busy} className="text-xs bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-200 px-3 py-1.5 rounded-lg transition">Mostra anteprima</button>
          <button onClick={sendNow} disabled={busy} className="text-xs bg-accent hover:opacity-90 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg transition font-medium">Invia ora</button>
        </div>
        {preview && (
          <pre className="mt-3 text-xs text-gray-300 bg-surface-page border border-gray-800 rounded-lg p-3 whitespace-pre-wrap font-sans leading-relaxed">{preview.empty ? 'Nessuna scadenza oggi, domani o in ritardo: oggi non partirebbe nulla.' : renderWa(preview.text)}</pre>
        )}
        {sendResult && (() => { const m = msgFor(sendResult); return (
          <div className={'mt-3 text-xs p-3 rounded-lg border ' + (m.ok ? 'bg-green-900/20 text-green-400 border-green-900/40' : 'bg-amber-900/20 text-amber-400 border-amber-900/40')}>{m.text}</div>
        ) })()}
      </section>
      </>
      )}

      {features.whatsapp && <WhatsAppRecipientsPanel token={token} />}
    </div>
  )
}
