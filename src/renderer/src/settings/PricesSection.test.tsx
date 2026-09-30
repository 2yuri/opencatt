import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { fakeApi } from '../test/fakeApi'
import { PricesSection } from './PricesSection'

afterEach(cleanup)

describe('PricesSection (OP-110)', () => {
  it('shows X prices with their date, saves an edit, refuses a bad one, and resets', async () => {
    const fake = fakeApi()
    window.opencat = fake.api
    render(<PricesSection />)
    await waitFor(() =>
      expect((screen.getByLabelText('Read a post') as HTMLInputElement).value).toBe('0.001')
    )
    const read = screen.getByLabelText('Read a post') as HTMLInputElement
    expect(screen.getByText(/Prices as of 30 Sep 2026/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Reset to defaults' })).toBeNull()

    fireEvent.change(read, { target: { value: '0.002' } })
    fireEvent.blur(read)
    await waitFor(() =>
      expect(fake.api.stats.prices.set).toHaveBeenCalledWith({ ownedRead: 0.002 })
    )
    const reset = await screen.findByRole('button', { name: 'Reset to defaults' })

    const post = screen.getByLabelText('Post') as HTMLInputElement
    fireEvent.change(post, { target: { value: 'abc' } })
    fireEvent.blur(post)
    expect(
      await screen.findByText('A price must be a number of dollars, zero or more.')
    ).toBeTruthy()

    fireEvent.click(reset)
    await waitFor(() =>
      expect((screen.getByLabelText('Read a post') as HTMLInputElement).value).toBe('0.001')
    )
  })
})
