import React, { useState, useEffect, useCallback } from 'react'
import Icon from '../../components/Icon'

// «Invia per la firma»: UN pulsante per mandare al cliente i documenti da firmare (tutti insieme, con un solo link). Sotto, lo stato dell'ultima richiesta:
// in attesa (da quanti giorni, quanti solleciti), firmata, scaduta. Sollecitare o annullare sono azioni piccole; il resto (allegati, consensi, stato) lo fa il server quando il cliente firma.
const quando = (d) => (d ? new Date(d.includes('T') ? d : d.replace(' ', 'T') + 'Z').toLocaleDateString('it-IT', { day: 'numeric', month: 'long' }) : '')
const STATI = { inviata: ['In attesa di firma', 'text-amber-500'], in_firma: ['Firma con codice in corso', 'text-amber-500'], firmata: ['Firmata', 'text-green-500'], scaduta: ['Scaduta', 'text-gray-400'], annullata: ['Annullata', 'text-gray-400'] }

export default function RichiestaFirma({ api, slug, recordId, documentiFirma }) {
  const [richieste, setRichieste] = useState([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const carica = useCallback(async () => {
    const d = await api.get('/firma/' + slug + '/' + recordId + '/richieste')
    if (Array.isArray(d)) setRichieste(d)
  }, [api, slug, recordId])
  useEffect(() => { carica() }, [carica])

  const invia = async () => {
    if (!window.confirm('Mando al cliente ' + (documentiFirma.length === 1 ? 'il documento' : 'i ' + documentiFirma.length + ' documenti') + ' da firmare, con un solo link:\n\n' + documentiFirma.map((d) => '• ' + d.label).join('\n') + '\n\nPartirà una mail al suo indirizzo.')) return
    setBusy(true); setMsg(null)
    const r = await api.post('/firma/' + slug + '/' + recordId + '/richieste', { link_base: window.location.origin })
    setBusy(false)
    setMsg(r.ok ? { ok: true, testo: 'Mail partita a ' + r.data.destinatario + '.' } : { ok: false, testo: (r.data && r.data.error) || 'Non riuscito.' })
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
  const inAttesa = ultima && (ultima.stato === 'inviata' || ultima.stato === 'in_firma')
  return (
    <div className="rounded-xl border border-gray-800 p-4 mb-4">
      <div className="flex items-start gap-3">
        <Icon name="edit" size={20} className="text-accent mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-ink">Far firmare al cliente</div>
          <div className="text-xs text-gray-500 mt-0.5">{documentiFirma.map((d) => d.label).join(' · ')}. Un solo link: il cliente li scarica, li firma e ricarica la foto; allegati e stato si aggiornano da soli.</div>
        </div>
      </div>
      <button type="button" onClick={invia} disabled={busy || inAttesa} className="w-full mt-3 bg-accent hover:opacity-90 disabled:opacity-50 text-white py-2.5 rounded-lg text-sm font-medium transition">
        {busy ? 'Un attimo…' : inAttesa ? 'Richiesta già inviata' : 'Invia per la firma'}
      </button>
      {msg && <div className={'text-xs mt-2 ' + (msg.ok ? 'text-green-500' : 'text-red-400')}>{msg.testo}</div>}
      {ultima && (
        <div className="mt-3 pt-3 border-t border-gray-800 text-xs flex items-center justify-between gap-2 flex-wrap">
          <span><span className={'font-medium ' + (STATI[ultima.stato] || STATI.annullata)[1]}>{(STATI[ultima.stato] || STATI.annullata)[0]}</span>
            <span className="text-gray-500"> · inviata il {quando(ultima.creata_il)} a {ultima.destinatario}{ultima.stato === 'firmata' ? ' · firmata il ' + quando(ultima.firmata_il) : ultima.stato === 'inviata' ? ' · ' + ultima.solleciti + ' solleciti' : ''}</span></span>
          {inAttesa && (
            <span className="flex gap-3 flex-shrink-0">
              {ultima.stato === 'inviata' && <button type="button" disabled={busy} onClick={() => azione('sollecita', ultima)} className="text-accent hover:opacity-80 disabled:opacity-40">Sollecita</button>}
              <button type="button" disabled={busy} onClick={() => azione('annulla', ultima)} className="text-gray-400 hover:text-gray-200 disabled:opacity-40">Annulla</button>
            </span>
          )}
        </div>
      )}
    </div>
  )
}
