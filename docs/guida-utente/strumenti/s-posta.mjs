import { avvia } from './cdp.mjs'
const b=await avvia({w:1280,h:1100})
const passo=async(nome,fn)=>{ try{ await fn(); await b.foto(nome) }catch(e){ console.log('KO',nome,e.message); await b.foto(nome+'-KO') } }
const menu=(n)=>b.clic(n,{sel:'aside button, aside a, nav button, nav a'})
try{
  await b.accedi()
  await passo('120-impostazioni-posta',async()=>{ await menu('Impostazioni'); await b.pausa(900); await b.clic('Connessioni',{sel:'nav button, button'}); await b.pausa(1200) })
  await passo('121-posta-smtp',async()=>{ await b.clic('Posta in uscita — SMTP',{sel:'button'}); await b.pausa(800) })
  await passo('122-messaggi-clienti',async()=>{ await b.clic('Messaggi ai clienti',{sel:'nav button, button'}); await b.pausa(1200) })
}finally{ await b.chiudi?.() }
