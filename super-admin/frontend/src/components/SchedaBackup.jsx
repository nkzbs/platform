import { useEffect, useState, useCallback } from 'react'

// Scheda unica dei backup di un tenant: i tre livelli, cosa copre ognuno, quando è l'ultima copia riuscita.
// Livello 1 = copie di Platform (database + allegati), 2 = copia fuori dal NAS, 3 = backup del disco di Linode (solo tenant su Linode).
const quando = (d) => (d ? new Date(d.includes('T') || d.includes('Z') ? d : d.replace(' ', 'T') + 'Z').toLocaleString('it-IT') : '—')
const fa = (ore) => (ore == null ? 'mai' : ore < 1 ? 'meno di un\'ora fa' : ore < 48 ? ore + ' ore fa' : Math.floor(ore / 24) + ' giorni fa')

export default function SchedaBackup({ api, headers, slug, ricarica, sezione, chiudi }) {
  const [st, setSt] = useState(null)
  const [disco, setDisco] = useState(null)
  const [erroreDisco, setErroreDisco] = useState(null)
  const [lavoro, setLavoro] = useState(null)

  const carica = useCallback(async () => {
    const r = await fetch(api + '/tenants/' + slug + '/backup-stato', { headers })
    if (r.ok) setSt(await r.json())
  }, [api, headers, slug])
  const caricaDisco = useCallback(async () => {
    setErroreDisco(null)
    const r = await fetch(api + '/tenants/' + slug + '/backup-disco', { headers })
    const d = await r.json().catch(() => ({}))
    if (r.ok) setDisco(d); else setErroreDisco(d.error || 'Non riesco a leggere i backup del disco.')
  }, [api, headers, slug])
  const seguiLavoro = useCallback(async () => {
    const r = await fetch(api + '/tenants/' + slug + '/backup-disco/ripristino', { headers })
    if (r.ok) setLavoro(await r.json())
  }, [api, headers, slug])

  useEffect(() => { carica() }, [carica])
  useEffect(() => { if (st && st.host === 'linode') { caricaDisco(); seguiLavoro() } }, [st && st.host]) // eslint-disable-line
  useEffect(() => {
    if (!lavoro || lavoro.stato !== 'in_corso') return undefined
    const t = setInterval(seguiLavoro, 5000)
    return () => clearInterval(t)
  }, [lavoro && lavoro.stato]) // eslint-disable-line
  useEffect(() => { if (lavoro && lavoro.stato === 'finito') { carica(); caricaDisco(); if (ricarica) ricarica() } }, [lavoro && lavoro.stato]) // eslint-disable-line

  const ripristinaDisco = async (b) => {
    const scritto = window.prompt('Il ripristino riporta TUTTO il server a com\'era il ' + quando(b.creato) + ': quello che è stato fatto dopo si perde. Prima faccio una copia di sicurezza di Platform e spengo il server per qualche minuto.\n\nPer confermare scrivi il nome del tenant: ' + slug)
    if (scritto == null) return
    const r = await fetch(api + '/tenants/' + slug + '/backup-disco/' + b.id + '/ripristina', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ conferma: scritto.trim() }) })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) { window.alert(d.error || 'Non riuscito.'); return }
    setLavoro({ stato: 'in_corso', fasi: ['Avvio…'] })
    setTimeout(seguiLavoro, 1500)
  }

  if (!st) return null
  const l1 = st.livello1, l2 = st.livello2
  // Una sola frase di stato: tutto in ordine, oppure la prima cosa che non va.
  const problemi = []
  if (!st.automatico) problemi.push('il backup automatico è spento')
  if (l1.scoperto) problemi.push(l1.ultimo ? 'l\'ultimo backup è di ' + fa(l1.eta_ore) : 'non c\'è ancora nessun backup')
  if (l1.allegati.errore) problemi.push('gli allegati non si sono salvati')
  if (l2.verifica && l2.verifica.esito !== 'ok') problemi.push('l\'ultima prova di ripristino è fallita')
  const tutto = problemi.length === 0
  const nota = []
  nota.push(l1.allegati.ultimo ? 'database e allegati' : 'database')
  nota.push(l2.configurato && l2.ultimo ? 'copia fuori dal NAS' : 'nessuna copia fuori dal NAS')
  if (st.livello3) nota.push('disco del server')
  return (
    <div className="mb-4 space-y-3">
      <div className={'rounded-lg border p-3 ' + (tutto ? 'border-green-900/50' : 'border-amber-500/50')}>
        <div className={'text-sm font-medium ' + (tutto ? 'text-green-400' : 'text-amber-400')}>{tutto ? 'Tutto in ordine' : 'Attenzione: ' + problemi.join(', ')}</div>
        <div className="text-xs text-gray-400 mt-1">Ultimo backup: {l1.ultimo ? quando(l1.ultimo) + ' (' + fa(l1.eta_ore) + ')' : 'nessuno'}</div>
        <div className="text-xs text-gray-600 mt-0.5">Protetto con: {nota.join(' · ')}</div>
      </div>

      {sezione === 'copie' && (
        <Dettaglio titolo="Copie salvate" chiudi={chiudi}>
          <div>Allegati: {l1.allegati.ultimo ? <>archiviati il {quando(l1.allegati.ultimo)} ({l1.allegati.dimensione_mb} MB)</> : 'nessun allegato archiviato'}{l1.allegati.errore && <span className="text-amber-400"> — ultimo tentativo non riuscito: {l1.allegati.errore}</span>}</div>
          <div>Copie conservate: {l1.copie} (gli ultimi giorni, 4 settimane e 6 mesi).</div>
        </Dettaglio>
      )}
      {sezione === 'fuori' && (
        <Dettaglio titolo="Copia fuori dal NAS" chiudi={chiudi}>
          {l2.configurato ? <div>Ultima copia fuori: <b>{quando(l2.ultimo)}</b></div> : <div className="text-amber-400">Non configurata: scrivi l'indirizzo qui sotto.</div>}
          <div>Ultima prova di ripristino: {l2.verifica ? <span className={l2.verifica.esito === 'ok' ? 'text-green-400' : 'text-red-400'}>{l2.verifica.esito === 'ok' ? 'riuscita' : 'FALLITA (' + l2.verifica.errore + ')'} il {quando(l2.verifica.quando)}</span> : 'non ancora fatta (si fa da sola una volta al mese)'}</div>
        </Dettaglio>
      )}
      {sezione === 'disco' && st.livello3 && (
        <Dettaglio titolo="Disco del server (Linode)" chiudi={chiudi}>
          <div className="text-gray-500">Un'istantanea di tutto il server: serve se il server è rotto. Riporta indietro l'intero disco, non un singolo dato.</div>
          {erroreDisco && <div className="text-amber-400">{erroreDisco}</div>}
          {disco && (disco.automatici || []).length === 0 && !disco.istantanea && <div className="text-amber-400">Nessuna copia del disco ancora: Linode ne fa una al giorno, la prima arriva dopo la creazione.</div>}
          {disco && [...(disco.automatici || []), disco.istantanea].filter(Boolean).map((b) => (
            <div key={b.id} className="flex items-center justify-between gap-2 flex-wrap">
              <span>{quando(b.finito || b.creato)} · {b.stato === 'successful' ? 'riuscito' : b.stato}{(b.dischi || []).length ? ' · ' + Math.round(b.dischi.reduce((a, x) => a + x.mb, 0) / 1024 * 10) / 10 + ' GB' : ''}</span>
              {b.disponibile && <button type="button" disabled={lavoro && lavoro.stato === 'in_corso'} onClick={() => ripristinaDisco(b)} className="text-cp-primary hover:opacity-80 disabled:opacity-40">Ripristina il server a questa copia</button>}
            </div>
          ))}
          {lavoro && lavoro.stato !== 'nessuno' && (
            <div className={'mt-2 rounded border p-2 ' + (lavoro.stato === 'errore' ? 'border-red-500/50 text-red-400' : lavoro.stato === 'finito' ? 'border-green-900/50 text-green-400' : 'border-gray-700')}>
              <div className="font-medium">{lavoro.stato === 'in_corso' ? 'Ripristino in corso…' : lavoro.stato === 'finito' ? 'Ripristino completato.' : 'Ripristino non riuscito: ' + lavoro.errore}</div>
              {(lavoro.fasi || []).slice(-4).map((f, i) => <div key={i} className="text-gray-400">{f}</div>)}
            </div>
          )}
        </Dettaglio>
      )}
    </div>
  )
}

function Dettaglio({ titolo, chiudi, children }) {
  return (
    <div className="rounded-lg border border-gray-800 p-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-ink font-medium">{titolo}</div>
        {chiudi && <button type="button" onClick={chiudi} className="text-xs text-gray-500 hover:text-gray-300">Chiudi</button>}
      </div>
      <div className="text-xs text-gray-300 mt-2 space-y-1">{children}</div>
    </div>
  )
}
