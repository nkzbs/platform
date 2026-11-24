import React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react'

// Il widget Timbrature della dashboard: un solo modulo (data e ora), un interruttore Entrata/Uscita che segue lo stato ma si cambia a mano, contatore delle ore di oggi.
// L'API e l'icona si fingono: qui si prova il comportamento del widget, non il server.
const api = { get: vi.fn(), post: vi.fn(), put: vi.fn() }
vi.mock('../lib/useApi', () => ({ default: () => api }))
vi.mock('../components/Icon', () => ({ default: () => null }))
import TimbratureWidget from '../components/TimbratureWidget'

const pad2 = (n) => String(n).padStart(2, '0')
const oggi = () => { const d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) }
const ruoli = [{ module_slug: 'presenze', data: 'data', inizio: 'inizio', fine: 'fine' }]
const turno = (id, inizio, fine) => ({ id, user_id: 7, data: { data: oggi(), inizio, ...(fine ? { fine } : {}) } })
const monta = (righe) => {
  api.get.mockImplementation(async (p) => (p === '/module-roles/presenze' ? ruoli : righe))
  api.post.mockResolvedValue({ ok: true, data: {} }); api.put.mockResolvedValue({ ok: true, data: {} })
  return render(<TimbratureWidget token="t" user={{ id: 7 }} />)
}
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('widget Timbrature', () => {
  it('non al lavoro: contatore a zero, interruttore su Entrata, un solo pulsante «Registra entrata»', async () => {
    monta([])
    expect(await screen.findByText('Non al lavoro')).toBeTruthy()
    expect(screen.getByText('0h 00m')).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Entrata' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('button', { name: 'Registra entrata' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Registra uscita' })).toBeNull()
  })

  it('al lavoro: l\'interruttore passa da solo su Uscita; si può tornare a mano su Entrata', async () => {
    monta([turno(1, '08:00')])
    expect(await screen.findByText(/Al lavoro dalle 08:00/)).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Uscita' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('button', { name: 'Registra uscita' })).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: 'Entrata' }))
    expect(screen.getByRole('button', { name: 'Registra entrata' })).toBeTruthy()
  })

  it('i turni chiusi di oggi si sommano nel contatore e compaiono in riga', async () => {
    monta([turno(1, '08:00', '09:30'), turno(2, '10:00', '10:45')])
    expect(await screen.findByText('2h 15m')).toBeTruthy()
    expect(screen.getByText(/08:00 – 09:30/)).toBeTruthy()
    expect(screen.getByText(/10:00 – 10:45/)).toBeTruthy()
  })

  it('«Registra entrata» scrive una riga nuova con data e ora del modulo', async () => {
    monta([])
    fireEvent.click(await screen.findByRole('button', { name: 'Registra entrata' }))
    await waitFor(() => expect(api.post).toHaveBeenCalled())
    const [url, corpo] = api.post.mock.calls[0]
    expect(url).toBe('/records/presenze')
    expect(corpo.data).toBe(oggi())
    expect(corpo.inizio).toMatch(/^\d\d:\d\d$/)
  })

  it('«Registra uscita» chiude il turno aperto con l\'ora scelta', async () => {
    monta([turno(5, '08:00')])
    const ora = await screen.findByLabelText('Orario')
    fireEvent.change(ora, { target: { value: '17:30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Registra uscita' }))
    await waitFor(() => expect(api.put).toHaveBeenCalled())
    const [url, corpo] = api.put.mock.calls[0]
    expect(url).toBe('/records/presenze/5')
    expect(corpo.fine).toBe('17:30')
    expect(corpo.inizio).toBe('08:00')
  })

  it('uscita senza un turno aperto in quella data: errore chiaro, nessuna scrittura', async () => {
    monta([turno(6, '08:00')])
    const data = await screen.findByLabelText('Data')
    fireEvent.change(data, { target: { value: '2020-01-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Registra uscita' }))
    expect(await screen.findByText('Nessun turno aperto in quella data.')).toBeTruthy()
    expect(api.put).not.toHaveBeenCalled()
  })
})
