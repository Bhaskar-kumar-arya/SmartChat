import { describe, it, expect, vi, beforeEach } from 'vitest'

// Import the extension directly
const botFn = require('./fixtures/unread-summarizer-bot/index.js')

describe('Unread Summarizer Bot', () => {
  let mockCtx: any
  let activateFn: () => Promise<void>
  let eventHandlers: Record<string, (payload: any) => Promise<void>>

  beforeEach(() => {
    eventHandlers = {}
    mockCtx = {
      extensionId: 'com.smartchat.unread-summarizer-bot',
      manifest: {
        id: 'com.smartchat.unread-summarizer-bot',
        version: '1.0.0',
        permissions: ['tools:read', 'llm:chat', 'ui:dedicated_chat', 'events:extension:chat-message']
      },
      log: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      },
      onActivate: vi.fn((fn) => {
        activateFn = fn
      }),
      onDeactivate: vi.fn(),
      dedicatedChat: {
        send: vi.fn().mockResolvedValue(undefined)
      },
      events: {
        on: vi.fn((event, handler) => {
          eventHandlers[event] = handler
          return vi.fn() // unsub function
        })
      },
      tools: {
        call: vi.fn()
      },
      llm: {
        chat: vi.fn()
      },
      ui: {
        toast: vi.fn()
      }
    }
  })

  it('should register activate and deactivate hooks, and register event listener', async () => {
    await botFn(mockCtx)

    expect(mockCtx.onActivate).toHaveBeenCalled()
    expect(mockCtx.onDeactivate).toHaveBeenCalled()
    expect(mockCtx.events.on).toHaveBeenCalledWith('extension:chat-message', expect.any(Function))
  })

  it('should send greeting card on activation', async () => {
    await botFn(mockCtx)
    await activateFn()

    expect(mockCtx.dedicatedChat.send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'card',
      title: '📝 Unread Messages Summarizer',
      buttons: expect.arrayContaining([
        expect.objectContaining({ id: 'summarize' })
      ])
    }))
  })

  it('should summarize unread messages correctly when triggered', async () => {
    await botFn(mockCtx)
    await activateFn()

    // Mock queryDatabase to return some unread chats
    mockCtx.tools.call.mockImplementation(async (toolName: string, _args: any) => {
      if (toolName === 'queryDatabase') {
        return {
          text: JSON.stringify({
            rows: [
              { jid: '12345@s.whatsapp.net', chatName: 'Alice', unreadCount: 2 }
            ]
          })
        }
      }
      if (toolName === 'readMessages') {
        return {
          text: '=== Chat: Alice (DM) (12345@s.whatsapp.net) ===\n[10:00:00] Alice:\n  - [10:00:00] Hey, are we on?\n  - [10:01:00] Lunch today?\n'
        }
      }
      return { text: '{}' }
    })

    mockCtx.llm.chat.mockResolvedValue('Alice wants to know if lunch is still on.')

    // Simulate sending /summarize
    const handler = eventHandlers['extension:chat-message']
    expect(handler).toBeDefined()

    await handler({ text: '/summarize' })

    // Check we sent updates
    expect(mockCtx.dedicatedChat.send).toHaveBeenCalledWith(expect.objectContaining({
      text: '⏳ Fetching unread messages and preparing summary...'
    }))

    expect(mockCtx.llm.chat).toHaveBeenCalledWith(expect.stringContaining('=== Chat: Alice (DM) (12345@s.whatsapp.net) ==='))

    expect(mockCtx.dedicatedChat.send).toHaveBeenCalledWith({
      type: 'card',
      title: '📝 Unread Summary (1 Chats)',
      body: 'Alice wants to know if lunch is still on.',
      buttons: [
        { id: 'mark_all_read', label: '✓ Mark All Read' },
        { id: 'mark_read:12345@s.whatsapp.net', label: '✓ Read: Alice' }
      ]
    })
  })

  it('should respond with a friendly message when there are no unread messages', async () => {
    await botFn(mockCtx)
    await activateFn()

    mockCtx.tools.call.mockResolvedValue({
      text: JSON.stringify({ rows: [] })
    })

    const handler = eventHandlers['extension:chat-message']
    await handler({ text: 'any random message' }) // default behavior triggers summarize

    expect(mockCtx.dedicatedChat.send).toHaveBeenCalledWith({
      type: 'text',
      text: '🎉 You have no unread messages!'
    })
  })

  it('should handle mark read button click', async () => {
    await botFn(mockCtx)
    await activateFn()

    mockCtx.tools.call.mockImplementation(async (toolName: string, _args: any) => {
      if (toolName === 'chatAction') {
        return { text: JSON.stringify({ success: true }) }
      }
      if (toolName === 'queryDatabase') {
        return { text: JSON.stringify({ rows: [{ chatName: 'Alice' }] }) }
      }
      return { text: '{}' }
    })

    const handler = eventHandlers['extension:chat-message']
    await handler({ text: '__button:mark_read:12345@s.whatsapp.net' })

    expect(mockCtx.tools.call).toHaveBeenCalledWith('chatAction', {
      action: 'mark_read',
      jid: '12345@s.whatsapp.net'
    })
    expect(mockCtx.ui.toast).toHaveBeenCalledWith('Chat marked as read!', 'success')
    expect(mockCtx.dedicatedChat.send).toHaveBeenCalledWith({
      type: 'text',
      text: '✓ Marked **Alice** as read.'
    })
  })

  it('should handle mark all read button click', async () => {
    await botFn(mockCtx)
    await activateFn()

    mockCtx.tools.call.mockImplementation(async (toolName: string, _args: any) => {
      if (toolName === 'queryDatabase') {
        return {
          text: JSON.stringify({
            rows: [
              { jid: '1@s.whatsapp.net' },
              { jid: '2@s.whatsapp.net' }
            ]
          })
        }
      }
      if (toolName === 'chatAction') {
        return { text: JSON.stringify({ success: true }) }
      }
      return { text: '{}' }
    })

    const handler = eventHandlers['extension:chat-message']
    await handler({ text: '__button:mark_all_read' })

    expect(mockCtx.tools.call).toHaveBeenCalledWith('chatAction', {
      action: 'mark_read',
      jid: '1@s.whatsapp.net'
    })
    expect(mockCtx.tools.call).toHaveBeenCalledWith('chatAction', {
      action: 'mark_read',
      jid: '2@s.whatsapp.net'
    })
    expect(mockCtx.ui.toast).toHaveBeenCalledWith('Marked 2 chats as read!', 'success')
  })
})
