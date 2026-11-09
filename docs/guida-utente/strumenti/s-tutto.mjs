import { avvia } from './cdp.mjs'
import { execSync } from 'child_process'
const DB='/Users/nimakarimpour/Desktop/platform/core/backend/node_modules/better-sqlite3'
const sql=(q)=>execSync(`node -e "const D=require('${DB}');const d=new D('/tmp/platform-core-dev.db');${q}"`,{stdio:'pipe'}).toString()
const b=await avvia({w:1280,h:1000}); const ko=[]
const passo=async(nome,fn)=>{ try{ await fn(); await b.foto(nome) }catch(e){ console.log('KO',nome,e.message); ko.push(nome); await b.foto(nome+'-KO') } }
const chiudi=async()=>{ await b.ev(`document.querySelectorAll('[role=menu]').forEach(e=>e.remove());[...document.querySelectorAll('button[aria-label="Chiudi"]')].forEach(e=>e.click());true`); await b.pausa(500) }
const menu=(n)=>b.clic(n,{sel:'aside button, aside a, nav button, nav a'})
const riga=(t)=>b.clic(t,{sel:'tr,td,span,div,p'})
const solo=process.argv[2]||'tutto'
const sezione=(n)=>solo==='tutto'||solo===n
try{
  if(sezione('giro')){
    sql("d.prepare('UPDATE users SET giro_visto_at = NULL').run()")
    b._giro=true; await b.accedi(); await b.pausa(1500)
    await passo('100-giro-1',async()=>{})
    await passo('101-giro-3',async()=>{ await b.clic('Avanti',{sel:'button',esatto:true}); await b.pausa(900); await b.clic('Avanti',{sel:'button',esatto:true}); await b.pausa(1400) })
    await b.clic('Salta',{sel:'button',esatto:true}); await b.pausa(500); b._giro=false
  }
  if(sezione('dashboard')){
    await b.accedi()
    await passo('01-dashboard',async()=>{ await b.pausa(1500) })
    await passo('110-percorso-clic',async()=>{ await b.clic('In mandato',{sel:'button,a,div,span'}); await b.pausa(1500) })
    await b.accedi()
    await passo('02-dashboard-modifica',async()=>{ await b.clic('Modifica layout') })
    await b.accedi()
    await passo('93-dashboard-aggiungi-widget',async()=>{ await b.clic('Modifica layout'); await b.clic('Aggiungi widget',{sel:'button'}); await b.pausa(900) })
    await b.accedi()
    await passo('111-segnali-clic',async()=>{ await b.clic('provvigioni scadute',{sel:'button,a,div,span'}); await b.pausa(1500) })
  }
  if(sezione('base')){
    await passo('90-login',async()=>{ await b.vai('http://localhost:5173'); await b.ev(`localStorage.removeItem('platform_token');localStorage.removeItem('platform_user');true`); await b.vai('http://localhost:5173'); await b.pausa(800) })
    await b.accedi()
    await passo('01-dashboard',async()=>{ await b.pausa(1200) })
    await passo('102-dashboard-aiuto',async()=>{ await b.clic('Aiuto: come si lavora qui',{sel:'button'}); await b.pausa(900) }); await chiudi()
    await passo('02-dashboard-modifica',async()=>{ await b.clic('Modifica layout') })
    await b.accedi()
    await passo('93-dashboard-aggiungi-widget',async()=>{ await b.clic('Modifica layout'); await b.clic('Aggiungi widget',{sel:'button'}); await b.pausa(900) })
    await b.accedi()
    await passo('70-guida',async()=>{ await menu('Guida'); await b.pausa(1500) })
    await passo('71-guida-capitolo',async()=>{ await b.clic('Provvigioni',{sel:'button[aria-expanded]'}); await b.pausa(600); await b.scorri(500) })
  }
  if(sezione('clienti')){
    await b.accedi()
    await passo('10-clienti-elenco',async()=>{ await menu('Clienti') })
    await passo('11-clienti-nuovo',async()=>{ await b.clic('Nuovo',{esatto:true}); await b.pausa(700) }); await chiudi()
    await passo('12-clienti-scheda',async()=>{ await riga('Giulia Bianchi'); await b.pausa(1400) })
    await passo('13-clienti-scheda-giu',async()=>{ await b.scorri(650) })
    await b.scorri(0)
    await passo('14-clienti-documenti',async()=>{ await b.clic('Documenti',{sel:'button'}) })
    await passo('15-clienti-bozza-email',async()=>{ await b.clic('Auguri',{sel:'[role=menuitem]'}); await b.pausa(1500) })
    await chiudi(); await b.accedi(); await menu('Clienti'); await riga('Giulia Bianchi'); await b.pausa(1300)
    await passo('16-clienti-altre-funzioni',async()=>{ await b.clic('Altre funzioni',{sel:'button'}) })
    await passo('17-clienti-funzione-da-attivare',async()=>{ await b.clic('Verifica del soggetto e solvibilità',{sel:'[role=menuitem]'}); await b.pausa(600) })
    await passo('18-clienti-stato',async()=>{ await b.ev(`document.querySelectorAll('[role=menu]').forEach(e=>e.remove());true`); await b.clic('transizioni disponibili',{sel:'button,div,span'}); await b.pausa(600) })
    await passo('19-clienti-passaggio-bloccato',async()=>{ await b.clic('Cliente verificato',{sel:'button',nth:0}); await b.pausa(1200) })
    await chiudi()
  }
  if(sezione('immobili')){
    await b.accedi()
    await passo('20-immobili-elenco',async()=>{ await menu('Immobili') })
    await passo('21-immobili-scheda',async()=>{ await riga('Trilocale luminoso'); await b.pausa(1500) })
    await passo('22-immobili-scheda-giu',async()=>{ await b.scorri(700) })
    await b.scorri(0)
    await passo('23-immobili-valutazione',async()=>{ await b.clic('Valutazione di mercato',{sel:'button'}); await b.pausa(1200) }); await chiudi()
  }
  if(sezione('servizi')){
    await b.accedi(); await menu('Immobili'); await riga('Trilocale luminoso')
    console.log('attendo i servizi vicini (fino a 3 minuti)…')
    for(let i=0;i<36;i++){ await b.pausa(5000); if(await b.ev(`document.body.innerText.includes('Farmacie')`)) break }
    await passo('53-immobili-mappa',async()=>{ await b.ev(`(()=>{const e=[...document.querySelectorAll('*')].find(x=>x.children.length===0&&x.textContent.trim()==='Servizi vicini'||x.textContent.startsWith('Servizi vicini (entro'));if(e)e.scrollIntoView({block:'center'});return !!e})()`); await b.pausa(600) })
  }
  if(sezione('attivita')){
    await b.accedi()
    await passo('30-visite-calendario',async()=>{ await menu('Attività'); await b.pausa(1200) })
    await passo('92-visite-giorno',async()=>{ await b.clic('Secondo sopralluogo',{sel:'button,span,div'}); await b.pausa(600); await b.scorri(600) })
    await passo('31-visite-elenco',async()=>{ await b.scorri(0); await b.clic('Elenco',{sel:'button[role=tab]'}) })
    await passo('32-visite-nuova',async()=>{ await b.clic('Nuovo',{esatto:true}); await b.pausa(900) }); await chiudi()
    await passo('33-visite-scheda',async()=>{ await riga('Secondo sopralluogo'); await b.pausa(1400) }); await chiudi()
  }
  if(sezione('trattative')){
    await b.accedi()
    await passo('40-trattative-elenco',async()=>{ await menu('Trattative') })
    await passo('41-trattative-scheda',async()=>{ await riga('Bilocale Via Verdi'); await b.pausa(1500) })
    await passo('42-trattative-scheda-giu',async()=>{ await b.scorri(700) }); await chiudi()
  }
  if(sezione('provvigioni')){
    await b.accedi()
    await passo('50-provvigioni-elenco',async()=>{ await menu('Provvigioni') })
    await passo('51-provvigioni-scheda',async()=>{ await riga('Provvigione venditore'); await b.pausa(1500); await b.scorri(250) })
    await chiudi(); await b.accedi(); await menu('Provvigioni'); await riga('Provvigione acquirente'); await b.pausa(1400)
    await passo('52-provvigioni-sollecito-menu',async()=>{ await b.pausa(300) })
    await passo('91-sollecito',async()=>{ await b.clic('Sollecito di pagamento',{sel:'button'}); await b.pausa(1500) }); await chiudi()
  }
  if(sezione('altri')){
    for (const [n,k] of [['Quote societarie','60-quote-elenco'],['Richieste privacy','61-privacy-elenco']]) { await b.accedi(); await passo(k,async()=>{ await menu(n) }) }
  }
  if(sezione('impostazioni')){
    await b.accedi()
    await passo('80-impostazioni',async()=>{ await menu('Impostazioni'); await b.pausa(1500) })
    await passo('81-aspetto',async()=>{ await b.clic('Aspetto',{sel:'button'}); await b.pausa(1000) })
    await passo('107-aspetto-carattere',async()=>{ await b.ev(`(()=>{const e=document.querySelector('[role=radiogroup]');if(e)e.scrollIntoView({block:'center'});return !!e})()`); await b.pausa(900) })
    await passo('82-connessioni',async()=>{ await b.clic('Connessioni',{sel:'button'}); await b.pausa(1500) })
    await passo('94-openapi-pannello',async()=>{ await b.clic('OpenAPI.it',{sel:'button,div,span'}); await b.pausa(1500) })
    await passo('95-openapi-spese',async()=>{ await b.scorri(500) })
    await passo('96-openapi-giu',async()=>{ await b.scorri(1100) })
  }
  if(sezione('notifiche')){
    await b.accedi()
    await passo('108-notifiche',async()=>{ for(const t of ['mousePressed','mouseReleased']) await b.cdp('Input.dispatchMouseEvent',{type:t,x:27,y:887,button:'left',clickCount:1}); await b.pausa(1500) })
  }
  if(sezione('casella')){
    await b.accedi()
    await passo('104-da-fare-casella',async()=>{ await b.ev(`document.querySelector('input[type=checkbox][aria-label^="Segna come fatto: Promemoria"]')?.click();true`); await b.pausa(1500) })
  }
}finally{ await b.chiudi() }
console.log('KO:',ko.join(','))
