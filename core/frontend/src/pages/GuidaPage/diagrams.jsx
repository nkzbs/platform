import React from 'react'

function DiagramRelation() {
  return (
    <svg viewBox="0 0 460 130" className="w-full max-w-md">
      <rect x="10" y="35" width="130" height="60" rx="10" fill="#2563EB22" stroke="#2563EB" strokeWidth="1.5" />
      <text x="75" y="60" textAnchor="middle" fill="#DBE4FF" fontSize="13" fontWeight="600">Ordini</text>
      <text x="75" y="78" textAnchor="middle" fill="#8B93A1" fontSize="10">molti record</text>

      <rect x="320" y="35" width="130" height="60" rx="10" fill="#7C3AED22" stroke="#7C3AED" strokeWidth="1.5" />
      <text x="385" y="60" textAnchor="middle" fill="#E4D9FF" fontSize="13" fontWeight="600">Clienti</text>
      <text x="385" y="78" textAnchor="middle" fill="#8B93A1" fontSize="10">un record</text>

      <line x1="140" y1="65" x2="315" y2="65" stroke="#4B5563" strokeWidth="1.5" markerEnd="url(#arrowRel)" />
      <text x="227" y="52" textAnchor="middle" fill="#9CA3AF" fontSize="10">cliente_id</text>
      <rect x="185" y="82" width="85" height="18" rx="9" fill="#0D1117" stroke="#374151" />
      <text x="227" y="95" textAnchor="middle" fill="#9CA3AF" fontSize="9">molti-a-uno</text>

      <defs>
        <marker id="arrowRel" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill="#4B5563" />
        </marker>
      </defs>
    </svg>
  )
}

function DiagramWorkflow() {
  const states = [
    { label: 'Bozza', x: 20, color: '#6B7280' },
    { label: 'Confermato', x: 150, color: '#2563EB' },
    { label: 'Spedito', x: 300, color: '#F59E0B' },
    { label: 'Fatturato', x: 430, color: '#10B981' },
  ]
  return (
    <svg viewBox="0 0 560 90" className="w-full max-w-lg">
      {states.map((s, i) => (
        <g key={s.label}>
          <rect x={s.x} y="25" width="110" height="34" rx="17" fill={s.color + '22'} stroke={s.color} strokeWidth="1.5" />
          <text x={s.x + 55} y="46" textAnchor="middle" fill="#E5E7EB" fontSize="11" fontWeight="600">{s.label}</text>
          {i < states.length - 1 && (
            <line x1={s.x + 112} y1="42" x2={states[i + 1].x - 2} y2="42" stroke="#4B5563" strokeWidth="1.5" markerEnd="url(#arrowWf)" />
          )}
        </g>
      ))}
      <defs>
        <marker id="arrowWf" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill="#4B5563" />
        </marker>
      </defs>
    </svg>
  )
}

function DiagramFormula() {
  const chips = [
    { label: 'ordini.totale', x: 10, w: 110, color: '#2563EB' },
    { label: 'sum( )', x: 150, w: 70, color: '#F87171' },
    { label: 'Totale ordini', x: 250, w: 110, color: '#10B981' },
  ]
  return (
    <svg viewBox="0 0 380 60" className="w-full max-w-sm">
      {chips.map((c, i) => (
        <g key={c.label}>
          <rect x={c.x} y="15" width={c.w} height="30" rx="15" fill={c.color + '22'} stroke={c.color} strokeWidth="1.5" />
          <text x={c.x + c.w / 2} y="34" textAnchor="middle" fill="#E5E7EB" fontSize="10.5" fontWeight="600">{c.label}</text>
          {i < chips.length - 1 && (
            <line x1={c.x + c.w + 2} y1="30" x2={chips[i + 1].x - 2} y2="30" stroke="#4B5563" strokeWidth="1.5" markerEnd="url(#arrowFm)" />
          )}
        </g>
      ))}
      <defs>
        <marker id="arrowFm" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill="#4B5563" />
        </marker>
      </defs>
    </svg>
  )
}

function DiagramPublish() {
  const steps = [
    { label: 'Modifichi nel Builder', color: '#6B7280' },
    { label: 'Bozza', color: '#F59E0B' },
    { label: 'Pubblica', color: '#10B981' },
  ]
  return (
    <svg viewBox="0 0 420 60" className="w-full max-w-sm">
      {steps.map((s, i) => (
        <g key={s.label}>
          <rect x={10 + i * 145} y="15" width="125" height="30" rx="8" fill={s.color + '22'} stroke={s.color} strokeWidth="1.5" />
          <text x={10 + i * 145 + 62} y="34" textAnchor="middle" fill="#E5E7EB" fontSize="10.5" fontWeight="600">{s.label}</text>
          {i < steps.length - 1 && (
            <line x1={10 + i * 145 + 127} y1="30" x2={10 + (i + 1) * 145 - 2} y2="30" stroke="#4B5563" strokeWidth="1.5" markerEnd="url(#arrowPb)" />
          )}
        </g>
      ))}
      <defs>
        <marker id="arrowPb" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill="#4B5563" />
        </marker>
      </defs>
    </svg>
  )
}

function GuidedDiagram({ type }) {
  if (type === 'relation') return <DiagramRelation />
  if (type === 'workflow') return <DiagramWorkflow />
  if (type === 'formula') return <DiagramFormula />
  if (type === 'publish') return <DiagramPublish />
  return null
}

export { GuidedDiagram }
