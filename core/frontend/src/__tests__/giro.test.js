import { describe, it, expect } from 'vitest'
import { costruisciGiro, PAGINE_FISSE } from '../lib/giro'

describe('costruisciGiro', () => {
  const passi = [
    { pagina: 'dashboard', titolo: 'Da qui', testo: 'Prima pagina' },
    { pagina: 'clienti', titolo: 'Clienti', testo: 'Anagrafica', target: 'sidebar-clienti-speciale' },
    { pagina: 'immobili', titolo: 'Immobili', testo: 'Schede' },
    { pagina: 'guida', titolo: 'Aiuto', testo: 'La guida' },
  ]
  it('trasforma i passi nella forma di ProductTour e usa la voce di menu come bersaglio di default', () => {
    const g = costruisciGiro(passi, [...PAGINE_FISSE, 'clienti', 'immobili'])
    expect(g.map((s) => s.page)).toEqual(['dashboard', 'clienti', 'immobili', 'guida'])
    expect(g[0]).toEqual({ page: 'dashboard', target: 'sidebar-dashboard', title: 'Da qui', body: 'Prima pagina' })
    expect(g[1].target).toBe('sidebar-clienti-speciale')
  })
  it('salta i passi di moduli non installati o non visibili', () => {
    const g = costruisciGiro(passi, [...PAGINE_FISSE, 'clienti'])
    expect(g.map((s) => s.page)).toEqual(['dashboard', 'clienti', 'guida'])
  })
  it('ignora passi incompleti e un elenco assente', () => {
    expect(costruisciGiro([{ pagina: 'dashboard', titolo: 'x' }, null, {}], PAGINE_FISSE)).toEqual([])
    expect(costruisciGiro(undefined, PAGINE_FISSE)).toEqual([])
  })
})
