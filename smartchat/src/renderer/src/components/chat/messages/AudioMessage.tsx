import WaveformPlayer from '../../common/WaveformPlayer'
import { ProfilePicture } from '../../common/ProfilePicture'

import { AudioMessageProps } from '../../../types'

export const AudioMessage = ({ localURI, senderJid, onDownload, isDownloading, rawMsg }: AudioMessageProps) => {
  const audioMsg = rawMsg?.audioMessage
  const duration = audioMsg?.seconds
  const peaks = audioMsg?.waveform ? Array.from(audioMsg.waveform as Iterable<number>).map((v: number) => v / 255) : undefined

  if (!localURI) {
    return (
      <div className="message-audio-download">
        <div className="audio-download-icon-wrapper">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
        </div>
        <div className="audio-download-info">
          <div className="audio-download-text">Voice message {duration ? `(${Math.floor(duration / 60)}:${(duration % 60).toString().padStart(2, '0')})` : ''}</div>
          <button 
            onClick={onDownload}
            disabled={isDownloading}
            className="audio-download-btn"
          >
            {isDownloading ? 'Downloading...' : 'Click to Download'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="message-audio-container">
      <div className="audio-avatar-container">
          {senderJid ? (
            <ProfilePicture jid={senderJid} size={48} />
          ) : (
            <div className="audio-avatar-fallback" />
          )}
          <div className="audio-mic-badge">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
          </div>
      </div>
      
      <div className="audio-player-wrapper">
        <WaveformPlayer url={localURI} isPtt={true} peaks={peaks} preDuration={duration} />
      </div>
    </div>
  )
}

