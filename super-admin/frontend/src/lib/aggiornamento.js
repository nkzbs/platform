import { useSyncExternalStore } from 'react'
import { API } from './api'

// L'aggiornamento di un tenant (Super Admin → Tenant → Aggiorna) vive qui, fuori dalle pagine: continua se cambi pagina e si può ridurre a una pastiglia
// (il lavoro lo fa il server, qui si legge solo lo stream dei passi). Un solo aggiornamento alla volta.
// stato: { upd: { t, lines: [{at,msg}], state: 'running'|'ok'|'ko'|'busy', note } | null, minimizzata }
let stato = { upd: null, minimizzata: false }
const ascoltatori = new Set()
const alleFine = new Set()
const emetti = () => ascoltatori.forEach((f) => f())
const imposta = (patch) => { stato = { ...stato, ...(typeof patch === 'function' ? patch(stato) : patch) }; emetti() }
const aggiornaUpd = (patch) => imposta((s) => (s.upd ? { upd: { ...s.upd, ...(typeof patch === 'function' ? patch(s.upd) : patch) } } : {}))

const iscriviti = (f) => { ascoltatori.add(f); return () => ascoltatori.delete(f) }
export const useAggiornamento = () => useSyncExternalStore(iscriviti, () => stato)
// `cb` si chiama quando un aggiornamento finisce (comunque sia finito): serve alla lista dei tenant per ricaricarsi.
export const allaFine = (cb) => { alleFine.add(cb); return () => alleFine.delete(cb) }

export const minimizza = () => imposta({ minimizzata: true })
export const riapri = () => imposta({ minimizzata: false })
export const chiudi = () => { if (!stato.upd || stato.upd.state !== 'running') imposta({ upd: null, minimizzata: false }) }

export async function avvia(t, force, token) {
  if (stato.upd && stato.upd.state === 'running') return // uno alla volta
  imposta({ upd: { t, lines: [], state: 'running', note: '' }, minimizzata: false })
  const add = (msg, at) => aggiornaUpd((u) => ({ lines: [...u.lines, { at: at || new Date().toISOString(), msg }] }))
  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }
  try {
    const res = await fetch(API + '/tenants/' + t.slug + '/redeploy?stream=1', { method: 'POST', headers, body: JSON.stringify({ force: !!force }) })
    if (!res.ok || !res.body) { const d = await res.json().catch(() => ({})); add('Errore: ' + (d.error || res.status)); aggiornaUpd({ state: 'ko' }); return }
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ''; let last = null
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1)
        if (!line) continue
        let o; try { o = JSON.parse(line) } catch (e) { continue }
        if (o.msg) add(o.msg, o.at)
        if (o.done) last = o
      }
    }
    if (!last) aggiornaUpd({ state: 'ko', note: 'Collegamento interrotto: controlla lo stato nei Dettagli.' })
    else if (last.ok) aggiornaUpd({ state: last.healthy === false ? 'ko' : 'ok', note: last.healthy === false ? 'Il container è stato ricreato ma il tenant non risponde ancora.' : '' })
    else if (last.skipped === 'active_session') aggiornaUpd({ state: 'busy', note: 'Sessione attiva: ' + last.active_session.username })
    else aggiornaUpd({ state: 'ko', note: last.error || '' })
  } catch (e) {
    add('Errore di rete: ' + e.message); aggiornaUpd({ state: 'ko' })
  } finally {
    // a lavoro finito la finestra si riapre da sola: è il momento di leggere l'esito
    imposta({ minimizzata: false })
    alleFine.forEach((f) => { try { f() } catch (e) { /* una lista che non si ricarica non deve fermare le altre */ } })
  }
}
