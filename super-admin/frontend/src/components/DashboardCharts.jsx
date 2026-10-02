import React, { useState } from 'react'
import Icon from './Icon'

// Estratto da DashboardPage.jsx (redesign 2026-08-30, Fase 1) — usato anche
// da PartnerHomePage.jsx (Fase 2), prima ognuna avrebbe avuto la propria
// copia quasi identica. Nessuna libreria di grafici in questo repo: tutto
// SVG scritto a mano, stessa convenzione di sempre.
export const KPI_TONE = { rose: 'bg-cp-danger/15 text-cp-danger', blue: 'bg-cp-primary/15 text-cp-primary', green: 'bg-cp-success-bg text-cp-success', purple: 'bg-cp-purple/15 text-cp-purple' }

// onClick opzionale (2026-09-08, richiesto dall'utente: "non vedo le
// opportunità" — il numero da solo non basta, serve un modo di arrivare a
// COSA lo compone) — solo un cursore/hover in più quando presente, il
// comportamento di ogni chiamante che non lo passa (es. DashboardPage.jsx)
// resta identico a prima.
// Restyle (2026-09-11, "rendila più bella da vedere" sullo stesso screenshot
// di Analytics) — badge icona più grande e con leggero anello colorato invece
// del semplice riquadro piatto, angoli più morbidi (xl invece di md), un filo
// di profondità al passaggio del mouse (bordo che si illumina + sollevamento
// di 1px) anche sulle card non cliccabili: la card non "sembra" più morta,
// pur restando non interattiva quando onClick non è passato. Altezza minima
// uniforme per non far ballare la riga quando un'etichetta va a due righe.
// "hint" opzionale (2026-09-11, "salute piattaforma cosa vuole dire? vogliamo
// mettere un hover con etichetta che spiega?" — una KPI col solo numero, senza
// contesto, per una metrica il cui nome da solo non è autoesplicativo). Icona
// "i" separata dal resto della card: sta DENTRO l'area cliccabile quando la
// card ha un onClick, ma il suo tooltip non deve dipendere da quel click —
// resta un semplice hover CSS (group/hint), nessuno stato React in più qui.
export function Kpi({ label, value, icon, delta, tone = 'blue', onClick, hint }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag onClick={onClick} type={onClick ? 'button' : undefined}
      className={'bg-surface-card rounded-xl border border-gray-800 p-4 text-left w-full min-h-[108px] flex flex-col justify-between transition hover:border-gray-700 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/20' + (onClick ? ' cursor-pointer' : '')}>
      <div className="text-xs text-gray-500 flex items-center gap-2">
        <span className={'w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ring-1 ring-inset ring-white/5 ' + (KPI_TONE[tone] || KPI_TONE.blue)}><Icon name={icon} size={13} /></span>
        <span className="leading-tight">{label}</span>
        {hint && (
          <span className="relative group/hint inline-flex flex-shrink-0">
            <Icon name="info" size={12} className="text-gray-600" />
            <span className="hidden group-hover/hint:block absolute left-1/2 -translate-x-1/2 bottom-full mb-1.5 z-20 w-48 bg-gray-900 border border-gray-700 rounded-lg px-2.5 py-1.5 text-[10px] leading-snug text-gray-300 normal-case font-normal shadow-lg shadow-black/40">
              {hint}
            </span>
          </span>
        )}
      </div>
      <div>
        <div className="text-2xl font-bold text-ink tracking-[-0.7px]">{value}</div>
        {delta != null && (
          <div className={'text-xs mt-0.5 ' + (delta > 0 ? 'text-green-400' : delta < 0 ? 'text-red-400' : 'text-gray-600')}>
            {delta > 0 ? '+' : ''}{delta}% vs 30gg fa
          </div>
        )}
      </div>
    </Tag>
  )
}

// Catmull-Rom -> Bezier (2026-09-11, "queste linee sono brutte" — segnalato
// dal vivo su un picco a triangolo netto) — prima puro M/L, segmenti dritti
// che a ogni cambio di direzione formano un angolo secco (il "picco" visto
// nello screenshot è letteralmente un singolo punto isolato unito con due
// rette). Una curva che passa DAVVERO per ogni punto reale (mai un'estetica
// che mente sui dati, solo un'interpolazione più morbida tra un punto e il
// successivo) — tecnica standard per un mini-grafico SVG scritto a mano
// senza libreria, non introduce overshoot vistoso. Punti (dot) scartati come
// opzione: avrebbero solo marcato meglio gli stessi angoli netti, non li
// avrebbero ammorbiditi.
function smoothPath(pts) {
  if (pts.length < 2) return ''
  if (pts.length === 2) return 'M' + pts[0][0].toFixed(1) + ',' + pts[0][1].toFixed(1) + ' L' + pts[1][0].toFixed(1) + ',' + pts[1][1].toFixed(1)
  let d = 'M' + pts[0][0].toFixed(1) + ',' + pts[0][1].toFixed(1)
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i === 0 ? 0 : i - 1], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2 < pts.length ? i + 2 : i + 1]
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6
    d += ' C' + c1x.toFixed(1) + ',' + c1y.toFixed(1) + ' ' + c2x.toFixed(1) + ',' + c2y.toFixed(1) + ' ' + p2[0].toFixed(1) + ',' + p2[1].toFixed(1)
  }
  return d
}

const MESE_BREVE = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic']
function fmtDataBreve(iso) {
  if (!iso) return ''
  const d = new Date(iso + 'T00:00:00')
  if (Number.isNaN(d.getTime())) return iso
  return d.getDate() + ' ' + MESE_BREVE[d.getMonth()]
}

// Assi etichettati + punti + area sfumata (2026-09-11, "queste linee sono
// brutte" / "anche MRR non si capisce" — un grafico senza NESSUNA etichetta
// di asse non dice quali siano i valori reali, solo la forma. Asse Y sulla
// PRIMA serie (quella che conta di più, es. MRR — una seconda serie
// sovrapposta resta leggibile dal colore/legenda ma non ha un proprio asse:
// due assi con scale diverse sullo stesso grafico confonderebbe più di
// quanto chiarirebbe). Area sfumata solo a una sola serie (con due linee
// sovrapposte il riempimento si accavallerebbe, illeggibile). "fmt" opzionale
// per formattare i valori dell'asse Y (es. valuta) — default: numero intero.
export function LineTrend({ points, series, fmt }) {
  // Tooltip al passaggio del mouse (2026-09-11, "vorrei che ogni punto se ci
  // passo sopra il mouse vorrei vedere un dettaglio numero" — le etichette
  // sugli assi danno solo la scala generale, non il valore esatto di un
  // giorno preciso, che prima si poteva leggere solo stimando la posizione
  // del punto). Stato in React (non solo CSS :hover, a differenza del
  // vecchio tooltip di BarTrend) perché il box va posizionato in percentuale
  // rispetto all'INTERO grafico, non alla singola fascia stretta sotto il
  // mouse — con tante fasce strette il posizionamento in puro CSS relativo
  // sarebbe stato storto sui punti vicino ai bordi.
  const [hoverI, setHoverI] = useState(null)
  if (points.length < 2) return <div className="text-xs text-gray-600 py-8 text-center">Serie storica troppo corta ancora.</div>
  // PAD_B piccolo (2026-09-11, "sono schiacciati i numeri e tagliati" — le
  // etichette dell'asse X non vivono più DENTRO l'svg, vedi sotto, quindi
  // qui serve solo un margine minimo sotto l'ultimo punto, non più i 20
  // punti riservati al testo).
  const W = 600, H = 150, PAD_L = 42, PAD_R = 6, PAD_T = 10, PAD_B = 6
  const plotW = W - PAD_L - PAD_R, plotH = H - PAD_T - PAD_B
  const format = fmt || ((v) => Math.round(v).toLocaleString('it-IT'))
  // Il fmt passato dal chiamante vale solo per la serie primaria (usato
  // anche per l'asse Y): una eventuale seconda serie (es. "Tenant attivi"
  // accanto al fatturato) è quasi sempre un conteggio semplice, non valuta.
  const fmtSeries = (si) => (si === 0 ? format : (v) => Math.round(v).toLocaleString('it-IT'))

  // Margine verticale del 15% sopra/sotto min-max (2026-09-11, "vedi che i
  // grafici sono tagliati?" — un picco isolato e stretto (es. un giorno solo
  // fuori scala) fa "overshoot" nella curva Catmull-Rom→Bezier: la curva tra
  // due punti può superare temporaneamente il valore del punto stesso, anche
  // se i punti reali restano sempre dentro min-max. Senza margine
  // quell'overshoot usciva dal viewBox e veniva tagliato di netto dal bordo
  // dell'svg, appiattendo il picco invece di lasciarlo arrotondato). Il
  // valore reale dei tick (yTicks) resta min/metà/max SENZA margine — solo
  // la loro posizione in pixel usa la scala allargata, altrimenti l'etichetta
  // "212" non starebbe più allineata al punto che vale davvero 212.
  const padScale = (min, max) => {
    const range = max - min || 1
    const pad = range * 0.15
    return { min: min - pad, range: range + pad * 2 }
  }

  const primaryVals = points.map((p) => Number(p[series[0].key]) || 0)
  const pMin = Math.min(...primaryVals), pMax = Math.max(...primaryVals)
  const pRange = pMax - pMin || 1
  const yTicks = [pMin, pMin + pRange / 2, pMax]
  const primaryScale = padScale(pMin, pMax)
  const yForVal = (v) => PAD_T + plotH - ((v - primaryScale.min) / primaryScale.range) * plotH

  const coordsFor = (key, isPrimary) => {
    const vals = points.map((p) => Number(p[key]) || 0)
    const scale = isPrimary ? primaryScale : padScale(Math.min(...vals), Math.max(...vals))
    return points.map((p, i) => [
      PAD_L + (i / (points.length - 1)) * plotW,
      PAD_T + plotH - (((Number(p[key]) || 0) - scale.min) / scale.range) * plotH,
    ])
  }

  // Al massimo ~6 etichette in ascissa, sempre includendo la prima e
  // l'ultima — con 30 punti giornalieri una per punto sarebbe illeggibile.
  const xLabelStep = Math.max(1, Math.ceil((points.length - 1) / 5))
  const xLabels = points.filter((_, i) => i % xLabelStep === 0 || i === points.length - 1)

  // Fasce di hit-test: una per punto, larghe quanto la metà della distanza
  // coi vicini (mai un cerchio minuscolo di raggio 2.5 come unico bersaglio,
  // impreciso col mouse) — ai bordi la fascia si ferma al bordo del plot.
  const xCoords = points.map((_, i) => PAD_L + (i / (points.length - 1)) * plotW)
  const bandBounds = xCoords.map((x, i) => [
    i === 0 ? PAD_L : (xCoords[i - 1] + x) / 2,
    i === xCoords.length - 1 ? PAD_L + plotW : (x + xCoords[i + 1]) / 2,
  ])

  return (
    <div>
      <div className="relative">
        <svg viewBox={'0 0 ' + W + ' ' + H} className="w-full" style={{ height: H }} preserveAspectRatio="none">
          <defs>
            <linearGradient id="lineTrendFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={series[0].color} stopOpacity="0.28" />
              <stop offset="100%" stopColor={series[0].color} stopOpacity="0" />
            </linearGradient>
          </defs>
          {yTicks.map((v, i) => {
            const y = yForVal(v)
            return <line key={i} x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke="currentColor" className="text-gray-800" strokeWidth="1" />
          })}
          {series.length === 1 && (
            <path d={smoothPath(coordsFor(series[0].key, true)) + ' L' + (PAD_L + plotW).toFixed(1) + ',' + (PAD_T + plotH).toFixed(1) + ' L' + PAD_L.toFixed(1) + ',' + (PAD_T + plotH).toFixed(1) + ' Z'}
              fill="url(#lineTrendFill)" stroke="none" />
          )}
          {series.map((s, si) => {
            const coords = coordsFor(s.key, si === 0)
            return (
              <g key={s.key}>
                <path d={smoothPath(coords)} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                {coords.length <= 31 && coords.map((c, i) => (
                  <circle key={i} cx={c[0]} cy={c[1]} r={i === hoverI ? 4 : 2.5} fill={s.color}
                    stroke="var(--color-surface-card, #12161c)" strokeWidth={i === hoverI ? 2 : 1.5} />
                ))}
              </g>
            )
          })}
          {hoverI != null && (
            <line x1={xCoords[hoverI]} y1={PAD_T} x2={xCoords[hoverI]} y2={PAD_T + plotH}
              stroke="currentColor" className="text-gray-700" strokeWidth="1" strokeDasharray="2,2" pointerEvents="none" />
          )}
          {bandBounds.map((b, i) => (
            <rect key={i} x={b[0]} y={PAD_T} width={Math.max(0, b[1] - b[0])} height={plotH} fill="transparent"
              onMouseEnter={() => setHoverI(i)} onMouseLeave={() => setHoverI(null)} style={{ cursor: 'crosshair' }} />
          ))}
        </svg>
        {/* Etichette asse Y fuori dall'svg (2026-09-11, "sono schiacciati i
            numeri e tagliati" — con preserveAspectRatio="none" un <text> SVG
            viene deformato ogni volta che il rettangolo reale della card non
            ha le stesse proporzioni 600:150 del viewBox, esattamente come
            linee/punti DEVONO stirarsi ma il testo no. HTML sovrapposto in
            percentuale, mai soggetto allo stiramento del sistema di
            coordinate dell'svg. */}
        <div className="absolute inset-0 pointer-events-none">
          {yTicks.map((v, i) => {
            const yPct = (yForVal(v) / H) * 100
            return (
              <div key={i} className="absolute text-[9px] text-gray-600 text-right whitespace-nowrap"
                style={{ left: 0, top: yPct + '%', width: ((PAD_L - 6) / W) * 100 + '%', transform: 'translateY(-50%)' }}>
                {format(v)}
              </div>
            )
          })}
        </div>
        {hoverI != null && (
          <div className="absolute pointer-events-none z-10" style={{
            left: Math.min(94, Math.max(6, (xCoords[hoverI] / W) * 100)) + '%',
            top: '4%',
            transform: 'translateX(-50%)',
          }}>
            <div className="bg-gray-900 border border-gray-700 rounded-lg px-2.5 py-1.5 shadow-lg shadow-black/40 whitespace-nowrap">
              <div className="text-[10px] text-gray-500 mb-1">{fmtDataBreve(points[hoverI].snapshot_date)}</div>
              {series.map((s, si) => (
                <div key={s.key} className="flex items-center gap-1.5 text-[11px]">
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: s.color }} />
                  <span className="text-gray-400">{s.label}:</span>
                  <span className="text-ink font-medium">{fmtSeries(si)(Number(points[hoverI][s.key]) || 0)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      {/* Etichette asse X in una riga dedicata fuori dall'svg, stesso motivo
          dell'asse Y sopra — mai più testo deformato/tagliato dal bordo del
          viewBox. Ancoraggio per bordo (sinistra/destra) sul primo/ultimo
          punto invece che centrato, altrimenti l'ultima etichetta uscirebbe
          dal bordo destro della card esattamente come il taglio segnalato. */}
      <div className="relative h-3 mt-1.5">
        {xLabels.map((p, i) => {
          const idx = points.indexOf(p)
          const xPct = (xCoords[idx] / W) * 100
          const isFirst = idx === 0, isLast = idx === points.length - 1
          return (
            <span key={i} className="absolute text-[9px] text-gray-600 whitespace-nowrap"
              style={{ left: xPct + '%', transform: 'translateX(' + (isFirst ? '0%' : isLast ? '-100%' : '-50%') + ')' }}>
              {fmtDataBreve(p.snapshot_date)}
            </span>
          )
        })}
      </div>
      <div className="flex items-center gap-4 mt-2">
        {series.map((s) => (
          <div key={s.key} className="flex items-center gap-1.5 text-xs text-gray-500">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: s.color }} />
            {s.label}
          </div>
        ))}
      </div>
    </div>
  )
}

// Donut a segmenti — un <circle> con stroke-dasharray per segmento, non
// path ad arco calcolati a mano. Ingrandito (2026-09-11, "va centrato il
// grafico ed ingrandito, magari rendilo più bello" — nella card era piccolo
// e allineato in alto a sinistra, con tanto spazio vuoto intorno una volta
// che la card si stira alla stessa altezza del grafico a fianco). Il
// centraggio nello spazio disponibile resta compito del chiamante (la card
// diventa flex-col con questo componente dentro un flex-1
// items-center/justify-center — stesso genere di scelta lasciata al
// chiamante già in uso per LineTrend/HBar), qui solo le dimensioni proprie.
export function Donut({ segments, total }) {
  if (!total) return <div className="text-xs text-gray-600 py-8 text-center">Nessun dato ancora.</div>
  const R = 62, C = 2 * Math.PI * R
  let offset = 0
  return (
    <div className="flex items-center gap-6">
      <svg viewBox="0 0 160 160" width={148} height={148}>
        <g transform="rotate(-90 80 80)">
          {segments.map((s) => {
            const frac = s.value / total
            const dash = frac * C
            const el = (
              <circle key={s.key} cx="80" cy="80" r={R} fill="none" stroke={s.color} strokeWidth="18" strokeLinecap="round"
                strokeDasharray={dash + ' ' + (C - dash)} strokeDashoffset={-offset} />
            )
            offset += dash
            return el
          })}
        </g>
        <text x="80" y="74" textAnchor="middle" className="fill-ink" style={{ fontSize: 28, fontWeight: 700 }}>{total}</text>
        <text x="80" y="93" textAnchor="middle" className="fill-gray-500" style={{ fontSize: 11 }}>totale</text>
      </svg>
      <div className="space-y-2">
        {segments.map((s) => (
          <div key={s.key} className="flex items-center gap-2 text-xs">
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: s.color }} />
            <span className="text-gray-400">{s.label}</span>
            <span className="text-gray-600">{s.value} ({Math.round((s.value / total) * 100)}%)</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function HBar({ rows, valueFmt }) {
  if (rows.length === 0) return <div className="text-xs text-gray-600 py-6 text-center">Nessun dato ancora.</div>
  const max = Math.max(...rows.map((r) => r.value), 1)
  return (
    <div className="space-y-2.5">
      {rows.map((r) => (
        <div key={r.label}>
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-gray-400 truncate">{r.label}</span>
            <span className="text-gray-600 flex-shrink-0 ml-2">{valueFmt ? valueFmt(r.value) : r.value}</span>
          </div>
          <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
            <div className="h-full bg-cp-primary rounded-full" style={{ width: (r.value / max) * 100 + '%' }} />
          </div>
        </div>
      ))}
    </div>
  )
}

// Funnel a barre orizzontali decrescenti, larghezza proporzionale allo stadio
// più popolato — non un vero imbuto grafico (path SVG a trapezi sarebbe più
// fedele al mockup ma molto più complesso da mantenere per un valore
// puramente estetico), stessa leggibilità con la stessa convenzione HBar già
// in uso qui sopra.
export function Funnel({ stages }) {
  if (stages.length === 0) return <div className="text-xs text-gray-600 py-6 text-center">Nessun dato ancora.</div>
  const max = Math.max(...stages.map((s) => s.value), 1)
  return (
    <div className="space-y-2">
      {stages.map((s) => (
        <div key={s.label} className="flex items-center gap-3">
          <div className="w-24 text-xs text-gray-400 flex-shrink-0 truncate">{s.label}</div>
          <div className="flex-1 h-6 bg-gray-800/50 rounded overflow-hidden">
            <div className="h-full rounded flex items-center justify-end pr-2 text-[10px] text-white font-medium"
              style={{ width: Math.max((s.value / max) * 100, s.value > 0 ? 8 : 0) + '%', background: s.color || 'rgb(8 123 255)' }}>
              {s.value > 0 ? s.value : ''}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
