import { X } from 'lucide-react'

export interface AlertModalOpts {
  title: string
  body?: string
  label?: string
}

export interface AlertModalProps {
  modalId: string
  opts: AlertModalOpts
  onResolve: () => void
}

export function AlertModal({ opts, onResolve }: AlertModalProps) {
  const handleClose = () => {
    onResolve()
  }

  return (
    <div className="tier1-modal" data-testid="alert-modal">
      <div className="tier1-modal-header">
        <h3 className="tier1-modal-title">{opts.title}</h3>
        <button
          type="button"
          className="close-btn"
          onClick={handleClose}
          aria-label="Close"
          data-testid="alert-modal-close"
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
          className="tier1-btn tier1-btn-primary"
          onClick={handleClose}
          data-testid="alert-modal-ok"
        >
          {opts.label || 'OK'}
        </button>
      </div>
    </div>
  )
}
