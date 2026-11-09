import { avvia } from './cdp.mjs'
const b=await avvia({w:1280,h:1100})
try{
  await b.accedi()
  await b.clic('Impostazioni',{sel:'aside button, aside a, nav button, nav a'}); await b.pausa(900)
  await b.clic('Moduli',{sel:'nav button, button'}); await b.pausa(1200)
  await b.clic('Controlla',{sel:'button',esatto:true}); await b.pausa(1800)
  await b.foto('130-controlla-tenant')
}finally{ await b.chiudi?.() }
