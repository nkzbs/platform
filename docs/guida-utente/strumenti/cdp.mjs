import { spawn } from 'child_process'
import fs from 'fs'
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT=9333, BASE='http://localhost:5173', API='http://localhost:3000/api'
export async function avvia({w=1280,h=860,mobile=false}={}){
  const dir=fs.mkdtempSync('/tmp/chr-')
  const proc=spawn(CHROME,['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port='+PORT,'--user-data-dir='+dir,'--hide-scrollbars','about:blank'],{stdio:'ignore'})
  let ws; for(let i=0;i<60;i++){ try{ const l=await (await fetch('http://localhost:'+PORT+'/json')).json(); const t=l.find(x=>x.type==='page'); if(t){ ws=new WebSocket(t.webSocketDebuggerUrl); await new Promise((ok,ko)=>{ws.onopen=ok;ws.onerror=ko}); break } }catch(e){} await new Promise(r=>setTimeout(r,250)) }
  let id=0; const pend=new Map(); ws.onmessage=(m)=>{const d=JSON.parse(m.data); if(d.id&&pend.has(d.id)){pend.get(d.id)(d); pend.delete(d.id)}}
  const cdp=(method,params={})=>new Promise((ok)=>{const i=++id;pend.set(i,ok);ws.send(JSON.stringify({id:i,method,params}))})
  await cdp('Page.enable'); await cdp('Runtime.enable')
  await cdp('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:mobile?2:1.5,mobile})
  if(mobile) await cdp('Emulation.setUserAgentOverride',{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'})
  const ev=async(expr)=>{const r=await cdp('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true}); if(r.result&&r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0,300)); return r.result&&r.result.result&&r.result.result.value}
  const pausa=(ms)=>new Promise(r=>setTimeout(r,ms))
  const api={
    cdp,ev,pausa,
    async vai(url){ await cdp('Page.navigate',{url}); await pausa(1200) },
    async accedi(){
      api._giro=api._giro||false
      await api.vai(BASE)
      const FT='/tmp/guida-login.json'
      const lg=api._lg||(api._lg=(fs.existsSync(FT)?JSON.parse(fs.readFileSync(FT,'utf8')):null)||await (async()=>{ const x=await (await fetch(API+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'admin1234'})})).json(); if(x.token) fs.writeFileSync(FT,JSON.stringify(x)); return x })()) // un solo accesso per tutte le schermate (il server limita i tentativi)
      if(!api._giro) await fetch(API+'/guida/giro/visto',{method:'POST',headers:{Authorization:'Bearer '+lg.token}}) // il giro parte da solo: nelle schermate normali è già stato visto
      await ev(`localStorage.setItem('platform_token',${JSON.stringify(lg.token)});localStorage.setItem('platform_user',${JSON.stringify(JSON.stringify(lg.user))});localStorage.setItem('platform_theme','light');true`)
      await api.vai(BASE); await pausa(1200)
    },
    // clicca il primo elemento visibile (button/a/[role]) il cui testo o aria-label/title contiene `testo`
    async clic(testo,{sel='button, a, [role=button], [role=menuitem], [role=tab], summary, label',nth=0,esatto=false}={}){
      const ok=await ev(`(()=>{const t=${JSON.stringify(testo)};const es=[...document.querySelectorAll(${JSON.stringify(sel)})].filter(e=>{const r=e.getBoundingClientRect();if(!r.width||!r.height)return false;const s=(e.getAttribute('aria-label')||'')+' '+(e.title||'')+' '+e.textContent;return ${esatto}?e.textContent.trim()===t:s.toLowerCase().includes(t.toLowerCase())}).sort((a,b)=>a.textContent.length-b.textContent.length);const e=es[${nth}];if(!e)return false;e.scrollIntoView({block:'center'});e.click();return true})()`)
      if(!ok) throw new Error('non trovo «'+testo+'»'); await pausa(700)
    },
    async scrivi(placeholder,valore){
      const ok=await ev(`(()=>{const el=[...document.querySelectorAll('input,textarea')].find(e=>(e.placeholder||'').toLowerCase().includes(${JSON.stringify(placeholder.toLowerCase())})&&e.getBoundingClientRect().width);if(!el)return false;const p=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(el,${JSON.stringify(valore)});el.dispatchEvent(new Event('input',{bubbles:true}));return true})()`)
      if(!ok) throw new Error('non trovo il campo «'+placeholder+'»'); await pausa(300)
    },
    async scorri(y){ await ev(`window.scrollTo(0,${y});document.querySelectorAll('main,[class*=overflow-y-auto]').forEach(e=>{e.scrollTop=${y}});true`); await pausa(300) },
    async foto(nome){ const r=await cdp('Page.captureScreenshot',{format:'jpeg',quality:84}); fs.writeFileSync(new URL('./shots/', import.meta.url).pathname+nome+'.jpg',Buffer.from(r.result.data,'base64')); console.log('foto',nome) },
    async chiudi(){ try{ws.close()}catch(e){} proc.kill() },
  }
  return api
}
