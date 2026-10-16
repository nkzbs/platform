import React, { useState, useEffect } from 'react'
import useApi from '../lib/useApi'
import Icon from './Icon'

// Report su WhatsApp e Telegram: ogni report è una DEFINIZIONE (un tipo + i suoi parametri). Se ne possono avere quanti se ne vogliono, anche dello stesso tipo.
// Cosa conta come «da fare» o «nuovo» lo dichiarano i moduli (Builder → Avvisi); qui si sceglie quale tipo di messaggio, cosa guarda e quando mandarlo.
const GIORNI = [[1, 'lunedì'], [2, 'martedì'], [3, 'mercoledì'], [4, 'giovedì'], [5, 'venerdì'], [6, 'sabato'], [0, 'domenica']]
const ORE = Array.from({ length: 17 }, (_, i) => i + 6) // 6..22
const STATI = [['nuovo', '«nuovo» (da smistare)'], ['da_fare', '«da fare» (da pagare)'], ['fatto', '«fatto» (pagato)']]
const PERIODI = [['oggi', 'Oggi'], ['settimana', 'Questa settimana'], ['settimana_scorsa', 'Settimana scorsa'], ['mese', 'Questo mese'], ['mese_scorso', 'Mese scorso']]
const FREQ = { mensile: 'Ogni mese', giornaliera: 'Ogni giorno', settimanale: 'Ogni settimana' }
const ICONA = { riepilogo_periodo: 'credit-card', coda: 'inbox', in_ritardo: 'alert-triangle', ore_periodo: 'clock', ore_settimana: 'clock' }

// *testo* è il grassetto di WhatsApp: nell'anteprima lo si mostra come tale.
function renderWa(text) {
  return text.split(/(\*[^*\n]+\*)/g).map((part, i) => (/^\*[^*\n]+\*$/.test(part) ? <strong key={i} className="text-ink">{part.slice(1, -1)}</strong> : part))
}

export default function ReportsSettingsTab({ token, user, features = {} }) {
  const api = useApi(token)
  const [data, setData] = useState(null) // { settings, last_sent, tipi }
  const [busy, setBusy] = useState(null)
  const [preview, setPreview] = useState({}) // id -> { text } | { empty }
  const [result, setResult] = useState({}) // id -> { ok, text }
  const [aperti, setAperti] = useState({}) // id -> mostra le impostazioni del messaggio
  const [nuovoTipo, setNuovoTipo] = useState('')
  const [telefoni, setTelefoni] = useState([]) // i telefoni Telegram collegati: { user_id, display_name, username }
  const [legacy, setLegacy] = useState(null)
  const [legacyMsg, setLegacyMsg] = useState('')

  const load = async () => { const d = await api.get('/reports/settings'); if (d) setData(d); const l = await api.get('/reports/legacy'); if (l) setLegacy(l.automazioni || []); const t = await api.get('/telegram/status'); if (t && Array.isArray(t.links)) setTelefoni(t.links) }
  useEffect(() => { if (features.riepilogo_mattino) load() }, [features.riepilogo_mattino]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (id, patch) => {
    setBusy(id + ':save')
    const res = await api.put('/reports/settings', { kind: id, ...patch })
    setBusy(null)
    if (res.ok) setData(res.data); else setResult((r) => ({ ...r, [id]: { ok: false, text: (res.data && res.data.error) || 'Non salvato.' } }))
  }
  const aggiungi = async () => {
    if (!nuovoTipo) return
    setBusy('add'); const res = await api.post('/reports/definitions', { tipo: nuovoTipo }); setBusy(null)
    if (res.ok) { setData(res.data); setNuovoTipo(''); setAperti((a) => ({ ...a, [res.data.id]: true })) }
  }
  const togli = async (d) => {
    if (!window.confirm('Togliere il report «' + d.nome + '»?')) return
    setBusy(d.id + ':del'); const res = await api.del('/reports/definitions/' + d.id); setBusy(null)
    if (res.ok) setData(res.data)
  }
  const show = async (id) => {
    setBusy(id + ':prev'); setResult((r) => ({ ...r, [id]: null }))
    const d = await api.get('/reports/preview/' + id)
    setBusy(null)
    setPreview((p) => ({ ...p, [id]: d && d.text ? { text: d.text } : { empty: true } }))
  }
  const send = async (d) => {
    setBusy(d.id + ':send')
    const res = await api.post('/reports/send-now/' + d.id, {})
    setBusy(null)
    const r = res.data || {}
    const msg = !res.ok ? { ok: false, text: r.error || 'Invio non riuscito.' }
      : r.esito === 'inviato' ? { ok: true, text: 'Inviato: controlla il telefono.' }
      : r.esito === 'nulla da segnalare' ? { ok: true, text: data.tipi[d.tipo].vuoto }
      : r.esito === 'non configurato' ? { ok: false, text: r.motivo }
      : { ok: false, text: (r.esito === 'parziale' ? 'Inviato solo ad alcuni destinatari. ' : 'NON inviato. ') + (r.dettaglio || '') }
    setResult((x) => ({ ...x, [d.id]: msg })); load()
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
  const txt = 'w-full bg-surface-page text-ink px-2.5 py-1.5 rounded-lg text-sm outline-none border border-gray-800 focus:border-accent'
  const Switch = ({ on, onClick }) => (
    <button type="button" role="switch" aria-checked={on} onClick={onClick} disabled={!!busy}
      className={'w-10 h-[22px] rounded-full transition-colors relative flex-shrink-0 mt-1 disabled:opacity-60 ' + (on ? 'bg-accent' : 'bg-gray-700')}>
      <span className={'absolute top-[3px] left-0 w-4 h-4 rounded-full bg-white transition-transform ' + (on ? 'translate-x-[21px]' : 'translate-x-[3px]')} />
    </button>
  )
  const Campo = ({ label, children }) => <label className="block"><span className="block text-[11px] text-gray-500 mb-1">{label}</span>{children}</label>

  // Quando parte: frequenza, giorno, ora — i controlli dipendono dalla frequenza scelta
  const Quando = ({ d, T }) => (
    <div className="flex items-center gap-2 flex-wrap text-sm text-gray-400">
      <select className={sel} value={d.freq} onChange={(e) => save(d.id, { freq: e.target.value })} disabled={!!busy || T.frequenze.length < 2}>
        {T.frequenze.map((f) => <option key={f} value={f}>{FREQ[f]}</option>)}
      </select>
      {d.freq === 'mensile' && <>
        il giorno <select className={sel} value={d.giorno} onChange={(e) => save(d.id, { giorno: parseInt(e.target.value, 10) })} disabled={!!busy}>{Array.from({ length: d.tipo === 'riepilogo_periodo' ? 27 : 28 }, (_, i) => i + (d.tipo === 'riepilogo_periodo' ? 2 : 1)).map((g) => <option key={g} value={g}>{g}</option>)}</select>
      </>}
      {d.freq === 'settimanale' && <>
        il <select className={sel} value={d.weekday} onChange={(e) => save(d.id, { weekday: parseInt(e.target.value, 10) })} disabled={!!busy}>{GIORNI.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      </>}
      alle <select className={sel} value={d.ora} onChange={(e) => save(d.id, { ora: parseInt(e.target.value, 10) })} disabled={!!busy}>{ORE.map((h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}</select>
      {d.freq === 'mensile' && 'weekend' in d && d.tipo === 'riepilogo_periodo' && <span className="text-xs text-gray-600">(se cade di sabato o domenica, il venerdì prima)</span>}
      {d.freq === 'giornaliera' && !d.invia_se_vuoto && <span className="text-xs text-gray-600">solo se c'è qualcosa</span>}
    </div>
  )

  // A chi arriva: su Telegram gli utenti scelti (nessuno = tutti i telefoni collegati), su WhatsApp i destinatari con il tag
  const utentiTelefono = [...new Map(telefoni.filter((l) => l.user_id).map((l) => [l.user_id, l])).values()]
  const Destinatari = ({ d }) => {
    const scelti = d.utenti || []
    const toggle = (id) => save(d.id, { utenti: scelti.includes(id) ? scelti.filter((x) => x !== id) : [...scelti, id] })
    return (
      <div className="space-y-2">
        <div className="text-[11px] text-gray-500">A chi arriva su Telegram</div>
        {utentiTelefono.length === 0 ? <div className="text-xs text-gray-600">Nessun telefono è collegato (Impostazioni → Connessioni → Telegram).</div> : (
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <label className="flex items-center gap-1.5 text-sm text-gray-300 cursor-pointer"><input type="checkbox" checked={scelti.length === 0} onChange={() => save(d.id, { utenti: [] })} disabled={!!busy} /> Tutti</label>
            {utentiTelefono.map((l) => (
              <label key={l.user_id} className="flex items-center gap-1.5 text-sm text-gray-300 cursor-pointer"><input type="checkbox" checked={scelti.includes(l.user_id)} onChange={() => toggle(l.user_id)} disabled={!!busy} /> {l.display_name || l.username}</label>
            ))}
          </div>
        )}
        <Campo label="Tag dei destinatari WhatsApp (Impostazioni → Connessioni → WhatsApp)">
          <input className={txt + ' max-w-[14rem]'} defaultValue={d.tag} key={d.id + 'tag' + d.tag} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== d.tag && save(d.id, { tag: e.target.value.trim() })} />
        </Campo>
      </div>
    )
  }

  if (!features.riepilogo_mattino) return <div className="max-w-2xl text-sm text-gray-500">I report non sono attivi per questo progetto.</div>
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

      <p className="text-xs text-gray-500">Per collegare il bot Telegram: <b className="text-gray-300">Impostazioni → Connessioni → Telegram</b>. Ogni report ha anche il suo comando nel bot (<span className="font-mono">/nome</span>) e <span className="font-mono">/report</span> li elenca.</p>

      {data.settings.definizioni.map((d) => {
        const T = data.tipi[d.tipo]
        const has = (k) => T.parametri.includes(k)
        return (
          <section key={d.id} className="bg-surface-card border border-gray-800 rounded-xl p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3 min-w-0">
                <div className="w-9 h-9 rounded-lg bg-surface-page border border-gray-800 flex items-center justify-center text-accent flex-shrink-0"><Icon name={ICONA[d.tipo] || 'bell'} size={16} /></div>
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-ink">{d.nome} <span className="font-mono text-[10px] text-gray-600 font-normal">/{d.id}</span></h2>
                  <p className="text-xs text-gray-500 mt-0.5 max-w-md">{T.descrizione}</p>
                </div>
              </div>
              <Switch on={d.enabled} onClick={() => save(d.id, { enabled: !d.enabled })} />
            </div>
            <div className="mt-4 pt-4 border-t border-gray-800 space-y-3">
              <Quando d={d} T={T} />
              {has('stipendio') && (
                <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
                  <input type="checkbox" checked={!!d.stipendio} onChange={(e) => save(d.id, { stipendio: e.target.checked })} disabled={!!busy} />
                  Aggiungi «ultimo stipendio → ti restano»
                </label>
              )}
              <Destinatari d={d} />
              <button type="button" onClick={() => setAperti((a) => ({ ...a, [d.id]: !a[d.id] }))} className="text-xs text-gray-400 hover:text-ink">{aperti[d.id] ? '▾' : '▸'} Cosa guarda e come appare</button>
              {aperti[d.id] && (
                <div className="grid sm:grid-cols-2 gap-3">
                  <Campo label="Nome del report"><input className={txt} defaultValue={d.nome} key={d.id + 'n' + d.nome} onBlur={(e) => e.target.value !== d.nome && save(d.id, { nome: e.target.value })} /></Campo>
                  <Campo label="Titolo nel messaggio"><input className={txt} defaultValue={d.titolo} key={d.id + 't' + d.titolo} onBlur={(e) => e.target.value !== d.titolo && save(d.id, { titolo: e.target.value })} /></Campo>
                  <Campo label="Simbolo"><input className={txt} defaultValue={d.emoji} maxLength={8} key={d.id + 'e' + d.emoji} onBlur={(e) => e.target.value !== d.emoji && save(d.id, { emoji: e.target.value })} /></Campo>
                  {has('stato') && <Campo label="Righe in stato"><select className={txt} value={d.stato} onChange={(e) => save(d.id, { stato: e.target.value })} disabled={!!busy}>{STATI.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Campo>}
                  {has('periodo') && <Campo label="Periodo"><select className={txt} value={d.periodo} onChange={(e) => save(d.id, { periodo: e.target.value })} disabled={!!busy}>{PERIODI.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Campo>}
                  {has('soglia_ore') && <Campo label="Straordinario: ore oltre … a settimana"><input type="number" min="1" max="100" className={txt} defaultValue={d.soglia_ore} key={d.id + 's' + d.soglia_ore} onBlur={(e) => parseInt(e.target.value, 10) !== d.soglia_ore && save(d.id, { soglia_ore: e.target.value })} /></Campo>}
                  {has('mese') && <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer"><input type="checkbox" checked={!!d.mese} onChange={(e) => save(d.id, { mese: e.target.checked })} disabled={!!busy} /> Aggiungi il recap del mese</label>}
                  {has('max_righe') && <Campo label="Righe mostrate (massimo)"><input type="number" min="1" max="30" className={txt} defaultValue={d.max_righe} key={d.id + 'm' + d.max_righe} onBlur={(e) => parseInt(e.target.value, 10) !== d.max_righe && save(d.id, { max_righe: e.target.value })} /></Campo>}
                  {has('scadute_max_giorni') && <Campo label="Una voce scaduta da oltre … giorni non conta"><input type="number" min="1" max="365" className={txt} defaultValue={d.scadute_max_giorni} key={d.id + 'g' + d.scadute_max_giorni} onBlur={(e) => parseInt(e.target.value, 10) !== d.scadute_max_giorni && save(d.id, { scadute_max_giorni: e.target.value })} /></Campo>}
                  {has('piede') && <div className="sm:col-span-2"><Campo label="Frase in fondo (facoltativa)"><input className={txt} defaultValue={d.piede || ''} key={d.id + 'p' + d.piede} onBlur={(e) => e.target.value !== (d.piede || '') && save(d.id, { piede: e.target.value })} /></Campo></div>}
                  {has('include_scadute') && <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer sm:col-span-2"><input type="checkbox" checked={!!d.include_scadute} onChange={(e) => save(d.id, { include_scadute: e.target.checked })} disabled={!!busy} /> Includi anche le voci già scadute</label>}
                  <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer sm:col-span-2"><input type="checkbox" checked={!!d.invia_se_vuoto} onChange={(e) => save(d.id, { invia_se_vuoto: e.target.checked })} disabled={!!busy} /> Manda il messaggio anche se non c'è niente da segnalare</label>
                </div>
              )}
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={() => show(d.id)} disabled={!!busy} className="text-xs bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-200 px-3 py-1.5 rounded-lg transition">Mostra anteprima</button>
                <button onClick={() => send(d)} disabled={!!busy} className="text-xs bg-accent hover:opacity-90 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg transition font-medium">Invia ora</button>
                <button onClick={() => togli(d)} disabled={!!busy} className="text-xs text-gray-500 hover:text-red-400 px-2 py-1.5">Togli</button>
                <span className="text-xs text-gray-600">{data.last_sent[d.id] ? 'Ultimo invio: ' + new Date(String(data.last_sent[d.id]).replace(' ', 'T') + 'Z').toLocaleString('it-IT') : 'Mai inviato'}</span>
              </div>
              {preview[d.id] && <pre className="text-xs text-gray-300 bg-surface-page border border-gray-800 rounded-lg p-3 whitespace-pre-wrap font-sans leading-relaxed">{preview[d.id].empty ? T.vuoto : renderWa(preview[d.id].text)}</pre>}
              {result[d.id] && <div className={'text-xs p-3 rounded-lg border ' + (result[d.id].ok ? 'bg-green-900/20 text-green-400 border-green-900/40' : 'bg-amber-900/20 text-amber-400 border-amber-900/40')}>{result[d.id].text}</div>}
            </div>
          </section>
        )
      })}

      <section className="bg-surface-card border border-dashed border-gray-800 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-ink mb-1">Aggiungi un report</h2>
        <p className="text-xs text-gray-500 mb-3">Scegli di che tipo è: nasce spento, lo configuri e lo accendi.</p>
        <div className="flex items-center gap-2 flex-wrap">
          <select className={sel + ' min-w-0 flex-1'} value={nuovoTipo} onChange={(e) => setNuovoTipo(e.target.value)}>
            <option value="">Scegli il tipo…</option>
            {Object.entries(data.tipi).map(([k, t]) => <option key={k} value={k}>{t.nome}</option>)}
          </select>
          <button onClick={aggiungi} disabled={!nuovoTipo || !!busy} className="text-xs bg-accent hover:opacity-90 disabled:opacity-50 text-white px-3 py-2 rounded-lg font-medium">Aggiungi</button>
        </div>
        {nuovoTipo && <p className="text-xs text-gray-500 mt-2">{data.tipi[nuovoTipo].descrizione}</p>}
      </section>

      <div className="text-xs text-gray-500 px-1">Su WhatsApp li ricevono i destinatari con il tag del report (di solito <span className="font-mono text-gray-300">scadenza</span>) in «Destinatari WhatsApp». Con i report accesi, gli avvisi «scadenza» per singola riga restano muti.</div>

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
