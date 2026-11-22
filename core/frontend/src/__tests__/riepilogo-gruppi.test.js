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

import { mappaDaElenco, raggruppaDaPagare, normalizza } from '../lib/riepilogo-gruppi'

describe('piani raggruppati per categoria del fornitore', () => {
  const perId = { 1: { data: { creditore: 'Officina Rossi' } }, 2: { data: { creditore: 'OFFICINA ROSSI' } }, 3: { data: { creditore: 'IKEA' } }, 4: { data: { creditore: 'Sconosciuto' } } }
  const righe = [{ __id: 1, residuo: 215, n_children: 4, n_done: 2 }, { __id: 2, residuo: 150, n_children: 2, n_done: 0 }, { __id: 3, residuo: 50, n_children: 1, n_done: 0 }, { __id: 4, residuo: 10, n_children: 1, n_done: 0 }]
  const forn = mappaDaElenco([{ data: { nome: 'Officina Rossi', categoria: 'Auto' } }, { data: { nome: 'IKEA', categoria: 'Acquisti' } }, { data: { nome: 'Vuota', categoria: '' } }], 'nome', 'categoria')
  it('la mappa fornitore → categoria ignora maiuscole e spazi e salta chi non ha categoria', () => {
    expect(forn[normalizza('officina rossi')]).toBe('Auto'); expect(forn[normalizza('Vuota')]).toBeUndefined()
  })
  it('somma per categoria; un creditore non in lista va in «Senza categoria»', () => {
    const g = riepilogoPerGruppo(righe, perId, 'creditore', () => false, (c) => forn[normalizza(c)])
    expect(g).toEqual([
      { nome: 'Auto', piani: 2, rate: 4, residuo: 365 },
      { nome: 'Acquisti', piani: 1, rate: 1, residuo: 50 },
      { nome: 'Senza categoria', piani: 1, rate: 1, residuo: 10 },
    ])
  })
})

describe('spese ancora da pagare', () => {
  const q = { stato: '_stato', da_fare: 'da_pagare', importo: 'importo', categoria: 'categoria', data: 'data' }
  const rec = (categoria, importo, data, stato = 'da_pagare') => ({ data: { _stato: stato, categoria, importo, data } })
  const spese = [rec('Elettricità', 80, '2026-12-05'), rec('Elettricità', 45.5, '2026-12-27'), rec('Affitto', 550, '2026-12-01'), rec('Internet', 30, '2027-01-10'), rec('Affitto', 550, '2026-11-01', 'pagato'), rec('', 12, '2027-01-15')]
  it('per categoria: solo le da pagare, dal totale più alto, senza categoria in fondo ai nomi vuoti', () => {
    expect(raggruppaDaPagare(spese, q, 'categoria')).toEqual([
      { nome: 'Affitto', n: 1, totale: 550, ordine: '' }, { nome: 'Elettricità', n: 2, totale: 125.5, ordine: '' }, { nome: 'Internet', n: 1, totale: 30, ordine: '' }, { nome: 'Senza categoria', n: 1, totale: 12, ordine: '' },
    ])
  })
  it('per mese: in ordine di tempo, col nome del mese', () => {
    expect(raggruppaDaPagare(spese, q, 'mese').map((g) => [g.nome, g.totale, g.n])).toEqual([['dicembre 2026', 675.5, 3], ['gennaio 2027', 42, 2]])
  })
  it('senza spese da pagare dà un elenco vuoto', () => { expect(raggruppaDaPagare([], q, 'categoria')).toEqual([]); expect(raggruppaDaPagare(null, q, 'mese')).toEqual([]) })
})
