import { avvia } from './cdp.mjs'
const b=await avvia({w:1280,h:1100})
try{
  await b.accedi()
  await b.clic('Impostazioni',{sel:'aside button, aside a, nav button, nav a'}); await b.pausa(900)
  await b.clic('Moduli',{sel:'nav button, button'}); await b.pausa(1200)
  await b.clic('Controlla',{sel:'button',esatto:true}); await b.pausa(1800)
  await b.foto('130-controlla-tenant')
  await b.clic('Collaudo completo',{sel:'button',esatto:true}); await b.pausa(2500)
  await b.foto('131-collaudo-in-corso')
  for(let i=0;i<40;i++){ await b.pausa(3000); const t=await b.ev(`document.body.innerText.includes('Tutto funziona')||document.body.innerText.includes('prove superate')`); if(t) break }
  await b.pausa(800)
  await b.foto('132-collaudo-finito')
}finally{ await b.chiudi?.() }
