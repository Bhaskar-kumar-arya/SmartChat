import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAudioRecorder } from '@renderer/hooks/useAudioRecorder'

describe('useAudioRecorder', () => {
  let mockMediaStream: any
  let mockMediaRecorder: any
  let ondataavailableCallback: ((e: any) => void) | null = null
  let onstopCallback: (() => void) | null = null

  beforeEach(() => {
    vi.useFakeTimers()

    ondataavailableCallback = null
    onstopCallback = null

    mockMediaStream = {
      getTracks: vi.fn().mockReturnValue([{ stop: vi.fn() }]),
    }

    mockMediaRecorder = {
      start: vi.fn(),
      stop: vi.fn().mockImplementation(() => {
        if (onstopCallback) onstopCallback()
      }),
      state: 'recording',
    }

    Object.defineProperty(mockMediaRecorder, 'ondataavailable', {
      set: (fn) => { ondataavailableCallback = fn },
      get: () => ondataavailableCallback,
    })

    Object.defineProperty(mockMediaRecorder, 'onstop', {
      set: (fn) => { onstopCallback = fn },
      get: () => onstopCallback,
    })

    // Mock navigator.mediaDevices.getUserMedia
    Object.defineProperty(navigator, 'mediaDevices', {
      writable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue(mockMediaStream),
      },
    })

    // Mock MediaRecorder constructor
    function MockMediaRecorderClass() {
      return mockMediaRecorder
    }
    MockMediaRecorderClass.isTypeSupported = vi.fn().mockReturnValue(true)
    ;(window as any).MediaRecorder = MockMediaRecorderClass

    // Mock AudioContext
    const mockAnalyser = {
      fftSize: 64,
      frequencyBinCount: 32,
      getByteFrequencyData: vi.fn((array: Uint8Array) => {
        array.fill(128)
      }),
    }

    const mockAudioContext = {
      state: 'running',
      createMediaStreamSource: vi.fn().mockReturnValue({
        connect: vi.fn(),
      }),
      createAnalyser: vi.fn().mockReturnValue(mockAnalyser),
      close: vi.fn().mockResolvedValue(undefined),
    }

    function MockAudioContextClass() {
      return mockAudioContext
    }
    ;(window as any).AudioContext = MockAudioContextClass

    // Mock URL methods
    global.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-url')
    global.URL.revokeObjectURL = vi.fn()

    // Mock Audio element constructor
    function MockAudioClass() {
      return {
        play: vi.fn().mockResolvedValue(undefined),
        pause: vi.fn(),
        currentTime: 0,
        src: '',
        onended: null,
      }
    }
    ;(window as any).Audio = MockAudioClass

    // Mock animation frames
    vi.stubGlobal('requestAnimationFrame', vi.fn().mockReturnValue(123))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('should initialize with default idle state', () => {
    const { result } = renderHook(() => useAudioRecorder())

    expect(result.current.isRecording).toBe(false)
    expect(result.current.duration).toBe(0)
    expect(result.current.audioBlob).toBeNull()
    expect(result.current.visualizerData).toEqual([])
    expect(result.current.isPlayingPreview).toBe(false)
  })

  it('should start recording successfully', async () => {
    const { result } = renderHook(() => useAudioRecorder())

    await act(async () => {
      await result.current.startRecording()
    })

    expect(result.current.isRecording).toBe(true)
    expect(result.current.duration).toBe(0)
    expect(mockMediaRecorder.start).toHaveBeenCalled()

    // Advance timer by 3 seconds
    act(() => {
      vi.advanceTimersByTime(3000)
    })

    expect(result.current.duration).toBe(3)
  })

  it('should stop recording and create an audio blob', async () => {
    const { result } = renderHook(() => useAudioRecorder())

    await act(async () => {
      await result.current.startRecording()
    })

    // Simulate data available
    if (ondataavailableCallback) {
      ondataavailableCallback({ data: new Blob(['chunk1'], { type: 'audio/webm' }) })
    }

    act(() => {
      result.current.stopRecording()
    })

    expect(result.current.isRecording).toBe(false)
    expect(mockMediaRecorder.stop).toHaveBeenCalled()
    expect(result.current.audioBlob).toBeInstanceOf(Blob)
  })

  it('should cancel recording and reset state without creating a blob', async () => {
    const { result } = renderHook(() => useAudioRecorder())

    await act(async () => {
      await result.current.startRecording()
    })

    act(() => {
      result.current.cancelRecording()
    })

    expect(result.current.isRecording).toBe(false)
    expect(result.current.audioBlob).toBeNull()
    expect(result.current.duration).toBe(0)
    expect(result.current.visualizerData).toEqual([])
  })

  it('should toggle preview playback', async () => {
    const { result } = renderHook(() => useAudioRecorder())

    await act(async () => {
      await result.current.startRecording()
    })

    act(() => {
      result.current.stopRecording()
    })

    act(() => {
      result.current.togglePreviewPlayback()
    })

    expect(result.current.isPlayingPreview).toBe(true)
    expect(global.URL.createObjectURL).toHaveBeenCalled()

    act(() => {
      result.current.togglePreviewPlayback()
    })

    expect(result.current.isPlayingPreview).toBe(false)
  })
})
