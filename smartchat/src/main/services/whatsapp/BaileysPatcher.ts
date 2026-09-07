import fs from 'fs';
import path from 'path';
import { app } from 'electron';

export class BaileysPatcher {
  public static patch(): void {
    // Genuine patch failures (target file present but an expected signature is
    // missing, or a target file could not be located at all). A dependency bump
    // that reformats Baileys' compiled output silently drops the matching patch
    // — the failure modes are severe and non-obvious (app-state sync aborts,
    // messageContextInfo lost, profile-picture token regresses). Make that a
    // hard error in dev so a version bump can't ship silently broken; in a
    // packaged build `node_modules` is inside the (read-only) asar so writes are
    // expected to throw — stay best-effort there.
    const failures: string[] = [];
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
        failures.push('Could not locate chat-utils.js to apply patches.');
        BaileysPatcher.reportFailures(failures);
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
          failures.push('Target signature for processSyncAction not found in chat-utils.js.');
        }
      }

      // 2. Patch "tried remove, but no previous op" to ignore and return instead of throwing
      const targetThrow = "throw new Boom('tried remove, but no previous op', { data: { indexMac, valueMac } });";
      if (content.includes(targetThrow)) {
        const replacementThrow = "console.warn('[BaileysPatcher] tried remove, but no previous op', { indexMacBase64 });\n                    return;";
        content = content.replace(targetThrow, replacementThrow);
        console.log('[BaileysPatcher] Successfully patched chat-utils.js to bypass tried remove error.');
        modified = true;
      } else if (!content.includes("[BaileysPatcher] tried remove, but no previous op")) {
        failures.push('Target throw "tried remove, but no previous op" not found in chat-utils.js.');
      }

      if (modified) {
        fs.writeFileSync(targetPath, content, 'utf8');
      } else {
        console.log('[BaileysPatcher] chat-utils.js is already fully patched.');
      }

      // 3. Patch decode-wa-message.js to preserve messageContextInfo for deviceSentMessage
      const possibleDecodeMessagePaths = [
        path.join(process.cwd(), 'node_modules', '@whiskeysockets', 'baileys', 'lib', 'Utils', 'decode-wa-message.js'),
        path.join(__dirname, '..', '..', '..', 'node_modules', '@whiskeysockets', 'baileys', 'lib', 'Utils', 'decode-wa-message.js')
      ];

      let targetDecodePath: string | null = null;
      for (const p of possibleDecodeMessagePaths) {
        if (fs.existsSync(p)) {
          targetDecodePath = p;
          break;
        }
      }

      if (targetDecodePath) {
        let decodeContent = fs.readFileSync(targetDecodePath, 'utf8');
        let decodeModified = false;

        const regex = /(\s*)let msg = proto\.Message\.decode\(e2eType !== 'plaintext' \? unpadRandomMax16\(msgBuffer\) : msgBuffer\);\r?\n\s*msg = msg\.deviceSentMessage\?\.message \|\| msg;/;
        if (regex.test(decodeContent) && !decodeContent.includes('const messageContextInfo = msg.messageContextInfo;')) {
          const replacement = `$1let msg = proto.Message.decode(e2eType !== 'plaintext' ? unpadRandomMax16(msgBuffer) : msgBuffer);
$1const messageContextInfo = msg.messageContextInfo;
$1msg = msg.deviceSentMessage?.message || msg;
$1if (messageContextInfo) {
$1    msg.messageContextInfo = messageContextInfo;
$1}`;
          decodeContent = decodeContent.replace(regex, replacement);
          console.log('[BaileysPatcher] Successfully patched decode-wa-message.js to preserve messageContextInfo.');
          decodeModified = true;
        }

        if (decodeModified) {
          fs.writeFileSync(targetDecodePath, decodeContent, 'utf8');
        } else if (!decodeContent.includes('const messageContextInfo = msg.messageContextInfo;')) {
          failures.push('Expected decode-wa-message.js signature (deviceSentMessage decode) not found.');
        } else {
          console.log('[BaileysPatcher] decode-wa-message.js is already fully patched.');
        }
      } else {
        failures.push('Could not locate decode-wa-message.js to apply patches.');
      }

      // 4. Patch chats.js to fix profile picture token structure
      const possibleChatsPaths = [
        path.join(process.cwd(), 'node_modules', '@whiskeysockets', 'baileys', 'lib', 'Socket', 'chats.js'),
        path.join(__dirname, '..', '..', '..', 'node_modules', '@whiskeysockets', 'baileys', 'lib', 'Socket', 'chats.js')
      ];

      let targetChatsPath: string | null = null;
      for (const p of possibleChatsPaths) {
        if (fs.existsSync(p)) {
          targetChatsPath = p;
          break;
        }
      }

      if (targetChatsPath) {
        let chatsContent = fs.readFileSync(targetChatsPath, 'utf8');
        let chatsModified = false;

        const regex = /const profilePictureUrl = async \(jid, type = 'preview', timeoutMs\) => \{[\s\S]*?const child = getBinaryNodeChild\(result, 'picture'\);\r?\n\s*return child\?\.attrs\?\.url;\r?\n\s*\};/;
        if (regex.test(chatsContent) && !chatsContent.includes('// NEST the tctoken here as a child')) {
          const replacement = `const profilePictureUrl = async (jid, type = 'preview', timeoutMs) => {
        jid = jidNormalizedUser(jid);
        const storageJid = isLidUser(jid) ? jid : (await getLIDForPN(jid)) || jid;
        const tcTokenData = await authState.keys.get('tctoken', [storageJid]);
        const tokenEntry = tcTokenData?.[storageJid];

        const result = await query({
            tag: 'iq',
            attrs: {
                to: S_WHATSAPP_NET,
                type: 'get',
                xmlns: 'w:profile:picture',
                target: jid,
            },
            content: [
                {
                    tag: 'picture',
                    attrs: { 
                        type, 
                        query: 'url'
                    },
                    // NEST the tctoken here as a child, NOT as a sibling node
                    content: tokenEntry ? [
                        {
                            tag: 'tctoken',
                            attrs: {
                                // The server requires the timestamp attribute to validate the token lifecycle
                                t: tokenEntry.timestamp.toString() 
                            },
                            content: tokenEntry.token // The raw binary buffer/string token
                        }
                    ] : undefined
                }
            ]
        }, timeoutMs);
        const child = getBinaryNodeChild(result, 'picture');
        return child?.attrs?.url;
    };`;
          chatsContent = chatsContent.replace(regex, replacement);
          console.log('[BaileysPatcher] Successfully patched chats.js for profile picture URL logic.');
          chatsModified = true;
        }

        if (chatsModified) {
          fs.writeFileSync(targetChatsPath, chatsContent, 'utf8');
        } else if (!chatsContent.includes('// NEST the tctoken here as a child')) {
          failures.push('Expected chats.js signature (profilePictureUrl) not found.');
        } else {
          console.log('[BaileysPatcher] chats.js is already fully patched.');
        }
      } else {
        failures.push('Could not locate chats.js to apply patches.');
      }

    } catch (error) {
      // In a packaged build the asar is read-only, so writeFileSync throws — that
      // is an expected, best-effort miss, not a dev-time signature drift.
      if (BaileysPatcher.isPackaged()) {
        console.error('[BaileysPatcher] Error applying patches (packaged, expected on read-only asar):', error);
        return;
      }
      failures.push(`Error applying patches: ${error instanceof Error ? error.message : String(error)}`);
    }

    BaileysPatcher.reportFailures(failures);
  }

  private static isPackaged(): boolean {
    try {
      return app.isPackaged;
    } catch {
      return false;
    }
  }

  private static reportFailures(failures: string[]): void {
    if (failures.length === 0) return;
    const msg = `[BaileysPatcher] ${failures.length} patch(es) failed to apply:\n  - ${failures.join('\n  - ')}`;
    if (BaileysPatcher.isPackaged()) {
      console.error(msg);
      return;
    }
    // Dev: fail loudly so a Baileys version bump can't ship silently broken.
    throw new Error(msg);
  }
}
