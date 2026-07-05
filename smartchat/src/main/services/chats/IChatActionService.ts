import { WASocket } from '../whatsapp/types'

export type IChatActionSocket = Pick<WASocket, 'chatModify' | 'user'>

export interface IChatActionService {
  muteChat(sock: IChatActionSocket, jid: string, durationMs: number | null): Promise<{ success: boolean; detail: string }>
  pinChat(sock: IChatActionSocket, jid: string, pin: boolean): Promise<{ success: boolean; detail: string }>
  markChatRead(_sock: IChatActionSocket, jid: string, read: boolean): Promise<{ success: boolean; detail: string }>
  archiveChat(_sock: IChatActionSocket, jid: string, archive: boolean): Promise<{ success: boolean; detail: string }>
}
