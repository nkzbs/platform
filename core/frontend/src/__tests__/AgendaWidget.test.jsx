import React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react'
import AgendaWidget from '../components/AgendaWidget'

// «Da fare» della Dashboard: la casella a sinistra segna la riga come fatta con il passaggio di stato vero; se il modulo non lo permette la riga resta e dice perché.
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const oggi = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }
const risposta = (corpo, ok = true, status = 200) => Promise.resolve({ ok, status, json: async () => corpo })

function prepara({ fatto = 'fatto', transizioni = {} } = {}) {
  const chiamate = []
  vi.stubGlobal('fetch', vi.fn((url, opts = {}) => {
    chiamate.push({ url, metodo: opts.method || 'GET', corpo: opts.body ? JSON.parse(opts.body) : null })
    if (url.endsWith('/module-roles/agenda')) return risposta([{ module_slug: 'attivita', name: 'Attività', scadenza: 'scadenza', descrizione: 'titolo', stato: '_stato', fatto, noun_s: 'attività' }])
    if (url.endsWith('/records/attivita')) return risposta([
      { id: 1, data: { titolo: 'Visita Villa', scadenza: oggi(), _stato: 'da_fare' } },
      { id: 2, data: { titolo: 'Telefonata offerta', scadenza: oggi(), _stato: 'da_fare' } },
    ])
    const m = /\/records\/attivita\/(\d+)\/transition$/.exec(url)
    if (m) { const t = transizioni[m[1]]; return t ? risposta({ error: t }, false, 400) : risposta({ id: Number(m[1]) }) }
    return risposta(null, false, 404)
  }))
  return chiamate
}

describe('AgendaWidget: casella «fatto»', () => {
  it('ogni riga ha la sua casella; spuntarla fa il passaggio di stato vero e la riga esce', async () => {
    const chiamate = prepara()
    render(<AgendaWidget token="t" onNavigate={() => {}} />)
    await screen.findByText('Visita Villa')
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
    fireEvent.click(screen.getByLabelText('Segna come fatto: Visita Villa'))
    await waitFor(() => expect(screen.queryByText('Visita Villa')).toBeNull())
    expect(screen.getByText('Telefonata offerta')).toBeTruthy()
    const post = chiamate.find((c) => c.metodo === 'POST')
    expect(post.url).toMatch(/\/records\/attivita\/1\/transition$/)
    expect(post.corpo).toEqual({ to: 'fatto' })
    expect(screen.getByText(/Da fare · 1/)).toBeTruthy()
  })

  it('se il modulo rifiuta il passaggio la riga resta e si legge il motivo', async () => {
    prepara({ transizioni: { 2: 'Per passare a «Fatto» manca: Esito.' } })
    render(<AgendaWidget token="t" onNavigate={() => {}} />)
    await screen.findByText('Telefonata offerta')
    fireEvent.click(screen.getByLabelText('Segna come fatto: Telefonata offerta'))
    await screen.findByText(/manca: Esito/)
    expect(screen.getByText('Telefonata offerta')).toBeTruthy()
    expect(screen.getByLabelText('Segna come fatto: Telefonata offerta').checked).toBe(false)
  })

  it('senza uno stato «fatto» dichiarato dal modulo non c\'è la casella (non si saprebbe dove portare la riga)', async () => {
    prepara({ fatto: '' })
    render(<AgendaWidget token="t" onNavigate={() => {}} />)
    await screen.findByText('Visita Villa')
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
  })

  it('cliccare il titolo apre il modulo, non segna la riga', async () => {
    const chiamate = prepara(); const aperti = []
    render(<AgendaWidget token="t" onNavigate={(m) => aperti.push(m)} />)
    fireEvent.click(await screen.findByText('Visita Villa'))
    expect(aperti).toEqual(['attivita'])
    expect(chiamate.some((c) => c.metodo === 'POST')).toBe(false)
  })
})
