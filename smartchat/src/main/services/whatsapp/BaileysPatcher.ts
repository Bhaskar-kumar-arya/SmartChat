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
        console.warn('[BaileysPatcher] Could not locate chat-utils.js to apply patches.');
        return;
      }

      let content = fs.readFileSync(targetPath, 'utf8');
      let modified = false;

      // 1. Patch processSyncAction to emit 'app-state.sync' events
      if (!content.includes("ev.emit('app-state.sync'")) {
        const targetSignature = 'export const processSyncAction = (syncAction, ev, me, initialSyncOpts, logger) => {';
        const replacement = `${targetSignature}
    try {
        ev.emit('app-state.sync', syncAction);
    } catch (e) {
        logger?.error({ err: e }, 'Failed to emit app-state.sync');
    }`;

        if (content.includes(targetSignature)) {
          content = content.replace(targetSignature, replacement);
          console.log('[BaileysPatcher] Successfully patched chat-utils.js to emit app-state.sync events.');
          modified = true;
        } else {
          console.error('[BaileysPatcher] Target signature for processSyncAction not found in chat-utils.js.');
        }
      }

      // 2. Patch "tried remove, but no previous op" to ignore and return instead of throwing
      const targetThrow = "throw new Boom('tried remove, but no previous op', { data: { indexMac, valueMac } });";
      if (content.includes(targetThrow)) {
        const replacementThrow = "console.warn('[BaileysPatcher] tried remove, but no previous op', { indexMacBase64 });\n                    return;";
        content = content.replace(targetThrow, replacementThrow);
        console.log('[BaileysPatcher] Successfully patched chat-utils.js to bypass tried remove error.');
        modified = true;
      }

      if (modified) {
        fs.writeFileSync(targetPath, content, 'utf8');
      } else {
        console.log('[BaileysPatcher] chat-utils.js is already fully patched.');
      }
    } catch (error) {
      console.error('[BaileysPatcher] Error applying patches to chat-utils.js:', error);
    }
  }
}
