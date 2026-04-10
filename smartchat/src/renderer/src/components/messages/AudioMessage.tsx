import WaveformPlayer from '../WaveformPlayer'
import { ProfilePicture } from '../ProfilePicture'

interface AudioMessageProps {
  localURI?: string
  textContent?: string | null
  senderJid?: string
  onDownload: () => void
  isDownloading: boolean
  rawMsg?: any
}

export const AudioMessage = ({ localURI, senderJid, onDownload, isDownloading, rawMsg }: AudioMessageProps) => {
  const audioMsg = rawMsg?.audioMessage
  const duration = audioMsg?.seconds
  const peaks = audioMsg?.waveform ? Array.from(audioMsg.waveform as Iterable<number>).map((v: number) => v / 255) : undefined

  if (!localURI) {
    return (
      <div className="message-audio-download" style={{
        padding: '12px',
        borderRadius: '12px',
        background: 'rgba(0,0,0,0.05)',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        minWidth: '240px'
      }}>
        <div style={{
          width: '40px',
          height: '40px',
          borderRadius: '50%',
          background: '#ddd',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '0.85rem', color: '#555' }}>Voice message {duration ? `(${Math.floor(duration / 60)}:${(duration % 60).toString().padStart(2, '0')})` : ''}</div>
          <button 
            onClick={onDownload}
            disabled={isDownloading}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--primary, #00a884)',
              fontSize: '0.75rem',
              fontWeight: 600,
              cursor: 'pointer',
              padding: 0,
              marginTop: '2px'
            }}
          >
            {isDownloading ? 'Downloading...' : 'Click to Download'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="message-audio-container" style={{
      display: 'flex',
      alignItems: 'flex-start',
      gap: '10px',
      padding: '4px 0',
      minWidth: '280px'
    }}>
      <div className="audio-avatar-container" style={{ position: 'relative' }}>
          {senderJid ? (
            <ProfilePicture jid={senderJid} size={48} />
          ) : (
            <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#ccc' }} />
          )}
          <div style={{
              position: 'absolute',
              bottom: 0,
              right: 0,
              background: '#fff',
              borderRadius: '50%',
              padding: '2px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
          }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#00a884" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
          </div>
      </div>
      
      <div style={{ flex: 1, paddingTop: '4px' }}>
        <WaveformPlayer url={localURI} isPtt={true} peaks={peaks} preDuration={duration} />
      </div>
    </div>
  )
}
