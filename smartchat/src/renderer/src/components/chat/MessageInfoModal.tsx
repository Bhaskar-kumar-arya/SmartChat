import { MessageReceiptInfo } from '../../types'
import { formatReceiptTime, formatReceiptDate } from '../../utils/formatters'

interface MessageInfoModalProps {
  receipts: MessageReceiptInfo[]
  onClose: () => void
}

export default function MessageInfoModal({ receipts, onClose }: MessageInfoModalProps) {
  return (
    <div className="info-modal-backdrop" onClick={onClose}>
      <div className="info-modal-container" onClick={(e) => e.stopPropagation()}>
        <div className="info-modal-header">
          <h3>Message Info</h3>
          <button className="info-modal-close" onClick={onClose}>
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="info-modal-content">
          {receipts.length === 0 ? (
            <p className="no-receipts-label">No delivery information available yet.</p>
          ) : (
            <div className="receipts-list">
              {receipts.map((receipt) => (
                <div className="receipt-item" key={receipt.userJid}>
                  <div className="receipt-item-details">
                    <span className="receipt-item-name">{receipt.name}</span>
                    <span className="receipt-item-jid">{receipt.userJid.split('@')[0]}</span>
                  </div>
                  <div className="receipt-item-status">
                    {receipt.status === 'READ' ? (
                      <div className="status-badge read">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 11" width="16" height="11" fill="#53bdeb" className="status-read">
                          <path d="M11.053 1.053a.75.75 0 0 0-1.06 0L4.437 6.61 2.227 4.4a.75.75 0 1 0-1.06 1.06l2.742 2.742a.75.75 0 0 0 1.06 0l6.084-6.085a.75.75 0 0 0 0-1.064zm4.242 0a.75.75 0 0 0-1.06 0L8.15 7.138l-1.47-1.47a.75.75 0 0 0-1.06 1.06l2 2a.75.75 0 0 0 1.06 0l6.615-6.615a.75.75 0 0 0 0-1.06z" />
                        </svg>
                        <span>Read • {formatReceiptTime(receipt.timestamp)} <span className="receipt-date">{formatReceiptDate(receipt.timestamp)}</span></span>
                      </div>
                    ) : (
                      <div className="status-badge delivered">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 11" width="16" height="11" fill="currentColor" className="status-delivered" style={{ opacity: 0.6 }}>
                          <path d="M11.053 1.053a.75.75 0 0 0-1.06 0L4.437 6.61 2.227 4.4a.75.75 0 1 0-1.06 1.06l2.742 2.742a.75.75 0 0 0 1.06 0l6.084-6.085a.75.75 0 0 0 0-1.064zm4.242 0a.75.75 0 0 0-1.06 0L8.15 7.138l-1.47-1.47a.75.75 0 0 0-1.06 1.06l2 2a.75.75 0 0 0 1.06 0l6.615-6.615a.75.75 0 0 0 0-1.06z" />
                        </svg>
                        <span>Delivered • {formatReceiptTime(receipt.timestamp)} <span className="receipt-date">{formatReceiptDate(receipt.timestamp)}</span></span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
