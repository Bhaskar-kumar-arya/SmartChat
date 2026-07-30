import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom'
import { useAPI } from '../../context/APIContext'
import { FormModal } from './FormModal'
import { ConfirmModal, ConfirmModalOpts } from './ConfirmModal'
import { AlertModal, AlertModalOpts } from './AlertModal'
import { OverlayShell } from './OverlayShell'
import { OverlayFormSchema } from '@smartchat/sdk'
import { WebviewOverlayRequest } from '../../../../main/kernel/ui/IOverlayHost'

export interface ModalRequest {
  type: 'form' | 'confirm' | 'alert'
  modalId: string
  payload: unknown
}

export function ModalPortal() {
  const api = useAPI()
  const [modals, setModals] = useState<ModalRequest[]>([])
  const [webviews, setWebviews] = useState<WebviewOverlayRequest[]>([])

  useEffect(() => {
    if (!api.onModalShow) return

    const unsubscribe = api.onModalShow((req: ModalRequest) => {
      setModals((prev) => [...prev, req])
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
    api.resolveModal(modalId, data)
  }

  const handleWebviewClose = (overlayId: string) => {
    setWebviews((prev) => prev.filter((w) => w.overlayId !== overlayId))
  }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (modals.length > 0) {
          const top = modals[modals.length - 1]
          if (top.type === 'form') {
            handleResolve(top.modalId, null)
          } else if (top.type === 'confirm') {
            handleResolve(top.modalId, false)
          } else if (top.type === 'alert') {
            handleResolve(top.modalId, undefined)
          }
        } else if (webviews.length > 0) {
          const top = webviews[webviews.length - 1]
          api.overlayDismiss?.(top.overlayId)
          handleWebviewClose(top.overlayId)
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [modals, webviews, api])

  if (modals.length === 0 && webviews.length === 0) return null

  const activeModal = modals.length > 0 ? modals[modals.length - 1] : null

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && activeModal) {
      if (activeModal.type === 'form') {
        handleResolve(activeModal.modalId, null)
      } else if (activeModal.type === 'confirm') {
        handleResolve(activeModal.modalId, false)
      } else if (activeModal.type === 'alert') {
        handleResolve(activeModal.modalId, undefined)
      }
    }
  }

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
      {activeModal && (
        <div
          className="modal-overlay"
          onClick={handleOverlayClick}
          data-testid="tier1-modal-overlay"
        >
          {modalContent}
        </div>
      )}
      {webviews.map((req) => (
        <OverlayShell key={req.overlayId} request={req} onClose={handleWebviewClose} />
      ))}
    </>,
    document.body
  )
}
