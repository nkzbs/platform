import React, { useEffect, useRef, useState } from 'react'

// Riepilogo del mese a riquadri ("bento"): lo spendibile in grande con un anello, poi entrate/uscite, pagato/da pagare, fisse/variabili.
// Riceve solo numeri già calcolati dalla dashboard; nessun nome di modulo o di campo qui dentro.
const VERDE = '#10B981', AMBRA = '#F59E0B', ROSSO = '#EF4444', INDACO = '#6366F1', VIOLA = '#A78BFA', AZZURRO = '#38BDF8'
const n = (v) => Number(v) || 0
const eur = (v) => n(v).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })
const riduci = () => typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches

// Numero che sale da 0 al valore (900 ms, rallenta alla fine).
function useCountUp(target, ms = 900) {
  const [v, setV] = useState(riduci() ? target : 0)
  const from = useRef(0)
  useEffect(() => {
    if (riduci()) { setV(target); return undefined }
    const start = performance.now(), a = from.current
    let raf
    const step = (t) => {
      const p = Math.min(1, (t - start) / ms), e = 1 - Math.pow(1 - p, 3)
      setV(a + (target - a) * e)
      if (p < 1) raf = requestAnimationFrame(step); else from.current = target
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target, ms])
  return v
}

// true un attimo dopo il montaggio: le barre partono da 0 e crescono.
function useMontato() {
  const [m, setM] = useState(riduci())
  useEffect(() => { const t = setTimeout(() => setM(true), 60); return () => clearTimeout(t) }, [])
  return m
}

const Tile = ({ i, className = '', style, children }) => (
  <div className={'rm-tile rounded-2xl p-4 relative overflow-hidden ' + className} style={{ animationDelay: i * 70 + 'ms', ...style }}>{children}</div>
)
const Etichetta = ({ children }) => <div className="text-[11px] uppercase tracking-wider text-gray-500 font-medium">{children}</div>

export default function RiepilogoMensile({ data, label, nomeMese }) {
  const d = data || {}
  const montato = useMontato()
  const spend = useCountUp(n(d.spendibile))
  const entr = useCountUp(n(d.entrateTotale))
  const usc = useCountUp(n(d.uscite))
  const ok = n(d.spendibile) >= 0
  const col = ok ? VERDE : ROSSO
  const usato = n(d.entrateTotale) > 0 ? n(d.uscite) / n(d.entrateTotale) : null
  const base = Math.max(n(d.entrateTotale), n(d.uscite), 1)
  const pc = (v) => Math.max(0, Math.min(100, (n(v) / base) * 100))
  const tot = Math.max(n(d.fissa) + n(d.variabile), 1)
  const [intero, dec] = Math.abs(spend).toFixed(2).split('.')
  // anello: quanta parte delle entrate è già andata (oltre 100% resta pieno e diventa rosso)
  const R = 46, C = 2 * Math.PI * R
  const frac = usato === null ? 0 : Math.min(1, usato)

  return (
    <div className="p-4 sm:p-5 h-full">
      <style>{`
        @keyframes rm-su { from { opacity: 0; transform: translateY(10px) scale(.98) } to { opacity: 1; transform: none } }
        @keyframes rm-luce { 0%,100% { opacity: .55 } 50% { opacity: .9 } }
        .rm-tile { animation: rm-su .55s cubic-bezier(.2,.8,.2,1) both }
        .rm-glow { animation: rm-luce 4s ease-in-out infinite }
        @media (prefers-reduced-motion: reduce) { .rm-tile, .rm-glow { animation: none } }
      `}</style>
      <div className="flex items-baseline justify-between mb-3 px-1">
        <div className="text-sm font-semibold text-ink">{label}</div>
        <div className="text-xs text-gray-500 capitalize">{nomeMese}</div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* HERO: spendibile + anello */}
        <Tile i={0} className="col-span-2 lg:row-span-2 lg:flex lg:items-center" style={{ background: `linear-gradient(135deg, ${col}2E 0%, ${ok ? AZZURRO : AMBRA}1F 100%)`, border: `1px solid ${col}40` }}>
          <div className="rm-glow absolute -top-10 -right-10 w-44 h-44 rounded-full blur-3xl pointer-events-none" style={{ background: col + '55' }} />
          <div className="relative flex items-center justify-between gap-3 w-full">
            <div className="min-w-0">
              <Etichetta>Spendibile</Etichetta>
              <div className="flex items-baseline tabular-nums mt-1 leading-none" style={{ color: col }}>
                <span className="text-4xl sm:text-5xl font-bold tracking-tight">{spend < 0 ? '−' : ''}{Number(intero).toLocaleString('it-IT')}</span>
                <span className="text-xl sm:text-2xl font-semibold">,{dec}</span>
                <span className="text-xl sm:text-2xl font-semibold ml-1">€</span>
              </div>
              <div className="text-xs text-gray-500 mt-2">
                {usato === null ? 'Nessuna entrata registrata per questo mese' : ok ? 'Finora hai usato il ' + Math.round(usato * 100) + '% delle entrate' : 'Sei oltre le entrate del ' + Math.round((usato - 1) * 100) + '%'}
              </div>
            </div>
            <svg viewBox="0 0 110 110" className="w-24 h-24 sm:w-28 sm:h-28 flex-shrink-0 -rotate-90 text-ink" aria-hidden="true">
              <circle cx="55" cy="55" r={R} fill="none" stroke="currentColor" strokeWidth="9" className="text-gray-500/20" />
              <circle cx="55" cy="55" r={R} fill="none" stroke={usato !== null && usato > 1 ? ROSSO : col} strokeWidth="9" strokeLinecap="round"
                strokeDasharray={C} strokeDashoffset={montato ? C * (1 - frac) : C} style={{ transition: 'stroke-dashoffset 1.1s cubic-bezier(.2,.8,.2,1) .2s' }} />
              <text x="55" y="55" textAnchor="middle" dominantBaseline="central" className="rotate-90" style={{ transformOrigin: '55px 55px', fill: 'currentColor', fontSize: 20, fontWeight: 700 }}>
                {usato === null ? '–' : Math.round(usato * 100) + '%'}
              </text>
            </svg>
          </div>
        </Tile>

        {/* Entrate / Uscite */}
        <Tile i={1} style={{ background: VERDE + '14', border: `1px solid ${VERDE}30` }}>
          <div className="flex items-center gap-1.5"><span className="w-5 h-5 rounded-full flex items-center justify-center text-[11px]" style={{ background: VERDE + '2E', color: VERDE }}>↑</span><Etichetta>Entrate</Etichetta></div>
          <div className="mt-2 text-xl font-bold tabular-nums" style={{ color: VERDE }}>{eur(entr)}</div>
        </Tile>
        <Tile i={2} style={{ background: INDACO + '14', border: `1px solid ${INDACO}30` }}>
          <div className="flex items-center gap-1.5"><span className="w-5 h-5 rounded-full flex items-center justify-center text-[11px]" style={{ background: INDACO + '2E', color: INDACO }}>↓</span><Etichetta>Uscite</Etichetta></div>
          <div className="mt-2 text-xl font-bold tabular-nums text-ink">{eur(usc)}</div>
        </Tile>

        {/* Pagato / Da pagare, con la loro quota sulle uscite */}
        <Tile i={3} style={{ background: VERDE + '10', border: `1px solid ${VERDE}26` }}>
          <Etichetta>Pagato</Etichetta>
          <div className="mt-1.5 text-lg font-bold tabular-nums" style={{ color: VERDE }}>{eur(d.pagato)}</div>
          <div className="mt-3 h-1.5 rounded-full bg-gray-500/20 overflow-hidden"><div className="h-full rounded-full" style={{ width: montato ? (n(d.uscite) ? (n(d.pagato) / n(d.uscite)) * 100 : 0) + '%' : '0%', background: VERDE, transition: 'width 1s cubic-bezier(.2,.8,.2,1) .35s' }} /></div>
        </Tile>
        <Tile i={4} style={{ background: AMBRA + '12', border: `1px solid ${AMBRA}30` }}>
          <Etichetta>Da Pagare</Etichetta>
          <div className="mt-1.5 text-lg font-bold tabular-nums" style={{ color: AMBRA }}>{eur(d.daPagare)}</div>
          <div className="mt-3 h-1.5 rounded-full bg-gray-500/20 overflow-hidden"><div className="h-full rounded-full" style={{ width: montato ? (n(d.uscite) ? (n(d.daPagare) / n(d.uscite)) * 100 : 0) + '%' : '0%', background: AMBRA, transition: 'width 1s cubic-bezier(.2,.8,.2,1) .45s' }} /></div>
        </Tile>

        {/* Fisse / Variabili */}
        <Tile i={5} className="col-span-2" style={{ background: VIOLA + '12', border: `1px solid ${VIOLA}30` }}>
          <div className="flex items-end justify-between gap-3 mb-3">
            <div><Etichetta>Fissa</Etichetta><div className="text-lg font-bold tabular-nums" style={{ color: INDACO }}>{eur(d.fissa)}</div></div>
            <div className="text-right"><Etichetta>Variabile</Etichetta><div className="text-lg font-bold tabular-nums" style={{ color: VIOLA }}>{eur(d.variabile)}</div></div>
          </div>
          <div className="flex h-2.5 rounded-full overflow-hidden bg-gray-500/20">
            <div style={{ width: montato ? (n(d.fissa) / tot) * 100 + '%' : '0%', background: INDACO, transition: 'width 1s cubic-bezier(.2,.8,.2,1) .5s' }} />
            <div style={{ width: montato ? (n(d.variabile) / tot) * 100 + '%' : '0%', background: VIOLA, transition: 'width 1s cubic-bezier(.2,.8,.2,1) .6s' }} />
          </div>
        </Tile>

        {/* Previsto Carta / Previsto Conto: sempre visibili anche a zero (servono per decidere quanto tenere sul conto e quanto sulla carta) */}
        <Tile i={6} style={{ background: AZZURRO + '12', border: `1px solid ${AZZURRO}30` }}>
          <Etichetta>Previsto Carta</Etichetta><div className="mt-1.5 text-lg font-bold tabular-nums text-ink">{eur(d.prevCarta)}</div>
        </Tile>
        <Tile i={7} style={{ background: AZZURRO + '12', border: `1px solid ${AZZURRO}30` }}>
          <Etichetta>Previsto Conto</Etichetta><div className="mt-1.5 text-lg font-bold tabular-nums text-ink">{eur(d.prevConto)}</div>
        </Tile>
      </div>
    </div>
  )
}
