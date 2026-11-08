import fs from 'fs'
const PK='/Users/nimakarimpour/Desktop/platform/super-admin/backend/src/pacchetti/mediazione-immobiliare/'
const parti={}; for (const p of ['estensioni','documenti','abbinamenti','moduli','ruoli','relazioni','proprieta','sezioni','dimostrativi','guida','migrazioni']) parti[p]=JSON.parse(fs.readFileSync(PK+p+'.json','utf8'))
const v=JSON.parse(fs.readFileSync(PK+'pacchetto.json','utf8')).versione
for (let i=0;i<2;i++){ const r=await fetch('http://localhost:3000/api/internal-setup/pacchetto',{method:'POST',headers:{'Content-Type':'application/json','x-internal-secret':'dev_internal_secret_local_only'},body:JSON.stringify({slug:'mediazione-immobiliare',versione:v,parti})}); console.log('pacchetto v'+v,r.status) }
const {token:T}=await (await fetch('http://localhost:3000/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'admin1234'})})).json()
const recs=await (await fetch('http://localhost:3000/api/records/provvigioni',{headers:{Authorization:'Bearer '+T}})).json()
console.log(recs.map(r=>[r.data.descrizione.slice(0,24),r.data.percentuale_applicata,r.data.importo_netto,r.data.totale].join(' | ')).join('\n'))
