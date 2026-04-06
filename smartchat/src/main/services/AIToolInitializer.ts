import { toolRegistry } from './AIToolService';
import { SendMessageTool } from '../tools/SendMessageTool';
import { ReadChatTool } from '../tools/ReadChatTool';

export class AIToolInitializer {
  /**
   * Initializes and registers all integrated AI tools.
   * This centralizes tool management and keeps the IPC handlers clean.
   * 
   * @param getSock - Function that returns the current Baileys socket.
   */
  static initializeAll(getSock: () => ReturnType<typeof import('@whiskeysockets/baileys').default> | null) {
    // 1. Instantiate tools
    const sendMessageTool = new SendMessageTool(getSock);
    const readChatTool = new ReadChatTool(getSock);

    // 2. Register tools
    toolRegistry.registerTool(sendMessageTool);
    toolRegistry.registerTool(readChatTool);

    console.log('[AIToolInitializer] All AI tools registered successfully');
  }
}
