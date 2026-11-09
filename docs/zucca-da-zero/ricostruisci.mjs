// Esperimento: ricostruire le funzioni di zucca in un tenant VUOTO usando solo le rotte che usa il Builder
// (crea modulo -> salva bozza -> pubblica), più ruoli, permessi per modulo e riquadri della Dashboard.
// Nessun pacchetto, nessun seed. Origine (solo lettura): un tenant con zucca già costruita (porta 3000). Destinazione: tenant vuoto (porta 3100).
const SRC = 'http://localhost:3000/api', DST = 'http://localhost:3100/api'
const login = async (B) => (await (await fetch(B + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin1234' }) })).json()).token
const [ts, td] = [await login(SRC), await login(DST)]
const call = async (B, T, m, p, b) => { const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + T }, body: b ? JSON.stringify(b) : undefined }); let j = null; try { j = await r.json() } catch (e) {} return { ok: r.ok, status: r.status, j } }
const log = []; const nota = (k, ok, d) => { log.push({ k, ok, d }); console.log((ok ? 'OK  ' : 'KO  ') + k + (d ? ' — ' + d : '')) }

const SLUGS = ['clienti', 'immobili', 'trattative', 'provvigioni', 'attivita', 'quote_societarie', 'richieste_privacy']
// ruoli
const ruoli = (await call(SRC, ts, 'GET', '/roles')).j || []
for (const r of ruoli) { const x = await call(DST, td, 'POST', '/roles', r); nota('ruolo ' + (r.name || r.nome), x.ok || x.status === 409, x.ok ? '' : JSON.stringify(x.j)) }
// moduli
for (const slug of SLUGS) {
  const m = (await call(SRC, ts, 'GET', '/modules/' + slug)).j
  if (!m || m.error) { nota('modulo ' + slug, false, 'non trovato in origine'); continue }
  const c = await call(DST, td, 'POST', '/modules/create', { name: m.name, slug, icon: m.icon, color: m.color })
  nota('crea ' + slug, c.ok, c.ok ? '' : JSON.stringify(c.j))
  const schema = JSON.parse(m.schema_json)
  const d = await call(DST, td, 'PUT', '/builder/' + slug + '/draft', { schema })
  nota('bozza ' + slug, d.ok, d.ok ? schema.steps.length + ' blocchi' : JSON.stringify(d.j))
  const p = await call(DST, td, 'POST', '/builder/' + slug + '/publish', {})
  nota('pubblica ' + slug, p.ok, p.ok ? '' : JSON.stringify(p.j).slice(0, 400))
  const patch = {}; for (const k of ['group_name', 'group_order', 'list_view', 'sort_order', 'quick_toggle', 'menu_nascosto', 'batch_upload_field', 'batch_upload_category_field']) if (m[k] != null) patch[k] = m[k]
  const pa = await call(DST, td, 'PATCH', '/modules/' + slug, patch); nota('impostazioni ' + slug, pa.ok, pa.ok ? Object.keys(patch).join(',') : JSON.stringify(pa.j))
  const mr = (await call(SRC, ts, 'GET', '/module-roles/' + slug)).j
  if (mr && !mr.error) { const w = await call(DST, td, 'PUT', '/module-roles/' + slug, mr); nota('permessi ' + slug, w.ok, w.ok ? '' : JSON.stringify(w.j)) }
}
// Dashboard
const wid = (await call(SRC, ts, 'GET', '/dashboard/widgets')).j || []
for (const w of wid) { const { id, ...rest } = w; const x = await call(DST, td, 'POST', '/dashboard/widgets', rest); nota('widget ' + (w.label || w.type), x.ok, x.ok ? '' : JSON.stringify(x.j)) }
import fs from 'fs'; fs.writeFileSync(new URL('./esito-ricostruzione.json', import.meta.url), JSON.stringify(log, null, 1))
console.log('\nOK:', log.filter((l) => l.ok).length, 'KO:', log.filter((l) => !l.ok).length)
