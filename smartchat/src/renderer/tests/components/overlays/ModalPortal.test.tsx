import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ModalPortal } from '../../../src/components/overlays/ModalPortal'
import { APIProvider } from '../../../src/context/APIContext'
import { WebviewOverlayRequest } from '../../../../main/kernel/ui/IOverlayHost'

describe('ModalPortal', () => {
  let mockApi: any
  let showOverlayCallback: (req: WebviewOverlayRequest) => void
  let closeOverlayCallback: (data: { overlayId: string }) => void

  beforeEach(() => {
    mockApi = {
      onModalShow: vi.fn().mockReturnValue(() => {}),
      resolveModal: vi.fn(),
      onOverlayShow: vi.fn((cb) => {
        showOverlayCallback = cb
        return () => {}
      }),
      onOverlayClose: vi.fn((cb) => {
        closeOverlayCallback = cb
        return () => {}
      }),
      overlayDismiss: vi.fn()
    }
  })

  function renderModalPortal() {
    return render(
      <APIProvider service={mockApi}>
        <ModalPortal />
      </APIProvider>
    )
  }

  it('renders nothing when no modals or webviews are active', () => {
    const { container } = renderModalPortal()
    expect(container.firstChild).toBeNull()
  })

  it('mounts OverlayShell when onOverlayShow fires', () => {
    renderModalPortal()

    const req: WebviewOverlayRequest = {
      overlayId: 'ov-999',
      pluginId: 'com.acme.translator',
      panel: 'overlays/translate.html',
      title: 'Translate Webview Overlay',
      width: 500,
      height: 400,
      mode: 'promise'
    }

    act(() => {
      showOverlayCallback(req)
    })

    expect(screen.getByText('Translate Webview Overlay')).toBeDefined()
    expect(screen.getByTestId('webview-overlay-shell-ov-999')).toBeDefined()
  })

  it('removes OverlayShell when onOverlayClose fires', () => {
    renderModalPortal()

    const req: WebviewOverlayRequest = {
      overlayId: 'ov-888',
      pluginId: 'com.acme.translator',
      panel: 'overlays/translate.html',
      title: 'Translate Webview Overlay',
      width: 500,
      height: 400,
      mode: 'promise'
    }

    act(() => {
      showOverlayCallback(req)
    })

    expect(screen.getByText('Translate Webview Overlay')).toBeDefined()

    act(() => {
      closeOverlayCallback({ overlayId: 'ov-888' })
    })

    expect(screen.queryByText('Translate Webview Overlay')).toBeNull()
  })

  it('dismisses top webview overlay on Escape key press', () => {
    renderModalPortal()

    const req: WebviewOverlayRequest = {
      overlayId: 'ov-777',
      pluginId: 'com.acme.translator',
      panel: 'overlays/translate.html',
      title: 'Translate Webview Overlay',
      width: 500,
      height: 400,
      mode: 'promise'
    }

    act(() => {
      showOverlayCallback(req)
    })

    expect(screen.getByText('Translate Webview Overlay')).toBeDefined()

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(mockApi.overlayDismiss).toHaveBeenCalledWith('ov-777')
    expect(screen.queryByText('Translate Webview Overlay')).toBeNull()
  })
})
