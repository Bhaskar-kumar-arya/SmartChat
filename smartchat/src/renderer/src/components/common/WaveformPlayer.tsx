import { useEffect, useRef, useState, useCallback } from 'react'
import WaveSurfer from 'wavesurfer.js'
import { Play, Pause } from 'lucide-react'

interface WaveformPlayerProps {
  url: string
  isPtt?: boolean
  peaks?: number[]
  preDuration?: number
  onPlay?: () => void
  onPause?: () => void
}

export default function WaveformPlayer({ url, isPtt = true, peaks, preDuration, onPlay, onPause }: WaveformPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const wavesurferRef = useRef<WaveSurfer | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [playbackSpeed, setPlaybackSpeed] = useState(1)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(preDuration || 0)

  useEffect(() => {
    if (!containerRef.current) return

    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: 'rgba(0, 0, 0, 0.2)',
      progressColor: isPtt ? '#00a884' : '#333',
      cursorColor: 'transparent',
      barWidth: 2,
      barGap: 3,
      barRadius: 3,
      height: 30,
      normalize: true,
      url: url,
      peaks: peaks ? [peaks] : undefined,
      duration: preDuration
    })

    wavesurferRef.current = ws

    ws.on('play', () => {
      setIsPlaying(true)
      onPlay?.()
    })
    ws.on('pause', () => {
      setIsPlaying(false)
      onPause?.()
    })
    ws.on('timeupdate', (time) => setCurrentTime(time))
    ws.on('ready', (dur) => setDuration(dur))
    ws.on('finish', () => setIsPlaying(false))

    return () => {
      ws.destroy()
    }
  }, [url, isPtt])

  const togglePlay = useCallback(() => {
    wavesurferRef.current?.playPause()
  }, [])

  const cycleSpeed = useCallback(() => {
    const speeds = [1, 1.5, 2]
    const nextSpeed = speeds[(speeds.indexOf(playbackSpeed) + 1) % speeds.length]
    setPlaybackSpeed(nextSpeed)
    wavesurferRef.current?.setPlaybackRate(nextSpeed)
  }, [playbackSpeed])

  const formatTime = (time: number) => {
    const mins = Math.floor(time / 60)
    const secs = Math.floor(time % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  return (
    <div className="audio-player-container" style={{ 
      display: 'flex', 
      alignItems: 'center', 
      gap: '12px', 
      width: '100%', 
      padding: '4px 8px',
      background: 'transparent'
    }}>
      <button 
        onClick={togglePlay}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: isPtt ? '#00a884' : '#54656f',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0
        }}
      >
        {isPlaying ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" />}
      </button>

      <div style={{ flex: 1, position: 'relative' }}>
        <div ref={containerRef} style={{ width: '100%' }} />
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          fontSize: '0.7rem', 
          color: '#888',
          marginTop: '2px'
        }}>
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      <button 
        onClick={cycleSpeed}
        style={{
          background: '#f0f2f5',
          border: 'none',
          borderRadius: '12px',
          padding: '2px 8px',
          fontSize: '0.75rem',
          fontWeight: 700,
          cursor: 'pointer',
          color: '#54656f',
          minWidth: '36px',
          textAlign: 'center'
        }}
      >
        {playbackSpeed}x
      </button>
    </div>
  )
}
