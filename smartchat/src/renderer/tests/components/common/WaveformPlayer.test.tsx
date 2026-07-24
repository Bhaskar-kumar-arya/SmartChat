import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import WaveformPlayer from '@renderer/components/common/WaveformPlayer'

// Mock WaveSurfer
const mockWsInstance = {
  on: vi.fn((event, cb) => {
    if (event === 'ready') cb(120) // 2 mins
    return mockWsInstance
  }),
  playPause: vi.fn(),
  setPlaybackRate: vi.fn(),
  destroy: vi.fn()
}

vi.mock('wavesurfer.js', () => ({
  default: {
    create: vi.fn(() => mockWsInstance)
  }
}))

describe('WaveformPlayer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders audio player controls, play button, and playback speed button', () => {
    render(<WaveformPlayer url="blob:audio-url" preDuration={60} />)
    
    // Play button exists
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(2)

    // Playback speed starts at 1x
    expect(screen.getByText('1x')).toBeInTheDocument()
  })

  it('toggles play/pause when play button is clicked', () => {
    render(<WaveformPlayer url="blob:audio-url" />)
    const playBtn = screen.getAllByRole('button')[0]

    fireEvent.click(playBtn)
    expect(mockWsInstance.playPause).toHaveBeenCalledTimes(1)
  })

  it('cycles playback speed when speed button is clicked (1x -> 1.5x -> 2x -> 1x)', () => {
    render(<WaveformPlayer url="blob:audio-url" />)
    const speedBtn = screen.getByText('1x')

    fireEvent.click(speedBtn)
    expect(screen.getByText('1.5x')).toBeInTheDocument()
    expect(mockWsInstance.setPlaybackRate).toHaveBeenCalledWith(1.5)

    fireEvent.click(screen.getByText('1.5x'))
    expect(screen.getByText('2x')).toBeInTheDocument()
    expect(mockWsInstance.setPlaybackRate).toHaveBeenCalledWith(2)

    fireEvent.click(screen.getByText('2x'))
    expect(screen.getByText('1x')).toBeInTheDocument()
    expect(mockWsInstance.setPlaybackRate).toHaveBeenCalledWith(1)
  })
})
