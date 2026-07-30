import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom'
import { useAPI } from '../../context/APIContext'
import { FormModal } from './FormModal'
import { ConfirmModal, ConfirmModalOpts } from './ConfirmModal'
import { AlertModal, AlertModalOpts } from './AlertModal'
import { OverlayFormSchema } from '@smartchat/sdk'

export interface ModalRequest {
  type: 'form' | 'confirm' | 'alert'
  modalId: string
  payload: unknown
}

export function ModalPortal() {
  const api = useAPI()
  const [modals, setModals] = useState<ModalRequest[]>([])

  useEffect(() => {
    if (!api.onModalShow) return

    const unsubscribe = api.onModalShow((req: ModalRequest) => {
      setModals((prev) => [...prev, req])
    })
    return unsubscribe
  }, [api])

  const handleResolve = (modalId: string, data: unknown) => {
    setModals((prev) => prev.filter((m) => m.modalId !== modalId))
    api.resolveModal(modalId, data)
  }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && modals.length > 0) {
        const top = modals[modals.length - 1]
        if (top.type === 'form') {
          handleResolve(top.modalId, null)
        } else if (top.type === 'confirm') {
          handleResolve(top.modalId, false)
        } else if (top.type === 'alert') {
          handleResolve(top.modalId, undefined)
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [modals])

  if (modals.length === 0) return null

  const active = modals[modals.length - 1]

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      if (active.type === 'form') {
        handleResolve(active.modalId, null)
      } else if (active.type === 'confirm') {
        handleResolve(active.modalId, false)
      } else if (active.type === 'alert') {
        handleResolve(active.modalId, undefined)
      }
    }
  }

  const modalContent = (() => {
    switch (active.type) {
      case 'form':
        return (
          <FormModal
            modalId={active.modalId}
            schema={active.payload as OverlayFormSchema}
            onSubmit={(val) => handleResolve(active.modalId, val)}
          />
        )
      case 'confirm':
        return (
          <ConfirmModal
            modalId={active.modalId}
            opts={active.payload as ConfirmModalOpts}
            onResolve={(confirmed) => handleResolve(active.modalId, confirmed)}
          />
        )
      case 'alert':
        return (
          <AlertModal
            modalId={active.modalId}
            opts={active.payload as AlertModalOpts}
            onResolve={() => handleResolve(active.modalId, undefined)}
          />
        )
      default:
        return null
    }
  })()

  return ReactDOM.createPortal(
    <div
      className="modal-overlay"
      onClick={handleOverlayClick}
      data-testid="tier1-modal-overlay"
    >
      {modalContent}
    </div>,
    document.body
  )
}
