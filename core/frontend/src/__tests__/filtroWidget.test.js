import { describe, it, expect, beforeEach } from 'vitest'
import { corrisponde, passaTutti, apriModulo, leggiApertura } from '../lib/filtroWidget'

const r = (data) => ({ id: 1, data })
describe('filtro dei widget', () => {
  const oggi = '2026-11-09'
  it('uguale, diverso, vuoto, compilato (anche su elenchi)', () => {
    expect(corrisponde(r({ _stato: 'in_mandato' }), { campo: '_stato', op: '=', valore: 'in_mandato' }, oggi)).toBe(true)
    expect(corrisponde(r({ _stato: 'x' }), { campo: '_stato', op: '!=', valore: 'x' }, oggi)).toBe(false)
    expect(corrisponde(r({ a: [] }), { campo: 'a', op: 'vuoto' }, oggi)).toBe(true)
    expect(corrisponde(r({ a: ['Cantina', 'Box'] }), { campo: 'a', op: '=', valore: 'Box' }, oggi)).toBe(true)
    expect(corrisponde(r({ a: 'x' }), { campo: 'a', op: 'non_vuoto' }, oggi)).toBe(true)
  })
  it('date: scaduto, entro N giorni, questo mese', () => {
    expect(corrisponde(r({ d: '2026-11-08' }), { campo: 'd', op: 'scaduto' }, oggi)).toBe(true)
    expect(corrisponde(r({ d: '2026-11-09' }), { campo: 'd', op: 'scaduto' }, oggi)).toBe(false)
    expect(corrisponde(r({ d: '2026-11-15' }), { campo: 'd', op: 'entro_giorni', valore: 7 }, oggi)).toBe(true)
    expect(corrisponde(r({ d: '2026-11-17' }), { campo: 'd', op: 'entro_giorni', valore: 7 }, oggi)).toBe(false)
    expect(corrisponde(r({ d: '2026-11-30' }), { campo: 'd', op: 'questo_mese' }, oggi)).toBe(true)
    expect(corrisponde(r({ d: 'non è una data' }), { campo: 'd', op: 'scaduto' }, oggi)).toBe(false)
  })
  it('numeri e più condizioni insieme; nessun filtro = tutto', () => {
    expect(corrisponde(r({ n: '10' }), { campo: 'n', op: '>', valore: 5 }, oggi)).toBe(true)
    expect(corrisponde(r({ n: '' }), { campo: 'n', op: '<', valore: 5 }, oggi)).toBe(false)
    expect(passaTutti(r({ s: 'a', d: '2026-01-01' }), [{ campo: 's', op: '=', valore: 'a' }, { campo: 'd', op: 'scaduto' }], oggi)).toBe(true)
    expect(passaTutti(r({}), [], oggi)).toBe(true)
  })
})
describe('apertura filtrata', () => {
  beforeEach(() => sessionStorage.clear())
  it('il filtro si legge una sola volta e solo dal modulo giusto', () => {
    let aperto = null
    apriModulo((s) => { aperto = s }, 'immobili', [{ campo: '_stato', op: '=', valore: 'in_mandato' }])
    expect(aperto).toBe('immobili')
    expect(leggiApertura('clienti')).toBe(null)
    expect(leggiApertura('immobili')).toEqual([{ campo: '_stato', op: '=', valore: 'in_mandato' }])
    expect(leggiApertura('immobili')).toBe(null)
  })
})
