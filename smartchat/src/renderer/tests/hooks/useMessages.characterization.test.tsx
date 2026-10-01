/**
 * N-08 characterization of useMessages (R-UICHAT-02 safety net).
 * Pins CURRENT behaviour of paging, the jump window, the on-demand WhatsApp
 * history flow (-1 sentinel / onWaHistoryAppended retry / 40 s timeout) and the
 * real-time event handlers. Known bugs are pinned with `it.fails` and flip when
 * F-UC-1 lands.
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, type RenderHookResult } from '@testing-library/react'
import { useMessages } from '@renderer/components/chat/hooks/useMessages'
import { APIProvider } from '@renderer/context/APIContext'
import type { MessageItem } from '@renderer/types/chatTypes'
import { createMockApiService, type MockApiService } from '../mocks/mockApiService'
import { makeMessage } from '../factories'

const JID = 'user1@s.whatsapp.net'
const OTHER = 'other@s.whatsapp.net'
const PAGE = 50

/** In-memory "backend": `total` messages m1..mN ascending by time. */
function makeBackend(total: number, jid = JID): MessageItem[] {
  return Array.from({ length: total }, (_, i) =>
    makeMessage({ id: `m${i + 1}`, chatJid: jid, timestamp: String(1000 + i), textContent: `t${i + 1}` })
  )
}

/** Mirrors messages:get — page 1 = newest `size`, returned ascending. */
function pageFromNewest(all: MessageItem[], page: number, size: number): MessageItem[] {
  const end = all.length - (page - 1) * size
  const start = Math.max(0, end - size)
  return end <= 0 ? [] : all.slice(start, end)
}

function around(all: MessageItem[], id: string, radius = 10): MessageItem[] {
  const idx = all.findIndex((m) => m.id === id)
  return all.slice(Math.max(0, idx - radius), idx + radius + 1)
}

const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function wrapperFor(api: MockApiService): React.FC<{ children: React.ReactNode }> {
  const Wrapper = ({ children }: { children: React.ReactNode }): React.ReactElement => (
    <APIProvider service={api}>{children}</APIProvider>
  )
  return Wrapper
}

type HookProps = { j: string | null; t: string | null | undefined }
type MessagesHook = RenderHookResult<ReturnType<typeof useMessages>, HookProps>

type Fn = ReturnType<typeof vi.fn>

describe('useMessages characterization', () => {
  let all: MessageItem[]
  let api: MockApiService

  const wire = (): void => {
    api.getMessages = vi.fn(async (_jid: string, page: number, size: number) => pageFromNewest(all, page, size))
    api.getMessagesAround = vi.fn(async (_jid: string, id: string) => around(all, id))
  }

  beforeEach(() => {
    all = makeBackend(120)
    api = createMockApiService({ markRead: vi.fn().mockResolvedValue(true) })
    wire()
  })

  const mount = async (jid: string | null = JID, target?: string | null): Promise<MessagesHook> => {
    const hook = renderHook(({ j, t }) => useMessages(j, t), {
      wrapper: wrapperFor(api),
      initialProps: { j: jid, t: target },
    })
    await flush()
    return hook
  }

  const historyAppended = async (): Promise<void> => {
    await act(async () => {
      api.emit.waHistoryAppended({ messageCount: 20 })
      await Promise.resolve()
    })
    await flush()
  }

  describe('initial load', () => {
    it('loads page 1 (50 newest), marks read, and exposes loading/hasMore', async () => {
      const { result } = await mount()
      expect(api.getMessages).toHaveBeenCalledWith(JID, 1, PAGE)
      expect(api.markRead).toHaveBeenCalledWith(JID)
      expect(result.current.messages.map((m) => m.id)).toEqual(all.slice(70).map((m) => m.id))
      expect(result.current.loading).toBe(false)
      expect(result.current.hasMore).toBe(true)
      expect(result.current.syncingOlder).toBe(false)
    })

    it('clears the list when activeJid becomes null', async () => {
      const { result, rerender } = await mount()
      expect(result.current.messages.length).toBe(50)
      rerender({ j: null, t: undefined })
      expect(result.current.messages).toEqual([])
    })

    it('an initial load failure yields an empty list and stops loading', async () => {
      const err = vi.spyOn(console, 'error').mockImplementation(() => {})
      api.getMessages = vi.fn().mockRejectedValue(new Error('db down'))
      const { result } = await mount()
      expect(result.current.messages).toEqual([])
      expect(result.current.loading).toBe(false)
      err.mockRestore()
    })
  })

  describe('paging (page-number model)', () => {
    it('loadMore requests page 2, prepends it in order, and returns the row count', async () => {
      const { result } = await mount()
      let landed = 0
      await act(async () => {
        landed = await result.current.loadMore()
      })
      expect(api.getMessages).toHaveBeenLastCalledWith(JID, 2, PAGE)
      expect(landed).toBe(50)
      expect(result.current.messages.map((m) => m.id)).toEqual(all.slice(20).map((m) => m.id))
    })

    it('successive loadMore calls advance the page number', async () => {
      const { result } = await mount()
      await act(async () => {
        await result.current.loadMore()
      })
      await act(async () => {
        await result.current.loadMore()
      })
      expect(api.getMessages).toHaveBeenLastCalledWith(JID, 3, PAGE)
      expect(result.current.messages.map((m) => m.id)).toEqual(all.map((m) => m.id))
    })

    it('dedupes rows already loaded (page boundary shifted by a real-time message)', async () => {
      const { result } = await mount()
      const overlap = result.current.messages[0]
      ;(api.getMessages as Fn).mockImplementationOnce(async () => [...all.slice(60, 65), overlap])
      await act(async () => {
        await result.current.loadMore()
      })
      const ids = result.current.messages.map((m) => m.id)
      expect(new Set(ids).size).toBe(ids.length)
      expect(ids.length).toBe(55)
    })

    // B-UICHAT-07: returns olderMsgs.length instead of the number of fresh rows.
    it.fails('B-UICHAT-07: loadMore returns the count of FRESH rows, not the raw page length', async () => {
      const { result } = await mount()
      const overlap = result.current.messages[0]
      ;(api.getMessages as Fn).mockImplementationOnce(async () => [overlap])
      let landed = -99
      await act(async () => {
        landed = await result.current.loadMore()
      })
      expect(landed).toBe(0)
    })

    it('does nothing without an active chat', async () => {
      const { result } = await mount(null)
      let r = -99
      await act(async () => {
        r = await result.current.loadMore()
      })
      expect(r).toBe(0)
      expect(api.getMessages).not.toHaveBeenCalled()
    })

    it('a loadMore failure is swallowed: returns 0 and keeps the list', async () => {
      const err = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { result } = await mount()
      ;(api.getMessages as Fn).mockRejectedValueOnce(new Error('boom'))
      let r = -99
      await act(async () => {
        r = await result.current.loadMore()
      })
      expect(r).toBe(0)
      expect(result.current.messages.length).toBe(50)
      err.mockRestore()
    })
  })

  describe('on-demand WhatsApp history (-1 sentinel)', () => {
    // 50 messages only: page 2 is empty so the local DB is exhausted.
    beforeEach(() => {
      all = makeBackend(50)
    })

    it("returns -1, sets syncingOlder and asks WhatsApp when the DB is exhausted and status is 'requested'", async () => {
      api.fetchMessageHistory = vi.fn().mockResolvedValue({ status: 'requested' })
      const { result } = await mount()
      let r = 0
      await act(async () => {
        r = await result.current.loadMore()
      })
      expect(r).toBe(-1)
      expect(api.fetchMessageHistory).toHaveBeenCalledWith(JID)
      expect(result.current.syncingOlder).toBe(true)
      expect(result.current.hasMore).toBe(true)
    })

    it('a second loadMore while a request is pending is a no-op (guard)', async () => {
      api.fetchMessageHistory = vi.fn().mockResolvedValue({ status: 'requested' })
      const { result } = await mount()
      await act(async () => {
        await result.current.loadMore()
      })
      const calls = (api.getMessages as Fn).mock.calls.length
      let r = -99
      await act(async () => {
        r = await result.current.loadMore()
      })
      expect(r).toBe(0)
      expect(api.getMessages).toHaveBeenCalledTimes(calls)
      expect(api.fetchMessageHistory).toHaveBeenCalledTimes(1)
    })

    it('onWaHistoryAppended retries the pending page, prepends it and clears syncingOlder', async () => {
      api.fetchMessageHistory = vi.fn().mockResolvedValue({ status: 'requested' })
      const { result } = await mount()
      await act(async () => {
        await result.current.loadMore()
      })
      // WhatsApp delivers 20 older rows into the DB.
      const older = Array.from({ length: 20 }, (_, i) =>
        makeMessage({ id: `old${i}`, chatJid: JID, timestamp: String(i) })
      )
      all = [...older, ...all]
      await historyAppended()
      expect(api.getMessages).toHaveBeenLastCalledWith(JID, 2, PAGE)
      expect(result.current.messages[0].id).toBe('old0')
      expect(result.current.messages.length).toBe(70)
      expect(result.current.syncingOlder).toBe(false)
      expect(result.current.hasMore).toBe(true)
    })

    it('onWaHistoryAppended with nothing new marks hasMore=false (start of conversation)', async () => {
      api.fetchMessageHistory = vi.fn().mockResolvedValue({ status: 'requested' })
      const { result } = await mount()
      await act(async () => {
        await result.current.loadMore()
      })
      await historyAppended()
      expect(result.current.hasMore).toBe(false)
      expect(result.current.syncingOlder).toBe(false)
      const calls = (api.fetchMessageHistory as Fn).mock.calls.length
      let r = -99
      await act(async () => {
        r = await result.current.loadMore()
      })
      expect(r).toBe(0)
      expect(api.fetchMessageHistory).toHaveBeenCalledTimes(calls)
    })

    it('onWaHistoryAppended with no pending request does nothing', async () => {
      const { result } = await mount()
      const calls = (api.getMessages as Fn).mock.calls.length
      await historyAppended()
      expect(api.getMessages).toHaveBeenCalledTimes(calls)
      expect(result.current.hasMore).toBe(true)
    })

    it.each(['no-anchor', 'error'] as const)(
      "status '%s' gives up: returns 0 and sets hasMore=false without syncingOlder",
      async (status) => {
        api.fetchMessageHistory = vi.fn().mockResolvedValue({ status })
        const { result } = await mount()
        let r = -99
        await act(async () => {
          r = await result.current.loadMore()
        })
        expect(r).toBe(0)
        expect(result.current.hasMore).toBe(false)
        expect(result.current.syncingOlder).toBe(false)
      }
    )

    it('gives up after 40 s: clears syncingOlder, keeps hasMore, and allows a later retry', async () => {
      vi.useFakeTimers()
      api.fetchMessageHistory = vi.fn().mockResolvedValue({ status: 'requested' })
      const { result } = renderHook(() => useMessages(JID), { wrapper: wrapperFor(api) })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      await act(async () => {
        await result.current.loadMore()
      })
      expect(result.current.syncingOlder).toBe(true)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(39999)
      })
      expect(result.current.syncingOlder).toBe(true)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1)
      })
      expect(result.current.syncingOlder).toBe(false)
      expect(result.current.hasMore).toBe(true)

      let r = 0
      await act(async () => {
        r = await result.current.loadMore()
      })
      expect(r).toBe(-1)
      expect(api.fetchMessageHistory).toHaveBeenCalledTimes(2)
    })

    it('switching chats drops the pending on-demand request', async () => {
      api.fetchMessageHistory = vi.fn().mockResolvedValue({ status: 'requested' })
      const { result, rerender } = await mount()
      await act(async () => {
        await result.current.loadMore()
      })
      expect(result.current.syncingOlder).toBe(true)
      rerender({ j: OTHER, t: undefined })
      await flush()
      expect(result.current.syncingOlder).toBe(false)
      const calls = (api.getMessages as Fn).mock.calls.length
      await historyAppended()
      expect(api.getMessages).toHaveBeenCalledTimes(calls)
    })
  })

  describe('jump window', () => {
    it('initialTargetId loads the window around the target instead of page 1', async () => {
      const { result } = await mount(JID, 'm20')
      expect(api.getMessagesAround).toHaveBeenCalledWith(JID, 'm20')
      expect(api.getMessages).not.toHaveBeenCalled()
      expect(result.current.messages.map((m) => m.id)).toEqual(around(all, 'm20').map((m) => m.id))
      expect(result.current.isJumping).toBe(false)
    })

    it('jumpToMessage replaces the list with the window and resets paging flags', async () => {
      const { result } = await mount()
      await act(async () => {
        await result.current.jumpToMessage('m5')
      })
      expect(api.getMessagesAround).toHaveBeenCalledWith(JID, 'm5')
      expect(result.current.messages.map((m) => m.id)).toEqual(around(all, 'm5').map((m) => m.id))
      expect(result.current.hasMore).toBe(true)
    })

    it('jumpToMessage short-circuits when the target is already loaded', async () => {
      const { result } = await mount()
      await act(async () => {
        await result.current.jumpToMessage('m100')
      })
      expect(api.getMessagesAround).not.toHaveBeenCalled()
      expect(result.current.messages.length).toBe(50)
    })

    it('a failing jump falls back to the initial page-1 load', async () => {
      const err = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { result } = await mount()
      ;(api.getMessagesAround as Fn).mockRejectedValueOnce(new Error('nope'))
      await act(async () => {
        await result.current.jumpToMessage('m5')
      })
      expect(result.current.messages.map((m) => m.id)).toEqual(all.slice(70).map((m) => m.id))
      expect(result.current.isJumping).toBe(false)
      err.mockRestore()
    })

    it('a jump result for a previous chat is discarded', async () => {
      let resolveJump: (v: MessageItem[]) => void = () => {}
      api.getMessagesAround = vi.fn().mockImplementation(() => new Promise((r) => { resolveJump = r }))
      const { result, rerender } = await mount(JID, 'm20')
      rerender({ j: OTHER, t: undefined })
      await flush()
      const before = result.current.messages
      await act(async () => {
        resolveJump(around(all, 'm20'))
        await Promise.resolve()
      })
      expect(result.current.messages).toEqual(before)
    })

    // B-UICHAT-01: paging is an offset from the NEWEST message, so after a jump the
    // "older" page is the newest page and lands above the old window, leaving a gap.
    it.fails('B-UICHAT-01: loadMore after a jump prepends the messages just older than the window (no gap)', async () => {
      all = makeBackend(300) // large enough that page 2-from-newest does not overlap the window
      const { result } = await mount(JID, 'm60')
      expect(result.current.messages[0].id).toBe('m50')
      await act(async () => {
        await result.current.loadMore()
      })
      const ids = result.current.messages.map((m) => Number(m.id.slice(1)))
      const contiguous = ids.every((n, i) => i === 0 || n === ids[i - 1] + 1)
      expect(contiguous).toBe(true)
    })

    it('B-UICHAT-01 (current behaviour): loadMore after a jump uses page 2-from-newest', async () => {
      all = makeBackend(300)
      const { result } = await mount(JID, 'm60')
      await act(async () => {
        await result.current.loadMore()
      })
      expect(api.getMessages).toHaveBeenCalledWith(JID, 2, PAGE)
    })
  })

  describe('real-time events', () => {
    it('appends new messages for the active chat, ignores other chats and duplicates', async () => {
      const { result } = await mount()
      const fresh = makeMessage({ id: 'new1', chatJid: JID })
      api.emit.newMessage(fresh)
      api.emit.newMessage(fresh)
      api.emit.newMessage(makeMessage({ id: 'other', chatJid: 'x@s.whatsapp.net' }))
      const ids = result.current.messages.map((m) => m.id)
      expect(ids.filter((i) => i === 'new1')).toHaveLength(1)
      expect(ids).not.toContain('other')
      expect(ids[ids.length - 1]).toBe('new1')
    })

    it('matches the chat JID after normalisation (device suffix)', async () => {
      const { result } = await mount()
      api.emit.newMessage(makeMessage({ id: 'dev', chatJid: 'user1:3@s.whatsapp.net' }))
      expect(result.current.messages.some((m) => m.id === 'dev')).toBe(true)
    })

    it('replaces an edited message and flags a deleted one', async () => {
      const { result } = await mount()
      const target = result.current.messages[3]
      api.emit.messageEdited({ ...target, textContent: 'edited!', isEdited: true })
      expect(result.current.messages[3].textContent).toBe('edited!')
      api.emit.messageDeleted({ id: target.id, chatJid: JID, fromMe: false })
      expect(result.current.messages[3].isDeleted).toBe(true)
    })

    it('updates delivery status', async () => {
      const { result } = await mount()
      const target = result.current.messages[0]
      api.emit.messageStatusUpdated({ id: target.id, chatJid: JID, status: 'DELIVERED' })
      expect(result.current.messages[0].status).toBe('DELIVERED')
    })

    const reactionMsg = (targetId: string, text: string, participant: string): MessageItem =>
      makeMessage({
        chatJid: JID,
        participant,
        participantName: 'Pat',
        messageType: 'reactionMessage',
        content: JSON.stringify({ reactionMessage: { key: { id: targetId }, text } }),
      })

    it('merges a reaction into its target (not into the list), replaces the same sender, and removes on empty text', async () => {
      const { result } = await mount()
      const target = result.current.messages[0].id
      const before = result.current.messages.length
      api.emit.newMessage(reactionMsg(target, '👍', 'pat@s.whatsapp.net'))
      expect(result.current.messages.length).toBe(before)
      expect(result.current.messages[0].reactions).toEqual([
        expect.objectContaining({ senderId: 'pat@s.whatsapp.net', text: '👍', senderName: 'Pat' }),
      ])
      api.emit.newMessage(reactionMsg(target, '❤️', 'pat@s.whatsapp.net'))
      expect(result.current.messages[0].reactions).toHaveLength(1)
      expect(result.current.messages[0].reactions?.[0].text).toBe('❤️')
      api.emit.newMessage(reactionMsg(target, '', 'pat@s.whatsapp.net'))
      expect(result.current.messages[0].reactions).toEqual([])
    })

    it('ignores a reaction with unparseable content', async () => {
      const err = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { result } = await mount()
      const before = result.current.messages.length
      api.emit.newMessage(makeMessage({ chatJid: JID, messageType: 'reactionMessage', content: '{bad json' }))
      expect(result.current.messages.length).toBe(before)
      err.mockRestore()
    })

    it('unsubscribes from all events on unmount', async () => {
      const { unmount } = await mount()
      expect(api.emit.listenerCount('onNewMessage')).toBe(1)
      unmount()
      expect(api.emit.listenerCount('onNewMessage')).toBe(0)
      expect(api.emit.listenerCount('onMessageEdited')).toBe(0)
      expect(api.emit.listenerCount('onMessageDeleted')).toBe(0)
      expect(api.emit.listenerCount('onMessageStatusUpdated')).toBe(0)
      expect(api.emit.listenerCount('onWaHistoryAppended')).toBe(0)
    })
  })

  describe('actions', () => {
    it('sendMessage ignores blank text and trims otherwise; the IPC reply replaces a real-time echo with the same id', async () => {
      const { result } = await mount()
      const calls = (api.sendMessage as Fn).mock.calls.length
      await act(async () => {
        await result.current.sendMessage('   ')
      })
      expect(api.sendMessage).toHaveBeenCalledTimes(calls)

      const sent = makeMessage({ id: 'sent1', chatJid: JID, fromMe: true, textContent: 'hi', status: 'SENT' })
      api.sendMessage = vi.fn().mockImplementation(async () => {
        api.emit.newMessage({ ...sent, status: 'PENDING' })
        return sent
      })
      await act(async () => {
        await result.current.sendMessage('  hi  ', 'q1', ['a@s.whatsapp.net'])
      })
      expect(api.sendMessage).toHaveBeenCalledWith(JID, 'hi', 'q1', ['a@s.whatsapp.net'])
      const matches = result.current.messages.filter((m) => m.id === 'sent1')
      expect(matches).toHaveLength(1)
      expect(matches[0].status).toBe('SENT')
    })

    it('sendMessage rethrows API failures and leaves the list untouched', async () => {
      const err = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { result } = await mount()
      api.sendMessage = vi.fn().mockRejectedValue(new Error('offline'))
      await act(async () => {
        await expect(result.current.sendMessage('x')).rejects.toThrow('offline')
      })
      expect(result.current.messages.length).toBe(50)
      err.mockRestore()
    })

    it('sendMediaMessage appends the returned message', async () => {
      const { result } = await mount()
      const media = makeMessage({ id: 'media1', chatJid: JID, fromMe: true, messageType: 'imageMessage' })
      api.sendMediaMessage = vi.fn().mockResolvedValue(media)
      await act(async () => {
        await result.current.sendMediaMessage('/tmp/a.png', ' cap ')
      })
      expect(api.sendMediaMessage).toHaveBeenCalledWith(JID, '/tmp/a.png', 'cap', undefined, undefined)
      expect(result.current.messages[result.current.messages.length - 1].id).toBe('media1')
    })

    it('handleDownloadMedia swaps in the updated message; failure is rethrown', async () => {
      const err = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { result } = await mount()
      const target = result.current.messages[2]
      api.downloadMedia = vi.fn().mockResolvedValue({ ...target, localURI: 'file:///x.jpg' })
      await act(async () => {
        await result.current.handleDownloadMedia(target.id)
      })
      expect(result.current.messages[2].localURI).toBe('file:///x.jpg')
      api.downloadMedia = vi.fn().mockRejectedValue(new Error('expired'))
      await act(async () => {
        await expect(result.current.handleDownloadMedia(target.id)).rejects.toThrow('expired')
      })
      err.mockRestore()
    })

    // B-UICHAT-02: a send that resolves after a chat switch is appended to the NEW chat's list.
    it.fails('B-UICHAT-02: a send resolving after a chat switch is not appended to the new chat', async () => {
      let resolveSend: (m: MessageItem) => void = () => {}
      api.sendMessage = vi.fn().mockImplementation(() => new Promise<MessageItem>((r) => { resolveSend = r }))
      const { result, rerender } = await mount()
      let sendPromise: Promise<unknown> | undefined
      act(() => {
        sendPromise = result.current.sendMessage('for chat A')
      })
      rerender({ j: OTHER, t: undefined })
      await flush()
      await act(async () => {
        resolveSend(makeMessage({ id: 'late', chatJid: JID, fromMe: true }))
        await sendPromise
      })
      expect(result.current.messages.some((m) => m.id === 'late')).toBe(false)
    })
  })
})
