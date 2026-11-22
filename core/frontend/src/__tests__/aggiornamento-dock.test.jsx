import React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, screen, fireEvent, waitFor, act } from '@testing-library/react'
import AggiornamentoDock from '../../../../super-admin/frontend/src/components/AggiornamentoDock'
import * as agg from '../../../../super-admin/frontend/src/lib/aggiornamento'

// L'icona di Super Admin porta con sé il React di Super Admin (due React nello stesso test: «Invalid hook call»): qui non serve, si finge.
vi.mock('../../../../super-admin/frontend/src/components/Icon', () => ({ default: () => null }))

// L'aggiornamento di un tenant in Super Admin: la finestra ha i passi e una barra, si può ridurre a una pastiglia mentre il lavoro continua, e a fine lavoro si riapre con l'esito.
afterEach(() => { cleanup(); vi.unstubAllGlobals(); agg.chiudi() })

// Uno stream di righe JSON che si manda a mano, una alla volta.
function flusso() {
  const enc = new TextEncoder(); let ctrl
  const body = new ReadableStream({ start(c) { ctrl = c } })
  return { body, manda: (o) => ctrl.enqueue(enc.encode(JSON.stringify(o) + '\n')), fine: () => ctrl.close() }
}
const tenant = { slug: 'finance', name: 'Finance' }

describe('finestra di aggiornamento', () => {
  it('mostra i passi e la barra; «Riduci e continua» la riduce a una pastiglia senza fermare il lavoro; a fine lavoro si riapre con AGGIORNATO', async () => {
    const f = flusso()
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, body: f.body, json: async () => ({}) })))
    render(<AggiornamentoDock token="t" />)
    expect(screen.queryByRole('dialog')).toBeNull()
    let finito; act(() => { finito = agg.avvia(tenant, false, 't') })
    await act(async () => { f.manda({ msg: 'Scarico il sorgente più recente (commit abc)...', at: new Date().toISOString() }) })
    const dialogo = await screen.findByRole('dialog')
    expect(dialogo).toBeTruthy()
    await waitFor(() => expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('5'))
    expect(screen.getByText('Aggiornamento in corso')).toBeTruthy()

    fireEvent.click(screen.getByText('Riduci e continua'))
    expect(screen.queryByRole('dialog')).toBeNull()
    const pastiglia = screen.getByRole('button', { name: /Aggiornamento di Finance: 5%/ })
    expect(pastiglia).toBeTruthy()

    // il lavoro continua anche a finestra ridotta: la pastiglia si aggiorna
    await act(async () => { f.manda({ msg: 'Nuovo container creato.', at: new Date().toISOString() }) })
    await waitFor(() => expect(screen.getByRole('button', { name: /Aggiornamento di Finance: 85%/ })).toBeTruthy())

    // a fine lavoro la finestra si riapre da sola con l'esito
    await act(async () => { f.manda({ done: true, ok: true, healthy: true }); f.fine(); await finito })
    expect(await screen.findByText('AGGIORNATO')).toBeTruthy()
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100')
    fireEvent.click(screen.getByText('Chiudi'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('un aggiornamento fallito mostra NON AGGIORNATO col motivo; con una sessione attiva offre «Aggiorna comunque»', async () => {
    const f1 = flusso()
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, body: f1.body, json: async () => ({}) })))
    render(<AggiornamentoDock token="t" />)
    let p; act(() => { p = agg.avvia(tenant, false, 't') })
    await act(async () => { f1.manda({ done: true, ok: false, skipped: 'active_session', active_session: { username: 'nima' } }); f1.fine(); await p })
    expect(await screen.findByText('Sessione attiva')).toBeTruthy()
    expect(screen.getByText('Aggiorna comunque')).toBeTruthy()
    fireEvent.click(screen.getByText('Chiudi'))

    const f2 = flusso()
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, body: f2.body, json: async () => ({}) })))
    let q; act(() => { q = agg.avvia(tenant, false, 't') })
    await act(async () => { f2.manda({ done: true, ok: false, error: 'build fallita' }); f2.fine(); await q })
    expect(await screen.findByText('NON AGGIORNATO')).toBeTruthy()
    expect(screen.getByText('build fallita')).toBeTruthy()
  })

  it('uno alla volta: un secondo avvio mentre uno è in corso non fa niente; a fine lavoro chiama chi si è iscritto', async () => {
    const f = flusso(); const chiamate = vi.fn(() => Promise.resolve({ ok: true, body: f.body, json: async () => ({}) }))
    vi.stubGlobal('fetch', chiamate)
    const fine = vi.fn(); const disiscrivi = agg.allaFine(fine)
    let p; act(() => { p = agg.avvia(tenant, false, 't') })
    await act(async () => { await agg.avvia({ slug: 'zucca', name: 'zucca' }, false, 't') })
    expect(chiamate).toHaveBeenCalledTimes(1)
    await act(async () => { f.manda({ done: true, ok: true, healthy: true }); f.fine(); await p })
    expect(fine).toHaveBeenCalledTimes(1)
    disiscrivi()
  })
})
