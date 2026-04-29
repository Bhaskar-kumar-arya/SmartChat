import { toolRegistry } from './AIToolService';
import { SendMessageTool } from '../tools/SendMessageTool';
import { ReadChatTool } from '../tools/ReadChatTool';
import { QueryDatabaseTool } from '../tools/QueryDatabaseTool';

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
    const queryDatabaseTool = new QueryDatabaseTool();

    // 2. Register tools
    toolRegistry.registerTool(sendMessageTool);
    toolRegistry.registerTool(readChatTool);
    toolRegistry.registerTool(queryDatabaseTool);

    // 3. Run optional async initialization on tools that need it (fire-and-forget)
    for (const tool of toolRegistry.getAllTools()) {
      if (tool.initialize) {
        tool.initialize().catch(err =>
          console.error(`[AIToolInitializer] Failed to initialize tool "${tool.name}":`, err)
        );
      }
    }

    console.log('[AIToolInitializer] All AI tools registered successfully');
  }
}
