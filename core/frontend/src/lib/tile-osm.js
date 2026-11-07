// Matematica delle tessere di OpenStreetMap (proiezione «slippy map»): da latitudine/longitudine a quale tessera e dove cade dentro. Funzione pura.
export const ZOOM_MIN = 12, ZOOM_MAX = 18
export function tessera(lat, lon, z) {
  const n = 2 ** z
  const rad = (lat * Math.PI) / 180
  const xf = ((lon + 180) / 360) * n
  const yf = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n
  const x = Math.floor(xf), y = Math.floor(yf)
  return { x, y, fx: xf - x, fy: yf - y }
}
// Le tessere da mostrare attorno al punto: `colonne` x `righe` (dispari), con la posizione di ognuna rispetto alla tessera del punto. x si avvolge attorno al mondo; y fuori dal mondo è scartata.
export function griglia(lat, lon, z, colonne = 5, righe = 3) {
  const t = tessera(lat, lon, z), n = 2 ** z, out = []
  for (let dy = -Math.floor(righe / 2); dy <= Math.floor(righe / 2); dy++) for (let dx = -Math.floor(colonne / 2); dx <= Math.floor(colonne / 2); dx++) {
    const y = t.y + dy
    if (y < 0 || y >= n) continue
    out.push({ x: ((t.x + dx) % n + n) % n, y, dx, dy })
  }
  return { ...t, tessere: out }
}
export const urlTessera = (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`
