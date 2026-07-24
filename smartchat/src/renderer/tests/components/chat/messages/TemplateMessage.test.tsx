import { screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { TemplateMessage } from '@renderer/components/chat/messages/TemplateMessage'
import { renderWithProviders } from '../../../testUtils'
import { createMockApiService } from '../../../mocks/mockApiService'
import { MessageItem } from '@renderer/types/chatTypes'

describe('TemplateMessage', () => {
  const sampleMsg: MessageItem = {
    id: 'tpl-1',
    chatJid: 'user1@s.whatsapp.net',
    participant: null,
    textContent: null,
    timestamp: '1620000000',
    fromMe: false,
    status: 'SENT',
    messageType: 'templateMessage'
  }

  it('renders body text, header, title, and buttons from hydratedFourRowTemplate', () => {
    renderWithProviders(
      <TemplateMessage
        msg={sampleMsg}
        rawMsg={{
          templateMessage: {
            hydratedFourRowTemplate: {
              hydratedContentText: 'Hello User,\nPlease verify your email',
              hydratedFooterText: 'SmartChat Support',
              hydratedButtons: [
                {
                  quickReplyButton: {
                    displayText: 'Confirm',
                    id: 'btn_confirm'
                  }
                },
                {
                  urlButton: {
                    displayText: 'Visit Website',
                    url: 'https://example.com'
                  }
                }
              ]
            }
          }
        }}
        onDownload={vi.fn()}
        isDownloading={false}
      />
    )

    expect(screen.getByText('Confirm')).toBeInTheDocument()
    expect(screen.getByText('Visit Website')).toBeInTheDocument()
    expect(screen.getByText('SmartChat Support')).toBeInTheDocument()
  })

  it('sends chat message via API when Quick Reply button is clicked', async () => {
    const mockApi = createMockApiService()
    mockApi.sendMessage = vi.fn().mockResolvedValue({})

    renderWithProviders(
      <TemplateMessage
        msg={sampleMsg}
        rawMsg={{
          templateMessage: {
            hydratedFourRowTemplate: {
              hydratedContentText: 'Choose an option below',
              hydratedButtons: [
                {
                  quickReplyButton: {
                    displayText: 'Yes, please',
                    id: 'btn_yes'
                  }
                }
              ]
            }
          }
        }}
        onDownload={vi.fn()}
        isDownloading={false}
      />,
      { apiService: mockApi }
    )

    const btn = screen.getByRole('button', { name: /yes, please/i })
    fireEvent.click(btn)

    await waitFor(() => {
      expect(mockApi.sendMessage).toHaveBeenCalledWith('user1@s.whatsapp.net', 'Yes, please')
    })
  })
})
