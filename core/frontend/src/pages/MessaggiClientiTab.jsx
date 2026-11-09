import React, { useState, useEffect } from 'react'
import useApi from '../lib/useApi'

// Impostazioni → Messaggi ai clienti: mittente degli SMS (alias approvato nella console di OpenAPI.it), tetto di messaggi al giorno, riga di disiscrizione delle mail, auguri di compleanno automatici
// (spenti finché non li accendi: testo, canali), e il registro di ciò che è partito. Il consenso alle comunicazioni commerciali si controlla sempre, cliente per cliente.
const STATI = { inviato: 'inviato', fallito: 'non riuscito', saltato: 'saltato', fermato: 'fermato dal tetto' }
export default function MessaggiClientiTab({ token, onVai }) {
  const api = useApi(token)
  const [d, setD] = useState(null)
  const [registro, setRegistro] = useState([])
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [bozza, setBozza] = useState(null)
  const carica = async () => {
    const x = await api.get('/messaggi/impostazioni'); if (x && !x.error) { setD(x); setBozza({ sms_mittente: x.sms_mittente || '', tetto_giornaliero: x.tetto_giornaliero, footer_mail: x.footer_mail || '', auguri: { ...x.auguri } }) }
    const r = await api.get('/messaggi/registro?limite=30'); if (Array.isArray(r)) setRegistro(r)
  }
  useEffect(() => { carica() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  if (!d || !bozza) return <div className="text-sm text-gray-500">Caricamento…</div>
  const salva = async () => {
    setErr(''); setMsg('')
    const r = await api.put('/messaggi/impostazioni', bozza)
    if (!r.ok) { setErr((r.data && r.data.error) || 'Non salvato.'); return }
    setMsg('Salvato.'); setTimeout(() => setMsg(''), 2500); carica()
  }
  const eseguiOra = async () => {
    setErr(''); setMsg('')
    const r = await api.post('/messaggi/auguri/esegui-ora', {})
    if (!r.ok) { setErr((r.data && r.data.error) || 'Non riuscito.'); return }
    const f = (r.data && r.data.fatto) || []
    setMsg(r.data && r.data.saltato ? 'Auguri non attivi: attivali e salva.' : f.length ? f.map((x) => x.compleanni + ' compleanni oggi: ' + x.inviati + ' messaggi inviati').join(' · ') : 'Nessun compleanno oggi.')
    carica()
  }
  const set = (k, v) => setBozza((b) => ({ ...b, [k]: v }))
  const setA = (k, v) => setBozza((b) => ({ ...b, auguri: { ...b.auguri, [k]: v } }))
  const canale = (c) => bozza.auguri.canali.includes(c)
  const togliMetti = (c) => setA('canali', canale(c) ? bozza.auguri.canali.filter((x) => x !== c) : [...bozza.auguri.canali, c])
  const inp = 'w-full bg-surface-page text-ink px-3 py-2 rounded-lg outline-none border border-gray-800 focus:border-accent transition text-sm'
  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-base font-semibold text-ink">Messaggi ai clienti</h2>
        <p className="text-sm text-gray-500 mt-1">Auguri di compleanno e invio di massa, per mail e per SMS. Partono <b>solo</b> a chi ha dato il consenso alle comunicazioni commerciali; ogni messaggio finisce nel registro qui sotto.</p>
      </div>
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-ink">1. Canali: cosa può partire adesso</h3>
        <div className="grid sm:grid-cols-2 gap-3 text-sm">
          <div className="rounded-lg border border-gray-800 p-3"><div className="font-semibold text-ink">Mail</div><div className={d.canali.mail.ok ? 'text-emerald-400' : 'text-amber-400'}>{d.canali.mail.ok ? 'Pronta' + (d.canali.mail.via ? ' · ' + (d.canali.mail.via === 'smtp' ? 'SMTP' : 'Resend') : '') : d.canali.mail.motivo}</div>
            {onVai && <button type="button" onClick={() => onVai('connessioni')} className="mt-1.5 text-xs text-accent hover:underline">{d.canali.mail.ok ? 'Cambia la posta in uscita →' : 'Imposta la posta in uscita (SMTP) →'}</button>}</div>
          <div className="rounded-lg border border-gray-800 p-3"><div className="font-semibold text-ink">SMS (OpenAPI.it)</div><div className={d.canali.sms.ok ? 'text-emerald-400' : 'text-amber-400'}>{d.canali.sms.ok ? 'Pronto' : d.canali.sms.motivo}</div>
            {onVai && <button type="button" onClick={() => onVai('connessioni')} className="mt-1.5 text-xs text-accent hover:underline">Collegamento OpenAPI.it →</button>}</div>
        </div>
      </section>
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-ink">2. Regole di invio</h3>
        <label className="block"><span className="text-xs text-gray-400">Mittente degli SMS (3-11 caratteri, già registrato e approvato nella console di OpenAPI.it)</span><input className={inp} value={bozza.sms_mittente} maxLength={11} onChange={(e) => set('sms_mittente', e.target.value)} placeholder="es. NOMESTUDIO" /></label>
        <label className="block"><span className="text-xs text-gray-400">Messaggi al giorno, al massimo (oggi inviati: {d.inviati_oggi})</span><input type="number" min="1" max="5000" className={inp} value={bozza.tetto_giornaliero} onChange={(e) => set('tetto_giornaliero', e.target.value)} /></label>
        <label className="block"><span className="text-xs text-gray-400">Riga in fondo a ogni mail (per non ricevere più messaggi)</span><input className={inp} value={bozza.footer_mail} onChange={(e) => set('footer_mail', e.target.value)} /></label>
      </section>
      <section className="space-y-2">
      <h3 className="text-sm font-semibold text-ink">3. Auguri di compleanno</h3>
      <div className="rounded-lg border border-gray-800 p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div><div className="font-semibold text-ink text-sm">Auguri di compleanno automatici</div><div className="text-xs text-gray-500">Ogni giorno dalle 09:00, a chi compie gli anni e ha il consenso. Una volta sola all'anno per cliente.</div></div>
          <button type="button" onClick={() => setA('attivi', !bozza.auguri.attivi)} aria-pressed={bozza.auguri.attivi} className={'text-xs px-3 py-1.5 rounded-full border transition ' + (bozza.auguri.attivi ? 'bg-accent/20 border-accent/50 text-accent' : 'border-gray-700 text-gray-400')}>{bozza.auguri.attivi ? 'Attivi' : 'Spenti'}</button>
        </div>
        <div className="flex gap-2 text-xs">{[['mail', 'Mail'], ['sms', 'SMS']].map(([c, l]) => <button key={c} type="button" onClick={() => togliMetti(c)} aria-pressed={canale(c)} className={'px-3 py-1.5 rounded-lg border transition ' + (canale(c) ? 'bg-accent/20 border-accent/50 text-accent' : 'border-gray-700 text-gray-500')}>{l}</button>)}</div>
        <label className="block"><span className="text-xs text-gray-400">Oggetto della mail</span><input className={inp} value={bozza.auguri.oggetto} onChange={(e) => setA('oggetto', e.target.value)} /></label>
        <label className="block"><span className="text-xs text-gray-400">Testo (mail e SMS). Puoi usare {'{nome}'} e {'{cognome}'}. Per gli SMS tienilo sotto i 160 caratteri: ogni 160 costa un SMS.</span><textarea rows={3} className={inp} value={bozza.auguri.testo} onChange={(e) => setA('testo', e.target.value)} /></label>
        <div className="text-xs text-gray-500">{bozza.auguri.testo.length} caratteri{bozza.auguri.testo.length > 160 ? ' · più di un SMS' : ''}</div>
      </div>
      </section>
      <div className="flex items-center gap-3 flex-wrap">
        <button type="button" onClick={salva} className="bg-accent hover:opacity-90 text-white px-4 py-2 rounded-lg text-sm font-medium transition">Salva</button>
        <button type="button" onClick={eseguiOra} className="border border-gray-700 hover:border-accent text-accent px-4 py-2 rounded-lg text-sm transition">Esegui ora gli auguri di oggi</button>
        {msg && <span className="text-sm text-emerald-400">{msg}</span>}{err && <span className="text-sm text-red-400">{err}</span>}
      </div>
      <div>
        <h3 className="text-sm font-semibold text-ink mb-2">4. Registro (ultimi 30)</h3>
        {registro.length === 0 && <div className="text-sm text-gray-500">Ancora niente.</div>}
        <div className="divide-y divide-gray-800 text-xs">
          {registro.map((r) => (
            <div key={r.id} className="py-1.5 flex gap-3 flex-wrap"><span className="text-gray-500 w-32">{String(r.quando).slice(0, 16)}</span><span className="w-16">{r.tipo}</span><span className="w-10">{r.canale}</span>
              <span className={r.esito === 'inviato' ? 'text-emerald-400' : r.esito === 'fallito' ? 'text-red-400' : 'text-amber-400'}>{STATI[r.esito] || r.esito}</span><span className="text-gray-500 flex-1 min-w-0 truncate">{r.motivo || ''}</span></div>
          ))}
        </div>
      </div>
    </div>
  )
}
