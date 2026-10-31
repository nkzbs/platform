import React, { useState, useEffect } from 'react'
import useApi from '../lib/useApi'
import Icon from './Icon'

// Impostazioni → AI: un posto solo per accendere l'AI. Interruttore generale, chiave Mistral, spesa del mese e, per ogni modulo che ha dichiarato
// a cosa serve, i potenziamenti. «Accendi e potenzia» accende tutto quello che i ruoli dei moduli permettono. L'AI propone o racconta, non scrive da sola.
const SOON = {}
const EFFETTI = [
  ['Smista già compilato', 'Aprendo «Smista» su una bolletta, l\'AI ha già letto il PDF e propone categoria, importo e scadenza: confermi con un clic.'],
  ['Spiega con l\'AI', 'Su «Come sta andando» e sui report dei moduli compare il pulsante che racconta i numeri.'],
  ['Mail da leggere', 'Le bollette in arrivo dai mittenti con una regola hanno già la loro proposta pronta.'],
  ['Importa da PDF', 'Nel modulo compare «Importa da PDF»: carichi una bolletta e l\'AI propone la riga.'],
  ['Chiedi ai dati', 'In alto compare «Chiedi ai dati»: fai una domanda sui tuoi numeri e ricevi la risposta, con il filtro usato.'],
]

export default function AiSettingsPage({ token, onChanged }) {
  const api = useApi(token)
  const [st, setSt] = useState(null)
  const [busy, setBusy] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const [msg, setMsg] = useState(null) // { ok, text }
  const [fatto, setFatto] = useState(null) // risultato di «Accendi e potenzia»

  const load = async () => { const d = await api.get('/ai/settings'); if (d) setSt(d) }
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const powerUp = async () => {
    setBusy(true); setMsg(null)
    const res = await api.post('/ai/power-up', {})
    setBusy(false)
    if (res.ok) { setFatto(res.data.attivati || []); await load(); if (onChanged) onChanged() } else setMsg({ ok: false, text: (res.data && res.data.error) || 'Non sono riuscito ad accendere l\'AI.' })
  }
  const spegni = async () => {
    if (!window.confirm('Spegnere l\'AI? Nessun potenziamento lavora finché non la riaccendi. Le impostazioni dei moduli restano.')) return
    setBusy(true); await api.put('/ai/settings', { enabled: false }); setBusy(false); setFatto(null); load(); if (onChanged) onChanged()
  }
  const toggleFeature = async (m, key) => {
    const on = m.features.filter((f) => f.enabled).map((f) => f.key)
    const next = on.includes(key) ? on.filter((k) => k !== key) : [...on, key]
    await api.put('/module-ai/' + m.slug, { features: next }); load()
  }
  const saveKey = async () => {
    setBusy(true); setMsg(null)
    const res = await api.put('/ai/key', { key: keyInput })
    setBusy(false)
    if (res.ok) { setKeyInput(''); setMsg({ ok: true, text: 'Chiave salvata.' }); load() } else setMsg({ ok: false, text: (res.data && res.data.error) || 'Non sono riuscito a salvare la chiave.' })
  }
  const removeKey = async () => {
    if (!window.confirm('Togliere la chiave? L\'AI smette di funzionare finché non ne inserisci un\'altra.')) return
    setBusy(true); const res = await api.del('/ai/key'); setBusy(false)
    setMsg(res.ok ? { ok: true, text: 'Chiave tolta.' } : { ok: false, text: 'Non sono riuscito a togliere la chiave.' }); load()
  }

  if (!st) return <div className="text-sm text-gray-600">Caricamento…</div>
  const b = st.budget, pct = b ? Math.min(100, b.percent) : 0
  const keyOk = !!(st.key && st.key.configured)

  return (
    <div className="max-w-2xl space-y-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-600">Attivazione</div>
      <section className={st.enabled ? 'rounded-xl border p-5 bg-accent/5 border-accent/30' : 'glass-panel p-5'}>
        <div className="flex items-start gap-3">
          <div className={'w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ' + (st.enabled ? 'bg-accent text-white' : 'bg-surface-page border border-gray-800 text-accent')}><Icon name="wand" size={18} /></div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-ink">{st.enabled ? 'AI accesa' : 'AI spenta'}</h2>
            <p className="text-xs text-gray-500 mt-0.5">{st.enabled ? 'I moduli potenziati lavorano. L\'AI propone o racconta; sei sempre tu a confermare.' : 'Accendila per potenziare i tuoi moduli: smistare le bollette già compilate, spiegare i numeri e altro.'}</p>
          </div>
          {st.enabled
            ? <button type="button" onClick={spegni} disabled={busy} className="text-xs text-gray-500 hover:text-red-400 px-2 py-1">Spegni</button>
            : <button type="button" onClick={powerUp} disabled={busy || !keyOk} className="bg-accent hover:opacity-90 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium flex-shrink-0">{busy ? 'Un momento…' : 'Accendi e potenzia'}</button>}
        </div>
        {!st.enabled && !keyOk && <div className="mt-3 text-xs text-amber-400">Prima inserisci la chiave Mistral qui sotto.</div>}
        {st.enabled && !keyOk && <div className="mt-3 text-xs text-amber-400">Manca la chiave Mistral: senza, i potenziamenti non possono rispondere.</div>}
        {st.enabled && <div className="mt-3"><button type="button" onClick={powerUp} disabled={busy} className="text-xs text-accent hover:underline">Potenzia tutti i moduli che si possono</button></div>}
        {msg && !fatto && <div className={'mt-3 text-xs ' + (msg.ok ? 'text-green-400' : 'text-amber-400')}>{msg.text}</div>}
      </section>

      {fatto && (
        <section className="bg-surface-card border border-green-900/40 rounded-xl p-5">
          <div className="text-sm font-semibold text-green-400 mb-1">Potenziato</div>
          {fatto.length === 0
            ? <div className="text-xs text-gray-400">Nessun modulo da potenziare: o lo sono già tutti, o nessun modulo ha ancora dichiarato i suoi ruoli (Builder → Ruoli del modulo).</div>
            : <ul className="text-xs text-gray-300 space-y-0.5 mb-3">{fatto.map((m) => <li key={m.slug}><span className="text-ink font-medium">{m.name}</span>: {m.attivati.map((k) => (k === 'triage' ? 'Smistare' : k === 'explain' ? 'Spiegare' : k === 'import' ? 'Importare' : k)).join(', ')}</li>)}</ul>}
          <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-1.5">Cosa vedrai adesso</div>
          <div className="space-y-1.5">{EFFETTI.map(([t, d]) => <div key={t} className="text-xs"><span className="text-ink font-medium">{t}.</span> <span className="text-gray-400">{d}</span></div>)}</div>
        </section>
      )}

      <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-600 pt-1">Chiave e spesa</div>
      <section className="glass-panel p-5">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-surface-page border border-gray-800 flex items-center justify-center text-accent flex-shrink-0"><Icon name="key" size={16} /></div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-ink">Chiave Mistral</h2>
            <p className="text-xs text-gray-500 mt-0.5 max-w-md">Ogni progetto ha la sua chiave e il suo tetto di spesa. La trovi nel tuo account Mistral, in «API keys».</p>
            <div className="mt-3 text-xs">
              {st.key && st.key.source === 'tenant' && <div className="text-green-400">Chiave di questo progetto salvata ({st.key.hint})</div>}
              {st.key && st.key.source === 'generale' && <div className="text-gray-400">Usa la chiave generale di Super Admin. Inserisci qui la tua per separare la spesa di questo progetto.</div>}
              {!keyOk && <div className="text-amber-400">Nessuna chiave: l'AI non funziona finché non ne inserisci una.</div>}
            </div>
            <div className="flex gap-2 mt-3 flex-wrap">
              <input type="password" autoComplete="off" spellCheck="false" value={keyInput} onChange={(e) => setKeyInput(e.target.value)} placeholder="Incolla la chiave Mistral" className="flex-1 min-w-[220px] bg-surface-page text-ink px-3 py-2 rounded-lg outline-none border border-gray-800 focus:border-accent text-sm placeholder-gray-600" />
              <button type="button" onClick={saveKey} disabled={busy || !keyInput.trim()} className="bg-accent hover:opacity-90 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium">Salva</button>
              {st.key && st.key.source === 'tenant' && <button type="button" onClick={removeKey} disabled={busy} className="px-4 py-2 rounded-lg text-sm bg-surface-page hover:bg-gray-800 text-gray-300 border border-gray-800">Togli</button>}
            </div>
            {msg && fatto && <div className={'mt-2 text-xs ' + (msg.ok ? 'text-green-400' : 'text-amber-400')}>{msg.text}</div>}
            <div className="text-xs text-gray-600 mt-3">La chiave è controllata con Mistral e conservata cifrata da Super Admin. Non viene mostrata di nuovo.</div>
          </div>
        </div>
      </section>

      <section className="glass-panel p-5">
        <h2 className="text-sm font-semibold text-ink mb-1">Spesa del mese</h2>
        {b ? (
          <>
            <div className="h-2 rounded-full bg-gray-800 overflow-hidden"><div className={'h-full rounded-full ' + (pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-accent')} style={{ width: pct + '%' }} /></div>
            <div className="text-xs text-gray-400 mt-1.5">{Number(b.spent_eur).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })} su {Number(b.budget_eur).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })} di tetto mensile{pct >= 100 ? ' — raggiunto: le richieste riprendono il mese prossimo' : ''}.</div>
          </>
        ) : <div className="text-xs text-gray-500">Il consumo non è disponibile in questo momento.</div>}
      </section>

      <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-600 pt-1">Per modulo</div>
      <section className="glass-panel p-5">
        <h2 className="text-sm font-semibold text-ink mb-1">Potenziamenti per modulo</h2>
        <p className="text-xs text-gray-500 mb-3">Ogni modulo accende quelli che vuole. Servono i ruoli dichiarati nel Builder (Ruoli del modulo).</p>
        {st.modules.length === 0 && <div className="text-xs text-gray-500">Nessun modulo ha ancora dichiarato i suoi ruoli.</div>}
        <div className="divide-y divide-gray-800">
          {st.modules.map((m) => (
            <div key={m.slug} className="py-2.5">
              <div className="text-sm text-ink font-medium mb-1">{m.name}</div>
              <div className="flex flex-wrap gap-x-5 gap-y-1">
                {m.features.map((f) => (
                  <label key={f.key} className={'flex items-center gap-1.5 text-xs ' + (SOON[f.key] ? 'text-gray-600' : f.missing_roles.length ? 'text-gray-500' : 'text-gray-300 cursor-pointer')} title={f.missing_roles.length ? 'Mancano i ruoli: ' + f.missing_roles.join(', ') : ''}>
                    <input type="checkbox" checked={f.enabled} disabled={!!SOON[f.key] || (f.missing_roles.length > 0 && !f.enabled)} onChange={() => toggleFeature(m, f.key)} />
                    {f.label}{SOON[f.key] ? ' · ' + SOON[f.key].toLowerCase() : f.missing_roles.length && !f.enabled ? ' · mancano ruoli' : ''}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
