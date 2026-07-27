import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { APIProvider } from '@renderer/context/APIContext'
import { createMockApiService } from '../mocks/mockApiService'
import { ContributionProvider } from '@renderer/context/ContributionContext'
import { useContributions } from '@renderer/hooks/useContributions'
import { ContributionRegistrySnapshot } from '@renderer/types/contribution.types'

function MessageActionRunner({ chatJid, messageId }: { chatJid: string; messageId: string }) {
  const actions = useContributions('message-action')
  return (
    <div>
      <span data-testid="count">{actions.length}</span>
      {actions.map((act) => (
        <button
          key={`${act.pluginId}:${act.id}`}
          data-testid={`action-${act.id}`}
          onClick={async () => {
            const api = (window as any).mockApi
            if (api) {
              await api.executeContribution({
                slot: 'message-action',
                pluginId: act.pluginId,
                id: act.id,
                context: { chatJid, messageId }
              })
            }
          }}
        >
          {act.label}
        </button>
      ))}
    </div>
  )
}

describe('MessageItem Contributions Integration', () => {
  it('loads message actions from snapshot and dispatches executeContribution', async () => {
    const mockSnapshot: ContributionRegistrySnapshot = {
      'message-action': [
        { pluginId: 'com.external.plugin', id: 'translate', label: 'Translate Message' }
      ]
    }

    const executeContributionMock = vi.fn().mockResolvedValue(undefined)

    const apiService = createMockApiService({
      getContributions: vi.fn().mockResolvedValue(mockSnapshot),
      executeContribution: executeContributionMock
    })

    ;(window as any).mockApi = apiService

    render(
      <APIProvider service={apiService}>
        <ContributionProvider>
          <MessageActionRunner chatJid="12345@s.whatsapp.net" messageId="msg-999" />
        </ContributionProvider>
      </APIProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('count')).toHaveTextContent('1')
    })

    const translateBtn = screen.getByTestId('action-translate')
    expect(translateBtn).toHaveTextContent('Translate Message')

    translateBtn.click()

    await waitFor(() => {
      expect(executeContributionMock).toHaveBeenCalledWith({
        slot: 'message-action',
        pluginId: 'com.external.plugin',
        id: 'translate',
        context: { chatJid: '12345@s.whatsapp.net', messageId: 'msg-999' }
      })
    })
  })
})
