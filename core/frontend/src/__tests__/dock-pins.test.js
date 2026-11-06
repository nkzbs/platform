import { describe, it, expect } from 'vitest'
import { risolviAppuntate, alternaAppuntata } from '@shared/dock-pins'

const disponibili = ['a', 'b', 'c', 'd', 'e', 'f']
const predefinite = ['a', 'b', 'c', 'd']

describe('risolviAppuntate', () => {
  it('senza preferenze usa le predefinite', () => {
    expect(risolviAppuntate(null, predefinite, disponibili, 4)).toEqual(['a', 'b', 'c', 'd'])
  })
  it('con preferenze usa quelle, nell\'ordine scelto', () => {
    expect(risolviAppuntate(['e', 'a'], predefinite, disponibili, 4)).toEqual(['e', 'a'])
  })
  it('una lista vuota è una scelta valida: dock senza voci appuntate, non un ritorno alle predefinite', () => {
    expect(risolviAppuntate([], predefinite, disponibili, 4)).toEqual([])
  })
  it('scarta le voci che non esistono più (un modulo tolto)', () => {
    expect(risolviAppuntate(['a', 'zzz', 'c'], predefinite, disponibili, 4)).toEqual(['a', 'c'])
  })
  it('scarta i doppioni', () => {
    expect(risolviAppuntate(['a', 'a', 'b'], predefinite, disponibili, 4)).toEqual(['a', 'b'])
  })
  it('taglia al massimo', () => {
    expect(risolviAppuntate(['a', 'b', 'c', 'd', 'e'], predefinite, disponibili, 4)).toEqual(['a', 'b', 'c', 'd'])
  })
  it('preferenze non valide (non una lista) tornano alle predefinite', () => {
    expect(risolviAppuntate('rotto', predefinite, disponibili, 4)).toEqual(predefinite)
  })
})

describe('alternaAppuntata', () => {
  it('toglie una voce appuntata', () => {
    expect(alternaAppuntata(['a', 'b'], 'a', 4)).toEqual(['b'])
  })
  it('aggiunge una voce se c\'è posto, in fondo', () => {
    expect(alternaAppuntata(['a', 'b'], 'c', 4)).toEqual(['a', 'b', 'c'])
  })
  it('dock pieno: non aggiunge e restituisce la STESSA lista (niente da salvare)', () => {
    const piena = ['a', 'b', 'c', 'd']
    expect(alternaAppuntata(piena, 'e', 4)).toBe(piena)
  })
  it('non modifica la lista ricevuta', () => {
    const l = ['a', 'b']
    alternaAppuntata(l, 'c', 4)
    alternaAppuntata(l, 'a', 4)
    expect(l).toEqual(['a', 'b'])
  })
})
