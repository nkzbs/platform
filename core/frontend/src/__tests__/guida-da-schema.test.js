import { describe, it, expect } from 'vitest'
import { daSchema } from '../lib/guida-da-schema'

const schema = {
  fields: [{ key: 'nome', label: 'Nome', dato_chiave: true }, { key: 'email', label: 'Email' }, { key: 'tel', label: 'Telefono' }],
  relations: [{ key: 'immobile', label: 'Immobile' }],
  workflow: {
    states: [{ key: 'a', label: 'Aperta', initial: true }, { key: 'b', label: 'In corso' }, { key: 'c', label: 'Chiusa' }],
    transitions: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'a' }],
  },
  state_requirements: [
    { stato: 'c', bloccante: true, requisiti: [{ label: 'Esito', tipo: 'campo', campo: 'nome' }, { tipo: 'uno_di', campi: ['email', 'tel'] }, { tipo: 'allegato', valore: 'Atto' }] },
    { stato: 'b', bloccante: false, requisiti: [{ tipo: 'campo', campo: 'immobile' }] },
    { stato: 'a', requisiti: [] },
  ],
  document_actions: [{ label: 'Privacy' }, {}],
  external_actions: [{ label: 'Valuta', adapter: 'x' }, { label: 'Firma', adapter: 'da_attivare', servizio_richiesto: 'eSignature' }],
  calendar_views: [{}],
}

describe('daSchema', () => {
  it('percorso nell\'ordine degli stati senza il giro di ritorno', () => { expect(daSchema(schema).percorso).toEqual(['Aperta', 'In corso', 'Chiusa']) })
  it('passaggi: requisiti con i nomi leggibili, bloccante o promemoria, senza i vuoti', () => {
    expect(daSchema(schema).passaggi).toEqual([
      { stato: 'Chiusa', bloccante: true, servono: ['Esito', 'Email o Telefono', 'Atto'] },
      { stato: 'In corso', bloccante: false, servono: ['Immobile'] },
    ])
  })
  it('dati chiave, documenti, azioni (con «da attivare») e calendario', () => {
    const r = daSchema(schema)
    expect(r.datiChiave).toEqual(['Nome']); expect(r.documenti).toEqual(['Privacy'])
    expect(r.azioni.map((a) => [a.label, a.daAttivare, a.servizio])).toEqual([['Valuta', false, ''], ['Firma', true, 'eSignature']]); expect(r.calendario).toBe(true)
  })
  it('uno schema vuoto o assente non rompe nulla', () => { expect(daSchema(null).percorso).toEqual([]); expect(daSchema({}).passaggi).toEqual([]) })
})
