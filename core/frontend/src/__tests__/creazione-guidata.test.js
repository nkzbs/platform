import { describe, it, expect } from 'vitest'
import { campoDiCollegamento, titoloProposto } from '../components/CreazioneGuidata'
import { schemaToV3, parseSchemaFrontend } from '../lib/schema-v3-frontend'

describe('creazione guidata', () => {
  const regola = { modulo: 'trattative', titolo: 'Trattativa — {nome}', per_valore: { campo: 'tipo_cliente', mappa: { Venditore: 'venditore', Acquirente: 'acquirente' }, predefinito: 'cliente' } }
  it('il campo di collegamento segue un valore della scheda, con un predefinito', () => {
    expect(campoDiCollegamento(regola, { tipo_cliente: 'Venditore' })).toBe('venditore')
    expect(campoDiCollegamento(regola, { tipo_cliente: 'Acquirente' })).toBe('acquirente')
    expect(campoDiCollegamento(regola, {})).toBe('cliente')
    expect(campoDiCollegamento({ campo: 'immobile' }, {})).toBe('immobile')
  })
  it('il titolo usa il nome della scheda appena creata', () => {
    expect(titoloProposto(regola, { nome: 'Mario Rossi' })).toBe('Trattativa — Mario Rossi')
    expect(titoloProposto({ titolo: 'Vendita — {nome}' }, { titolo: 'Bilocale Desenzano' })).toBe('Vendita — Bilocale Desenzano')
  })
  it('il blocco sopravvive al giro schema piatto → blocchi → schema piatto (il Builder non lo perde)', () => {
    const piatto = { fields: [], relations: [], creazione_guidata: { scelta_iniziale: true, dopo: [{ modulo: 'trattative', campo: 'immobile' }] } }
    const v3 = schemaToV3(piatto)
    expect(v3.steps.some((s) => s.block_type === 'creazione_guidata')).toBe(true)
    expect(parseSchemaFrontend(JSON.stringify(v3)).creazione_guidata.dopo[0].modulo).toBe('trattative')
  })
})
