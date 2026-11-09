import { avvia } from './cdp.mjs'
const b=await avvia({w:1280,h:1500})
try{
  await b.accedi()
  await b.clic('Impostazioni',{sel:'aside button, aside a, nav button, nav a'}); await b.pausa(900)
  await b.clic('Guida',{sel:'nav button, button',esatto:true}); await b.pausa(1000)
  await b.clic('Genera dai moduli',{sel:'button',esatto:true}); await b.pausa(1500)
  await b.ev(`document.querySelector('details') && (document.querySelector('details').open = true); true`); await b.pausa(500)
  await b.foto('133-guida-tenant')
}finally{ await b.chiudi?.() }
