import { describe, it, expect } from 'vitest'
import { avanzamento } from '@shared/avanzamento-aggiornamento'

const r = (...msg) => msg.map((m) => ({ msg: m }))

describe('avanzamento di un aggiornamento', () => {
  it('parte da zero e sale con le tappe riconosciute', () => {
    expect(avanzamento([], 'running')).toBe(0)
    expect(avanzamento(r('Scarico il sorgente più recente (commit abc)...'), 'running')).toBe(5)
    expect(avanzamento(r('Scarico il sorgente più recente (commit abc)...', "Sorgente scaricato ed estratto. Costruisco l'immagine..."), 'running')).toBe(20)
  })
  it('durante la costruzione sale con i messaggi ma non arriva al 70%', () => {
    const base = r("Sorgente scaricato ed estratto. Costruisco l'immagine...")
    const poche = avanzamento([...base, ...r('a', 'b', 'c')], 'running')
    const molte = avanzamento([...base, ...r(...Array.from({ length: 200 }, (_, i) => 'passo ' + i))], 'running')
    expect(poche).toBeGreaterThan(20); expect(molte).toBeGreaterThan(poche); expect(molte).toBeLessThan(70)
  })
  it('dopo la costruzione le tappe del tenant: controllo sessione, container, attesa, risposta', () => {
    const t = (m) => avanzamento([...r("Costruisco l'immagine..."), ...r(m)], 'running')
    expect(t('Controllo se qualcuno sta usando "Finance"…')).toBe(70)
    expect(t('Fermo il vecchio container, lo rimuovo e ne creo uno nuovo con l\'ultima immagine (stessi dati)…')).toBe(78)
    expect(t('Nuovo container creato.')).toBe(85)
    expect(t('Attendo che il tenant risponda…')).toBe(88)
    expect(t('Il tenant risponde correttamente.')).toBe(96)
  })
  it('non torna mai indietro e, da riuscito, è 100; da fallito si ferma dov\'era', () => {
    const righe = r('Nuovo container creato.', 'un messaggio qualunque')
    expect(avanzamento(righe, 'running')).toBe(85)
    expect(avanzamento(righe, 'ok')).toBe(100)
    expect(avanzamento(righe, 'ko')).toBe(85)
  })
  it('non supera mai 99 se non è finito', () => {
    expect(avanzamento(r('Pacchetti aggiornati: x.'), 'running')).toBe(98)
  })
})
