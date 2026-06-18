import { toolRegistry } from './AIToolService';
import { SendMessageTool } from '../../tools/SendMessageTool';
import { ReadMessagesTool } from '../../tools/ReadMessagesTool';
import { QueryDatabaseTool } from '../../tools/QueryDatabaseTool';
import { MessageActionTool } from '../../tools/MessageActionTool';
import { ExecuteScriptTool } from '../../tools/ExecuteScriptTool';
import { WASocket } from '../../types';
import { ServiceContainer } from '../../ServiceContainer';

export class AIToolInitializer {
  /**
   * Initializes and registers all integrated AI tools.
   * This centralizes tool management and keeps the IPC handlers clean.
   * 
   * @param getSock - Function that returns the current Baileys socket.
   */
  static initializeAll(getSock: () => WASocket | null, services: ServiceContainer) {
    // 1. Instantiate tools
    const sendMessageTool = new SendMessageTool(getSock, services.messageActionService);
    const readMessagesTool = new ReadMessagesTool(
      getSock,
      services.messageFormatterRegistry,
      services.messageRepository,
      services.contactRepository,
      services.chatRepository
    );
    const queryDatabaseTool = new QueryDatabaseTool();
    const messageActionTool = new MessageActionTool(getSock, services.messageActionService);
    // ExecuteScriptTool must be instantiated last — its initialize() builds the
    // injected-tool list from the registry, so all other tools must be registered first.
    const executeScriptTool = new ExecuteScriptTool();

    // 2. Register tools
    toolRegistry.registerTool(sendMessageTool);
    toolRegistry.registerTool(readMessagesTool);
    toolRegistry.registerTool(queryDatabaseTool);
    toolRegistry.registerTool(messageActionTool);
    toolRegistry.registerTool(executeScriptTool);

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

