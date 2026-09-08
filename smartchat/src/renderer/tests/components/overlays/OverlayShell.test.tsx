import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OverlayShell } from '../../../src/components/overlays/OverlayShell'
import { APIProvider } from '../../../src/context/APIContext'
import { WebviewOverlayRequest } from '../../../../main/kernel/ui/IOverlayHost'

describe('OverlayShell', () => {
  let mockApi: any
  let mockOnClose: any
  let request: WebviewOverlayRequest

  beforeEach(() => {
    mockApi = {
      overlaySubmit: vi.fn(),
      overlayEvent: vi.fn(),
      overlayDismiss: vi.fn(),
      onOverlaySend: vi.fn().mockReturnValue(() => {})
    }
    mockOnClose = vi.fn()
    request = {
      overlayId: 'ov-123',
      pluginId: 'com.acme.translator',
      panel: 'overlays/translate.html',
      title: 'Translate Message',
      width: 500,
      height: 400,
      mode: 'promise',
      context: { text: 'Hello' }
    }
  })

  function renderWithAPI(ui: React.ReactElement) {
    return render(<APIProvider service={mockApi}>{ui}</APIProvider>)
  }

  it('renders title and webview shell with correct testids', () => {
    renderWithAPI(<OverlayShell request={request} onClose={mockOnClose} />)

    expect(screen.getByText('Translate Message')).toBeDefined()
    expect(screen.getByTestId('webview-overlay-shell-ov-123')).toBeDefined()
    expect(screen.getByTestId('webview-element-ov-123')).toBeDefined()
  })

  it('calls overlayDismiss and onClose when close button is clicked', () => {
    renderWithAPI(<OverlayShell request={request} onClose={mockOnClose} />)

    const closeBtn = screen.getByTestId('webview-overlay-close-ov-123')
    fireEvent.click(closeBtn)

    expect(mockApi.overlayDismiss).toHaveBeenCalledWith('ov-123')
    expect(mockOnClose).toHaveBeenCalledWith('ov-123')
  })

  it('relays an inbound payload to the guest only on smartchat:receive (F10-02)', () => {
    let sendCallback: ((p: any) => void) | null = null
    mockApi.onOverlaySend = vi.fn((cb) => {
      sendCallback = cb
      return () => {}
    })

    renderWithAPI(<OverlayShell request={request} onClose={mockOnClose} />)

    const el = screen.getByTestId('webview-element-ov-123') as any
    const send = vi.fn()
    el.send = send

    sendCallback!({ overlayId: 'ov-123', event: 'ping', data: { a: 1 } })

    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith('smartchat:receive', { event: 'ping', data: { a: 1 } })
    expect(send).not.toHaveBeenCalledWith('smartchat:send', expect.anything())
  })

  it('calls overlayDismiss and onClose when backdrop is clicked', () => {
    renderWithAPI(<OverlayShell request={request} onClose={mockOnClose} />)

    const backdrop = screen.getByTestId('webview-overlay-backdrop-ov-123')
    fireEvent.click(backdrop)

    expect(mockApi.overlayDismiss).toHaveBeenCalledWith('ov-123')
    expect(mockOnClose).toHaveBeenCalledWith('ov-123')
  })
})
