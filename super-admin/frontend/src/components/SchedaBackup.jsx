import { useEffect, useState, useCallback } from 'react'

// Scheda unica dei backup di un tenant: i tre livelli, cosa copre ognuno, quando è l'ultima copia riuscita.
// Livello 1 = copie di Platform (database + allegati), 2 = copia fuori dal NAS, 3 = backup del disco di Linode (solo tenant su Linode).
const quando = (d) => (d ? new Date(d.includes('T') || d.includes('Z') ? d : d.replace(' ', 'T') + 'Z').toLocaleString('it-IT') : '—')
const fa = (ore) => (ore == null ? 'mai' : ore < 1 ? 'meno di un\'ora fa' : ore < 48 ? ore + ' ore fa' : Math.floor(ore / 24) + ' giorni fa')

function Livello({ n, titolo, sotto, tono, children }) {
  const colori = { ok: 'border-green-900/50', warn: 'border-amber-500/50', no: 'border-gray-800' }
  return (
    <div className={'rounded-lg border p-3 ' + (colori[tono] || colori.no)}>
      <div className="text-sm text-ink font-medium">{n}. {titolo}</div>
      <div className="text-xs text-gray-500 mt-0.5">{sotto}</div>
      <div className="text-xs text-gray-300 mt-2 space-y-1">{children}</div>
    </div>
  )
}

export default function SchedaBackup({ api, headers, slug, ricarica }) {
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
  return (
    <div className="mb-4 space-y-2">
      <div className="text-xs text-gray-500">Tre livelli di copia, ognuno per un guasto diverso. {st.automatico ? 'Backup automatico acceso.' : <span className="text-amber-400">Backup automatico spento: nessuna copia parte da sola.</span>}</div>
      <Livello n={1} titolo="Copie di Platform" sotto="Database e allegati, conservati su Super Admin. Servono per tornare a ieri o recuperare un dato cancellato." tono={l1.scoperto ? 'warn' : 'ok'}>
        <div>Ultimo backup: <b>{quando(l1.ultimo)}</b> ({fa(l1.eta_ore)}){l1.scoperto && <span className="text-amber-400"> — da più di {st.soglia_ore} ore: premi «Backup ora»</span>}</div>
        <div>Allegati: {l1.allegati.ultimo ? <>archiviati il {quando(l1.allegati.ultimo)} ({l1.allegati.dimensione_mb} MB)</> : 'nessun allegato archiviato'}{l1.allegati.errore && <span className="text-amber-400"> — ultimo tentativo non riuscito: {l1.allegati.errore}</span>}</div>
        <div>Copie conservate: {l1.copie}. Si tengono gli ultimi giorni, 4 settimane e 6 mesi.</div>
      </Livello>
      <Livello n={2} titolo="Copia fuori dal NAS" sotto="Una copia in un altro posto: se il NAS o il server spariscono, i dati esistono ancora." tono={l2.configurato && l2.ultimo ? 'ok' : 'warn'}>
        {l2.configurato ? <div>Ultima copia fuori: <b>{quando(l2.ultimo)}</b></div> : <div className="text-amber-400">Non configurata: scrivi l'indirizzo qui sotto, in «Backup off-site».</div>}
        <div>Ultima prova di ripristino: {l2.verifica ? <span className={l2.verifica.esito === 'ok' ? 'text-green-400' : 'text-red-400'}>{l2.verifica.esito === 'ok' ? 'riuscita' : 'FALLITA (' + l2.verifica.errore + ')'} il {quando(l2.verifica.quando)}</span> : 'non ancora fatta (si fa da sola una volta al mese)'}</div>
      </Livello>
      {st.livello3 && (
        <Livello n={3} titolo="Backup del disco su Linode" sotto="Un'istantanea di tutto il server. Serve se il server è rotto: riporta indietro l'intero disco, non un singolo dato." tono={disco && (disco.automatici || []).some((b) => b && b.disponibile) ? 'ok' : 'warn'}>
          {erroreDisco && <div className="text-amber-400">{erroreDisco}</div>}
          {disco && (disco.automatici || []).length === 0 && !disco.istantanea && <div className="text-amber-400">Nessuna copia del disco ancora: Linode ne fa una al giorno, la prima arriva dopo la creazione.</div>}
          {disco && [...(disco.automatici || []), disco.istantanea].filter(Boolean).map((b) => (
            <div key={b.id} className="flex items-center justify-between gap-2 flex-wrap">
              <span>{b.tipo === 'istantanea' ? 'Istantanea' : 'Automatico'} · {quando(b.finito || b.creato)} · {b.stato === 'successful' ? 'riuscito' : b.stato}{(b.dischi || []).length ? ' · ' + Math.round(b.dischi.reduce((a, x) => a + x.mb, 0) / 1024 * 10) / 10 + ' GB' : ''}</span>
              {b.disponibile && <button type="button" disabled={lavoro && lavoro.stato === 'in_corso'} onClick={() => ripristinaDisco(b)} className="text-cp-primary hover:opacity-80 disabled:opacity-40">Ripristina il server a questa copia</button>}
            </div>
          ))}
          {lavoro && lavoro.stato !== 'nessuno' && (
            <div className={'mt-2 rounded border p-2 ' + (lavoro.stato === 'errore' ? 'border-red-500/50 text-red-400' : lavoro.stato === 'finito' ? 'border-green-900/50 text-green-400' : 'border-gray-700')}>
              <div className="font-medium">{lavoro.stato === 'in_corso' ? 'Ripristino in corso…' : lavoro.stato === 'finito' ? 'Ripristino completato.' : 'Ripristino non riuscito: ' + lavoro.errore}</div>
              {(lavoro.fasi || []).slice(-4).map((f, i) => <div key={i} className="text-gray-400">{f}</div>)}
            </div>
          )}
          <div className="text-gray-500">Le copie Linode non contengono nulla di più dei dati già in Platform: servono a rimettere in piedi il server più in fretta.</div>
        </Livello>
      )}
    </div>
  )
}
