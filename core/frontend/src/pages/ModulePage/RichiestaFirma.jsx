import React, { useState, useEffect, useCallback } from 'react'
import Icon from '../../components/Icon'

// «Invia per la firma»: UN pulsante per mandare al cliente i documenti da firmare (tutti insieme, con un solo link). Sotto, lo stato dell'ultima richiesta:
// in attesa (da quanti giorni, quanti solleciti), firmata, scaduta. Sollecitare o annullare sono azioni piccole; il resto (allegati, consensi, stato) lo fa il server quando il cliente firma.
const quando = (d) => (d ? new Date(d.includes('T') ? d : d.replace(' ', 'T') + 'Z').toLocaleDateString('it-IT', { day: 'numeric', month: 'long' }) : '')
const STATI = { inviata: ['In attesa di firma', 'text-amber-500'], in_firma: ['Firma con codice in corso', 'text-amber-500'], firmata: ['Firmata', 'text-green-500'], scaduta: ['Scaduta', 'text-gray-400'], annullata: ['Annullata', 'text-gray-400'] }

export default function RichiestaFirma({ api, slug, recordId, documentiFirma, onManuale }) {
  const [richieste, setRichieste] = useState([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [cap, setCap] = useState(null) // cosa c'è oltre alla mail: { sms: { ok, prezzo } }
  const [conSms, setConSms] = useState(false)
  const [whats, setWhats] = useState([]) // collegamenti WhatsApp dei firmatari appena avvisati
  const carica = useCallback(async () => {
    const d = await api.get('/firma/' + slug + '/' + recordId + '/richieste')
    if (Array.isArray(d)) setRichieste(d)
  }, [api, slug, recordId])
  useEffect(() => { carica() }, [carica])
  useEffect(() => { api.get('/firma/capacita').then((d) => { if (d && d.sms) setCap(d) }) }, [api])

  const invia = async () => {
    if (!window.confirm('Mando al cliente ' + (documentiFirma.length === 1 ? 'il documento' : 'i ' + documentiFirma.length + ' documenti') + ' da firmare, con un solo link:\n\n' + documentiFirma.map((d) => '• ' + d.label).join('\n') + '\n\nPartirà una mail al suo indirizzo' + (conSms ? ' e un SMS al suo cellulare' + (cap && cap.sms.prezzo ? ' (circa ' + cap.sms.prezzo + ' € a SMS)' : '') : '') + '.')) return
    setBusy(true); setMsg(null)
    const r = await api.post('/firma/' + slug + '/' + recordId + '/richieste', { link_base: window.location.origin, canali: conSms ? ['sms'] : [] })
    setBusy(false)
    setWhats(r.ok ? (r.data.inviati || []).filter((x) => x.whatsapp) : [])
    const sms = r.ok ? (r.data.inviati || []).filter((x) => x.sms) : []
    setMsg(r.ok ? { ok: true, testo: 'Mail partita a ' + r.data.destinatario + '.' + (sms.length ? ' SMS: ' + sms.map((x) => (x.nome || x.destinatario) + ' ' + x.sms).join(', ') + '.' : '') + ((r.data.falliti || []).length ? ' Non è partita a: ' + r.data.falliti.map((f) => f.destinatario).join(', ') + '.' : '') } : { ok: false, testo: (r.data && r.data.error) || 'Non riuscito.' })
    carica()
  }
  const azione = async (verbo, r) => {
    setBusy(true); setMsg(null)
    const res = verbo === 'sollecita' ? await api.post('/firma/richieste/' + r.id + '/sollecita', {}) : await api.del('/firma/richieste/' + r.id)
    setBusy(false)
    setMsg(res.ok ? { ok: true, testo: verbo === 'sollecita' ? 'Sollecito mandato.' : 'Richiesta annullata.' } : { ok: false, testo: (res.data && res.data.error) || 'Non riuscito.' })
    carica()
  }
  const ultima = richieste[0]
  const gruppo = ultima ? (ultima.gruppo ? richieste.filter((x) => x.gruppo === ultima.gruppo) : [ultima]) : []
  const inAttesa = gruppo.some((x) => x.stato === 'inviata' || x.stato === 'in_firma')
  return (
    <div className="rounded-xl border border-gray-800 p-4 mb-4">
      <div className="flex items-start gap-3">
        <Icon name="edit" size={20} className="text-accent mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-ink">Far firmare al cliente</div>
          <div className="text-xs text-gray-500 mt-0.5">{documentiFirma.map((d) => d.label).join(' · ')}. Un solo link: il cliente li scarica, li firma e ricarica la foto; allegati e stato si aggiornano da soli.</div>
        </div>
      </div>
      {cap && cap.sms.ok && !inAttesa && (
        <label className="flex items-center gap-2 mt-3 text-xs text-gray-400 cursor-pointer"><input type="checkbox" checked={conSms} onChange={(e) => setConSms(e.target.checked)} /> Manda anche un SMS con il link{cap.sms.prezzo ? ' (circa ' + cap.sms.prezzo + ' € a SMS)' : ''}</label>
      )}
      <button type="button" onClick={invia} disabled={busy || inAttesa} className="w-full mt-3 bg-accent hover:opacity-90 disabled:opacity-50 text-white py-2.5 rounded-lg text-sm font-medium transition">
        {busy ? 'Un attimo…' : inAttesa ? 'Richiesta già inviata' : 'Invia per la firma'}
      </button>
      {whats.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {whats.map((x) => <a key={x.id} href={x.whatsapp} target="_blank" rel="noopener noreferrer" className="text-xs px-3 py-1.5 rounded-lg bg-green-500/15 text-green-500 hover:opacity-80">Scrivi su WhatsApp a {x.nome || x.destinatario}</a>)}
        </div>
      )}
      {onManuale && (
        <div className="mt-4 pt-3 border-t border-gray-800">
          <div className="text-xs text-gray-400">Oppure a mano: scarichi il PDF, lo fai firmare e lo carichi tu (anche per chi è in studio con te).</div>
          <div className="mt-2 flex flex-col gap-1">
            {documentiFirma.map((d) => (
              <button key={d.key} type="button" onClick={() => onManuale(d)} className="text-left text-xs px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200 flex items-center justify-between gap-2">
                <span className="min-w-0 truncate">{d.label}</span><span className="text-accent flex-shrink-0">Scarica PDF · Carica firmato</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {msg && <div className={'text-xs mt-2 ' + (msg.ok ? 'text-green-500' : 'text-red-400')}>{msg.testo}</div>}
      {gruppo.length > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-800 text-xs space-y-2">
          {gruppo.map((x) => {
            const [etichetta, colore] = STATI[x.stato] || STATI.annullata
            const attesa = x.stato === 'inviata' || x.stato === 'in_firma'
            return (
              <div key={x.id} className="flex items-center justify-between gap-2 flex-wrap">
                <span className="min-w-0"><span className="text-ink">{x.nome || x.destinatario}</span> <span className={'font-medium ' + colore}>{etichetta}</span>
                  <span className="text-gray-500"> · inviata il {quando(x.creata_il)}{x.nome ? ' a ' + x.destinatario : ''}{x.stato === 'firmata' ? ' · firmata il ' + quando(x.firmata_il) : x.stato === 'inviata' ? ' · ' + x.solleciti + ' solleciti' : ''}</span></span>
                {attesa && (
                  <span className="flex gap-3 flex-shrink-0">
                    <button type="button" disabled={busy} onClick={async () => { const d = await api.get('/firma/richieste/' + x.id + '/whatsapp'); if (d && d.url) window.open(d.url, '_blank', 'noopener'); else setMsg({ ok: false, testo: 'Per WhatsApp serve un cellulare valido nella scheda del firmatario.' }) }} className="text-green-500 hover:opacity-80 disabled:opacity-40">WhatsApp</button>
                    {x.stato === 'inviata' && <button type="button" disabled={busy} onClick={() => azione('sollecita', x)} className="text-accent hover:opacity-80 disabled:opacity-40">Sollecita</button>}
                    <button type="button" disabled={busy} onClick={() => azione('annulla', x)} className="text-gray-400 hover:text-gray-200 disabled:opacity-40">Annulla</button>
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
