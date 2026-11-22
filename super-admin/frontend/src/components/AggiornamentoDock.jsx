import React from 'react'
import Icon from './Icon'
import Portal from './Portal'
import { avanzamento } from '@shared/avanzamento-aggiornamento'
import { useAggiornamento, avvia, minimizza, riapri, chiudi } from '../lib/aggiornamento'

// La finestra dell'aggiornamento di un tenant: i passi veri, una barra di avanzamento e «Riduci» (il lavoro continua sul server e in qualunque pagina).
// Ridotta, resta una pastiglia in basso con tenant e percentuale; a fine lavoro la finestra si riapre da sola con l'esito. Montata una volta in App.
export default function AggiornamentoDock({ token }) {
  const { upd, minimizzata } = useAggiornamento()
  if (!upd) return null
  const pct = avanzamento(upd.lines, upd.state)
  const incorso = upd.state === 'running'
  const tinta = upd.state === 'ok' ? 'bg-green-500' : upd.state === 'ko' ? 'bg-red-500' : upd.state === 'busy' ? 'bg-amber-500' : 'bg-cp-primary'
  const titolo = upd.state === 'ok' ? 'Aggiornato' : upd.state === 'ko' ? 'Non aggiornato' : upd.state === 'busy' ? 'Sessione attiva' : 'Aggiornamento in corso'

  if (minimizzata) {
    return (
      <Portal>
        <button type="button" onClick={riapri} aria-label={'Aggiornamento di ' + upd.t.name + ': ' + pct + '%. Tocca per aprire'}
          className="fixed z-50 left-1/2 -translate-x-1/2 bottom-28 md:bottom-6 md:left-auto md:translate-x-0 md:right-6 flex items-center gap-3 bg-surface-card border border-gray-800 shadow-2xl rounded-full pl-3 pr-4 py-2 text-left">
          <Icon name="refresh" size={16} className="animate-spin text-cp-primary" />
          <span className="min-w-0">
            <span className="block text-xs font-semibold text-ink leading-tight truncate max-w-[160px]">Aggiorno {upd.t.name}</span>
            <span className="block mt-1 h-1 w-32 rounded-full bg-gray-800 overflow-hidden"><span className={'block h-full rounded-full transition-all duration-700 ' + tinta} style={{ width: pct + '%' }} /></span>
          </span>
          <span className="text-xs tabular-nums text-gray-500">{pct}%</span>
        </button>
      </Portal>
    )
  }

  return (
    <Portal>
      <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
        <div className="bg-surface-card border border-gray-800 rounded-xl w-full max-w-md shadow-2xl overflow-hidden" role="dialog" aria-label={titolo}>
          <div className="px-6 pt-6 pb-3 flex items-center gap-3">
            <div className={'w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ' + (upd.state === 'ok' ? 'bg-green-500/15 text-green-500' : upd.state === 'ko' ? 'bg-red-500/15 text-red-500' : upd.state === 'busy' ? 'bg-amber-500/15 text-amber-500' : 'bg-cp-primary/15 text-cp-primary')}>
              <Icon name={upd.state === 'ok' ? 'check' : upd.state === 'ko' ? 'alert-triangle' : 'refresh'} size={18} className={incorso ? 'animate-spin' : ''} />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold text-ink leading-tight">{titolo}</h2>
              <div className="text-sm text-gray-500">{upd.t.name}</div>
            </div>
            <div className="text-sm tabular-nums text-gray-500 font-medium">{pct}%</div>
          </div>
          <div className="px-6 pb-4">
            <div className="h-2 rounded-full bg-gray-800 overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
              <div className={'h-full rounded-full transition-all duration-700 ' + tinta + (incorso ? ' animate-pulse' : '')} style={{ width: pct + '%' }} />
            </div>
          </div>
          <ol className="px-6 pb-4 space-y-2.5 max-h-60 overflow-y-auto">
            {upd.lines.map((l, i) => {
              const ultima = i === upd.lines.length - 1
              const inLavoro = incorso && ultima
              return (
                <li key={i} className="flex items-start gap-3 text-sm">
                  <span className="mt-0.5 w-4 h-4 flex-shrink-0 flex items-center justify-center">
                    {inLavoro ? <Icon name="refresh" size={14} className="animate-spin text-cp-primary" /> : <Icon name="check" size={14} className="text-green-500" />}
                  </span>
                  <span className="flex-1 text-ink">{l.msg}</span>
                  <span className="text-xs text-gray-500 tabular-nums mt-0.5">{new Date(l.at).toLocaleTimeString('it-IT')}</span>
                </li>
              )
            })}
          </ol>
          {upd.state === 'ok' && <div className="mx-6 mb-5 rounded-lg bg-green-500/10 border border-green-500/30 text-green-600 text-center font-semibold tracking-wide py-3">AGGIORNATO</div>}
          {upd.state === 'ko' && <div className="mx-6 mb-5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-600 text-center py-3"><div className="font-semibold tracking-wide">NON AGGIORNATO</div>{upd.note && <div className="text-xs mt-1 px-3">{upd.note}</div>}</div>}
          {upd.state === 'busy' && <div className="mx-6 mb-5 text-sm text-gray-500">{upd.note}. Aggiornando, l'utente collegato viene scollegato per qualche secondo.</div>}
          {incorso && <div className="mx-6 mb-4 text-xs text-gray-500">Puoi ridurre la finestra e continuare a usare Super Admin: l'aggiornamento prosegue da solo.</div>}
          <div className="px-6 py-4 border-t border-gray-800 flex justify-end gap-2">
            {upd.state === 'busy' && <button onClick={() => avvia(upd.t, true, token)} className="text-sm px-4 py-2 rounded-lg bg-cp-primary hover:bg-cp-primary-hover text-white transition">Aggiorna comunque</button>}
            {incorso
              ? <button onClick={minimizza} className="text-sm px-4 py-2 rounded-lg bg-cp-primary hover:bg-cp-primary-hover text-white transition">Riduci e continua</button>
              : <button onClick={chiudi} className="text-sm px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200 transition">Chiudi</button>}
          </div>
        </div>
      </div>
    </Portal>
  )
}
