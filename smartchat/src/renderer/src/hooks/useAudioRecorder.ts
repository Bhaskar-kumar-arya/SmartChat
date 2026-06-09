import { useState, useRef, useCallback, useEffect } from 'react'

export interface AudioRecorderState {
  isRecording: boolean
  duration: number
  audioBlob: Blob | null
  visualizerData: number[]
  isPlayingPreview: boolean
}

export function useAudioRecorder() {
  const [isRecording, setIsRecording] = useState(false)
  const [duration, setDuration] = useState(0)
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
  const [visualizerData, setVisualizerData] = useState<number[]>([])
  const [isPlayingPreview, setIsPlayingPreview] = useState(false)
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const timerRef = useRef<any>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const chunksRef = useRef<Blob[]>([])
  
  const previewAudioRef = useRef<HTMLAudioElement | null>(null)
  const previewUrlRef = useRef<string | null>(null)

  const stopPreview = useCallback(() => {
    if (previewAudioRef.current) {
      previewAudioRef.current.pause()
      previewAudioRef.current.currentTime = 0
      setIsPlayingPreview(false)
    }
  }, [])

  const startRecording = useCallback(async () => {
    // Clean up any ongoing preview
    stopPreview()
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current)
      previewUrlRef.current = null
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      
      // Determine supported mime type
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') 
        ? 'audio/webm;codecs=opus' 
        : 'audio/webm'
      
      const recorder = new MediaRecorder(stream, { mimeType })
      mediaRecorderRef.current = recorder
      chunksRef.current = []

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType })
        setAudioBlob(blob)
        stream.getTracks().forEach(track => track.stop())
      }

      // Audio analysis for visualizer
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
      const source = audioContext.createMediaStreamSource(stream)
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 64
      source.connect(analyser)
      
      audioContextRef.current = audioContext
      analyserRef.current = analyser

      recorder.start()
      setIsRecording(true)
      setDuration(0)
      setAudioBlob(null)

      timerRef.current = setInterval(() => {
        setDuration(prev => prev + 1)
      }, 1000)

      const updateVisualizer = () => {
        const dataArray = new Uint8Array(analyser.frequencyBinCount)
        analyser.getByteFrequencyData(dataArray)
        // Normalize and take a subset for visualizer
        const normalized = Array.from(dataArray).map(v => v / 255)
        setVisualizerData(normalized)
        animationFrameRef.current = requestAnimationFrame(updateVisualizer)
      }
      updateVisualizer()

    } catch (err) {
      console.error('Failed to start recording:', err)
      throw err
    }
  }, [stopPreview])

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop()
      setIsRecording(false)
      
      if (timerRef.current) clearInterval(timerRef.current)
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current)
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(console.error)
      }
      audioContextRef.current = null
    }
  }, [isRecording])

  const cancelRecording = useCallback(() => {
    stopPreview()
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current)
      previewUrlRef.current = null
    }

    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop()
    }
    
    setIsRecording(false)
    setAudioBlob(null)
    setDuration(0)
    setVisualizerData([])
    
    if (timerRef.current) clearInterval(timerRef.current)
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current)
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(console.error)
    }
    audioContextRef.current = null
  }, [isRecording, stopPreview])

  const togglePreviewPlayback = useCallback(() => {
    if (!audioBlob) return

    if (isPlayingPreview) {
      stopPreview()
    } else {
      if (!previewAudioRef.current) {
        previewAudioRef.current = new Audio()
        previewAudioRef.current.onended = () => setIsPlayingPreview(false)
      }
      
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current)
      }
      
      const url = URL.createObjectURL(audioBlob)
      previewUrlRef.current = url
      previewAudioRef.current.src = url
      previewAudioRef.current.play().catch(err => {
        console.error('Failed to play preview audio:', err)
      })
      setIsPlayingPreview(true)
    }
  }, [audioBlob, isPlayingPreview, stopPreview])

  // Lifecycle cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current)
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(console.error)
      }
      audioContextRef.current = null
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop()
      }
      if (previewAudioRef.current) {
        previewAudioRef.current.pause()
        previewAudioRef.current = null
      }
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current)
      }
    }
  }, [])

  return {
    isRecording,
    duration,
    audioBlob,
    visualizerData,
    isPlayingPreview,
    startRecording,
    stopRecording,
    cancelRecording,
    togglePreviewPlayback,
    stopPreview
  }
}
