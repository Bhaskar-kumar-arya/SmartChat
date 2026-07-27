import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { APIProvider } from '@renderer/context/APIContext'
import { createMockApiService } from '../mocks/mockApiService'
import { ContributionProvider } from '@renderer/context/ContributionContext'
import { useContributions } from '@renderer/hooks/useContributions'
import { ContributionRegistrySnapshot } from '@renderer/types/contribution.types'

function ChatActionRunner({ chatJid }: { chatJid: string }) {
  const actions = useContributions('chat-action')
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
                slot: 'chat-action',
                pluginId: act.pluginId,
                id: act.id,
                context: { jid: chatJid }
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

describe('ChatList Contributions Integration', () => {
  it('loads chat actions from snapshot and dispatches executeContribution on trigger', async () => {
    const mockSnapshot: ContributionRegistrySnapshot = {
      'chat-action': [
        { pluginId: 'com.builtin.wa', id: 'pin', label: 'Pin Chat' },
        { pluginId: 'com.external.plugin', id: 'export-chat', label: 'Export Chat' }
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
          <ChatActionRunner chatJid="12345@s.whatsapp.net" />
        </ContributionProvider>
      </APIProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('count')).toHaveTextContent('2')
    })

    const exportBtn = screen.getByTestId('action-export-chat')
    expect(exportBtn).toHaveTextContent('Export Chat')

    exportBtn.click()

    await waitFor(() => {
      expect(executeContributionMock).toHaveBeenCalledWith({
        slot: 'chat-action',
        pluginId: 'com.external.plugin',
        id: 'export-chat',
        context: { jid: '12345@s.whatsapp.net' }
      })
    })
  })
})
