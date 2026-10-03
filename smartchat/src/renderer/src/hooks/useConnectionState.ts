import { useEffect, useReducer } from 'react'
import { useAPI } from '../context/APIContext'

export type ConnectionPhase = 'initializing' | 'qr' | 'connected' | 'syncing' | 'ready'

export const INITIAL_SYNC_STATUS = 'Initializing connection...'
export const SESSION_REPLACED_STATUS =
  'This session was opened on another device. SmartChat has stopped syncing.'

export interface ConnectionState {
  phase: ConnectionPhase
  qr: string | null
  syncProgress: number
  syncStatus: string
  syncType: number
  isRegeneratingQr: boolean
  sessionReplaced: boolean
  /** True while a transient reconnect/catch-up runs after `ready`; the UI stays mounted. */
  reconnecting: boolean
}

export type ConnectionAction =
  | { type: 'qr'; qr: string }
  | { type: 'connected'; isCatchup: boolean }
  | { type: 'loggedOut' }
  | { type: 'sessionReplaced' }
  | { type: 'syncProgress'; progress: number; syncType: number }
  | { type: 'syncStatus'; status: string }
  | { type: 'syncComplete' }

export const initialConnectionState: ConnectionState = {
  phase: 'initializing',
  qr: null,
  syncProgress: 0,
  syncStatus: INITIAL_SYNC_STATUS,
  syncType: 0,
  isRegeneratingQr: false,
  sessionReplaced: false,
  reconnecting: false
}

export function connectionReducer(state: ConnectionState, action: ConnectionAction): ConnectionState {
  switch (action.type) {
    case 'qr':
      return {
        ...state,
        qr: action.qr,
        isRegeneratingQr: false,
        phase: 'qr',
        sessionReplaced: false,
        reconnecting: false
      }
    case 'connected':
      // Once ready, a (re)connect must not tear the chat UI down: keep `ready` and flag it.
      if (state.phase === 'ready') {
        return { ...state, qr: null, sessionReplaced: false, reconnecting: true }
      }
      return action.isCatchup
        ? { ...state, qr: null, phase: 'connected', sessionReplaced: false }
        : { ...state, qr: null, phase: 'syncing', syncProgress: 0, sessionReplaced: false }
    case 'loggedOut':
      return {
        ...state,
        qr: null,
        phase: 'initializing',
        syncProgress: 0,
        syncType: 0,
        syncStatus: INITIAL_SYNC_STATUS,
        sessionReplaced: false,
        reconnecting: false
      }
    case 'sessionReplaced':
      return {
        ...state,
        qr: null,
        syncProgress: 0,
        syncType: 0,
        sessionReplaced: true,
        reconnecting: false,
        phase: 'initializing',
        syncStatus: SESSION_REPLACED_STATUS
      }
    case 'syncProgress':
      // A late progress event after `ready` must not drop back to the sync screen.
      if (state.phase === 'ready') return state
      return { ...state, syncProgress: action.progress, syncType: action.syncType, phase: 'syncing' }
    case 'syncStatus':
      return { ...state, syncStatus: action.status }
    case 'syncComplete':
      return { ...state, syncProgress: 100, phase: 'ready', sessionReplaced: false, reconnecting: false }
  }
}

/** Owns the WhatsApp connection/sync state machine that drives the App screens. */
export function useConnectionState(): ConnectionState {
  const api = useAPI()
  const [state, dispatch] = useReducer(connectionReducer, initialConnectionState)

  useEffect(() => {
    const unsubs = [
      api.onWaQr((qr: string) => dispatch({ type: 'qr', qr })),
      api.onWaConnected((data) => dispatch({ type: 'connected', isCatchup: !!data?.isCatchup })),
      api.onWaLoggedOut(() => dispatch({ type: 'loggedOut' })),
      api.onWaSessionReplaced(() => dispatch({ type: 'sessionReplaced' })),
      api.onWaSyncProgress((data) =>
        dispatch({ type: 'syncProgress', progress: data.progress, syncType: data.syncType })
      ),
      api.onWaSyncStatus((status: string) => dispatch({ type: 'syncStatus', status })),
      api.onWaSyncComplete(() => dispatch({ type: 'syncComplete' }))
    ]
    return () => unsubs.forEach((u) => u())
  }, [api])

  return state
}
