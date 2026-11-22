import { describe, it, expect } from 'vitest'
import { riepilogoPerGruppo } from '../lib/riepilogo-gruppi'

const perId = {
  1: { data: { creditore: 'COFIDIS' } }, 2: { data: { creditore: 'LG ' } }, 3: { data: { creditore: 'COFIDIS' } },
  4: { data: { creditore: '' } }, 5: { data: {} }, 6: { data: { creditore: 'IKEA' } },
}
const righe = [
  { __id: 1, residuo: 543.48, n_children: 4, n_done: 0 },
  { __id: 2, residuo: 1086.96, n_children: 12, n_done: 4 },
  { __id: 3, residuo: 100.1, n_children: 2, n_done: 1 },
  { __id: 4, residuo: 50, n_children: 1, n_done: 0 },
  { __id: 5, residuo: 30, n_children: 1, n_done: 0 },
  { __id: 6, residuo: 0, n_children: 6, n_done: 6 },
]

describe('riepilogoPerGruppo', () => {
  it('somma piani, rate rimaste e residuo per creditore, dal più alto al più basso', () => {
    const g = riepilogoPerGruppo(righe, perId, 'creditore', (p) => p.residuo <= 0 && p.n_children > 0)
    expect(g).toEqual([
      { nome: 'LG', piani: 1, rate: 8, residuo: 1086.96 },
      { nome: 'COFIDIS', piani: 2, rate: 5, residuo: 643.58 },
    ])
  })
  it('un piano saldato non conta; senza creditore non entra in nessun gruppo', () => {
    const g = riepilogoPerGruppo(righe, perId, 'creditore', (p) => p.__id === 1 || (p.residuo <= 0 && p.n_children > 0))
    expect(g.map((x) => x.nome)).toEqual(['LG', 'COFIDIS'])
    expect(g[1]).toEqual({ nome: 'COFIDIS', piani: 1, rate: 1, residuo: 100.1 })
  })
  it('un piano senza rate (un saldo) conta col suo residuo e zero rate', () => {
    const g = riepilogoPerGruppo([{ __id: 1, residuo: 775, n_children: 0, n_done: 0 }], perId, 'creditore', () => false)
    expect(g).toEqual([{ nome: 'COFIDIS', piani: 1, rate: 0, residuo: 775 }])
  })
  it('senza righe o senza record non rompe', () => {
    expect(riepilogoPerGruppo(null, null, 'creditore')).toEqual([])
    expect(riepilogoPerGruppo([{ __id: 9, residuo: 1 }], {}, 'creditore')).toEqual([])
  })
})
