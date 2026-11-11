import React, { useState, useEffect } from 'react'

// La pagina pubblica di una richiesta di firma (/firma/<token>): senza login, pensata per il telefono del cliente. Tre passi: rivedi i documenti (si scaricano in PDF),
// firma e carica (la foto o la scansione di ognuno, più i consensi), fatto. Prende nome, logo e colore dell'agenzia da Impostazioni → Aspetto: nessun marchio di Platform.
const chiaro = (hex, q) => { const n = parseInt(hex.slice(1), 16); const m = (c) => Math.round(255 - (255 - c) * q).toString(16).padStart(2, '0'); return '#' + m((n >> 16) & 255) + m((n >> 8) & 255) + m(n & 255) }
const testoSu = (hex) => { const n = parseInt(hex.slice(1), 16); const l = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; return 0.2126 * l((n >> 16) & 255) + 0.7152 * l((n >> 8) & 255) + 0.0722 * l(n & 255) > 0.55 ? '#1c1917' : '#fff' }

export default function FirmaPage({ token }) {
  const [info, setInfo] = useState(null)
  const [passo, setPasso] = useState(1)
  const [file, setFile] = useState({})
  const [consensi, setConsensi] = useState({})
  const [errore, setErrore] = useState('')
  const [busy, setBusy] = useState(false)
  const [fatto, setFatto] = useState(false)
  useEffect(() => { fetch('/api/public-firma/' + encodeURIComponent(token)).then((r) => r.json()).then(setInfo).catch(() => setInfo({ valido: false, motivo: 'Non riesco a contattare il server: riprova tra poco.', agenzia: {} })) }, [token])

  const colore = (info && info.agenzia && /^#[0-9a-f]{6}$/i.test(info.agenzia.colore || '') && info.agenzia.colore) || '#1f4e79'
  const su = testoSu(colore)
  const css = `.fp{--c:${colore};--s:${su};--cs:${chiaro(colore, 0.12)};min-height:100vh;background:#f4f2ee;color:#1c1917;font:16px/1.55 system-ui,-apple-system,Segoe UI,sans-serif;padding-bottom:40px}
  .fp *{box-sizing:border-box}.fp-top{background:var(--c);color:var(--s);padding:16px max(16px,env(safe-area-inset-left));display:flex;gap:12px;align-items:center}
  .fp-logo{width:36px;height:36px;border-radius:8px;background:rgba(255,255,255,.18);display:grid;place-items:center;font:600 19px Georgia,serif;flex:none;overflow:hidden}.fp-logo img{max-width:100%;max-height:100%}
  .fp-nome{font:600 18px Georgia,serif}.fp-box{max-width:520px;margin:0 auto;padding:20px 16px}.fp h1{font:600 24px/1.2 Georgia,serif;margin:6px 0 10px}.fp p{margin:0 0 12px}
  .fp-prog{display:flex;gap:5px;margin:4px 0 18px}.fp-prog i{flex:1;height:5px;border-radius:3px;background:#dcd8d0}.fp-prog i.on{background:var(--c)}
  .fp-card{background:#fff;border:1px solid #e3dfd7;border-radius:12px;padding:14px 16px;margin-bottom:12px}.fp-card b{display:block;font:600 16px Georgia,serif}
  .fp-btn{display:block;width:100%;border:0;border-radius:10px;background:var(--c);color:var(--s);font:600 16px system-ui,sans-serif;padding:15px;text-align:center;text-decoration:none;cursor:pointer;margin-top:14px}.fp-btn[disabled]{opacity:.5}
  .fp-ghost{display:inline-block;margin-top:8px;background:none;border:0;padding:0;color:var(--c);font-weight:600;font-size:14px;text-decoration:none;cursor:pointer}.fp-err{color:#b3261e;font-size:14px;margin-top:10px}
  .fp label.k{display:flex;gap:10px;align-items:flex-start;font-size:14px;margin:10px 0 0}.fp input[type=checkbox]{width:20px;height:20px;accent-color:var(--c);flex:none;margin-top:2px}
  .fp-file{display:block;margin-top:10px;padding:12px;border:1.5px dashed var(--c);border-radius:10px;background:var(--cs);font-size:14px}.fp-file input{display:block;margin-top:6px;max-width:100%}
  .fp-tick{width:56px;height:56px;border-radius:50%;background:var(--cs);color:var(--c);display:grid;place-items:center;font-size:28px;margin:24px auto 10px}.fp-mut{color:#6b665f;font-size:14px}`

  const ok = info && info.valido
  const tutti = ok && info.documenti.every((d) => file[d.key])
  const invia = async () => {
    setErrore(''); setBusy(true)
    try {
      const fd = new FormData()
      info.documenti.forEach((d) => fd.append('file_' + d.key, file[d.key], file[d.key].name))
      fd.append('consensi', JSON.stringify(consensi))
      const r = await fetch('/api/public-firma/' + encodeURIComponent(token), { method: 'POST', body: fd })
      const d = await r.json().catch(() => ({}))
      if (r.ok) setFatto(true); else setErrore(d.error || 'Non riuscito: riprova.')
    } catch (e) { setErrore('Non riesco a contattare il server: riprova tra poco.') } finally { setBusy(false) }
  }
  const spunta = (key, campo, v) => setConsensi((c) => ({ ...c, [key]: { ...(c[key] || {}), [campo]: v } }))
  const az = (info && info.agenzia) || {}

  return (
    <div className="fp">
      <style>{css}</style>
      <div className="fp-top">
        <div className="fp-logo">{az.logo ? <img src={az.logo} alt="" /> : (az.nome || '·').charAt(0).toUpperCase()}</div>
        <div className="fp-nome">{az.nome || 'Documenti da firmare'}</div>
      </div>
      <div className="fp-box">
        {!info ? <p className="fp-mut">Un momento…</p>
          : fatto ? (
            <div style={{ textAlign: 'center' }}>
              <div className="fp-tick">✓</div><h1>Fatto, grazie</h1>
              <p className="fp-mut">Abbiamo ricevuto i documenti firmati. Ti abbiamo mandato una mail di conferma: conservala.</p>
            </div>
          ) : !ok ? (
            <div style={{ textAlign: 'center', paddingTop: 20 }}>
              {info.firmata && <div className="fp-tick">✓</div>}
              <h1>{info.firmata ? 'Già firmato' : 'Link non valido'}</h1><p className="fp-mut">{info.motivo}</p>
            </div>
          ) : (
            <>
              <div className="fp-prog"><i className="on" /><i className={passo >= 2 ? 'on' : ''} /><i /></div>
              {passo === 1 && (
                <>
                  <h1>Rivedi {info.documenti.length === 1 ? 'il documento' : 'i documenti'}</h1>
                  <p className="fp-mut">Scarica e leggi con calma. Nel passo dopo li firmi e ricarichi la foto: ci vogliono pochi minuti.</p>
                  {info.documenti.map((d) => (
                    <div className="fp-card" key={d.key}>
                      <b>{d.label}</b>
                      <a className="fp-ghost" href={'/api/public-firma/' + encodeURIComponent(token) + '/pdf/' + encodeURIComponent(d.key)} target="_blank" rel="noopener noreferrer">Scarica il PDF</a>
                    </div>
                  ))}
                  <button type="button" className="fp-btn" onClick={() => setPasso(2)}>Continua</button>
                </>
              )}
              {passo === 2 && (
                <>
                  <h1>Firma e carica</h1>
                  <p className="fp-mut">Stampa e firma a penna e fotografa il foglio, oppure firma il PDF con un'app sul telefono. Poi scegli il file qui sotto.</p>
                  {info.documenti.map((d) => (
                    <div className="fp-card" key={d.key}>
                      <b>{d.label}</b>
                      {d.consensi.map((c) => (
                        <label className="k" key={c.field}><input type="checkbox" checked={!!(consensi[d.key] && consensi[d.key][c.field])} onChange={(e) => spunta(d.key, c.field, e.target.checked)} />{c.label}</label>
                      ))}
                      <label className="fp-file">{file[d.key] ? '✓ ' + file[d.key].name : 'Foto o PDF del documento firmato'}
                        <input type="file" accept="application/pdf,image/*" onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) setFile((x) => ({ ...x, [d.key]: f })) }} />
                      </label>
                    </div>
                  ))}
                  {errore && <div className="fp-err">{errore}</div>}
                  <button type="button" className="fp-btn" disabled={!tutti || busy} onClick={invia}>{busy ? 'Invio…' : 'Invia i documenti firmati'}</button>
                  <button type="button" className="fp-ghost" onClick={() => setPasso(1)}>Indietro</button>
                </>
              )}
            </>
          )}
      </div>
    </div>
  )
}
