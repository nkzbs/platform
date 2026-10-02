// ─── GRAFICI SVG ────────────────────────────────────────────────────────────
// Niente Recharts/Chart.js: un grafico a torta o a barre è geometria semplice,
// scriverlo a mano come stringa SVG evita una dipendenza pesante E — motivo
// principale — permette di riusare la STESSA funzione sia per il rendering a
// schermo (React) sia per l'export PDF (via svg-to-pdfkit, prossimo pezzo):
// un solo posto che decide come appare un grafico, non due implementazioni che
// possono disallinearsi nel tempo.
//
// Duplicato tra frontend (qui) e backend (core/backend/src/chart-svg.js) per lo
// stesso motivo già documentato in schema-v3-frontend.js: frontend (Vite/ESM) e
// backend (Node/CJS) sono due bundle separati in questo repo, senza un pacchetto
// condiviso. Funzioni pure, zero dipendenze — la duplicazione è a basso rischio,
// ma va tenuta sincronizzata a mano se la logica cambia.

const DEFAULT_COLORS = ['#2563EB', '#7C3AED', '#10B981', '#FFB84D', '#F87171', '#FBBF24', '#EC4899', '#6B7280'];

function polarToCartesian(cx, cy, r, angleDeg) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

// data: [{label, value}], colors: array opzionale (altrimenti usa la palette default,
// riciclata se ci sono più fette dei colori disponibili — meglio un colore ripetuto
// che una fetta senza colore).
function pieChartSvg(data, { size = 220, colors = DEFAULT_COLORS, showLegend = true } = {}) {
  const total = data.reduce((s, d) => s + (d.value || 0), 0);
  const cx = size / 2, cy = size / 2, r = size / 2 - 8;
  let angle = 0;
  const slices = [];

  if (total <= 0) {
    return `<svg viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#232A38" stroke-width="1.5" stroke-dasharray="4 4"/>
      <text x="${cx}" y="${cy}" text-anchor="middle" fill="#565F72" font-family="IBM Plex Sans, sans-serif" font-size="12">Nessun dato</text>
    </svg>`;
  }

  data.forEach((d, i) => {
    const value = d.value || 0;
    const sliceAngle = (value / total) * 360;
    if (sliceAngle <= 0) return;
    const start = polarToCartesian(cx, cy, r, angle);
    const end = polarToCartesian(cx, cy, r, angle + sliceAngle);
    const largeArc = sliceAngle > 180 ? 1 : 0;
    // Una fetta che copre l'intero cerchio (100% su una sola categoria) degenera
    // in un arco di raggio nullo con il path standard — la disegniamo come cerchio
    // pieno invece che provare a forzare il path M-L-A-Z con angoli coincidenti.
    const path = sliceAngle >= 359.99
      ? `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r} Z`
      : `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y} Z`;
    slices.push(`<path d="${path}" fill="${colors[i % colors.length]}" stroke="#0B0E14" stroke-width="1.5"/>`);
    angle += sliceAngle;
  });

  const legend = showLegend ? data.map((d, i) => {
    const pct = total > 0 ? Math.round(((d.value || 0) / total) * 100) : 0;
    return `<div style="display:flex;align-items:center;gap:6px;font-size:12px;color:#8B93A7;margin-bottom:4px;">
      <span style="width:9px;height:9px;border-radius:2px;background:${colors[i % colors.length]};flex-shrink:0;"></span>
      <span style="flex:1;">${escapeHtml(d.label)}</span>
      <span style="color:#F3F4F6;font-weight:500;">${pct}%</span>
    </div>`;
  }).join('') : '';

  return {
    svg: `<svg viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">${slices.join('')}</svg>`,
    legendHtml: legend,
  };
}

// Grafico a barre orizzontali — più leggibile di uno verticale quando le etichette
// sono testo lungo (es. nomi di categoria), che è il caso più comune qui.
function barChartSvg(data, { width = 400, barHeight = 28, gap = 10, colors = DEFAULT_COLORS } = {}) {
  const max = Math.max(1, ...data.map((d) => d.value || 0));
  const height = data.length * (barHeight + gap);
  const labelWidth = 120;
  const chartWidth = width - labelWidth - 60;

  const bars = data.map((d, i) => {
    const y = i * (barHeight + gap);
    const w = Math.max(2, ((d.value || 0) / max) * chartWidth);
    return `
      <text x="${labelWidth - 8}" y="${y + barHeight / 2 + 4}" text-anchor="end" fill="#8B93A7" font-family="IBM Plex Sans, sans-serif" font-size="12">${escapeHtml(truncate(d.label, 16))}</text>
      <rect x="${labelWidth}" y="${y}" width="${w}" height="${barHeight}" rx="4" fill="${colors[i % colors.length]}"/>
      <text x="${labelWidth + w + 8}" y="${y + barHeight / 2 + 4}" fill="#F3F4F6" font-family="IBM Plex Mono, monospace" font-size="12">${formatNumber(d.value || 0)}</text>
    `;
  }).join('');

  return `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">${bars}</svg>`;
}

// Grafico a linea — andamento nel tempo (2026-09-04, richiesto dall'utente: "più
// profondità nei grafici"). series: [{label, color, data: [{x, y}]}] — più serie
// sullo stesso asse (es. aperti/critici) per confrontarle a colpo d'occhio. Asse X
// per posizione (indice), non per data reale: le date arrivano già ordinate e
// equispaziate dal backend (una per giorno), un asse temporale vero sarebbe
// complessità senza beneficio qui.
function lineChartSvg(series, { width = 480, height = 160, xLabels = [], colors = DEFAULT_COLORS } = {}) {
  const padTop = 12, padBottom = 24, padLeft = 32, padRight = 12;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;
  const allValues = series.flatMap((s) => s.data.map((d) => d.y));
  const maxY = Math.max(1, ...allValues);
  const n = Math.max(1, ...series.map((s) => s.data.length)) - 1 || 1;

  const px = (i) => padLeft + (n === 0 ? 0 : (i / n) * plotW);
  const py = (v) => padTop + plotH - (v / maxY) * plotH;

  const gridLines = [0, 0.5, 1].map((f) => {
    const y = padTop + plotH * f;
    const val = Math.round(maxY * (1 - f));
    return `<line x1="${padLeft}" y1="${y}" x2="${width - padRight}" y2="${y}" stroke="#232A38" stroke-width="1" stroke-dasharray="3 3"/>
      <text x="${padLeft - 6}" y="${y + 3}" text-anchor="end" fill="#565F72" font-family="IBM Plex Mono, monospace" font-size="10">${val}</text>`;
  }).join('');

  const lines = series.map((s, si) => {
    const color = s.color || colors[si % colors.length];
    if (!s.data.length) return '';
    const path = s.data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${px(i).toFixed(1)} ${py(d.y).toFixed(1)}`).join(' ');
    const dots = s.data.map((d, i) => `<circle cx="${px(i).toFixed(1)}" cy="${py(d.y).toFixed(1)}" r="2.5" fill="${color}"/>`).join('');
    return `<path d="${path}" fill="none" stroke="${color}" stroke-width="2"/>${dots}`;
  }).join('');

  const xAxisLabels = xLabels.length > 1 ? [0, xLabels.length - 1].map((i) => {
    return `<text x="${px(i).toFixed(1)}" y="${height - 6}" text-anchor="${i === 0 ? 'start' : 'end'}" fill="#565F72" font-family="IBM Plex Sans, sans-serif" font-size="10">${escapeHtml(xLabels[i])}</text>`;
  }).join('') : '';

  const legend = series.map((s, si) => `<div style="display:flex;align-items:center;gap:6px;font-size:12px;color:#8B93A7;">
      <span style="width:9px;height:9px;border-radius:2px;background:${s.color || colors[si % colors.length]};flex-shrink:0;"></span>
      <span>${escapeHtml(s.label)}</span>
    </div>`).join('');

  return {
    svg: `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">${gridLines}${lines}${xAxisLabels}</svg>`,
    legendHtml: `<div style="display:flex;gap:14px;margin-top:6px;">${legend}</div>`,
  };
}

function truncate(s, n) { return s && s.length > n ? s.slice(0, n - 1) + '…' : s; }
function formatNumber(n) { return Number(n).toLocaleString('it-IT', { maximumFractionDigits: 2 }); }
function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

export { pieChartSvg, barChartSvg, lineChartSvg, DEFAULT_COLORS };
