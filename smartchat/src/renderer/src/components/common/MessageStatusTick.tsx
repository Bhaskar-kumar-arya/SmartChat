import React from 'react'

interface MessageStatusTickProps {
  status?: string
  className?: string
  style?: React.CSSProperties
}

export function MessageStatusTick({ status, className = '', style }: MessageStatusTickProps) {
  const normalized = status || 'SENT'
  const combinedStyle = {
    display: 'inline-flex',
    alignSelf: 'center',
    marginLeft: '4px',
    ...style
  }

  if (normalized === 'PENDING') {
    return (
      <span className={`msg-status-tick ${className}`} title="Pending" style={combinedStyle}>
        <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="status-clock" style={{ opacity: 0.6 }}><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
      </span>
    )
  }

  if (normalized === 'DELIVERED') {
    return (
      <span className={`msg-status-tick ${className}`} title="Delivered" style={combinedStyle}>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 11" width="16" height="11" fill="currentColor" className="status-delivered" style={{ opacity: 0.6 }}><path d="M11.053 1.053a.75.75 0 0 0-1.06 0L4.437 6.61 2.227 4.4a.75.75 0 1 0-1.06 1.06l2.742 2.742a.75.75 0 0 0 1.06 0l6.084-6.085a.75.75 0 0 0 0-1.064zm4.242 0a.75.75 0 0 0-1.06 0L8.15 7.138l-1.47-1.47a.75.75 0 0 0-1.06 1.06l2 2a.75.75 0 0 0 1.06 0l6.615-6.615a.75.75 0 0 0 0-1.06z" /></svg>
      </span>
    )
  }

  if (normalized === 'READ' || normalized === 'PLAYED') {
    return (
      <span className={`msg-status-tick ${className}`} title="Read" style={combinedStyle}>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 11" width="16" height="11" fill="#53bdeb" className="status-read"><path d="M11.053 1.053a.75.75 0 0 0-1.06 0L4.437 6.61 2.227 4.4a.75.75 0 1 0-1.06 1.06l2.742 2.742a.75.75 0 0 0 1.06 0l6.084-6.085a.75.75 0 0 0 0-1.064zm4.242 0a.75.75 0 0 0-1.06 0L8.15 7.138l-1.47-1.47a.75.75 0 0 0-1.06 1.06l2 2a.75.75 0 0 0 1.06 0l6.615-6.615a.75.75 0 0 0 0-1.06z" /></svg>
      </span>
    )
  }

  // default to SENT
  return (
    <span className={`msg-status-tick ${className}`} title="Sent" style={combinedStyle}>
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 11" width="16" height="11" fill="currentColor" className="status-sent" style={{ opacity: 0.6 }}><path d="M15.006 1.014a.75.75 0 0 0-1.062 0l-9.52 9.52-4.148-4.148a.75.75 0 0 0-1.06 1.06l4.678 4.678a.75.75 0 0 0 1.06 0l10.052-10.052a.75.75 0 0 0 0-1.058z" /></svg>
    </span>
  )
}
