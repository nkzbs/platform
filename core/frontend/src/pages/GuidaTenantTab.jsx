import React, { useState, useEffect } from 'react'
import useApi from '../lib/useApi'

// Impostazioni → Guida: la guida d'uso di questo tenant. Si genera dalla struttura dei moduli (sempre allineata a ciò che l'app fa) e poi si rifinisce qui a mano.
// Quello che scrivi vince sui testi dei pacchetti. Nei testi si può usare **grassetto**. Le liste si scrivono una voce per riga.
const righe = (t) => String(t || '').split('\n').map((x) => x.trim()).filter(Boolean)
const inp = 'w-full bg-surface-page text-ink px-3 py-2 rounded-lg outline-none border border-gray-800 focus:border-accent transition text-sm'
export default function GuidaTenantTab({ token }) {
  const api = useApi(token)
  const [g, setG] = useState(null)       // contenuto in modifica
  const [quando, setQuando] = useState(null)
  const [msg, setMsg] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const carica = async () => { const r = await api.get('/guida/tenant'); if (r && !r.error) { setG(r.contenuto); setQuando(r.modificata_il || null) } }
  useEffect(() => { carica() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const avvisa = (m, e = false) => { e ? setErr(m) : setMsg(m); setTimeout(() => { setMsg(''); setErr('') }, 3500) }
  const genera = async () => {
    if (g && !window.confirm('Esiste già una guida scritta per questo tenant: rigenerarla sostituisce i testi, comprese le tue correzioni. Continuare?')) return
    setBusy(true); const r = await api.post('/guida/genera', {}); setBusy(false)
    if (!r.ok) { avvisa((r.data && r.data.error) || 'Non riuscito.', true); return }
    avvisa('Guida generata: ' + r.data.capitoli + ' capitoli, ' + r.data.flussi + ' percorsi, ' + r.data.passi_giro + ' passi del giro.'); carica()
  }
  const salva = async () => {
    setBusy(true); const r = await api.put('/guida/tenant', { contenuto: g }); setBusy(false)
    if (!r.ok) { avvisa((r.data && r.data.error) || 'Non salvato.', true); return }
    avvisa('Salvata.'); carica()
  }
  const togli = async () => { if (!window.confirm('Togliere la guida del tenant? Restano solo i testi dei pacchetti, se ci sono.')) return; await api.del('/guida/tenant'); setG(null); setQuando(null); avvisa('Tolta.') }
  const set = (fn) => setG((x) => { const c = JSON.parse(JSON.stringify(x)); fn(c); return c })

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h2 className="text-base font-semibold text-ink">Guida d'uso</h2>
        <p className="text-sm text-gray-500 mt-1">I testi che compaiono nella pagina Guida, nel «?» accanto al titolo di ogni pagina e nel giro guidato. Si generano dalla struttura dei moduli e poi si rifiniscono qui. Nei testi puoi usare **grassetto**.</p>
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={genera} disabled={busy} className="text-xs bg-accent hover:opacity-90 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg transition font-medium">{g ? 'Rigenera dai moduli' : 'Genera dai moduli'}</button>
        {g && <button onClick={salva} disabled={busy} className="text-xs bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-200 px-3 py-1.5 rounded-lg transition">Salva le modifiche</button>}
        {g && <button onClick={togli} className="text-xs text-gray-500 hover:text-red-400 transition px-2 py-1.5">Togli la guida</button>}
        {quando && <span className="text-[11px] text-gray-600">ultima modifica {String(quando).slice(0, 16)}</span>}
        {msg && <span className="text-xs text-emerald-400">{msg}</span>}{err && <span className="text-xs text-red-400">{err}</span>}
      </div>
      {!g && <div className="text-sm text-gray-500">Questo tenant non ha ancora una guida propria (se ha un pacchetto di settore, usa i suoi testi). «Genera dai moduli» la scrive subito.</div>}
      {g && (
        <div className="space-y-5">
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-ink">Introduzione</h3>
            <input className={inp} value={(g.introduzione && g.introduzione.titolo) || ''} onChange={(e) => set((c) => { c.introduzione = { ...(c.introduzione || {}), titolo: e.target.value } })} placeholder="Titolo" />
            <textarea rows={4} className={inp} value={((g.introduzione && g.introduzione.testo) || []).join('\n\n')} onChange={(e) => set((c) => { c.introduzione = { ...(c.introduzione || {}), testo: e.target.value.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean) } })} placeholder="Paragrafi, separati da una riga vuota" />
          </section>
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-ink">Un capitolo per modulo</h3>
            {Object.entries(g.capitoli || {}).map(([slug, c]) => (
              <details key={slug} className="rounded-lg border border-gray-800 p-3">
                <summary className="text-sm text-ink cursor-pointer">{slug}</summary>
                <div className="mt-2 space-y-2">
                  <label className="block"><span className="text-xs text-gray-400">A cosa serve</span><textarea rows={2} className={inp} value={c.scopo || ''} onChange={(e) => set((x) => { x.capitoli[slug].scopo = e.target.value })} /></label>
                  <label className="block"><span className="text-xs text-gray-400">Come si usa (una voce per riga)</span><textarea rows={5} className={inp} value={(c.come_si_usa || []).join('\n')} onChange={(e) => set((x) => { x.capitoli[slug].come_si_usa = righe(e.target.value) })} /></label>
                  <label className="block"><span className="text-xs text-gray-400">Consigli (una voce per riga)</span><textarea rows={3} className={inp} value={(c.consigli || []).join('\n')} onChange={(e) => set((x) => { x.capitoli[slug].consigli = righe(e.target.value) })} /></label>
                </div>
              </details>
            ))}
          </section>
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-ink">Giro guidato</h3>
            {(g.giro || []).map((p, i) => (
              <div key={i} className="rounded-lg border border-gray-800 p-3 space-y-1.5">
                <div className="flex gap-2"><input className={inp + ' !w-40'} value={p.pagina} onChange={(e) => set((x) => { x.giro[i].pagina = e.target.value })} placeholder="pagina" /><input className={inp} value={p.titolo} onChange={(e) => set((x) => { x.giro[i].titolo = e.target.value })} placeholder="Titolo del passo" /><button onClick={() => set((x) => { x.giro.splice(i, 1) })} className="text-xs text-gray-500 hover:text-red-400 px-2">Togli</button></div>
                <textarea rows={2} className={inp} value={p.testo} onChange={(e) => set((x) => { x.giro[i].testo = e.target.value })} />
              </div>
            ))}
            <button onClick={() => set((x) => { x.giro = [...(x.giro || []), { pagina: 'dashboard', titolo: '', testo: '' }] })} className="text-xs text-accent hover:underline">+ Aggiungi un passo</button>
          </section>
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-ink">Percorsi (flussi)</h3>
            {(g.flussi || []).map((f, i) => (
              <div key={i} className="rounded-lg border border-gray-800 p-3 space-y-1.5">
                <input className={inp} value={f.titolo} onChange={(e) => set((x) => { x.flussi[i].titolo = e.target.value })} />
                <textarea rows={3} className={inp} value={(f.passi || []).join('\n')} onChange={(e) => set((x) => { x.flussi[i].passi = righe(e.target.value) })} />
              </div>
            ))}
          </section>
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-ink">Parole usate (glossario)</h3>
            {(g.glossario || []).map((t, i) => (
              <div key={i} className="flex gap-2"><input className={inp + ' !w-48'} value={t.termine} onChange={(e) => set((x) => { x.glossario[i].termine = e.target.value })} /><input className={inp} value={t.significato} onChange={(e) => set((x) => { x.glossario[i].significato = e.target.value })} /></div>
            ))}
            <button onClick={() => set((x) => { x.glossario = [...(x.glossario || []), { termine: '', significato: '' }] })} className="text-xs text-accent hover:underline">+ Aggiungi una parola</button>
          </section>
        </div>
      )}
    </div>
  )
}
