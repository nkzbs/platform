// Colore d'accento leggibile sul tema in uso: un accento scuro (es. blu notte) sparisce sullo sfondo scuro,
// uno chiaro sparisce sul tema chiaro. Si schiarisce/scurisce il colore scelto (mescolando con bianco/nero)
// finché ha abbastanza contrasto; i colori già leggibili restano IDENTICI.
export function luminanza([r, g, b]) {
  const c = [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) })
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
const contrasto = (a, b) => { const [x, y] = [luminanza(a), luminanza(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
const SFONDO = { scuro: [17, 24, 39], chiaro: [255, 255, 255] }

export function accentoLeggibile(rgb, tema, minimo = 3.2) {
  const sfondo = SFONDO[tema === 'light' || tema === 'chiaro' ? 'chiaro' : 'scuro']
  const verso = sfondo === SFONDO.scuro ? 255 : 0
  let out = rgb
  for (let t = 0; t <= 1.0001 && contrasto(out, sfondo) < minimo; t += 0.05) {
    out = rgb.map((v) => Math.round(v + (verso - v) * t))
  }
  return out
}
