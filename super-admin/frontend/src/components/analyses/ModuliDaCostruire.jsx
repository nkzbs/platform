import React, { useState, useEffect, useRef } from 'react'

// «Moduli da costruire»: ciò che la Libreria non ha. L'AI propone quali moduli servono e ne scrive le bozze (campi, stati, requisiti, automazioni, documenti), il codice le controlla
// con lo stesso controllo di «Controlla il tenant»; qui si vedono, si approvano o si scartano. Solo le bozze approvate si installano quando si crea il tenant.
// req(method, path, body) → { ok, data }
export default function ModuliDaCostruire({ analysisId, req, btn, ghost, card, bloccato }) {
  const [st, setSt] = useState(null) // { piano, generati, generazione, in_corso }
  const [msg, setMsg] = useState('')
  const timer = useRef(null)
  const carica = async () => { const r = await req('GET', '/' + analysisId + '/moduli'); if (r.ok) { setSt(r.data); if (!r.data.in_corso) clearInterval(timer.current) } }
  useEffect(() => { carica(); return () => clearInterval(timer.current) }, [analysisId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (st && st.in_corso && !timer.current) timer.current = setInterval(carica, 2500); if (st && !st.in_corso && timer.current) { clearInterval(timer.current); timer.current = null } }, [st && st.in_corso]) // eslint-disable-line react-hooks/exhaustive-deps
  const genera = async () => {
    if (st && st.generati.length && !window.confirm('Rigenerare scarta le bozze di ora e le riscrive da capo. Continuare?')) return
    setMsg(''); const r = await req('POST', '/' + analysisId + '/moduli/genera', {})
    if (!r.ok) { setMsg((r.data && r.data.error) || 'Non avviata.'); return }
    setSt((x) => ({ ...(x || { piano: [], generati: [] }), in_corso: true, generazione: { fase: 'piano', fatti: 0, totale: 0 } })); timer.current = timer.current || setInterval(carica, 2500)
  }
  const approva = async (slug, approvato) => { await req('PUT', '/' + analysisId + '/moduli/' + slug, { approvato }); carica() }
  const scarta = async (slug) => { if (!window.confirm('Scartare la bozza «' + slug + '»?')) return; await req('DELETE', '/' + analysisId + '/moduli/' + slug); carica() }
  if (!st) return null
  const g = st.generazione || {}
  const fase = g.fase === 'piano' ? 'Decido quali moduli servono…' : g.fase === 'bozze' ? 'Scrivo le bozze: ' + (g.fatti || 0) + ' di ' + (g.totale || '…') + (g.ultimo ? ' (ultima: ' + g.ultimo + ')' : '') : ''
  return (
    <section className={card}>
      <h2 className="text-sm font-semibold text-ink mb-1">Moduli da costruire</h2>
      <p className="text-xs text-gray-500 mb-3">Per i processi che nessun modulo della Libreria copre, l'AI propone i moduli mancanti e ne scrive le bozze: campi, relazioni, stati del flusso, requisiti, automazioni, documenti. Ogni bozza è controllata dal codice; tu approvi quelle da installare.</p>
      <div className="flex items-center gap-3 flex-wrap">
        {!bloccato && <button type="button" className={btn} onClick={genera} disabled={st.in_corso}>{st.in_corso ? 'Sto lavorando…' : st.generati.length ? 'Rigenera le bozze' : 'Proponi e scrivi i moduli mancanti'}</button>}
        {st.in_corso && <span className="text-xs text-gray-400">{fase} <span className="text-gray-600">(può servire qualche minuto: puoi lasciare la pagina)</span></span>}
        {msg && <span className="text-xs text-amber-300">{msg}</span>}
        {g.fase === 'errore' && !st.in_corso && <span className="text-xs text-red-300">Non riuscito: {g.errore}</span>}
      </div>
      {st.generati.length > 0 && (
        <div className="mt-4 space-y-2.5">
          {st.generati.map((m) => {
            const campi = m.schema.steps.filter((b) => b.block_type === 'field').length
            const stati = m.schema.steps.filter((b) => b.block_type === 'workflow_state')
            const rel = m.schema.steps.filter((b) => b.block_type === 'relation')
            const extra = ['state_requirements', 'automation', 'document_action', 'allegati', 'calendar_view'].map((k) => [k, m.schema.steps.filter((b) => b.block_type === k).length]).filter(([, n]) => n)
            const NOMI = { state_requirements: 'requisiti', automation: 'automazioni', document_action: 'documenti', allegati: 'allegati', calendar_view: 'calendario' }
            return (
              <div key={m.slug} className={'rounded-lg border p-3 ' + (m.approvato ? 'border-cp-primary/50 bg-cp-primary/5' : 'border-gray-800')}>
                <div className="flex items-start gap-3">
                  <label className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer">
                    <input type="checkbox" checked={!!m.approvato} onChange={(e) => approva(m.slug, e.target.checked)} disabled={bloccato} />
                    <span className="text-sm font-medium text-ink truncate">{m.name}</span>
                    <span className="text-[10px] text-gray-500 font-mono">{m.slug}</span>
                  </label>
                  {!bloccato && <button type="button" onClick={() => scarta(m.slug)} className="text-xs text-gray-500 hover:text-red-400 transition">Scarta</button>}
                </div>
                <div className="text-xs text-gray-400 mt-1.5">{campi} campi{rel.length ? ' · collegato a ' + rel.map((r) => r.target_module).join(', ') : ''}{stati.length ? ' · percorso: ' + stati.map((s) => s.label).join(' → ') : ''}{extra.length ? ' · ' + extra.map(([k, n]) => n + ' ' + NOMI[k]).join(', ') : ''}</div>
                {m.problemi.length === 0
                  ? <div className="text-xs text-green-400 mt-1">Controllo superato{m.tentativi > 1 ? ' dopo ' + m.tentativi + ' tentativi' : ''}.</div>
                  : <div className="text-xs text-amber-300 mt-1">Da sistemare ({m.problemi.length}): {m.problemi.slice(0, 4).join(' · ')}{m.problemi.length > 4 ? ' …' : ''} <span className="text-gray-500">— se la approvi comunque, si corregge dal Builder del tenant.</span></div>}
                <details className="mt-1.5"><summary className="text-xs text-gray-500 cursor-pointer">Campi</summary><div className="text-xs text-gray-400 mt-1">{m.schema.steps.filter((b) => b.block_type === 'field').map((b) => b.label + (b.required ? '*' : '')).join(' · ')}</div></details>
              </div>
            )
          })}
          <p className="text-xs text-gray-500">{st.generati.filter((m) => m.approvato).length} di {st.generati.length} approvate: alla creazione del tenant si installano quelle.</p>
        </div>
      )}
    </section>
  )
}
