import React from 'react'
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import Portal from '../components/Portal'

afterEach(cleanup)

describe('Portal', () => {
  it('rende i figli su document.body, fuori dalla card che li ha aperti', () => {
    // La card con backdrop-filter è proprio il caso che intrappolava i position:fixed.
    const { getByTestId } = render(
      <div data-testid="card" style={{ backdropFilter: 'blur(8px)' }}>
        <Portal><div data-testid="dialogo">Smista</div></Portal>
      </div>
    )
    const card = getByTestId('card')
    const dialogo = getByTestId('dialogo')
    expect(dialogo.parentElement).toBe(document.body)
    expect(card.contains(dialogo)).toBe(false)
  })

  it('al disaccoppiamento il dialogo sparisce da body', () => {
    const { unmount } = render(<Portal><div data-testid="dialogo" /></Portal>)
    expect(document.body.querySelector('[data-testid="dialogo"]')).not.toBeNull()
    unmount()
    expect(document.body.querySelector('[data-testid="dialogo"]')).toBeNull()
  })
})
