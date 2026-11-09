// Lo stato iniziale lo manda la scheda («Stato iniziale»), non l'API: qui lo si scrive come fa la scheda.
// Prova sul tenant ricostruito (porta 3100): il flusso di vendita funziona come in zucca?
const B = 'http://localhost:3100/api'
const { token: T } = await (await fetch(B + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin1234' }) })).json()
const j = async (m, p, b) => { const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + T }, body: b ? JSON.stringify(b) : undefined }); return { s: r.status, d: await r.json().catch(() => ({})) } }
const esiti = []; const t = (nome, ok, d) => { esiti.push({ nome, ok, d }); console.log((ok ? 'OK  ' : 'KO  ') + nome + (d ? ' — ' + d : '')) }
const mk = async (slug, d) => (await j('POST', '/records/' + slug, d))
const v = await mk('clienti', { nome: 'Mario Rossi', tipo_soggetto: 'Persona fisica', codice_fiscale_piva: 'RSSMRA85T10A562S', email: 'm@example.com', tipo_cliente: 'Venditore' }); t('crea cliente venditore', v.s === 200, v.s + '')
const a = await mk('clienti', { nome: 'Giulia Bianchi', tipo_soggetto: 'Persona fisica', email: 'g@example.com', tipo_cliente: 'Acquirente' }); t('crea cliente acquirente', a.s === 200)
const cfk = await mk('clienti', { nome: 'CF sbagliato', tipo_soggetto: 'Persona fisica', codice_fiscale_piva: 'XXXXXXXXXXXXXXXX', tipo_cliente: 'Venditore' }); t('codice fiscale non valido viene rifiutato', cfk.s >= 400, cfk.s + ' ' + JSON.stringify(cfk.d).slice(0, 90))
const im = await mk('immobili', { titolo: 'Bilocale Via Verdi', tipologia: 'Appartamento', indirizzo: 'Via Verdi 21', comune: 'Brescia', provincia: 'BS', superficie_mq: 58, locali: 2, prezzo_richiesto: 159000, proprietario: v.d.id }); t('crea immobile con proprietario', im.s === 200, im.s + ' ' + JSON.stringify(im.d).slice(0, 100))
const tr = await mk('trattative', { titolo: 'Via Verdi — Bianchi', tipo: 'Vendita', immobile: im.d.id, venditore: v.d.id, acquirente: a.d.id, prezzo_concordato: 152000, data_preliminare: '2026-12-01', data_rogito: '2027-01-20', prov_venditore_perc: 3, prov_acquirente_perc: 3, _stato: 'trattativa_in_corso' }); t('crea trattativa', tr.s === 200, tr.s + '')
const blocco = await j('POST', '/records/trattative/' + tr.d.id + '/transition', { to: 'preliminare_firmato' }); t('passaggio a «Preliminare firmato» bloccato senza il contratto', blocco.s >= 400, blocco.s + ' ' + JSON.stringify(blocco.d).slice(0, 160))
const fd = new FormData(); fd.append('file', new Blob(['%PDF-1.4 prova'], { type: 'application/pdf' }), 'preliminare.pdf')
const up = await (await fetch(B + '/uploads', { method: 'POST', headers: { Authorization: 'Bearer ' + T }, body: fd })).json()
const al = await j('POST', '/records/trattative/' + tr.d.id + '/attachments', { upload_id: up.id, tipo: 'Contratto preliminare' }); t('allegato «Contratto preliminare» caricato', al.s === 200, al.s + ' ' + JSON.stringify(al.d).slice(0, 80))
const forza = await j('POST', '/records/trattative/' + tr.d.id + '/transition', { to: 'preliminare_firmato' })
const prov = await j('GET', '/records/provvigioni')
const gen = (Array.isArray(prov.d) ? prov.d : []).filter((r) => String(r.data && r.data.trattativa) === String(tr.d.id))
t('alla firma del preliminare nascono 2 provvigioni (una per parte)', gen.length === 2, 'transizione ' + forza.s + ', provvigioni trovate: ' + gen.length)
if (gen[0]) t('l\'importo della provvigione si calcola da solo', gen.some((g) => Number(g.data.importo_netto) > 0), JSON.stringify(gen.map((g) => [g.data.parte, g.data.percentuale_applicata, g.data.importo_netto, g.data.totale])))
const att = await mk('attivita', { titolo: 'Visita', tipo: 'Visita', scadenza: '2026-11-12', ora: '10:00', immobile: im.d.id, cliente: a.d.id }); t('crea attività collegata a immobile e cliente', att.s === 200)
const ag = await j('GET', '/modules/queues'); 
const sch = await j('GET', '/modules/trattative'); const stp = JSON.parse(sch.d.schema_json).steps
t('requisiti per stato presenti', stp.filter((s) => s.block_type === 'state_requirements').length === 4, '')
import fs from 'fs'; fs.writeFileSync(new URL('./esito-comportamento.json', import.meta.url), JSON.stringify(esiti, null, 1))
console.log('\nOK:', esiti.filter((e) => e.ok).length, 'KO:', esiti.filter((e) => !e.ok).length)
