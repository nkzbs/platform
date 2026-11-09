import { avvia } from './cdp.mjs'
const b=await avvia({w:1280,h:900})
try{
  await b.accedi()
  await b.clic('Impostazioni',{sel:'aside button, aside a, nav button, nav a'}); await b.pausa(900)
  await b.clic('Moduli',{sel:'nav button, button',esatto:true}); await b.pausa(1200)
  await b.clic('Carica i dati di esempio',{sel:'button',esatto:true}); await b.pausa(2500)
  await b.foto('134-dati-esempio')
  b.ev(`window.confirm=()=>true;true`)
  await b.clic('Togli i dati di esempio',{sel:'button',esatto:true}); await b.pausa(1500)
  await b.foto('135-dati-esempio-tolti')
}finally{ await b.chiudi?.() }
