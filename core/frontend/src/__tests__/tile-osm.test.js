import { describe, it, expect } from 'vitest'
import { tessera, griglia, urlTessera } from '../lib/tile-osm'

describe('tessere di OpenStreetMap', () => {
  it('Greenwich/equatore a zoom 1: tessera (1,1), in alto a sinistra di quella', () => {
    const t = tessera(0, 0, 1); expect([t.x, t.y]).toEqual([1, 1]); expect(t.fx).toBeCloseTo(0, 5); expect(t.fy).toBeCloseTo(0, 5)
  })
  it('Milano a zoom 16 cade nella tessera (34440, 23454), calcolata a parte con asinh', () => {
    const t = tessera(45.4642, 9.19, 16); expect([t.x, t.y]).toEqual([34440, 23454]); expect(t.fx).toBeGreaterThanOrEqual(0); expect(t.fx).toBeLessThan(1)
  })
  it('la griglia 5x3 ha 15 tessere con il punto al centro', () => {
    const g = griglia(45.4642, 9.19, 16); expect(g.tessere).toHaveLength(15)
    const c = g.tessere.find((t) => t.dx === 0 && t.dy === 0); expect([c.x, c.y]).toEqual([g.x, g.y])
  })
  it('vicino al polo le tessere fuori dal mondo si scartano; la longitudine si avvolge', () => {
    const polo = griglia(85.05, 0, 3); expect(polo.tessere.every((t) => t.y >= 0)).toBe(true); expect(polo.tessere.length).toBeLessThan(15)
    const bordo = griglia(0, 179.9, 3); expect(bordo.tessere.every((t) => t.x >= 0 && t.x < 8)).toBe(true)
  })
  it('url della tessera', () => { expect(urlTessera(16, 34440, 23454)).toBe('https://tile.openstreetmap.org/16/34440/23454.png') })
})
