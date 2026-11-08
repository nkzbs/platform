import React, { useState } from 'react'
import useApi from '../lib/useApi'
import Portal from './Portal'

// Invio di massa ai clienti della lista che stai guardando (filtri e ricerca compresi). Si scrive il messaggio, si guarda l'ANTEPRIMA (chi riceve, chi è saltato e perché, quanti SMS e quanto costano), poi si conferma.
// Il server controlla il consenso alle comunicazioni commerciali per ogni destinatario: la lista non lo aggira.
export default function MessaggioMassivoModal({ token, slug, azione, ids, onClose }) {
  const api = useApi(token)
  const [canali, setCanali] = useState(['mail'])
  const [oggetto, setOggetto] = useState('')
  const [testo, setTesto] = useState('')
  const [anteprima, setAnteprima] = useState(null)
  const [esito, setEsito] = useState(null)
  const [errore, setErrore] = useState('')
  const [lavoro, setLavoro] = useState(false)
  const corpo = (extra = {}) => ({ ids, canali, oggetto, testo, ...extra })
  const tog = (c) => { setAnteprima(null); setCanali((x) => (x.includes(c) ? x.filter((y) => y !== c) : [...x, c])) }
  const guarda = async () => {
    setErrore(''); setLavoro(true)
    const r = await api.post('/messaggi/' + slug + '/massivo/' + azione, corpo({ anteprima: true }))
    setLavoro(false)
    if (!r.ok) { setErrore((r.data && r.data.error) || 'Non riuscito.'); return }
    setAnteprima(r.data)
  }
  const invia = async () => {
    setErrore(''); setLavoro(true)
    const r = await api.post('/messaggi/' + slug + '/massivo/' + azione, corpo({ conferma: true }))
    setLavoro(false)
    if (!r.ok) { setErrore((r.data && r.data.error) || 'Non riuscito.'); return }
    setEsito(r.data)
  }
  const inp = 'w-full bg-surface-page text-ink px-3 py-2 rounded-lg outline-none border border-gray-800 focus:border-accent transition text-sm'
  const euro = (n) => Number(n).toLocaleString('it-IT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 })
  return (
    <Portal>
      <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
        <div className="bg-surface-card border border-gray-700 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between"><h2 className="text-base font-semibold text-ink">Messaggio a {ids.length} {ids.length === 1 ? 'cliente' : 'clienti'}</h2><button type="button" onClick={onClose} className="text-gray-500 hover:text-ink" aria-label="Chiudi">✕</button></div>
          {esito ? (
            <div className="space-y-2 text-sm">
              <div className="text-emerald-400 font-semibold">Fatto: {esito.inviati} messaggi inviati{esito.falliti ? ', ' + esito.falliti + ' non riusciti' : ''}{esito.fermati_dal_tetto ? ', ' + esito.fermati_dal_tetto + ' fermati dal tetto giornaliero' : ''}.</div>
              <div className="text-gray-500">Il dettaglio è nel registro: Impostazioni → Messaggi ai clienti.</div>
              <button type="button" onClick={onClose} className="bg-accent text-white px-4 py-2 rounded-lg text-sm">Chiudi</button>
            </div>
          ) : (
            <>
              <div className="flex gap-2 text-xs">{[['mail', 'Mail'], ['sms', 'SMS']].map(([c, l]) => <button key={c} type="button" onClick={() => tog(c)} aria-pressed={canali.includes(c)} className={'px-3 py-1.5 rounded-lg border transition ' + (canali.includes(c) ? 'bg-accent/20 border-accent/50 text-accent' : 'border-gray-700 text-gray-500')}>{l}</button>)}</div>
              {canali.includes('mail') && <label className="block"><span className="text-xs text-gray-400">Oggetto</span><input className={inp} value={oggetto} onChange={(e) => { setOggetto(e.target.value); setAnteprima(null) }} /></label>}
              <label className="block"><span className="text-xs text-gray-400">Testo. Puoi usare {'{nome}'} e {'{cognome}'}. {canali.includes('sms') ? 'Per gli SMS ogni 160 caratteri costa un SMS.' : ''}</span><textarea rows={5} className={inp} value={testo} onChange={(e) => { setTesto(e.target.value); setAnteprima(null) }} /></label>
              <div className="text-xs text-gray-500">{testo.length} caratteri</div>
              {anteprima && (
                <div className="rounded-lg border border-gray-700 p-3 text-sm space-y-1.5">
                  <div><b className="text-ink">{anteprima.pronti}</b> su {anteprima.destinatari} lo ricevono: {anteprima.mail} mail, {anteprima.sms} SMS{anteprima.sms ? ' (' + (anteprima.costo_sms === null ? 'costo non noto' : euro(anteprima.costo_sms)) + ')' : ''}.</div>
                  {anteprima.saltati > 0 && <div className="text-amber-400">{anteprima.saltati} saltati: {anteprima.saltati_motivi.join('; ')}.</div>}
                  {anteprima.canali.non_disponibili.map((c) => <div key={c.canale} className="text-amber-400">{c.canale === 'sms' ? 'SMS' : 'Mail'} non disponibile: {c.motivo}</div>)}
                  {anteprima.esempio && <div className="text-gray-400 border-l-2 border-gray-700 pl-2 whitespace-pre-wrap">A {anteprima.esempio.nome}: {anteprima.esempio.testo}</div>}
                  <div className="text-xs text-gray-500">Oggi già inviati {anteprima.gia_inviati_oggi} su un massimo di {anteprima.tetto_giornaliero}.</div>
                </div>
              )}
              {errore && <div className="text-sm text-red-400">{errore}</div>}
              <div className="flex gap-3">
                <button type="button" onClick={onClose} className="flex-1 border border-gray-700 text-gray-300 py-2 rounded-lg text-sm">Annulla</button>
                {!anteprima
                  ? <button type="button" onClick={guarda} disabled={lavoro || !canali.length || !testo.trim() || (canali.includes('mail') && !oggetto.trim())} className="flex-1 bg-accent disabled:opacity-50 text-white py-2 rounded-lg text-sm font-medium">{lavoro ? '…' : 'Guarda l\'anteprima'}</button>
                  : <button type="button" onClick={invia} disabled={lavoro || anteprima.pronti === 0} className="flex-1 bg-accent disabled:opacity-50 text-white py-2 rounded-lg text-sm font-medium">{lavoro ? 'Invio…' : 'Conferma e invia a ' + anteprima.pronti}</button>}
              </div>
            </>
          )}
        </div>
      </div>
    </Portal>
  )
}
