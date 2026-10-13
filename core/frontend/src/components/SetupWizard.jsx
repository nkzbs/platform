import React, { useState, useEffect, useCallback } from 'react'
import useApi from '../lib/useApi'
import Icon from './Icon'
import CollegaModuli from './CollegaModuli'

// I primi passi di un tenant nuovo: scegliere cosa gestire, collegare i moduli, invitare chi lo usa, scegliere come avvisare.
// Compare da solo (solo admin) finché il tenant è vuoto e non è stato chiuso. Ogni passo porta alla pagina giusta; cosa è già fatto si
// legge dai dati veri. Chiudere il pannello lo riduce a una pillola in basso; «Non mostrare più» lo chiude per sempre.
export default function SetupWizard({ token, user, onNavigate, onOpenBuilderNewModule }) {
  const api = useApi(token)
  const [stato, setStato] = useState(null)
  const [aperto, setAperto] = useState(true)
  const [collega, setCollega] = useState(false)
  const carica = useCallback(() => api.get('/setup-wizard/stato').then((d) => d && typeof d.mostra === 'boolean' && setStato(d)), []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (user && user.role === 'admin') carica() }, [user && user.role]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!stato || !stato.mostra) return null

  const p = stato.passi
  const vai = (fn) => () => { setAperto(false); fn() }
  const passi = [
    { titolo: 'Scegli cosa gestire', fatto: p.moduli > 0, testo: 'Parti da un modello (un gruppo di moduli già pronto), scegli i moduli uno per uno dalla Libreria, oppure costruiscine uno da zero.', azioni: [
      { label: 'Scegli un modello o i moduli', onClick: vai(() => onNavigate('libreria')) },
      { label: 'Crea da zero', onClick: vai(onOpenBuilderNewModule), secondario: true } ] },
    { titolo: 'Collega i moduli', fatto: p.collegamenti > 0, bloccato: p.moduli < 2, testo: p.moduli < 2 ? 'Servono almeno due moduli.' : 'Ti propongo i collegamenti ovvi (un ordine appartiene a un cliente…): scegli quali creare.', azioni: [
      { label: 'Collega i moduli', onClick: () => setCollega(true) } ] },
    { titolo: 'Chi lo usa', fatto: p.utenti > 1, testo: 'Aggiungi le persone e dai a ciascuna il suo ruolo.', azioni: [{ label: 'Utenti e ruoli', onClick: vai(() => onNavigate('impostazioni')) }] },
    { titolo: 'Come ti avvisa', fatto: p.connessioni > 0, testo: 'Collega Telegram, WhatsApp o la posta per ricevere avvisi e riepiloghi.', azioni: [{ label: 'Connessioni', onClick: vai(() => onNavigate('connessioni')) }] },
  ]
  const fatti = passi.filter((s) => s.fatto).length
  const chiudiPerSempre = async () => { await api.post('/setup-wizard/chiudi', {}); setStato(null) }

  if (!aperto) {
    return (
      <button onClick={() => { setAperto(true); carica() }} className="fixed bottom-4 right-4 z-40 bg-accent text-white text-sm px-4 py-2.5 rounded-full shadow-lg hover:opacity-90 flex items-center gap-2">
        <Icon name="check" size={14} />Primi passi {fatti}/{passi.length}
      </button>
    )
  }
  return (
    <>
      <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setAperto(false)}>
        <div className="bg-surface-card rounded-xl w-full max-w-lg border border-gray-800 p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
          <h2 className="text-lg font-bold text-ink">Benvenuto: cominciamo</h2>
          <p className="text-sm text-gray-500 mb-4">Quattro passi per avere il tuo gestionale. Puoi farli in ordine o saltare quelli che non ti servono.</p>
          <div className="h-1.5 bg-gray-800 rounded-full mb-4 overflow-hidden"><div className="h-full bg-accent transition-all" style={{ width: (fatti / passi.length * 100) + '%' }} /></div>
          <div className="space-y-2.5">
            {passi.map((s, i) => (
              <div key={i} className={'border rounded-lg p-3.5 ' + (s.fatto ? 'border-green-900/50' : 'border-gray-800')}>
                <div className="flex items-start gap-3">
                  <div className={'w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-semibold flex-shrink-0 mt-0.5 ' + (s.fatto ? 'bg-green-600 text-white' : 'bg-gray-800 text-gray-400')}>{s.fatto ? <Icon name="check" size={11} /> : i + 1}</div>
                  <div className="min-w-0 flex-1">
                    <div className="text-ink text-sm font-medium">{s.titolo}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{s.testo}</div>
                    {!s.bloccato && (
                      <div className="flex gap-2 flex-wrap mt-2.5">
                        {s.azioni.map((a) => <button key={a.label} onClick={a.onClick} className={'text-xs px-3 py-1.5 rounded-lg transition ' + (a.secondario || s.fatto ? 'bg-gray-800 hover:bg-gray-700 text-gray-200' : 'bg-accent hover:opacity-90 text-white')}>{a.label}</button>)}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between gap-3 mt-4">
            <button onClick={chiudiPerSempre} className="text-xs text-gray-500 hover:text-ink">Non mostrare più</button>
            <button onClick={() => setAperto(false)} className="text-sm px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200">Più tardi</button>
          </div>
        </div>
      </div>
      {collega && <CollegaModuli token={token} onClose={() => { setCollega(false); carica() }} onDone={carica} />}
    </>
  )
}
