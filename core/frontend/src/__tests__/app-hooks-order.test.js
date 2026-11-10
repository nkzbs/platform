import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// «Pagina bianca» cambiando utente: un useEffect stava DOPO il return del login in App.jsx. Con il token nullo (uscita) React vede meno ganci di prima, va in errore e svuota tutta la
// pagina. Regola: in App.jsx nessun gancio dopo «if (!token) return».
describe('App.jsx: ordine dei ganci', () => {
  it('nessun use* dopo il return del login', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'App.jsx'), 'utf8')
    const i = src.indexOf('if (!token) return <')
    expect(i).toBeGreaterThan(0)
    const dopo = src.slice(i)
    const ganci = dopo.match(/\buse(State|Effect|Memo|Ref|Callback|Context|Reducer)\(/g) || []
    expect(ganci).toEqual([])
  })
})
