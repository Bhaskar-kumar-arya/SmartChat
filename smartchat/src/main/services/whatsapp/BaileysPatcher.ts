import fs from 'fs';
import path from 'path';

export class BaileysPatcher {
  public static patch(): void {
    try {
      // Find the path to the chat-utils.js file inside node_modules
      const possiblePaths = [
        path.join(process.cwd(), 'node_modules', '@whiskeysockets', 'baileys', 'lib', 'Utils', 'chat-utils.js'),
        path.join(__dirname, '..', '..', '..', 'node_modules', '@whiskeysockets', 'baileys', 'lib', 'Utils', 'chat-utils.js')
      ];

      let targetPath: string | null = null;
      for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
          targetPath = p;
          break;
        }
      }

      if (!targetPath) {
        console.warn('[BaileysPatcher] Could not locate chat-utils.js to apply app-state.sync patch.');
        return;
      }

      const content = fs.readFileSync(targetPath, 'utf8');
      
      // Check if already patched
      if (content.includes("ev.emit('app-state.sync'")) {
        console.log('[BaileysPatcher] chat-utils.js is already patched.');
        return;
      }

      // We want to insert the event emission inside processSyncAction
      const targetSignature = 'export const processSyncAction = (syncAction, ev, me, initialSyncOpts, logger) => {';
      const replacement = `${targetSignature}
    try {
        ev.emit('app-state.sync', syncAction);
    } catch (e) {
        logger?.error({ err: e }, 'Failed to emit app-state.sync');
    }`;

      if (!content.includes(targetSignature)) {
        console.error('[BaileysPatcher] Target signature for processSyncAction not found in chat-utils.js.');
        return;
      }

      const patchedContent = content.replace(targetSignature, replacement);
      fs.writeFileSync(targetPath, patchedContent, 'utf8');
      console.log('[BaileysPatcher] Successfully patched chat-utils.js to emit app-state.sync events.');
    } catch (error) {
      console.error('[BaileysPatcher] Error applying patch to chat-utils.js:', error);
    }
  }
}
