import { X } from 'lucide-react'

export interface ConfirmModalOpts {
  title: string
  body?: string
  confirmLabel?: string
  cancelLabel?: string
}

export interface ConfirmModalProps {
  modalId: string
  opts: ConfirmModalOpts
  onResolve: (confirmed: boolean) => void
}

export function ConfirmModal({ opts, onResolve }: ConfirmModalProps) {
  const handleConfirm = () => {
    onResolve(true)
  }

  const handleCancel = () => {
    onResolve(false)
  }

  return (
    <div className="tier1-modal" data-testid="confirm-modal">
      <div className="tier1-modal-header">
        <h3 className="tier1-modal-title">{opts.title}</h3>
        <button
          type="button"
          className="close-btn"
          onClick={handleCancel}
          aria-label="Close"
          data-testid="confirm-modal-close"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="tier1-modal-body">
        {opts.body && <p className="tier1-modal-text">{opts.body}</p>}
      </div>

      <div className="tier1-modal-footer">
        <button
          type="button"
          className="tier1-btn tier1-btn-secondary"
          onClick={handleCancel}
          data-testid="confirm-modal-cancel"
        >
          {opts.cancelLabel || 'Cancel'}
        </button>
        <button
          type="button"
          className="tier1-btn tier1-btn-primary"
          onClick={handleConfirm}
          data-testid="confirm-modal-confirm"
        >
          {opts.confirmLabel || 'Confirm'}
        </button>
      </div>
    </div>
  )
}
