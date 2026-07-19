import { useEffect, useRef } from 'react'
import { useExtensionLog } from '../../hooks/useExtensionLog'

interface ExtensionLogViewerProps {
  extensionId: string | null
}

/**
 * SRP: Only renders the log panel — uses hook for all side-effects.
 * No setInterval in this component body.
 */
export function ExtensionLogViewer({ extensionId }: ExtensionLogViewerProps) {
  const log = useExtensionLog(extensionId)
  const preRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    if (preRef.current) {
      preRef.current.scrollTop = preRef.current.scrollHeight
    }
  }, [log])

  if (!extensionId) {
    return (
      <div className="ext-log-empty">
        <span>Select an extension to view its log</span>
      </div>
    )
  }

  return (
    <div className="ext-log-panel">
      <div className="ext-log-header">
        <span className="ext-log-title">Live Log</span>
        <span className="ext-log-pulse" title="Updates every 2s" />
      </div>
      <pre ref={preRef} className="ext-log-content">
        {log || '(no log output yet)'}
      </pre>
    </div>
  )
}
