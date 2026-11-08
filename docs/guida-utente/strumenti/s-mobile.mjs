import { avvia } from './cdp.mjs'
const b=await avvia({w:390,h:844,mobile:true}); const ko=[]
const passo=async(nome,fn)=>{ try{ await fn(); await b.foto(nome) }catch(e){ console.log('KO',nome,e.message); ko.push(nome); await b.foto(nome+'-KO') } }
const chiudi=async()=>{ await b.ev(`document.querySelectorAll('[role=menu]').forEach(e=>e.remove());[...document.querySelectorAll('button[aria-label="Chiudi"]')].forEach(e=>e.click());true`); await b.pausa(500) }
const dock=(n)=>b.clic(n,{sel:'nav[aria-label="Navigazione principale"] button, nav[aria-label="Navigazione principale"] a'})
try{
  await b.accedi()
  await passo('m01-dashboard',async()=>{ await b.pausa(500) })
  await passo('m02-dock-altro',async()=>{ await dock('Altro'); await b.pausa(600) })
  await b.accedi()
  await passo('m03-clienti',async()=>{ try{ await dock('Clienti') }catch(e){ await dock('Altro'); await b.clic('Clienti',{sel:'button,a'}) } await b.pausa(900) })
  await passo('m04-cliente-scheda',async()=>{ await b.clic('Giulia Bianchi',{sel:'tr,td,span,div,p'}); await b.pausa(1300) })
  await passo('m05-cliente-menu-funzioni',async()=>{ await b.clic('Altre funzioni',{sel:'button'}) }); await chiudi()
  await passo('m06-cliente-aiuto',async()=>{ await b.clic('Aiuto: come si usa',{sel:'button'}); await b.pausa(800) }); await chiudi()
  await b.accedi()
  await passo('m07-visite-calendario',async()=>{ try{ await dock('Attività') }catch(e){ await dock('Altro'); await b.clic('Attività',{sel:'button,a'}) } await b.pausa(1000); await b.scorri(200) })
}finally{ await b.chiudi() }
console.log('KO:',ko.join(','))
