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
        } else {
          console.log('[BaileysPatcher] decode-wa-message.js is already fully patched.');
        }
      } else {
        console.warn('[BaileysPatcher] Could not locate decode-wa-message.js to apply patches.');
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
        } else {
          console.log('[BaileysPatcher] chats.js is already fully patched.');
        }
      } else {
        console.warn('[BaileysPatcher] Could not locate chats.js to apply patches.');
      }

    } catch (error) {
      console.error('[BaileysPatcher] Error applying patches:', error);
    }
  }
}
