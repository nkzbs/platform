import React, { useState, useRef, useLayoutEffect, useCallback } from 'react'
import Icon from '../../components/Icon'

// ─── MODEL CANVAS (Builder 2.0 fase 2) ──────────────────────────────────────
// Vista grafica dei moduli e delle loro relazioni — "il tecnico deve poter
// aprire un verticale e capire in meno di un minuto quali moduli esistono,
// come sono collegati". Niente libreria di grafi: i nodi sono normali card
// in una griglia CSS, le linee sono un <svg> assoluto sopra, con le posizioni
// misurate dal DOM vero (stesso principio della "spina dorsale" decorativa
// già in uso nell'editor blocchi — qui però le linee portano informazione
// reale, non sono decorazione). Costruita SOLO da fieldCache (già caricato
// una volta all'apertura del Builder per l'autocomplete formule) — zero
// nuove chiamate API, zero nuovo modello dati: esattamente "usa quello che
// già hai" del task.
function ModelCanvas({ modules, fieldCache, onSelectModule }) {
  const containerRef = useRef(null)
  const nodeRefs = useRef({})
  const [lines, setLines] = useState([])
  const [hoveredSlug, setHoveredSlug] = useState(null)
  const [zoom, setZoom] = useState(1)

  const bySlug = {}
  fieldCache.forEach((m) => { bySlug[m.slug] = m })
  // Solo moduli reali installati (niente moduli di supporto tipo ordini_righe —
  // sono dettaglio di un altro modulo, non un nodo a sé nella mappa d'insieme).
  const nodes = modules.filter((m) => bySlug[m.slug])

  const recompute = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    const cRect = container.getBoundingClientRect()
    const centerOf = (slug) => {
      const el = nodeRefs.current[slug]
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.left - cRect.left + r.width / 2 + container.scrollLeft, y: r.top - cRect.top + r.height / 2 + container.scrollTop }
    }
    const computed = []
    nodes.forEach((m) => {
      const mod = bySlug[m.slug]
      ;(mod.relations || []).forEach((rel) => {
        if (!rel.target_module) return
        const a = centerOf(m.slug)
        const b = centerOf(rel.target_module)
        const targetExists = !!bySlug[rel.target_module]
        if (a && b) computed.push({ key: m.slug + ':' + rel.key, a, b, label: rel.label, cardinality: rel.type, from: m.slug, to: rel.target_module, broken: !targetExists })
        else if (a && !targetExists) computed.push({ key: m.slug + ':' + rel.key, a, b: null, label: rel.label, cardinality: rel.type, from: m.slug, to: rel.target_module, broken: true })
      })
    })
    setLines(computed)
  }, [nodes, bySlug])

  useLayoutEffect(() => {
    recompute()
    const onResize = () => recompute()
    window.addEventListener('resize', onResize)
    const container = containerRef.current
    if (container) container.addEventListener('scroll', onResize)
    return () => { window.removeEventListener('resize', onResize); if (container) container.removeEventListener('scroll', onResize) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modules, fieldCache, zoom])

  const CARDINALITY_LABEL = { many_to_one: 'N:1', one_to_many: '1:N', many_to_many: 'N:N' }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-lg font-bold text-ink">Mappa dei moduli</h2>
          <p className="text-xs text-gray-500 mt-0.5">Ogni linea è una relazione. Clic su un modulo per aprirlo nell'editor.</p>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-gray-500">
          <span className="flex items-center gap-1"><span className="w-4 h-px bg-gray-600 inline-block" />Relazione</span>
          <span className="flex items-center gap-1"><span className="w-4 h-px bg-red-500 inline-block" style={{ borderTop: '1px dashed' }} />Dipendenza mancante</span>
          <div className="flex items-center gap-0.5 ml-2 border border-gray-800 rounded-lg overflow-hidden">
            <button onClick={() => setZoom((z) => Math.max(0.4, Math.round((z - 0.1) * 10) / 10))} className="w-6 h-6 flex items-center justify-center hover:bg-white/5 text-gray-400 hover:text-ink transition"><Icon name="plus" size={10} className="rotate-45" /></button>
            <span className="w-10 text-center font-mono text-gray-500">{Math.round(zoom * 100)}%</span>
            <button onClick={() => setZoom((z) => Math.min(2, Math.round((z + 0.1) * 10) / 10))} className="w-6 h-6 flex items-center justify-center hover:bg-white/5 text-gray-400 hover:text-ink transition"><Icon name="plus" size={10} /></button>
            <button onClick={() => setZoom(1)} title="Reimposta zoom" className="w-6 h-6 flex items-center justify-center hover:bg-white/5 text-gray-400 hover:text-ink transition border-l border-gray-800"><Icon name="refresh" size={10} /></button>
          </div>
        </div>
      </div>
      <div ref={containerRef} className="relative border border-gray-800 rounded-xl bg-surface-page overflow-auto" style={{ maxHeight: '70vh', minHeight: '400px' }}>
        <div style={{ transform: 'scale(' + zoom + ')', transformOrigin: 'top left', width: zoom < 1 ? (100 / zoom) + '%' : undefined }}>
          <svg className="absolute top-0 left-0 pointer-events-none" style={{ width: '100%', height: '100%', minWidth: '100%', minHeight: '100%' }}>
            <defs>
              <marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                <path d="M0,0 L8,4 L0,8 Z" fill="rgb(var(--gray-600))" />
              </marker>
            </defs>
            {lines.map((l) => {
              const highlighted = hoveredSlug && (l.from === hoveredSlug || l.to === hoveredSlug)
              if (l.broken || !l.b) return null
              const mx = (l.a.x + l.b.x) / 2
              const my = (l.a.y + l.b.y) / 2
              return (
                <g key={l.key} opacity={hoveredSlug && !highlighted ? 0.15 : 1}>
                  <line x1={l.a.x} y1={l.a.y} x2={l.b.x} y2={l.b.y} stroke={highlighted ? '#60A5FA' : 'rgb(var(--gray-600))'} strokeWidth={highlighted ? 2 : 1.2} markerEnd="url(#arrow)" />
                  <rect x={mx - 14} y={my - 8} width={28} height={16} rx={4} fill="rgb(var(--surface-page))" />
                  <text x={mx} y={my + 4} fontSize="9" fill={highlighted ? '#60A5FA' : 'rgb(var(--gray-500))'} textAnchor="middle" fontFamily="monospace">{CARDINALITY_LABEL[l.cardinality] || ''}</text>
                </g>
              )
            })}
          </svg>
          <div className="relative grid gap-6 p-6" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
            {nodes.map((m) => {
              const mod = bySlug[m.slug]
              // Slug mancanti, non solo il conteggio (2026-09-08, segnalato dal
              // vivo dall'utente: "ok che mi segnali dipendenze mancanti, ma
              // come le sistemo?" — "1 dipendenza mancante" da solo non dice
              // QUALE modulo cercare/ricreare, bisognava aprire l'editor e
              // cercarla a tentativi tra le relazioni). Stesso fix in
              // core/frontend (copia sincronizzata a mano, non condivisa).
              const brokenTargets = [...new Set((mod.relations || []).filter((r) => r.target_module && !bySlug[r.target_module]).map((r) => r.target_module))]
              return (
                <button key={m.slug} ref={(el) => { nodeRefs.current[m.slug] = el }}
                  onClick={() => onSelectModule(m.slug)}
                  onMouseEnter={() => setHoveredSlug(m.slug)} onMouseLeave={() => setHoveredSlug(null)}
                  className="relative z-10 bg-surface-card border border-gray-800 hover:border-gray-600 rounded-xl p-3 text-left transition"
                  style={{ borderColor: hoveredSlug === m.slug ? (m.color || '#2563EB') : undefined }}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0" style={{ backgroundColor: (m.color || '#2563EB') + '22', color: m.color || '#2563EB' }}>
                      <Icon name={m.icon || 'box'} size={12} />
                    </span>
                    <span className="text-sm text-ink font-medium truncate">{m.name}</span>
                  </div>
                  <div className="text-[10px] text-gray-600">{(mod.fields || []).length} campi · {(mod.relations || []).length} relazioni</div>
                  {brokenTargets.length > 0 && (
                    <div className="text-[10px] text-red-400 mt-1 flex items-start gap-1">
                      <Icon name="x" size={9} className="flex-shrink-0 mt-0.5" />
                      <span>Punta a "{brokenTargets.join('", "')}" — non installato</span>
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      </div>
      {nodes.length === 0 && <div className="text-sm text-gray-600 text-center py-12">Nessun modulo installato ancora.</div>}
    </div>
  )
}

export default ModelCanvas
