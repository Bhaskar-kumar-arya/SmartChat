export interface IDedicatedChatSessionManager {
  routeUserMessage(extensionId: string, text: string): Promise<void>
  routeButtonPress(extensionId: string, buttonId: string): Promise<void>
  routeCommand(extensionId: string, command: string, args: string): Promise<void>
}
