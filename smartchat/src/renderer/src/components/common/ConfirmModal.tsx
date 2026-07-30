interface ConfirmModalProps {
  isOpen: boolean
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
  isDanger?: boolean
  children?: React.ReactNode
}

export default function ConfirmModal({
  isOpen,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  isDanger = false,
  children
}: ConfirmModalProps) {
  if (!isOpen) return null

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-container" onClick={e => e.stopPropagation()} style={{ maxWidth: '380px' }}>
        <div style={{ padding: '20px' }}>
          <h3 style={{ margin: '0 0 10px 0', fontSize: '16px', fontWeight: '600', color: 'var(--wa-text-primary)' }}>
            {title}
          </h3>
          <p style={{ margin: '0 0 20px 0', fontSize: '13px', color: 'var(--wa-text-secondary)', lineHeight: '1.5' }}>
            {description}
          </p>
          {children}
          <div className="ai-modal-btn-group" style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: children ? '20px' : '0' }}>
            <button
              className="ai-modal-btn cancel"
              onClick={onCancel}
              style={{
                padding: '8px 16px',
                borderRadius: '6px',
                border: '1px solid var(--wa-border, #e4e6eb)',
                backgroundColor: 'transparent',
                color: 'var(--wa-text-secondary)',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: '500'
              }}
            >
              {cancelLabel}
            </button>
            <button
              className={`ai-modal-btn ${isDanger ? 'delete' : 'save'}`}
              onClick={onConfirm}
              style={{
                padding: '8px 16px',
                borderRadius: '6px',
                border: 'none',
                backgroundColor: isDanger ? '#ef4444' : 'var(--wa-primary, #008069)',
                color: '#ffffff',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: '500'
              }}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
