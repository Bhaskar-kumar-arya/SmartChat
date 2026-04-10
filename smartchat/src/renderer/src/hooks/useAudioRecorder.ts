import { useState, useRef, useCallback } from 'react'

export interface AudioRecorderState {
  isRecording: boolean
  duration: number
  audioBlob: Blob | null
  visualizerData: number[]
}

export function useAudioRecorder() {
  const [isRecording, setIsRecording] = useState(false)
  const [duration, setDuration] = useState(0)
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
  const [visualizerData, setVisualizerData] = useState<number[]>([])
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const timerRef = useRef<any>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const chunksRef = useRef<Blob[]>([])

  const startRecording = useCallback(async () => {
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
  }, [])

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop()
      setIsRecording(false)
      
      if (timerRef.current) clearInterval(timerRef.current)
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current)
      if (audioContextRef.current) audioContextRef.current.close()
    }
  }, [isRecording])

  const cancelRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop()
    }
    
    setIsRecording(false)
    setAudioBlob(null)
    setDuration(0)
    setVisualizerData([])
    
    if (timerRef.current) clearInterval(timerRef.current)
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current)
    if (audioContextRef.current) audioContextRef.current.close()
  }, [isRecording])

  return {
    isRecording,
    duration,
    audioBlob,
    visualizerData,
    startRecording,
    stopRecording,
    cancelRecording
  }
}
