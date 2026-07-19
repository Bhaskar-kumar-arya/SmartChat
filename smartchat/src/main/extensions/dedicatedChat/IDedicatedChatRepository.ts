export interface IDedicatedChatRepository {
  append(extensionId: string, role: 'user' | 'extension', content: string): Promise<void>
  getHistory(extensionId: string, limit?: number): Promise<any[]>
  clear(extensionId: string): Promise<void>
}
