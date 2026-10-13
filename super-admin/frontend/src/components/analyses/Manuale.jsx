import React from 'react'

// Il manuale dei processi: un documento da leggere, stampare o salvare in PDF (dal pulsante Stampa del browser). In copertina il riepilogo (quanti processi, cosa copre la
// Libreria, cosa va costruito), poi una scheda per processo. Palette fissa chiara: un documento stampato resta uguale in qualunque tema. Nessun prezzo, nessun cliente.
const BADGE = { utente: 'background:#ede9fe;color:#3c3489', sistema: 'background:#f5f5f4;color:#44403c', esterno: 'background:#fef3c7;color:#92400e' }
const CALLOUT = { nota: 'Nota', limite: 'Limite di processo', lezione: 'Lezione appresa' }
const COVER = { coperto: 'Coperto', da_valutare: 'Da valutare', da_costruire: 'Da costruire' }
const cell = { border: '1px solid #d6d3d1', padding: '8px 10px', verticalAlign: 'top', fontSize: 13 }

function Grid({ items }) {
  const shown = items.filter((i) => i.value)
  if (!shown.length) return null
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 1, background: '#d6d3d1', border: '1px solid #d6d3d1', borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      {shown.map((i, k) => <div key={k} style={{ background: '#fff', padding: '10px 14px' }}><div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.05em', color: '#78716c', fontWeight: 700, marginBottom: 3 }}>{i.label}</div><div style={{ fontSize: 14, color: '#1c1917' }}>{i.value}</div></div>)}
    </div>
  )
}

export default function Manuale({ analysis, modules }) {
  const modName = (id) => (modules.find((m) => m.id === id) || {}).name || ''
  const p = analysis.processi, b = analysis.blueprint, pr = analysis.profilo || {}
  const oggi = new Date().toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })
  return (
    <div id="manuale" style={{ background: '#fff', color: '#1c1917', fontFamily: 'system-ui,-apple-system,Segoe UI,sans-serif', lineHeight: 1.55, padding: '28px 24px', borderRadius: 12, border: '1px solid #d6d3d1' }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.08em', color: '#78716c', fontWeight: 700 }}>Manuale dei processi · {oggi}</div>
      <h1 style={{ fontSize: 26, margin: '4px 0 6px', fontWeight: 600 }}>{analysis.name}</h1>
      {analysis.descrizione && <p style={{ fontSize: 14, color: '#44403c', margin: '0 0 16px' }}>{analysis.descrizione}</p>}
      <Grid items={[
        { label: 'Settore', value: pr.settore }, { label: 'Dimensione', value: pr.dimensione }, { label: 'Dipendenti', value: pr.numero_dipendenti || '' }, { label: 'Sedi', value: pr.numero_sedi || '' },
        { label: 'Reparti', value: (pr.reparti || []).join(', ') }, { label: 'Sistemi in uso', value: (pr.sistemi_esistenti || []).join(', ') }, { label: 'Obiettivi', value: pr.obiettivi }, { label: 'Criticità', value: pr.criticita },
      ]} />
      <h2 style={{ fontSize: 17, margin: '8px 0 8px', fontWeight: 600 }}>Riepilogo</h2>
      <Grid items={[
        { label: 'Processi', value: String(b.processi) }, { label: 'Coperti da moduli', value: String(b.coperto) }, { label: 'Da valutare', value: String(b.da_valutare) },
        { label: 'Da costruire', value: b.da_costruire.length ? b.da_costruire.join(', ') : '' }, { label: 'Ruoli utente', value: String(b.ruoli_utente) },
      ]} />
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 24 }}>
        <thead><tr style={{ background: '#f5f5f4' }}>{['Processo', 'Reparto', 'Modulo', 'Copertura'].map((h) => <th key={h} style={{ ...cell, textAlign: 'left', fontSize: 11, textTransform: 'uppercase', color: '#78716c' }}>{h}</th>)}</tr></thead>
        <tbody>{p.map((x, i) => <tr key={i}><td style={cell}>{x.nome}</td><td style={cell}>{x.reparto}</td><td style={cell}>{modName(x.registry_module_id)}</td><td style={cell}>{COVER[x.copertura]}</td></tr>)}</tbody>
      </table>
      {p.map((x, i) => (
        <section key={i} style={{ pageBreakInside: 'avoid', marginBottom: 28 }}>
          <h2 style={{ fontSize: 18, margin: '0 0 8px', fontWeight: 600 }}>{i + 1}. {x.nome}</h2>
          <Grid items={[{ label: 'Reparto', value: x.reparto }, { label: 'Modulo', value: modName(x.registry_module_id) }, { label: 'Scopo', value: x.scopo }, { label: 'Cosa lo fa partire', value: x.evento_innesco }, { label: 'Cosa serve già pronto', value: x.input }, { label: 'Cosa produce', value: x.output }]} />
          {x.ruoli_coinvolti.length > 0 && <p style={{ margin: '0 0 10px', fontSize: 13 }}><b>Ruoli: </b>{x.ruoli_coinvolti.map((r, k) => <span key={k} style={{ ...Object.fromEntries((BADGE[r.tipo] || BADGE.utente).split(';').map((kv) => kv.split(':'))), padding: '2px 8px', borderRadius: 6, marginRight: 6, display: 'inline-block', fontSize: 12 }}>{r.nome}</span>)}</p>}
          {x.passaggi.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 10 }}>
              <thead><tr style={{ background: '#f5f5f4' }}>{['#', 'Passaggio', 'Ruolo', 'Dettaglio'].map((h) => <th key={h} style={{ ...cell, textAlign: 'left', fontSize: 11, textTransform: 'uppercase', color: '#78716c' }}>{h}</th>)}</tr></thead>
              <tbody>{x.passaggi.map((s, k) => <tr key={k} style={s.tipo === 'decisione' ? { background: '#fffbeb' } : undefined}><td style={cell}>{k + 1}</td><td style={cell}>{s.tipo === 'decisione' ? 'Bivio: ' : ''}{s.titolo}</td><td style={cell}>{s.ruolo}</td><td style={cell}>{s.descrizione}</td></tr>)}</tbody>
            </table>
          )}
          {[['Eccezioni', x.eccezioni], ['Documenti collegati', x.documenti_collegati], ['Sistemi coinvolti', x.sistemi_coinvolti], ['KPI', x.kpi]].filter(([, v]) => v.length).map(([l, v]) => <p key={l} style={{ margin: '0 0 6px', fontSize: 13 }}><b>{l}: </b>{v.join(' · ')}</p>)}
          {x.callout.map((c, k) => <div key={k} style={{ borderLeft: '3px solid #a8a29e', background: '#fafaf9', padding: '8px 12px', margin: '8px 0', fontSize: 13 }}><b>{CALLOUT[c.tipo]}: </b>{c.testo}</div>)}
        </section>
      ))}
    </div>
  )
}
