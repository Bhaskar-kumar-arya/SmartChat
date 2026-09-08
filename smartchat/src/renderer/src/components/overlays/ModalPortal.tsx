import { useEffect, useState } from 'react'
import ReactDOM from 'react-dom'
import { useAPI } from '../../context/APIContext'
import { FormModal } from './FormModal'
import { ConfirmModal, ConfirmModalOpts } from './ConfirmModal'
import { AlertModal, AlertModalOpts } from './AlertModal'
import { OverlayShell } from './OverlayShell'
import { BaseModal } from './BaseModal'
import { OverlayFormSchema } from '@smartchat/sdk'
import { WebviewOverlayRequest } from '../../../../main/kernel/ui/IOverlayHost'

export interface ModalRequest {
  type: 'form' | 'confirm' | 'alert'
  modalId: string
  payload: unknown
}

function cancelValueForType(type: ModalRequest['type']): unknown {
  if (type === 'form') return null
  if (type === 'confirm') return false
  return undefined
}

export function ModalPortal() {
  const api = useAPI()
  const [modals, setModals] = useState<ModalRequest[]>([])
  const [webviews, setWebviews] = useState<WebviewOverlayRequest[]>([])

  useEffect(() => {
    if (!api.onModalShow) return

    const unsubscribe = api.onModalShow((req: ModalRequest) => {
      // F10-12: a backend re-send of the same request must not stack a duplicate.
      setModals((prev) =>
        prev.some((m) => m.modalId === req.modalId) ? prev : [...prev, req]
      )
    })
    return unsubscribe
  }, [api])

  useEffect(() => {
    if (!api.onOverlayShow) return

    const unsubscribeShow = api.onOverlayShow((req: WebviewOverlayRequest) => {
      setWebviews((prev) => [...prev.filter((w) => w.overlayId !== req.overlayId), req])
    })

    const unsubscribeClose = api.onOverlayClose?.(({ overlayId }) => {
      setWebviews((prev) => prev.filter((w) => w.overlayId !== overlayId))
    })

    return () => {
      unsubscribeShow()
      unsubscribeClose?.()
    }
  }, [api])

  const handleResolve = (modalId: string, data: unknown) => {
    setModals((prev) => prev.filter((m) => m.modalId !== modalId))
    // F10-10: don't fire-and-forget — a rejected resolve is otherwise an
    // unhandled rejection and the plugin-side promise hangs silently.
    Promise.resolve(api.resolveModal(modalId, data)).catch((err) =>
      console.error('[ModalPortal] resolveModal failed:', err)
    )
  }

  const handleWebviewClose = (overlayId: string) => {
    setWebviews((prev) => prev.filter((w) => w.overlayId !== overlayId))
  }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // F10-11: the tier1 modal renders visually on top of any webview overlay
      // and owns Escape while it is open; BaseModal handles that case.
      if (modals.length > 0) return
      if (webviews.length > 0) {
        const top = webviews[webviews.length - 1]
        api.overlayDismiss?.(top.overlayId)
        handleWebviewClose(top.overlayId)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [modals, webviews, api])

  if (modals.length === 0 && webviews.length === 0) return null

  const activeModal = modals.length > 0 ? modals[modals.length - 1] : null

  const modalContent = (() => {
    if (!activeModal) return null
    switch (activeModal.type) {
      case 'form':
        return (
          <FormModal
            modalId={activeModal.modalId}
            schema={activeModal.payload as OverlayFormSchema}
            onSubmit={(val) => handleResolve(activeModal.modalId, val)}
          />
        )
      case 'confirm':
        return (
          <ConfirmModal
            modalId={activeModal.modalId}
            opts={activeModal.payload as ConfirmModalOpts}
            onResolve={(confirmed) => handleResolve(activeModal.modalId, confirmed)}
          />
        )
      case 'alert':
        return (
          <AlertModal
            modalId={activeModal.modalId}
            opts={activeModal.payload as AlertModalOpts}
            onResolve={() => handleResolve(activeModal.modalId, undefined)}
          />
        )
      default:
        return null
    }
  })()

  return ReactDOM.createPortal(
    <>
      {webviews.map((req) => (
        <OverlayShell key={req.overlayId} request={req} onClose={handleWebviewClose} />
      ))}
      {activeModal && (
        <BaseModal
          key={activeModal.modalId}
          onClose={() =>
            handleResolve(activeModal.modalId, cancelValueForType(activeModal.type))
          }
          overlayTestId="tier1-modal-overlay"
        >
          {modalContent}
        </BaseModal>
      )}
    </>,
    document.body
  )
}
