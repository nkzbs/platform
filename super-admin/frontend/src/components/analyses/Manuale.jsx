import React from 'react'

// Il manuale dei processi: un documento da leggere, stampare o salvare in PDF (dal pulsante Stampa del browser). In copertina il riepilogo (quanti processi, cosa copre la
// Libreria, cosa va costruito), poi una scheda per processo. Palette fissa chiara: un documento stampato resta uguale in qualunque tema. Nessun prezzo, nessun cliente.
const BADGE = { utente: 'background:#ede9fe;color:#3c3489', sistema: 'background:#f5f5f4;color:#44403c', esterno: 'background:#fef3c7;color:#92400e' }
const CALLOUT = { nota: 'Nota', limite: 'Limite di processo', lezione: 'Lezione appresa' }
const COVER = { coperto: 'Coperto', da_valutare: 'Da valutare', da_costruire: 'Da costruire' }

function Grid({ items }) {
  const shown = items.filter((i) => i.value)
  if (!shown.length) return null
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,150px),1fr))', gap: 0, background: '#fff', border: '1px solid #d6d3d1', borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      {shown.map((i, k) => <div key={k} style={{ background: '#fff', padding: '10px 14px', boxShadow: 'inset 0 -1px 0 #e7e5e4, inset -1px 0 0 #e7e5e4' }}><div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.05em', color: '#78716c', fontWeight: 700, marginBottom: 3 }}>{i.label}</div><div style={{ fontSize: 14, color: '#1c1917' }}>{i.value}</div></div>)}
    </div>
  )
}

export default function Manuale({ analysis, modules }) {
  const modName = (id) => (modules.find((m) => m.id === id) || {}).name || ''
  const p = analysis.processi, b = analysis.blueprint, pr = analysis.profilo || {}
  const oggi = new Date().toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })
  return (
    <div id="manuale" style={{ background: '#fff', color: '#1c1917', fontFamily: 'system-ui,-apple-system,Segoe UI,sans-serif', lineHeight: 1.55, padding: 'clamp(14px, 4vw, 28px)', borderRadius: 12, border: '1px solid #d6d3d1', boxSizing: 'border-box', maxWidth: '100%', overflowWrap: 'anywhere', overflow: 'hidden' }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.08em', color: '#78716c', fontWeight: 700 }}>Manuale dei processi · {oggi}</div>
      <h1 style={{ fontSize: 'clamp(20px, 6vw, 26px)', margin: '4px 0 6px', fontWeight: 600 }}>{analysis.name}</h1>
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
      <div style={{ marginBottom: 24 }}>
        {p.map((x, i) => (
          <div key={i} style={{ borderTop: '1px solid #e7e5e4', padding: '8px 0' }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{i + 1}. {x.nome}</div>
            <div style={{ fontSize: 12.5, color: '#57534e' }}>{[x.reparto, modName(x.registry_module_id) || 'nessun modulo'].filter(Boolean).join(' · ')} · <span style={{ fontWeight: 600, color: x.copertura === 'coperto' ? '#166534' : x.copertura === 'da_costruire' ? '#991b1b' : '#57534e' }}>{COVER[x.copertura]}</span></div>
          </div>
        ))}
      </div>
      {p.map((x, i) => (
        <section key={i} style={{ pageBreakInside: 'avoid', marginBottom: 28 }}>
          <h2 style={{ fontSize: 18, margin: '0 0 8px', fontWeight: 600 }}>{i + 1}. {x.nome}</h2>
          <Grid items={[{ label: 'Reparto', value: x.reparto }, { label: 'Modulo', value: modName(x.registry_module_id) }, { label: 'Scopo', value: x.scopo }, { label: 'Cosa lo fa partire', value: x.evento_innesco }, { label: 'Cosa serve già pronto', value: x.input }, { label: 'Cosa produce', value: x.output }]} />
          {x.ruoli_coinvolti.length > 0 && <p style={{ margin: '0 0 10px', fontSize: 13 }}><b>Ruoli: </b>{x.ruoli_coinvolti.map((r, k) => <span key={k} style={{ ...Object.fromEntries((BADGE[r.tipo] || BADGE.utente).split(';').map((kv) => kv.split(':'))), padding: '2px 8px', borderRadius: 6, marginRight: 6, display: 'inline-block', fontSize: 12 }}>{r.nome}</span>)}</p>}
          {x.passaggi.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em', color: '#78716c', fontWeight: 700, marginBottom: 4 }}>Passaggi</div>
              {x.passaggi.map((st, k) => (
                <div key={k} style={{ display: 'flex', gap: 10, padding: '7px 0', borderTop: '1px solid #e7e5e4', background: st.tipo === 'decisione' ? '#fffbeb' : undefined }}>
                  <div style={{ flex: '0 0 22px', height: 22, borderRadius: st.tipo === 'decisione' ? 4 : 11, background: st.tipo === 'decisione' ? '#fde68a' : '#e7e5e4', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: st.tipo === 'decisione' ? 'rotate(45deg)' : undefined }}><span style={{ transform: st.tipo === 'decisione' ? 'rotate(-45deg)' : undefined }}>{k + 1}</span></div>
                  <div style={{ minWidth: 0, fontSize: 13 }}>
                    <div style={{ fontWeight: 600 }}>{st.tipo === 'decisione' ? 'Bivio: ' : ''}{st.titolo}{st.ruolo ? <span style={{ fontWeight: 400, color: '#57534e' }}> · {st.ruolo}</span> : null}</div>
                    {st.descrizione && <div style={{ color: '#44403c' }}>{st.descrizione}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
          {[['Eccezioni', x.eccezioni], ['Documenti collegati', x.documenti_collegati], ['Sistemi coinvolti', x.sistemi_coinvolti], ['KPI', x.kpi]].filter(([, v]) => v.length).map(([l, v]) => <p key={l} style={{ margin: '0 0 6px', fontSize: 13 }}><b>{l}: </b>{v.join(' · ')}</p>)}
          {x.callout.map((c, k) => <div key={k} style={{ borderLeft: '3px solid #a8a29e', background: '#fafaf9', padding: '8px 12px', margin: '8px 0', fontSize: 13 }}><b>{CALLOUT[c.tipo]}: </b>{c.testo}</div>)}
        </section>
      ))}
    </div>
  )
}
