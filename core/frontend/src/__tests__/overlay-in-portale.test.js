import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Guardia contro il bug del 06/11/2026: un overlay a tutto schermo (`fixed inset-0`) dentro una
// card di vetro (backdrop-filter) resta intrappolato nella card. Ogni overlay deve stare in un
// portale (<Portal> o createPortal). Il controllo è deliberatamente semplice: per ogni file, gli
// overlay non possono essere più dei portali, salvo le eccezioni elencate sotto (con il motivo).
const qui = path.dirname(fileURLToPath(import.meta.url))
const RADICI = {
  tenant: path.resolve(qui, '..'),
  'super-admin': path.resolve(qui, '../../../../super-admin/frontend/src'),
}
// file (relativo alla radice dell'app) → quanti overlay senza portale sono voluti
const ECCEZIONI = {
  'tenant:components/Sidebar.jsx': 1,      // backdrop del pannello "Altro" del dock: non è un dialogo
  'tenant:components/ProductTour.jsx': 2,  // giro guidato: overlay di radice, mai dentro una card
  'super-admin:components/Sidebar.jsx': 1, // stesso backdrop del dock
}

function jsx(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) return e.name === '__tests__' ? [] : jsx(p)
    return e.name.endsWith('.jsx') ? [p] : []
  })
}

describe('overlay a tutto schermo', () => {
  for (const [app, radice] of Object.entries(RADICI)) {
    it('ogni overlay di ' + app + ' è in un portale', () => {
      const fuori = []
      for (const file of jsx(radice)) {
        const src = fs.readFileSync(file, 'utf8')
        const overlay = (src.match(/fixed inset-0/g) || []).length
        if (!overlay) continue
        const portali = (src.match(/<Portal>|createPortal\(/g) || []).length
        const rel = path.relative(radice, file)
        const permessi = ECCEZIONI[app + ':' + rel] || 0
        if (overlay - portali > permessi) fuori.push(rel + ' (' + overlay + ' overlay, ' + portali + ' portali)')
      }
      expect(fuori, 'overlay senza portale — avvolgili in <Portal> (vedi ARCHITETTURA.md, "Overlay a tutto schermo")').toEqual([])
    })
  }
})
