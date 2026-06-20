export interface ExportSession {
  id: string
  title: string
  modelId?: string | null
}

export interface ExportMessage {
  role: string
  content: string
  timestamp?: string | number | null
}

export interface IAIChatExportService {
  exportChat(session: ExportSession, messages: ExportMessage[]): Promise<void>
  deleteExportedChat(sessionId: string): Promise<void>
  duplicateExportedChat(sessionId: string): Promise<void>
}
