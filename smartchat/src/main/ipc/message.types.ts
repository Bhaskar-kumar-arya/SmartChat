import { EnrichedReaction } from './reaction.types'

/** Enriched message returned to the frontend via IPC. */
export interface EnrichedMessage {
  id: string
  chatJid: string
  fromMe: boolean
  participant: string | null
  participantName: string
  timestamp: string
  messageType: string
  content: string
  reactions?: EnrichedReaction[]
  isDeleted?: boolean
  isEdited?: boolean
  status?: string | null
}
