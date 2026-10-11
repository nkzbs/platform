import React, { useState, useEffect } from 'react'
import useApi from '../lib/useApi'
import Icon from './Icon'
import TelegramCard from './TelegramCard'

// Report su WhatsApp: tre messaggi, ognuno risponde a una sola domanda e non parte se non c'è niente da dire.
// Cosa conta come "da pagare" o "da smistare" lo dichiarano i moduli (Builder → Avvisi); qui si sceglie solo quando mandarli.
const GIORNI = [[1, 'lunedì'], [2, 'martedì'], [3, 'mercoledì'], [4, 'giovedì'], [5, 'venerdì'], [6, 'sabato'], [0, 'domenica']]
const ORE = Array.from({ length: 17 }, (_, i) => i + 6) // 6..22

// *testo* è il grassetto di WhatsApp: nell'anteprima lo si mostra come tale.
function renderWa(text) {
  return text.split(/(\*[^*\n]+\*)/g).map((part, i) => (/^\*[^*\n]+\*$/.test(part) ? <strong key={i} className="text-ink">{part.slice(1, -1)}</strong> : part))
}

const REPORT = {
  pagare: { titolo: 'Quanto devo pagare', icona: 'credit-card', vuoto: 'Niente da pagare in questo periodo.' },
  smistare: { titolo: 'Da smistare', icona: 'inbox', vuoto: 'Niente da smistare: la coda è vuota, il messaggio non partirebbe.' },
  scadute: { titolo: 'Voci scadute', icona: 'alert-triangle', vuoto: 'Nessuna voce scaduta: il messaggio non partirebbe.' },
}

export default function ReportsSettingsTab({ token, user, features = {} }) {
  const api = useApi(token)
  const [data, setData] = useState(null) // { settings, last_sent }
  const [busy, setBusy] = useState(null)
  const [preview, setPreview] = useState({}) // kind -> { text } | { empty }
  const [result, setResult] = useState({}) // kind -> { ok, text }
  const [legacy, setLegacy] = useState(null)
  const [legacyMsg, setLegacyMsg] = useState('')

  const load = async () => { const d = await api.get('/reports/settings'); if (d) setData(d); const l = await api.get('/reports/legacy'); if (l) setLegacy(l.automazioni || []) }
  useEffect(() => { if (features.riepilogo_mattino) load() }, [features.riepilogo_mattino]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (kind, patch) => {
    setBusy(kind + ':save')
    const res = await api.put('/reports/settings', { kind, ...patch })
    setBusy(null)
    if (res.ok) setData(res.data); else setResult((r) => ({ ...r, [kind]: { ok: false, text: (res.data && res.data.error) || 'Non salvato.' } }))
  }
  const show = async (kind) => {
    setBusy(kind + ':prev'); setResult((r) => ({ ...r, [kind]: null }))
    const d = await api.get('/reports/preview/' + kind)
    setBusy(null)
    setPreview((p) => ({ ...p, [kind]: d && d.text ? { text: d.text } : { empty: true } }))
  }
  const send = async (kind) => {
    setBusy(kind + ':send')
    const res = await api.post('/reports/send-now/' + kind, {})
    setBusy(null)
    const r = res.data || {}
    const msg = !res.ok ? { ok: false, text: r.error || 'Invio non riuscito.' }
      : r.esito === 'inviato' ? { ok: true, text: 'Inviato: controlla il telefono.' }
      : r.esito === 'nulla da segnalare' ? { ok: true, text: REPORT[kind].vuoto }
      : r.esito === 'non configurato' ? { ok: false, text: r.motivo }
      : { ok: false, text: (r.esito === 'parziale' ? 'Inviato solo ad alcuni destinatari. ' : 'NON inviato. ') + (r.dettaglio || '') }
    setResult((x) => ({ ...x, [kind]: msg })); load()
  }
  const pulisci = async () => {
    if (!window.confirm('Togliere dai moduli ' + legacy.length + (legacy.length === 1 ? ' automazione vecchia?' : ' automazioni vecchie?') + ' Resta la cronologia del modulo.')) return
    setBusy('legacy')
    const res = await api.post('/reports/legacy/remove', {})
    setBusy(null)
    setLegacyMsg(res.ok ? 'Fatto: tolte ' + res.data.rimosse + ' automazioni.' : (res.data && res.data.error) || 'Non riuscito.')
    load()
  }

  const sel = 'bg-surface-page text-ink px-2.5 py-1.5 rounded-lg text-sm outline-none border border-gray-800 focus:border-accent'
  const Switch = ({ on, onClick }) => (
    <button type="button" role="switch" aria-checked={on} onClick={onClick} disabled={!!busy}
      className={'w-10 h-[22px] rounded-full transition-colors relative flex-shrink-0 mt-1 disabled:opacity-60 ' + (on ? 'bg-accent' : 'bg-gray-700')}>
      <span className={'absolute top-[3px] left-0 w-4 h-4 rounded-full bg-white transition-transform ' + (on ? 'translate-x-[21px]' : 'translate-x-[3px]')} />
    </button>
  )
  const Ora = ({ kind }) => <select className={sel} value={data.settings[kind].hour} onChange={(e) => save(kind, { hour: parseInt(e.target.value, 10) })} disabled={!!busy}>{ORE.map((h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}</select>
  const Quando = {
    pagare: () => (
      <div className="flex items-center gap-2 flex-wrap text-sm text-gray-400">
        Ogni
        <select className={sel} value={data.settings.pagare.day} onChange={(e) => save('pagare', { day: parseInt(e.target.value, 10) })} disabled={!!busy}>{Array.from({ length: 27 }, (_, i) => i + 2).map((d) => <option key={d} value={d}>{d}</option>)}</select>
        del mese, alle <Ora kind="pagare" /> <span className="text-xs text-gray-600">(se cade di sabato o domenica, il venerdì prima)</span>
      </div>),
    smistare: () => <div className="flex items-center gap-2 flex-wrap text-sm text-gray-400">Ogni sera alle <Ora kind="smistare" /> <span className="text-xs text-gray-600">finché ci sono righe da smistare</span></div>,
    scadute: () => (
      <div className="flex items-center gap-2 flex-wrap text-sm text-gray-400">
        Ogni <select className={sel} value={data.settings.scadute.weekday} onChange={(e) => save('scadute', { weekday: parseInt(e.target.value, 10) })} disabled={!!busy}>{GIORNI.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        alle <Ora kind="scadute" /> <span className="text-xs text-gray-600">solo se ce ne sono</span>
      </div>),
  }
  const Descr = {
    pagare: 'Tutto ciò che è «da pagare» dal giorno del report al 26 del mese dopo, più le voci scadute: totale, divisione per modulo ed elenco per data.',
    smistare: 'Le bollette e le righe nuove che non hai ancora smistato. Il primo avviso arriva subito; poi questo promemoria, finché la coda non è vuota.',
    scadute: 'Le voci «da pagare» con la scadenza passata, con da quanti giorni. Se le hai già pagate, spuntale nella Checklist e non arrivano più.',
  }

  if (!features.riepilogo_mattino) return <div className="max-w-2xl text-sm text-gray-500">I report su WhatsApp non sono attivi per questo progetto.</div>
  if (!data) return <div className="max-w-2xl text-sm text-gray-500">Caricamento…</div>
  return (
    <div className="max-w-2xl space-y-4">
      <section className="bg-surface-card border border-gray-800 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-ink mb-1">Dove arrivano i report</h2>
        <p className="text-xs text-gray-500 mb-3">Telegram parte solo se il bot è collegato e c'è almeno un telefono collegato. Ogni telefono riceve la sua versione: solo ciò che vede nell'app.</p>
        <div className="flex items-center gap-6 flex-wrap">
          {[['whatsapp', 'WhatsApp'], ['telegram', 'Telegram']].map(([k, l]) => (
            <label key={k} className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
              <input type="checkbox" checked={data.settings.canali[k]} onChange={(e) => save('canali', { [k]: e.target.checked })} disabled={!!busy} /> {l}
            </label>
          ))}
        </div>
      </section>

      <TelegramCard token={token} user={user} />

      {Object.keys(REPORT).map((kind) => {
        const s = data.settings[kind], R = REPORT[kind]
        return (
          <section key={kind} className="bg-surface-card border border-gray-800 rounded-xl p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-surface-page border border-gray-800 flex items-center justify-center text-accent flex-shrink-0"><Icon name={R.icona} size={16} /></div>
                <div>
                  <h2 className="text-sm font-semibold text-ink">{R.titolo}</h2>
                  <p className="text-xs text-gray-500 mt-0.5 max-w-md">{Descr[kind]}</p>
                </div>
              </div>
              <Switch on={s.enabled} onClick={() => save(kind, { enabled: !s.enabled })} />
            </div>
            <div className="mt-4 pt-4 border-t border-gray-800 space-y-3">
              {Quando[kind]()}
              {kind === 'pagare' && (
                <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
                  <input type="checkbox" checked={s.stipendio} onChange={(e) => save('pagare', { stipendio: e.target.checked })} disabled={!!busy} />
                  Aggiungi «ultimo stipendio → ti restano»
                </label>
              )}
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={() => show(kind)} disabled={!!busy} className="text-xs bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-200 px-3 py-1.5 rounded-lg transition">Mostra anteprima</button>
                <button onClick={() => send(kind)} disabled={!!busy} className="text-xs bg-accent hover:opacity-90 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg transition font-medium">Invia ora</button>
                <span className="text-xs text-gray-600">{data.last_sent[kind] ? 'Ultimo invio: ' + new Date(String(data.last_sent[kind]).replace(' ', 'T') + 'Z').toLocaleString('it-IT') : 'Mai inviato'}</span>
              </div>
              {preview[kind] && <pre className="text-xs text-gray-300 bg-surface-page border border-gray-800 rounded-lg p-3 whitespace-pre-wrap font-sans leading-relaxed">{preview[kind].empty ? R.vuoto : renderWa(preview[kind].text)}</pre>}
              {result[kind] && <div className={'text-xs p-3 rounded-lg border ' + (result[kind].ok ? 'bg-green-900/20 text-green-400 border-green-900/40' : 'bg-amber-900/20 text-amber-400 border-amber-900/40')}>{result[kind].text}</div>}
            </div>
          </section>
        )
      })}

      <div className="text-xs text-gray-500 px-1">Li ricevono i destinatari con il tag <span className="font-mono text-gray-300">scadenza</span> in «Destinatari WhatsApp». Con i report accesi, gli avvisi «scadenza» per singola riga restano muti.</div>

      {legacy && legacy.length > 0 && (
        <section className="bg-surface-card border border-amber-900/40 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-ink mb-1">Vecchi report ancora nei moduli</h2>
          <p className="text-xs text-gray-500 mb-3">Queste automazioni mandano ancora i vecchi messaggi (report settimanale e mensile del giorno 1, «scadenza oggi» delle 08:00). Con i nuovi report non servono più.</p>
          <ul className="text-xs text-gray-300 space-y-1 mb-3">{legacy.map((a) => <li key={a.modulo + a.id}>• {a.nome} <span className="text-gray-600">— {a.nome_modulo}</span></li>)}</ul>
          <button onClick={pulisci} disabled={!!busy} className="text-xs bg-amber-600 hover:opacity-90 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg transition font-medium">Toglili dai moduli</button>
        </section>
      )}
      {legacyMsg && <div className="text-xs text-green-400 px-1">{legacyMsg}</div>}
    </div>
  )
}
