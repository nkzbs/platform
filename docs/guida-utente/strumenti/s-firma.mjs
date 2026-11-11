// Schermate del flusso «Invia per la firma»: la scheda Documenti del cliente (con la richiesta già inviata), la mail che arriva al cliente (catturata da un server SMTP di prova) e la pagina di firma da telefono.
// Prima: un server SMTP di prova su 127.0.0.1:2525 collegato come posta in uscita, e una richiesta inviata a Mario Rossi (vedi LEGGIMI.md); il codice del link sta in /tmp/guida-mail/token.txt.
import fs from 'fs'
import { avvia } from './cdp.mjs'
const token = fs.readFileSync('/tmp/guida-mail/token.txt', 'utf8').trim()
const sez = process.argv[2] || 'tutto'
if (sez === 'tutto' || sez === 'scheda') {
  const b = await avvia({ w: 1280, h: 1300 })
  try {
    await b.accedi()
    await b.clic('Clienti', { sel: 'aside button, aside a, nav button, nav a' }); await b.pausa(1200)
    await b.clic('Mario Rossi', { sel: 'td, tr, a, button, div' }); await b.pausa(1500)
    await b.clic('Documenti', { sel: '[role=tab], button' }); await b.pausa(1200)
    await b.foto('140-documenti-firma')
  } finally { await b.chiudi?.() }
}
if (sez === 'tutto' || sez === 'mail') {
  const b = await avvia({ w: 760, h: 1000 })
  try { await b.vai('file:///tmp/guida-mail/mail.html'); await b.pausa(800); await b.foto('141-mail-firma') } finally { await b.chiudi?.() }
}
if (sez === 'tutto' || sez === 'pagina') {
  const b = await avvia({ w: 420, h: 760, mobile: true })
  try {
    // In locale il servizio di firma con codice non è collegato: per la figura si finge, solo nella pagina, che lo sia (come su un tenant con eSignature attivo).
    await b.cdp('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { const f = window.fetch; window.fetch = async (u, o) => { const r = await f(u, o); if (/\\/api\\/public-firma\\/[^/]+$/.test(String(u)) && (!o || !o.method || o.method === 'GET')) { const j = await r.clone().json(); j.codice = { disponibile: true, sms: true, tentativi_residui: 2 }; return new Response(JSON.stringify(j), { status: r.status, headers: { 'Content-Type': 'application/json' } }); } return r; }; })()` })
    await b.vai('http://localhost:5173/firma/' + token); await b.pausa(1500); await b.foto('142-firma-rivedi')
    await b.clic('Continua', { sel: 'button' }); await b.pausa(800); await b.foto('143-firma-scelta')
    await b.clic('Firma con un codice', { sel: 'button' }); await b.pausa(800); await b.foto('145-firma-codice')
    await b.clic('Indietro', { sel: 'button' }); await b.pausa(600)
    await b.clic('Stampa, firma e ricarica', { sel: 'button' }); await b.pausa(800); await b.foto('144-firma-carica')
  } finally { await b.chiudi?.() }
}
