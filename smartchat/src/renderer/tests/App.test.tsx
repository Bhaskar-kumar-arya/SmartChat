/**
 * N-08 characterization of the App connection state machine (R-UIAPP-08 safety net).
 * States: initializing | qr | connected (catch-up) | syncing | ready, plus sessionReplaced.
 * B-UIAPP-04 (a reconnect after `ready` tears the whole UI down) is pinned `it.fails`
 * and flips with F-UA-3.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useEffect } from 'react'
import { act } from '@testing-library/react'
import { renderWithProviders, screen, fireEvent } from './testUtils'
import { createMockApiService, type MockApiService } from './mocks/mockApiService'
import { App } from '@renderer/App'

const layoutLifecycle = { mounts: 0, unmounts: 0 }

vi.mock('@renderer/components/chat', () => ({
  ChatLayout: function ChatLayoutStub() {
    useEffect(() => {
      layoutLifecycle.mounts += 1
      return () => {
        layoutLifecycle.unmounts += 1
      }
    }, [])
    return <div data-testid="chat-layout" />
  },
}))

vi.mock('@renderer/components/overlays/ModalPortal', () => ({
  ModalPortal: () => <div data-testid="modal-portal" />,
}))

vi.mock('qrcode.react', () => ({
  QRCodeSVG: ({ value }: { value: string }) => <svg data-testid="qr" data-value={value} />,
}))

describe('App connection states', () => {
  let api: MockApiService

  beforeEach(() => {
    layoutLifecycle.mounts = 0
    layoutLifecycle.unmounts = 0
    api = createMockApiService()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const renderApp = (): ReturnType<typeof renderWithProviders> => renderWithProviders(<App />, { apiService: api })

  const stepClass = (title: string): string =>
    screen.getByText(title).closest('.step-item')?.className.replace('step-item', '').trim() ?? ''

  const goSyncing = (): void => {
    api.emit.waConnected({})
  }

  const goReady = (): void => {
    goSyncing()
    api.emit.waSyncComplete()
  }

  describe('initializing', () => {
    it('starts on the initializing screen with the default status text and no layout', () => {
      renderApp()
      expect(screen.getByText('Initializing connection...')).toBeInTheDocument()
      expect(screen.queryByTestId('chat-layout')).toBeNull()
      expect(screen.queryByText('Reconnect this device →')).toBeNull()
      expect(screen.getByTestId('modal-portal')).toBeInTheDocument()
    })

    it('subscribes to every auth/sync event once and unsubscribes on unmount', () => {
      const { unmount } = renderApp()
      const events = [
        'onWaQr',
        'onWaConnected',
        'onWaLoggedOut',
        'onWaSessionReplaced',
        'onWaSyncProgress',
        'onWaSyncStatus',
        'onWaSyncComplete',
      ] as const
      for (const e of events) expect(api.emit.listenerCount(e)).toBe(1)
      unmount()
      for (const e of events) expect(api.emit.listenerCount(e)).toBe(0)
    })

    it('shows incoming status text while initializing', () => {
      renderApp()
      api.emit.waSyncStatus('Opening socket...')
      expect(screen.getByText('Opening socket...')).toBeInTheDocument()
    })
  })

  describe('qr', () => {
    it('onWaQr shows the QR code and scan instructions', () => {
      renderApp()
      api.emit.waQr('qr-payload-1')
      expect(screen.getByText('Scan QR Code')).toBeInTheDocument()
      expect(screen.getByTestId('qr')).toHaveAttribute('data-value', 'qr-payload-1')
    })

    it('a refreshed QR replaces the previous one', () => {
      renderApp()
      api.emit.waQr('one')
      api.emit.waQr('two')
      expect(screen.getByTestId('qr')).toHaveAttribute('data-value', 'two')
    })

    it('a successful scan (waConnected) leaves the QR screen for syncing', () => {
      renderApp()
      api.emit.waQr('one')
      goSyncing()
      expect(screen.queryByTestId('qr')).toBeNull()
      expect(screen.getByText('Syncing')).toBeInTheDocument()
    })
  })

  describe('connected (catch-up) and syncing', () => {
    it('waConnected with isCatchup shows the reconnecting screen, not the sync grid', () => {
      renderApp()
      api.emit.waConnected({ isCatchup: true })
      expect(screen.getByText('Reconnecting and catching up on missed messages…')).toBeInTheDocument()
      expect(screen.queryByText('Syncing')).toBeNull()
    })

    it('waConnected without isCatchup starts syncing at 0%', () => {
      renderApp()
      goSyncing()
      expect(screen.getByText('0%')).toBeInTheDocument()
      expect(screen.getByText('Syncing')).toBeInTheDocument()
    })

    it('onWaSyncProgress enters syncing from any state and shows the percentage', () => {
      renderApp()
      api.emit.waSyncProgress({ progress: 42, syncType: 0, syncFullHistory: false })
      expect(screen.getByText('42%')).toBeInTheDocument()
    })

    it('shows the latest sync status line', () => {
      renderApp()
      goSyncing()
      api.emit.waSyncStatus('Downloading history')
      expect(screen.getByText('Downloading history')).toBeInTheDocument()
    })

    it('step statuses follow syncType', () => {
      renderApp()
      goSyncing()
      // handshake done, directory ingestion active
      expect(stepClass('Connection Handshake')).toBe('completed')
      expect(stepClass('Directory Ingestion')).toBe('active')
      expect(stepClass('Message History Sync')).toBe('pending')
      expect(stepClass('Hydrating Group Metadata')).toBe('pending')

      api.emit.waSyncProgress({ progress: 10, syncType: 3, syncFullHistory: false })
      expect(stepClass('Directory Ingestion')).toBe('completed')
      expect(stepClass('Message History Sync')).toBe('active')
      expect(stepClass('Hydrating Group Metadata')).toBe('pending')

      api.emit.waSyncProgress({ progress: 50, syncType: 6, syncFullHistory: false })
      expect(stepClass('Message History Sync')).toBe('completed')
      expect(stepClass('Hydrating Group Metadata')).toBe('active')

      api.emit.waSyncProgress({ progress: 100, syncType: 6, syncFullHistory: false })
      expect(stepClass('Hydrating Group Metadata')).toBe('completed')
    })

    it('the skip button calls api.skipSync', () => {
      renderApp()
      goSyncing()
      fireEvent.click(screen.getByText('Skip remaining sync →'))
      expect(api.skipSync).toHaveBeenCalledTimes(1)
    })

    it('a new non-catch-up connection resets progress to 0', () => {
      renderApp()
      api.emit.waSyncProgress({ progress: 80, syncType: 3, syncFullHistory: false })
      expect(screen.getByText('80%')).toBeInTheDocument()
      api.emit.waConnected({})
      expect(screen.getByText('0%')).toBeInTheDocument()
    })
  })

  describe('ready', () => {
    it('onWaSyncComplete renders ChatLayout and hides the setup screen', () => {
      renderApp()
      goReady()
      expect(screen.getByTestId('chat-layout')).toBeInTheDocument()
      expect(screen.queryByText('SmartChat')).toBeNull()
      expect(screen.getByTestId('modal-portal')).toBeInTheDocument()
    })

    it('syncComplete can arrive without any prior connect event', () => {
      renderApp()
      api.emit.waSyncComplete()
      expect(screen.getByTestId('chat-layout')).toBeInTheDocument()
    })

    it('logout from ready returns to initializing and unmounts the layout', () => {
      renderApp()
      goReady()
      api.emit.waLoggedOut()
      expect(screen.queryByTestId('chat-layout')).toBeNull()
      expect(screen.getByText('Initializing connection...')).toBeInTheDocument()
      expect(layoutLifecycle.unmounts).toBe(1)
    })

    it('logout resets a custom status line and any QR', () => {
      renderApp()
      api.emit.waQr('q')
      api.emit.waSyncStatus('half way')
      api.emit.waLoggedOut()
      expect(screen.queryByTestId('qr')).toBeNull()
      expect(screen.getByText('Initializing connection...')).toBeInTheDocument()
    })

    // Current behaviour (also part of B-UIAPP-04's blast radius): any sync progress after
    // `ready` drops back to the sync screen and unmounts the layout.
    it('a late onWaSyncProgress after ready leaves the layout for the sync screen', () => {
      renderApp()
      goReady()
      api.emit.waSyncProgress({ progress: 10, syncType: 3, syncFullHistory: false })
      expect(screen.queryByTestId('chat-layout')).toBeNull()
      expect(screen.getByText('10%')).toBeInTheDocument()
    })

    // B-UIAPP-04: a transient reconnect after `ready` currently tears down the whole UI.
    it('B-UIAPP-04 (current behaviour): waConnected{isCatchup} after ready unmounts ChatLayout', () => {
      renderApp()
      goReady()
      expect(layoutLifecycle.mounts).toBe(1)
      api.emit.waConnected({ isCatchup: true })
      expect(screen.queryByTestId('chat-layout')).toBeNull()
      expect(screen.getByText('Reconnecting and catching up on missed messages…')).toBeInTheDocument()
      expect(layoutLifecycle.unmounts).toBe(1)
    })

    it.fails('B-UIAPP-04: a reconnect after ready keeps ChatLayout mounted (open chat/draft survive)', () => {
      renderApp()
      goReady()
      api.emit.waConnected({ isCatchup: true })
      expect(screen.getByTestId('chat-layout')).toBeInTheDocument()
      expect(layoutLifecycle.unmounts).toBe(0)
    })

    it('after a reconnect the layout is mounted afresh once syncComplete fires again', () => {
      renderApp()
      goReady()
      api.emit.waConnected({ isCatchup: true })
      api.emit.waSyncComplete()
      expect(screen.getByTestId('chat-layout')).toBeInTheDocument()
      expect(layoutLifecycle.mounts).toBe(2)
    })
  })

  describe('session replaced', () => {
    it('shows the replaced message and a reconnect button instead of the spinner text', () => {
      renderApp()
      api.emit.waSessionReplaced()
      expect(
        screen.getByText('This session was opened on another device. SmartChat has stopped syncing.')
      ).toBeInTheDocument()
      expect(screen.getByText('Reconnect this device →')).toBeInTheDocument()
    })

    it('replaces the ready layout', () => {
      renderApp()
      goReady()
      api.emit.waSessionReplaced()
      expect(screen.queryByTestId('chat-layout')).toBeNull()
      expect(screen.getByText('Reconnect this device →')).toBeInTheDocument()
    })

    it('the reconnect button reloads the window', () => {
      const reload = vi.fn()
      vi.stubGlobal('location', { ...window.location, reload })
      renderApp()
      api.emit.waSessionReplaced()
      fireEvent.click(screen.getByText('Reconnect this device →'))
      expect(reload).toHaveBeenCalledTimes(1)
    })

    // Current behaviour: the flag is never cleared, so a later logout still offers the button.
    it('the sessionReplaced flag survives a later logout (never cleared)', () => {
      renderApp()
      api.emit.waSessionReplaced()
      api.emit.waLoggedOut()
      expect(screen.getByText('Initializing connection...')).toBeInTheDocument()
      expect(screen.getByText('Reconnect this device →')).toBeInTheDocument()
    })

    it('a QR after replacement shows the QR screen (flag stays set but is not rendered there)', () => {
      renderApp()
      api.emit.waSessionReplaced()
      act(() => api.emit.waQr('fresh'))
      expect(screen.getByTestId('qr')).toBeInTheDocument()
      expect(screen.queryByText('Reconnect this device →')).toBeNull()
    })
  })
})
