import React from 'react'
import { GUIDA_GUIDED_STEPS } from './content'
import { GuidedDiagram } from './diagrams'
import RichText from '../../components/RichText'

function GuidedPath() {
  return (
    <div className="flex gap-10 items-start">
      <div className="flex-1 max-w-3xl min-w-0">
        <div className="bg-surface-card border border-gray-800 rounded-xl p-5 mb-5">
          <div className="text-ink font-semibold text-sm mb-1">Costruisci un tenant da zero</div>
          <p className="text-xs text-gray-500">Segui questi passi nell'ordine — alla fine avrai un modulo vero, con una relazione, un workflow e una formula che funzionano davvero, non solo mostrati in uno schema.</p>
        </div>
        <div className="space-y-0">
          {GUIDA_GUIDED_STEPS.map((s, i) => (
            <div key={s.n} id={'step-' + s.n} className="flex gap-4 scroll-mt-6">
              <div className="flex flex-col items-center flex-shrink-0">
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                  style={{ backgroundColor: s.color + '22', color: s.color, border: '1.5px solid ' + s.color }}>
                  {s.n}
                </div>
                {i < GUIDA_GUIDED_STEPS.length - 1 && <div className="w-px flex-1 bg-gray-800 my-1" style={{ minHeight: '24px' }} />}
              </div>
              <div className="pb-8 min-w-0 flex-1">
                <div className="text-ink font-semibold text-sm mb-2">{s.title}</div>
                <div className="space-y-2 mb-3">
                  {s.body.map((p, j) => <p key={j} className="text-xs text-gray-400 leading-relaxed"><RichText text={p} /></p>)}
                </div>
                {s.example && (
                  <div className="rounded-lg p-3 mb-3 text-xs leading-relaxed text-gray-300"
                    style={{ backgroundColor: s.color + '0d', border: '1px solid ' + s.color + '33', borderLeft: '3px solid ' + s.color }}>
                    <span className="font-semibold" style={{ color: s.color }}>Esempio — </span>
                    <RichText text={s.example} />
                  </div>
                )}
                {s.diagram && (
                  <div className="bg-surface-page border border-gray-800 rounded-lg p-3 overflow-x-auto">
                    <GuidedDiagram type={s.diagram} />
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Indice laterale: usa lo spazio a destra invece di lasciarlo vuoto, resta
          visibile mentre si scorre (sticky) — nascosto sotto una certa larghezza
          dove non ci sarebbe spazio per non affollare la pagina. */}
      <div className="w-56 flex-shrink-0 sticky top-6 hidden xl:block">
        <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide mb-3 px-2">In questa pagina</div>
        <div className="space-y-0.5">
          {GUIDA_GUIDED_STEPS.map((s) => (
            <a key={s.n} href={'#step-' + s.n}
              className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-xs text-gray-500 hover:text-ink hover:bg-white/5 transition">
              <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                style={{ backgroundColor: s.color + '22', color: s.color }}>
                {s.n}
              </span>
              <span className="truncate">{s.title}</span>
            </a>
          ))}
        </div>
      </div>
    </div>
  )
}

export default GuidedPath
