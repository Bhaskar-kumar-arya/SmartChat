import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { renderWithProviders, screen } from './testUtils'
import { useAPI } from '@renderer/context/APIContext'
import { createMockApiService } from './mocks/mockApiService'

function TestComponent() {
  const api = useAPI()
  const [jid, setJid] = React.useState<string | null>(null)

  React.useEffect(() => {
    api.getMyJid().then(setJid)
  }, [api])

  return <div data-testid="jid-container">{jid || 'Loading...'}</div>
}

describe('Renderer Test Environment Setup', () => {
  it('renders components with APIProvider and default mockApiService', async () => {
    renderWithProviders(<TestComponent />)

    expect(screen.getByTestId('jid-container')).toHaveTextContent('Loading...')
    expect(await screen.findByTestId('jid-container')).toHaveTextContent('me@s.whatsapp.net')
  })

  it('allows overriding mockApiService methods per test', async () => {
    const customApiService = {
      getMyJid: vi.fn().mockResolvedValue('custom@s.whatsapp.net'),
    }

    renderWithProviders(<TestComponent />, {
      apiService: createMockApiService(customApiService),
    })

    expect(await screen.findByTestId('jid-container')).toHaveTextContent('custom@s.whatsapp.net')
  })
})
