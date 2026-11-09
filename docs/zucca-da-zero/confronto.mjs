// Cosa ha zucca (porta 3000) che il tenant ricostruito solo dal Builder (porta 3100) non ha?
const L = async (B) => (await (await fetch(B + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin1234' }) })).json()).token
const A = 'http://localhost:3000/api', Z = 'http://localhost:3100/api'
const [ta, tz] = [await L(A), await L(Z)]
const g = async (B, T, p) => { try { const r = await fetch(B + p, { headers: { Authorization: 'Bearer ' + T } }); return await r.json() } catch (e) { return { errore: e.message } } }
const both = async (p) => [await g(A, ta, p), await g(Z, tz, p)]
const righe = []; const conf = (nome, a, z) => { righe.push({ nome, zucca: a, da_zero: z, uguale: JSON.stringify(a) === JSON.stringify(z) }) }
// Guida e giro guidato
let [a, z] = await both('/guida'); conf('Guida: capitoli', Object.keys(a.capitoli || {}).length, Object.keys(z.capitoli || {}).length); conf('Guida: flussi', (a.flussi || []).length, (z.flussi || []).length); conf('Guida: voci di glossario', (a.glossario || []).length, (z.glossario || []).length)
;[a, z] = await both('/guida/giro'); conf('Giro guidato: passi', (a.passi || a || []).length, (z.passi || z || []).length)
// Struttura di ogni modulo: tipi di blocco
const SL = ['clienti', 'immobili', 'trattative', 'provvigioni', 'attivita', 'quote_societarie', 'richieste_privacy']
for (const s of SL) { const [ma, mz] = await both('/modules/' + s); const cnt = (m) => { const c = {}; for (const st of JSON.parse(m.schema_json).steps) c[st.block_type] = (c[st.block_type] || 0) + 1; return c }; conf('Modulo ' + s + ': blocchi per tipo', cnt(ma), cnt(mz)) }
// Menu e impostazioni dei moduli
;[a, z] = await both('/modules/installed'); const m = (x) => (Array.isArray(x) ? x : []).map((r) => r.slug + ':' + (r.menu_nascosto ? 'nascosto' : 'visibile') + ':' + r.group_name).sort(); conf('Menu moduli (slug:visibilità:gruppo)', m(a), m(z))
;[a, z] = await both('/dashboard/widgets'); conf('Dashboard: riquadri', (a || []).map((w) => w.type + ':' + w.label), (z || []).map((w) => w.type + ':' + w.label))
;[a, z] = await both('/roles'); conf('Ruoli', (a || []).map((r) => r.name).sort(), (z || []).map((r) => r.name).sort())
;[a, z] = await both('/features'); conf('Funzioni attive (features)', a, z)
;[a, z] = await both('/settings'); const pick = (x) => ({ app_name: x.app_name, colore: x.color || x.colore, ai: x.ai }); conf('Impostazioni: nome app e colore', pick(a || {}), pick(z || {}))
;[a, z] = await both('/connections'); conf('Connessioni visibili', (a || []).map((c) => c.id + ':' + c.connected), (z || []).map((c) => c.id + ':' + c.connected))
;[a, z] = await both('/option-lists'); conf('Liste di scelta', (Array.isArray(a) ? a : []).length, (Array.isArray(z) ? z : []).length)
for (const r of righe) console.log((r.uguale ? '=  ' : '!= ') + r.nome + (r.uguale ? '' : '\n     zucca  : ' + JSON.stringify(r.zucca).slice(0, 260) + '\n     da zero: ' + JSON.stringify(r.da_zero).slice(0, 260)))
import fs from 'fs'; fs.writeFileSync(new URL('./esito-confronto.json', import.meta.url), JSON.stringify(righe, null, 1))
