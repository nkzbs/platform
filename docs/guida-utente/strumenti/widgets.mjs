const B='http://localhost:3000/api'
const {token:T}=await (await fetch(B+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'admin1234'})})).json()
const post=async(b)=>{const r=await fetch(B+'/dashboard/widgets',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+T},body:JSON.stringify(b)});console.log(b.label,r.status)}
await post({type:'kpi',module_slug:'immobili',aggregation:'count',label:'Immobili a portafoglio'})
await post({type:'periodo',module_slug:'trattative',aggregation:'count',label:'Preliminari del mese',config:{date_field:'data_preliminare',periodo:'mese'}})
await post({type:'periodo',module_slug:'provvigioni',field:'importo',aggregation:'sum',label:'Provvigioni in scadenza nel mese',config:{date_field:'data_scadenza',periodo:'mese'}})
await post({type:'agenda',label:'Da fare',aggregation:'count'})
