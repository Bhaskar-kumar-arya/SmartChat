import React from 'react'

interface AIToolCardProps {
  toolData: {
    tool: string
    arguments: any
  }
  toolResult?: string
  isExecuting: boolean
  onApprove: () => void
  onDecline: () => void
}

const AIToolCard: React.FC<AIToolCardProps> = ({ 
  toolData, 
  toolResult, 
  isExecuting, 
  onApprove, 
  onDecline 
}) => {
  return (
    <div className="ai-tool-card" style={{ padding: '12px', background: 'rgba(0,0,0,0.15)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)' }}>
      <div style={{ fontWeight: 600, marginBottom: '8px', color: '#ffb340' }}>⚡ Tool Request: {toolData.tool}</div>
      <pre style={{ fontSize: '11px', background: 'rgba(0,0,0,0.4)', padding: '8px', borderRadius: '4px', overflowX: 'auto', margin: 0 }}>
        {JSON.stringify(toolData.arguments, null, 2)}
      </pre>
      {toolResult ? (
        <div style={{ marginTop: '10px', fontSize: '12px', color: '#a8bbd9', background: 'rgba(255,255,255,0.05)', padding: '8px', borderRadius: '4px' }}>
          <span style={{fontWeight: 600}}>Result:</span> <pre style={{margin: 0, marginTop:'4px', whiteSpace: 'pre-wrap'}}>{toolResult}</pre>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
          <button 
            disabled={isExecuting}
            onClick={onApprove}
            style={{ flex: 1, padding: '6px 12px', border: 'none', background: '#0a84ff', color: 'white', borderRadius: '6px', cursor: isExecuting ? 'not-allowed' : 'pointer', fontWeight: 600 }}
          >
            {isExecuting ? 'Running...' : 'Approve'}
          </button>
          <button 
            disabled={isExecuting}
            onClick={onDecline}
            style={{ flex: 1, padding: '6px 12px', background: 'transparent', color: '#ff453a', border: '1px solid #ff453a', borderRadius: '6px', cursor: isExecuting ? 'not-allowed' : 'pointer', fontWeight: 600 }}
          >
            Decline
          </button>
        </div>
      )}
    </div>
  )
}

export default AIToolCard
