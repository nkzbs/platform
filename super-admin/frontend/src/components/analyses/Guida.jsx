import React from 'react'

// La guida all'uso del verticale: come si lavora, ruolo per ruolo, processo per processo e modulo per modulo. Un documento da leggere o salvare in PDF
// (stesso stile e stessa stampa del Manuale). Viene da GET /analyses/:id/guida, costruita dai dati dell'analisi e dei moduli: nessuna AI.
const H2 = { fontSize: 17, margin: '22px 0 8px', fontWeight: 600 }
const SMALL = { fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.05em', color: '#78716c', fontWeight: 700, marginBottom: 3 }
const Elenco = ({ titolo, voci }) => (voci && voci.length ? <p style={{ margin: '0 0 6px', fontSize: 13 }}><b>{titolo}: </b>{voci.join(' · ')}</p> : null)

export default function Guida({ guida: g }) {
  const oggi = new Date().toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })
  return (
    <div id="guida" className="doc-stampa" style={{ background: '#fff', color: '#1c1917', fontFamily: 'system-ui,-apple-system,Segoe UI,sans-serif', lineHeight: 1.55, padding: 'clamp(14px, 4vw, 28px)', borderRadius: 12, border: '1px solid #d6d3d1', boxSizing: 'border-box', maxWidth: '100%', overflowWrap: 'anywhere', overflow: 'hidden' }}>
      <div className="copertina">
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.08em', color: '#78716c', fontWeight: 700 }}>Guida all'uso · {oggi}</div>
        <h1 style={{ fontSize: 'clamp(22px, 6vw, 30px)', margin: '4px 0 8px', fontWeight: 600 }}>{g.nome}</h1>
        {g.descrizione && <p style={{ fontSize: 14, color: '#44403c', margin: '0 0 14px' }}>{g.descrizione}</p>}
        <p style={{ fontSize: 13, color: '#44403c', margin: '0 0 14px' }}>Come si lavora con questo gestionale: cosa fa ciascuno, quali sono i passi di ogni processo e a cosa serve ogni modulo.</p>
        <h2 style={H2}>In questa guida</h2>
        <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13.5 }}>
          <li>Primi passi</li>{g.ruoli.length > 0 && <li>Cosa fa ciascuno ({g.ruoli.length} ruoli)</li>}<li>I processi ({g.processi.length})</li><li>I moduli ({g.moduli.length})</li>{(g.report.length > 0 || g.ai.length > 0) && <li>Avvisi e assistente</li>}
        </ol>
      </div>

      <h2 style={{ ...H2, marginTop: 0 }}>1. Primi passi</h2>
      <ol style={{ margin: '0 0 8px', paddingLeft: 20, fontSize: 13.5 }}>
        <li style={{ marginBottom: 4 }}><b>Entra</b> con l'indirizzo e le credenziali ricevute. Il primo accesso dell'amministratore chiede di cambiare la password.</li>
        <li style={{ marginBottom: 4 }}><b>Aggiungi le persone</b> in Impostazioni → Utenti &amp; Ruoli e dai a ciascuna il suo ruolo{g.ruoli.length > 0 ? ' (' + g.ruoli.map((r) => r.nome).join(', ') + ')' : ''}.</li>
        <li style={{ marginBottom: 4 }}><b>Inserisci i primi dati</b> nei moduli qui sotto, cominciando da quelli a cui gli altri si collegano.</li>
        <li><b>Collega gli avvisi</b> in Impostazioni → Connessioni (Telegram, WhatsApp o posta) se vuoi ricevere i riepiloghi.</li>
      </ol>

      {g.ruoli.length > 0 && (
        <>
          <h2 style={H2}>2. Cosa fa ciascuno</h2>
          {g.ruoli.map((r, i) => (
            <section key={i} className="scheda" style={{ borderTop: '1px solid #e7e5e4', padding: '10px 0' }}>
              <h3 style={{ fontSize: 15, margin: '0 0 4px', fontWeight: 600 }}>{r.nome}</h3>
              <Elenco titolo="Partecipa a" voci={r.processi} />
              {r.passaggi.length > 0 && <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 13 }}>{r.passaggi.map((p, k) => <li key={k} className="riga"><b>{p.titolo}</b> <span style={{ color: '#78716c' }}>({p.processo})</span>{p.descrizione ? ' — ' + p.descrizione : ''}</li>)}</ul>}
            </section>
          ))}
        </>
      )}

      <h2 style={H2}>{g.ruoli.length > 0 ? '3' : '2'}. I processi</h2>
      {g.processi.map((p, i) => (
        <section key={i} className="scheda" style={{ borderTop: '1px solid #e7e5e4', padding: '10px 0' }}>
          <h3 style={{ fontSize: 15, margin: '0 0 4px', fontWeight: 600 }}>{p.nome}{p.reparto ? <span style={{ fontWeight: 400, color: '#78716c' }}> · {p.reparto}</span> : null}</h3>
          {p.scopo && <p style={{ margin: '0 0 4px', fontSize: 13 }}>{p.scopo}</p>}
          <p style={{ margin: '0 0 4px', fontSize: 13 }}>{p.modulo ? <>Si lavora nel modulo <b>{p.modulo}</b>.</> : <b style={{ color: '#991b1b' }}>Nessun modulo ancora: da costruire.</b>}</p>
          {p.quando && <p style={{ margin: '0 0 4px', fontSize: 13 }}><b>Parte quando: </b>{p.quando}</p>}
          {p.passaggi.length > 0 && <ol style={{ margin: '4px 0', paddingLeft: 20, fontSize: 13 }}>{p.passaggi.map((s, k) => <li key={k} className="riga">{s.tipo === 'decisione' ? <i>Bivio: </i> : null}<b>{s.titolo}</b>{s.ruolo ? <span style={{ color: '#57534e' }}> ({s.ruolo})</span> : null}{s.descrizione ? ' — ' + s.descrizione : ''}</li>)}</ol>}
          <Elenco titolo="Se qualcosa va storto" voci={p.eccezioni} />
          <Elenco titolo="Come capisci che va bene" voci={p.kpi} />
        </section>
      ))}

      <h2 style={H2}>{g.ruoli.length > 0 ? '4' : '3'}. I moduli</h2>
      {g.moduli.map((m, i) => (
        <section key={i} className="scheda" style={{ borderTop: '1px solid #e7e5e4', padding: '10px 0' }}>
          <h3 style={{ fontSize: 15, margin: '0 0 4px', fontWeight: 600 }}>{m.nome}{m.gruppo ? <span style={{ fontWeight: 400, color: '#78716c' }}> · {m.gruppo}</span> : null}</h3>
          {m.descrizione && <p style={{ margin: '0 0 6px', fontSize: 13 }}>{m.descrizione}</p>}
          {m.campi.length > 0 && <><div style={SMALL}>Cosa si compila</div><ul style={{ margin: '0 0 6px', paddingLeft: 18, fontSize: 13 }}>{m.campi.map((f, k) => <li key={k}>{f.nome} <span style={{ color: '#78716c' }}>({f.tipo}{f.scelte && f.scelte.length ? ': ' + f.scelte.join(', ') : ''})</span></li>)}</ul></>}
          {m.stati.length > 0 && <p style={{ margin: '0 0 4px', fontSize: 13 }}><b>Passa da uno stato all'altro: </b>{m.stati.join(' → ')}</p>}
          <Elenco titolo="Si collega a" voci={m.collegamenti} />
        </section>
      ))}

      {(g.report.length > 0 || g.ai.length > 0) && (
        <section className="scheda">
          <h2 style={H2}>{g.ruoli.length > 0 ? '5' : '4'}. Avvisi e assistente</h2>
          {g.report.length > 0 && <><div style={SMALL}>Report (spenti all'inizio, si accendono in Impostazioni → Report)</div><ul style={{ margin: '0 0 8px', paddingLeft: 18, fontSize: 13 }}>{g.report.map((r, k) => <li key={k}><b>{r.nome}</b> — {r.perche}</li>)}</ul></>}
          {g.ai.length > 0 && <><div style={SMALL}>Assistente AI (su richiesta, mai da solo)</div><ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>{g.ai.map((a, k) => <li key={k}><b>{a.modulo}</b>: {a.cosa}</li>)}</ul></>}
        </section>
      )}
      {g.da_costruire.length > 0 && <p style={{ fontSize: 13, marginTop: 14 }}><b>Ancora da costruire: </b>{g.da_costruire.join(', ')}.</p>}
    </div>
  )
}
