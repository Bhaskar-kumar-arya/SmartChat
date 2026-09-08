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
  const playbackSpeedRef = useRef(1)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(preDuration || 0)

  useEffect(() => {
    if (!containerRef.current) return

    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: 'rgba(233, 237, 239, 0.25)',
      progressColor: isPtt ? '#00a884' : '#e9edef',
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
    ws.on('ready', (dur) => {
      setDuration(dur)
      // A fresh WaveSurfer instance defaults to 1x — re-apply the chosen speed
      // so the pill and playback stay in sync after a url/peaks change.
      ws.setPlaybackRate(playbackSpeedRef.current)
    })
    ws.on('finish', () => setIsPlaying(false))

    return () => {
      ws.destroy()
    }
  }, [url, isPtt, peaks, preDuration])

  const togglePlay = useCallback(() => {
    wavesurferRef.current?.playPause()
  }, [])

  const cycleSpeed = useCallback(() => {
    const speeds = [1, 1.5, 2]
    const nextSpeed = speeds[(speeds.indexOf(playbackSpeed) + 1) % speeds.length]
    setPlaybackSpeed(nextSpeed)
    playbackSpeedRef.current = nextSpeed
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
          color: isPtt ? '#00a884' : 'var(--wa-icon)',
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
        <div className="waveform-time" style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: '0.7rem',
          marginTop: '2px'
        }}>
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      <button className="waveform-speed-pill" onClick={cycleSpeed}>
        {playbackSpeed}x
      </button>
    </div>
  )
}
