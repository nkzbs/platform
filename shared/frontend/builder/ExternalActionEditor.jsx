import React, { useState, useEffect } from 'react'

// Editor del blocco `external_action`: un pulsante sul record che chiama un servizio esterno tramite un adattatore (elenco chiuso, lo dà il server).
// Le proprietà comuni hanno il loro campo; ciò che dipende dall'adattatore (campi da mandare, dove scrivere l'esito, dati del cliente, firmatari…) è un
// oggetto «Collegamenti» in JSON, controllato prima di salvarlo. Nessun nome di modulo: vale per qualunque adattatore.
const COMUNI = ['id', 'block_type', 'key', 'label', 'icon', 'descrizione', 'adapter', 'connection', 'servizio_richiesto', 'come_attivare', 'risultato_in', 'tipologie', 'tipologia_predefinita', '_keyManuallyEdited']
const inp = 'w-full bg-surface-page text-ink px-3 py-2 rounded-lg text-sm outline-none border border-gray-700 focus:border-violet-500 transition placeholder-gray-600'
const lab = 'text-xs text-gray-400 block mb-1'

export default function ExternalActionEditor({ step, idx, updateStep, api, campiModulo }) {
  const [adattatori, setAdattatori] = useState(null)
  useEffect(() => { let vivo = true; api.get('/builder/azioni-esterne').then((r) => { if (vivo && r && r.adattatori) setAdattatori(r.adattatori) }); return () => { vivo = false } }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const altre = Object.fromEntries(Object.entries(step).filter(([k]) => !COMUNI.includes(k)))
  const [testo, setTesto] = useState(JSON.stringify(altre, null, 2))
  const [errore, setErrore] = useState('')
  const [tipTesto, setTipTesto] = useState(JSON.stringify(step.tipologie || {}, null, 2))
  const [tipErrore, setTipErrore] = useState('')
  const corrente = (adattatori || []).find((a) => a.nome === step.adapter)

  const salvaCollegamenti = () => {
    let ob
    try { ob = JSON.parse(testo || '{}') } catch (e) { setErrore('Non è un JSON valido: ' + e.message); return }
    if (!ob || typeof ob !== 'object' || Array.isArray(ob)) { setErrore('Deve essere un oggetto { ... }.'); return }
    const chiaveComune = Object.keys(ob).find((k) => COMUNI.includes(k))
    if (chiaveComune) { setErrore('«' + chiaveComune + '» ha il suo campo sopra: toglilo da qui.'); return }
    setErrore('')
    for (const k of Object.keys(altre)) if (!(k in ob)) updateStep(idx, k, undefined)
    for (const [k, v] of Object.entries(ob)) updateStep(idx, k, v)
  }
  const salvaTipologie = () => {
    let ob
    try { ob = JSON.parse(tipTesto || '{}') } catch (e) { setTipErrore('Non è un JSON valido: ' + e.message); return }
    if (!ob || typeof ob !== 'object' || Array.isArray(ob)) { setTipErrore('Deve essere un oggetto { "etichetta": codice }.'); return }
    setTipErrore(''); updateStep(idx, 'tipologie', Object.keys(ob).length ? ob : undefined)
  }

  return (
    <div className="space-y-3">
      <div>
        <label className={lab}>Nome del pulsante</label>
        <input value={step.label || ''} onChange={(e) => updateStep(idx, 'label', e.target.value)} placeholder="es. Valutazione di mercato" className={inp} />
      </div>
      <div>
        <label className={lab}>Che cosa fa (una riga, compare sotto il pulsante)</label>
        <input value={step.descrizione || ''} onChange={(e) => updateStep(idx, 'descrizione', e.target.value)} className={inp} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={lab}>Adattatore</label>
          <select value={step.adapter || ''} onChange={(e) => updateStep(idx, 'adapter', e.target.value)} className={inp}>
            <option value="">Scegli…</option>
            {(adattatori || [{ nome: step.adapter }]).filter((a) => a.nome).map((a) => <option key={a.nome} value={a.nome}>{a.nome}</option>)}
          </select>
        </div>
        <div>
          <label className={lab}>Connessione richiesta (id)</label>
          <input value={step.connection || ''} onChange={(e) => updateStep(idx, 'connection', e.target.value)} placeholder="es. openapi_it" className={inp + ' font-mono text-xs'} />
        </div>
      </div>
      {corrente && <div className="text-[11px] text-gray-500 leading-snug">{corrente.servizio ? 'Consuma un servizio a pagamento («' + corrente.servizio + '»): prima di partire si chiede conferma del costo. ' : 'Non ha costi propri. '}{corrente.pdf ? 'Può produrre un PDF dell\'esito.' : ''}</div>}
      <div>
        <label className={lab}>Dove resta il risultato completo sul record</label>
        <select value={step.risultato_in || ''} onChange={(e) => updateStep(idx, 'risultato_in', e.target.value || undefined)} className={inp}>
          <option value="">Nessuno (si scrivono solo i campi dell'esito)</option>
          {(campiModulo || []).map((f) => <option key={f.key} value={f.key}>{f.label || f.key}</option>)}
          {step.risultato_in && !(campiModulo || []).some((f) => f.key === step.risultato_in) && <option value={step.risultato_in}>{step.risultato_in} (chiave non dichiarata come campo)</option>}
        </select>
        <div className="text-[10px] text-gray-600 mt-1">Serve a riaprire l'esito e a farne il PDF senza richiamare il servizio.</div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={lab}>Servizio richiesto (a parole)</label>
          <input value={step.servizio_richiesto || ''} onChange={(e) => updateStep(idx, 'servizio_richiesto', e.target.value)} placeholder="es. il servizio Catasto di OpenAPI.it" className={inp} />
        </div>
        <div>
          <label className={lab}>Come si attiva</label>
          <input value={step.come_attivare || ''} onChange={(e) => updateStep(idx, 'come_attivare', e.target.value)} placeholder="cosa fare se il servizio non è attivo" className={inp} />
        </div>
      </div>
      <div className="text-[10px] text-gray-600 -mt-1">Se il servizio non è attivo, il pulsante compare tra «Altre funzioni» con questa spiegazione.</div>
      <div>
        <label className={lab}>Tipologie (etichetta del modulo → codice del servizio), solo per chi le usa</label>
        <textarea value={tipTesto} onChange={(e) => setTipTesto(e.target.value)} onBlur={salvaTipologie} rows={3} spellCheck={false} className={inp + ' font-mono text-xs'} />
        {tipErrore && <div className="text-[11px] text-amber-400 mt-1">{tipErrore}</div>}
        {step.tipologie && <div className="mt-1">
          <label className={lab}>Codice di riserva se la tipologia non è tra queste</label>
          <input value={step.tipologia_predefinita ?? ''} onChange={(e) => updateStep(idx, 'tipologia_predefinita', e.target.value === '' ? undefined : (isNaN(Number(e.target.value)) ? e.target.value : Number(e.target.value)))} className={inp + ' w-40'} />
        </div>}
      </div>
      <div>
        <label className={lab}>Collegamenti dell'adattatore (JSON): campi da mandare, dove scrivere l'esito, dati del cliente…</label>
        <textarea value={testo} onChange={(e) => setTesto(e.target.value)} onBlur={salvaCollegamenti} rows={8} spellCheck={false} className={inp + ' font-mono text-xs'} />
        {errore ? <div className="text-[11px] text-amber-400 mt-1">{errore}</div> : <div className="text-[10px] text-gray-600 mt-1">Si salva quando esci dal riquadro. I nomi dei campi sono le chiavi di questo modulo.</div>}
      </div>
    </div>
  )
}
