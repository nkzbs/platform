import React from 'react'
import Icon from '../../../components/Icon'

// Vista dell'esito dell'azione «valutazione_immobiliare» (report a schermo + stampa). Scritta una volta qui, fuori dalla scheda del record, che la trova da viste-azione/index.js.
// Report della valutazione appena fatta (2026-11-01) — un pannello a schermo con i dati
// grezzi di OpenAPI.it messi in ordine, più una copia stampabile via window.print() dietro
// un portal su document.body (stesso meccanismo già in uso per la Guida dei verticali in
// components/VerticaliLibreria.jsx: solo quella porzione resta visibile quando si stampa).
// Non il report multi-pagina con mappe/foto di un concorrente — solo i numeri che OpenAPI.it
// restituisce davvero, onestamente presentati: niente inventato per sembrare più completo.
// Separatore delle migliaia sempre (anche a 4 cifre, che «it-IT» di solito non raggruppa): coerente col PDF.
function fmtNum(n) { return (n || n === 0) && !isNaN(Number(n)) ? String(Math.round(Number(n))).replace(/\B(?=(\d{3})+(?!\d))/g, '.') : '—' }
function fmtEuro(n) { return fmtNum(n) === '—' ? '—' : fmtNum(n) + ' €' }
// Barra orizzontale con etichetta e valore: la stessa lettura delle barre del PDF.
function BarraReport({ etichetta, valore, massimo, testo }) {
  return (
    <div className="flex items-center gap-2 text-[11px] py-[3px]">
      <span className="w-28 shrink-0 text-gray-500 truncate">{etichetta}</span>
      <div className="flex-1 h-2 rounded-full bg-gray-800/60 overflow-hidden"><div className="h-full rounded-full bg-accent" style={{ width: Math.max(3, Math.min(100, (valore / (massimo || 1)) * 100)) + '%' }} /></div>
      <span className="w-24 shrink-0 text-right text-ink font-medium">{testo}</span>
    </div>
  )
}

function SezioneReport({ titolo, sotto, children }) {
  return (
    <section className="rounded-xl border border-gray-800 bg-surface-page/60 p-3.5">
      <h4 className="text-[13px] font-semibold text-ink mb-0.5 flex items-center gap-2"><span className="w-1 h-3.5 rounded-full bg-accent" />{titolo}</h4>
      {sotto && <div className="text-[11px] text-gray-500 mb-2 ml-3">{sotto}</div>}
      <div className={sotto ? '' : 'mt-2'}>{children}</div>
    </section>
  )
}

const pctIt = (n) => (n == null || n === '' || isNaN(Number(n)) ? '—' : String(Math.round(Number(n) * 10) / 10).replace('.', ',') + '%')

// Report di valutazione: stessa struttura del PDF (riquadri con le quotazioni, valore stimato, considerazioni, tabelle e barre).
function ReportValutazione({ report, titolo, indirizzo, onPdf, dati = {}, campi = {} }) {
  const d = (report && report.dettaglio) || {}
  const q = d.quotazione || {}
  const med = parseFloat(String(q.med || '').replace(/[^0-9.]/g, '')) || null
  const demo = d.demografico || {}
  const mq = parseFloat(dati[campi.superficie]) || null
  const comparabili = (report && report.comparabili) || []
  const omiRow = report && report.omi
  const dinamicita = d.capoluoghi_vendite_zona && typeof d.capoluoghi_vendite_zona === 'object' ? Object.entries(d.capoluoghi_vendite_zona) : []
  const tempiVendita = Array.isArray(d.tempistiche) && Array.isArray(d.tempistiche[0]) ? d.tempistiche[0] : []
  const dimensioni = Array.isArray(d.dimensioni) ? d.dimensioni : []
  const ripartizione = (d.ripartizione_annunci && d.ripartizione_annunci.vendita) ? Object.values(d.ripartizione_annunci.vendita).sort((a, b) => b.percentuale - a.percentuale) : []
  const fotovoltaico = report && report.fotovoltaico
  const zonaSismicaUff = report && report.zonaSismicaUfficiale
  const considerazioni = report && report.considerazioni
  const norm = (x) => String(x || '').toLowerCase().replace(/[^a-zà-ú0-9]/g, '')
  const comuneRecord = dati[campi.comune]
  const altroLuogo = comuneRecord && d.citta && norm(comuneRecord) !== norm(d.citta)
  const pop = demo.pop || {}, stock = demo.stock || {}
  const territorio = [
    demo.rischio_sismico && ['Rischio sismico (OpenAPI.it)', demo.rischio_sismico],
    zonaSismicaUff && zonaSismicaUff.zona != null && ['Zona sismica ufficiale (ISPRA)', zonaSismicaUff.zona + (zonaSismicaUff.zona === 1 ? ' · alta' : zonaSismicaUff.zona === 4 ? ' · bassa' : '')],
    fotovoltaico && fotovoltaico.kwh_per_kwp_anno && ['Resa fotovoltaico (PVGIS)', Number(fotovoltaico.kwh_per_kwp_anno).toLocaleString('it-IT') + ' kWh/anno per kW'],
    fotovoltaico && fotovoltaico.irraggiamento_kwh_mq_anno && ['Irraggiamento medio', Number(fotovoltaico.irraggiamento_kwh_mq_anno).toLocaleString('it-IT') + ' kWh/m² all\'anno'],
  ].filter(Boolean)
  const zona = [
    demo.geo && demo.geo.nome_localita && ['Area', demo.geo.nome_localita],
    pop.media_componenti_famiglia && ['Componenti per famiglia', String(pop.media_componenti_famiglia).replace('.', ',') + ' (nuclei ' + (pop.dimensione_nuclei_familiari || '—') + ')'],
    pop.livello_anzianita && ['Età della popolazione', pop.livello_anzianita],
    pop.livello_istruzione && ['Istruzione', pop.livello_istruzione],
    pop.livello_disoccupazione && ['Disoccupazione', pop.livello_disoccupazione],
    stock.prc_abitazioni_di_proprieta && ['Abitazioni di proprietà', pctIt(stock.prc_abitazioni_di_proprieta)],
    stock.prc_abitazioni_vuote_o_2_case && ['Vuote o seconde case', pctIt(stock.prc_abitazioni_vuote_o_2_case)],
    stock.mq_abitazione_media && ['Superficie media abitazioni', Math.round(stock.mq_abitazione_media) + ' mq'],
  ].filter(Boolean)
  const coppie = (righe) => righe.map(([e, v]) => (
    <div key={e} className="flex justify-between gap-3 text-[11px] py-[3px] border-b border-gray-800/60 last:border-0"><span className="text-gray-500">{e}</span><span className="text-ink font-medium text-right">{v}</span></div>
  ))

  return (
    <div className="glass-panel p-4 mb-5 border-accent/30">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.14em] text-accent font-semibold flex items-center gap-1.5"><Icon name="sparkles" size={12} />Report di valutazione</div>
          <div className="text-ink text-lg font-semibold leading-tight mt-0.5 truncate" style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}>{titolo || 'Immobile'}</div>
          <div className="text-xs text-gray-500 truncate">{indirizzo || d.formatted}</div>
        </div>
        <button onClick={onPdf} className="shrink-0 text-xs px-3 py-1.5 rounded-lg bg-accent hover:opacity-90 text-white flex items-center gap-1.5 font-medium"><Icon name="download" size={12} />Scarica PDF</button>
      </div>

      {altroLuogo && (
        <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-300 text-[11px] px-3 py-2">
          I dati di mercato si riferiscono a «{d.formatted || d.citta}», che non coincide con il comune dell'immobile ({comuneRecord}). Controlla l'indirizzo e rifai la valutazione prima di usarli.
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 mb-2">
        {[['Minimo', q.min, false], ['Medio', med, true], ['Massimo', q.max, false]].map(([l, v, evid]) => (
          <div key={l} className={'rounded-xl p-3 border ' + (evid ? 'bg-accent border-accent text-white' : 'bg-surface-page border-gray-800')}>
            <div className={'text-[10px] uppercase tracking-wide ' + (evid ? 'text-white/70' : 'text-gray-500')}>{l} €/mq</div>
            <div className={'text-xl font-semibold mt-0.5 ' + (evid ? 'text-white' : 'text-ink')} style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}>{fmtNum(v)}</div>
          </div>
        ))}
      </div>
      {mq && med ? (
        <div className="rounded-xl border border-accent/50 px-3.5 py-2.5 mb-3 flex items-end justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-gray-500">Valore stimato · media × {mq.toLocaleString('it-IT')} mq</div>
            <div className="text-2xl font-semibold text-accent" style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}>{fmtEuro(Math.round(med * mq))}</div>
          </div>
          <div className="text-[11px] text-gray-500 text-right">Intervallo<br /><span className="text-ink font-medium">{fmtEuro(Math.round(q.min * mq))} – {fmtEuro(Math.round(q.max * mq))}</span></div>
        </div>
      ) : <div className="text-[11px] text-gray-500 italic mb-3">Valore stimato non calcolabile: manca la superficie dell'immobile.</div>}

      {considerazioni && (
        <blockquote className="mb-3 rounded-xl bg-surface-page border-l-[3px] border-accent px-3.5 py-2.5 text-xs text-gray-300 italic leading-relaxed">{considerazioni}</blockquote>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {omiRow && Array.isArray(omiRow.values) && omiRow.values.length > 0 && (
          <SezioneReport titolo="Quotazioni OMI" sotto={'Zona ' + (omiRow.omi_zone || '—') + (omiRow.zone && omiRow.zone.description ? ' · ' + omiRow.zone.description : '')}>
            <table className="w-full text-[11px]"><tbody>
              {omiRow.values.map((v, i) => (
                <tr key={i} className="border-b border-gray-800/60 last:border-0"><td className="py-1 text-gray-500">{v.property_type}</td><td className="py-1 text-right text-ink font-medium">{v.sale ? fmtNum(v.sale.min) + ' – ' + fmtNum(v.sale.max) : '—'}<span className="text-gray-600 font-normal"> €/mq</span></td></tr>
              ))}
            </tbody></table>
          </SezioneReport>
        )}
        <SezioneReport titolo="Comparabili nella zona">
          {comparabili.length > 0 ? (
            <table className="w-full text-[11px]"><tbody>
              {comparabili.slice(0, 8).map((c, i) => (
                <tr key={i} className="border-b border-gray-800/60 last:border-0"><td className="py-1 text-gray-500">{c.property_type || 'Immobile'}{c.total_sqm ? ' · ' + c.total_sqm + ' mq' : ''}<div className="text-[10px] text-gray-600">{c.municipality || ''}</div></td><td className="py-1 text-right text-ink font-medium">{fmtEuro(c.price)}{c.price_per_sqm ? <div className="text-[10px] text-gray-600 font-normal">{Math.round(c.price_per_sqm)} €/mq</div> : null}</td></tr>
              ))}
            </tbody></table>
          ) : <div className="text-[11px] text-gray-500 italic">Nessun annuncio comparabile trovato vicino a questo indirizzo.</div>}
        </SezioneReport>
        {dinamicita.length > 0 && (
          <SezioneReport titolo="Andamento del mercato" sotto="Abitazioni vendute ogni anno in zona">
            {dinamicita.map(([anno, v]) => <BarraReport key={anno} etichetta={anno + ' · ' + String(v.dinamicita_mercato_residenziale || '').toLowerCase()} valore={Number(v.numero_abitazioni_vendute) || 0} massimo={Math.max(...dinamicita.map(([, x]) => Number(x.numero_abitazioni_vendute) || 0), 1)} testo={v.numero_abitazioni_vendute + ' (' + (Number(v.perc_variazione_annuale) > 0 ? '+' : '') + pctIt(v.perc_variazione_annuale) + ')'} />)}
          </SezioneReport>
        )}
        {tempiVendita.length > 0 && (
          <SezioneReport titolo="Tempi medi di vendita" sotto="Per superficie dell'immobile">
            {tempiVendita.map((t, i) => <BarraReport key={i} etichetta={String(t.label).replace(/^(\d+) (\d+) Mq$/, '$1-$2 mq')} valore={Number(t.media_giorni) || 0} massimo={Math.max(...tempiVendita.map((x) => Number(x.media_giorni) || 0), 1)} testo={t.media_giorni + ' giorni'} />)}
          </SezioneReport>
        )}
        {ripartizione.length > 0 && (
          <SezioneReport titolo="Annunci in vendita per tipologia">
            {ripartizione.map((r, i) => <BarraReport key={i} etichetta={r.tipologia} valore={Number(r.percentuale) || 0} massimo={Math.max(...ripartizione.map((x) => Number(x.percentuale) || 0), 1)} testo={pctIt(r.percentuale)} />)}
          </SezioneReport>
        )}
        {dimensioni.length > 0 && (
          <SezioneReport titolo="Annunci per superficie">
            {dimensioni.map((x, i) => <BarraReport key={i} etichetta={x.label} valore={Number(x.percentuale) || 0} massimo={Math.max(...dimensioni.map((y) => Number(y.percentuale) || 0), 1)} testo={pctIt(x.percentuale)} />)}
          </SezioneReport>
        )}
        {territorio.length > 0 && <SezioneReport titolo="Territorio">{coppie(territorio)}</SezioneReport>}
        {zona.length > 0 && <SezioneReport titolo="La zona">{coppie(zona)}</SezioneReport>}
      </div>
      <div className="text-[10px] text-gray-600 mt-3">Stima indicativa su quotazioni medie di zona e dati pubblici (OpenAPI.it, OMI, ISPRA, PVGIS): non sostituisce una perizia.</div>
    </div>
  )
}

function sintesiValutazione(report, dati, az) {
  const q = (report && report.dettaglio && report.dettaglio.quotazione) || {}
  const num = (v) => { const x = parseFloat(String(v == null ? '' : v).replace(/[^0-9.]/g, '')); return isNaN(x) ? null : x }
  const it = (x) => x.toLocaleString('it-IT', { maximumFractionDigits: 0, useGrouping: 'always' })
  const E = (az && az.esito) || {}
  const min = num(q.min), max = num(q.max), valore = parseFloat(dati[E.valore]), data = dati[E.data]
  return [min != null && max != null ? it(min) + '–' + it(max) + ' €/mq' : null, valore ? 'stima ' + it(valore) + ' €' : null, data ? String(data).slice(0, 10).split('-').reverse().join('/') : null].filter(Boolean).join(' · ')
}

export const vistaValutazioneImmobiliare = { Vista: ReportValutazione, sintesi: sintesiValutazione }
