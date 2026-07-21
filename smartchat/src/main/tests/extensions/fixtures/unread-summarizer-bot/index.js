module.exports = async function(ctx) {
  ctx.log.info('Unread Messages Summarizer Bot: Activating...', { version: ctx.manifest.version });

  const unsubs = [];

  // Register onActivate hook
  ctx.onActivate(async () => {
    ctx.log.info('Unread Messages Summarizer Bot: Activated!');
    
    // Dedicated Chat greeting
    if (ctx.dedicatedChat) {
      try {
        await ctx.dedicatedChat.send({
          type: 'card',
          title: '📝 Unread Messages Summarizer',
          body: 'Hi! I can help you stay on top of your notifications. I use an LLM to summarize all unread WhatsApp messages across your chats.\n\nUse these commands or buttons to control me:\n• **/summarize** or click button below to generate summaries.\n• **/clear** to mark all unread chats as read.',
          buttons: [
            { id: 'summarize', label: 'Summarize Unread' }
          ]
        });
      } catch (err) {
        ctx.log.error('Failed to send dedicated chat greeting', err.message);
      }
    }
  });

  // Register onDeactivate hook
  ctx.onDeactivate(async () => {
    ctx.log.info('Unread Messages Summarizer Bot: Deactivating...');
    for (const unsub of unsubs) {
      try {
        unsub();
      } catch (err) {
        ctx.log.error('Error during event unsub', err.message);
      }
    }
    ctx.log.info('Unread Messages Summarizer Bot: Deactivated successfully');
  });

  // Listen for Dedicated Chat messages
  if (ctx.events) {
    try {
      const unsub = ctx.events.on('extension:chat-message', async (payload) => {
        let cmdText = (payload.text || '').trim();
        ctx.log.info(`Received dedicated chat message: "${cmdText}"`);

        // Handle buttons prefixing message with "__button:"
        if (cmdText.startsWith('__button:')) {
          const buttonId = cmdText.substring('__button:'.length);
          if (buttonId === 'summarize') {
            await handleSummarize();
          } else if (buttonId === 'mark_all_read') {
            await handleMarkAllRead();
          } else if (buttonId.startsWith('mark_read:')) {
            const jid = buttonId.substring('mark_read:'.length);
            await handleMarkRead(jid);
          } else {
            await reply(`Unknown button action: ${buttonId}`);
          }
          return;
        }

        // Handle direct text inputs/commands
        if (cmdText === '/summarize') {
          await handleSummarize();
        } else if (cmdText === '/clear') {
          await handleMarkAllRead();
        } else {
          // Default to summarizing if they message the bot
          await handleSummarize();
        }
      });
      unsubs.push(unsub);
    } catch (err) {
      ctx.log.error('Failed to register extension:chat-message listener', err.message);
    }
  }

  // --- Helper to reply in dedicated chat ---
  async function reply(text, cardOpts = null) {
    if (!ctx.dedicatedChat) {
      ctx.log.info('Dedicated chat not available to reply:', text);
      return;
    }
    try {
      if (cardOpts) {
        await ctx.dedicatedChat.send({
          type: 'card',
          title: cardOpts.title || 'Summary',
          body: text,
          buttons: cardOpts.buttons
        });
      } else {
        await ctx.dedicatedChat.send({
          type: 'text',
          text: text
        });
      }
    } catch (err) {
      ctx.log.error('Failed to send reply to dedicated chat', err.message);
    }
  }

  // --- /summarize Handler ---
  async function handleSummarize() {
    if (!ctx.tools || !ctx.llm) {
      await reply('❌ Required capabilities (tools, llm) are not available.');
      return;
    }

    try {
      await reply('⏳ Fetching unread messages and preparing summary...');

      // 1. Get unread chats
      const chatsResult = await ctx.tools.call('queryDatabase', {
        sql: `
          SELECT c.jid,
                 COALESCE(c.name, i.displayName, i.pushName, i.verifiedName, i.phoneNumber, c.jid) as chatName,
                 c.unreadCount
          FROM Chat c
          LEFT JOIN IdentityAlias ia ON c.jid = ia.jid
          LEFT JOIN Identity i ON ia.identityId = i.id
          WHERE c.unreadCount > 0 AND c.isArchived = 0
        `,
        explanation: 'Check for chats with unread messages'
      });

      const unreadChats = JSON.parse(chatsResult.text).rows || [];
      if (unreadChats.length === 0) {
        await reply('🎉 You have no unread messages!');
        return;
      }

      // 2. Fetch formatted transcripts of unread messages using readMessages
      const transcriptResult = await ctx.tools.call('readMessages', {
        sql: `
          WITH RankedMessages AS (
            SELECT m.id, m.chatJid,
                   ROW_NUMBER() OVER (PARTITION BY m.chatJid ORDER BY m.timestamp DESC) as rn
            FROM Message m
            JOIN Chat c ON m.chatJid = c.jid
            WHERE c.unreadCount > 0 AND c.isArchived = 0
          )
          SELECT rm.id
          FROM RankedMessages rm
          JOIN Chat c ON rm.chatJid = c.jid
          WHERE rm.rn <= c.unreadCount
        `,
        groupByChat: true
      });

      const formattedTranscripts = sanitizeText(transcriptResult.text || '');
      if (!formattedTranscripts || formattedTranscripts.includes('No messages found')) {
        await reply('🎉 You have no unread messages!');
        return;
      }

      // 3. Generate summary using ctx.llm.chat
      const prompt = `
You are the WhatsApp Unread Messages Summarizer Bot.
Below is the history of unread messages from your chats, formatted and grouped by chat.

Please read through all these messages and generate a beautiful, concise summary of the unread messages.
Organize your response clearly:
- Use emojis and clean markdown formatting.
- Provide a summary for each chat highlighting who sent what and the key context/intent.
- Call out any questions, urgent requests, or action items specifically.

Unread Messages:
${formattedTranscripts}
`;

      const summary = await ctx.llm.chat(prompt);

      // 4. Build action buttons (Max 3 buttons)
      const buttons = [];
      buttons.push({ id: 'mark_all_read', label: '✓ Mark All Read' });

      // Add individual mark read buttons for up to 2 chats
      unreadChats.slice(0, 2).forEach(chat => {
        buttons.push({
          id: `mark_read:${chat.jid}`,
          label: `✓ Read: ${chat.chatName.substring(0, 15)}`
        });
      });

      await reply(summary, {
        title: `📝 Unread Summary (${unreadChats.length} Chats)`,
        buttons
      });

    } catch (err) {
      ctx.log.error('Summary generation failed:', err.message);
      await reply(`❌ Failed to summarize unread messages: ${err.message}`);
    }
  }

  // --- Mark single chat read ---
  async function handleMarkRead(jid) {
    if (!ctx.tools) return;
    try {
      const resText = await ctx.tools.call('chatAction', {
        action: 'mark_read',
        jid: jid
      });
      
      const res = JSON.parse(resText.text);
      if (res && res.success) {
        if (ctx.ui) {
          ctx.ui.toast('Chat marked as read!', 'success');
        }
        
        // Find chat name from DB for notification
        const nameRes = await ctx.tools.call('queryDatabase', {
          sql: `
            SELECT COALESCE(c.name, i.displayName, i.pushName, i.verifiedName, i.phoneNumber, c.jid) as chatName
            FROM Chat c
            LEFT JOIN IdentityAlias ia ON c.jid = ia.jid
            LEFT JOIN Identity i ON ia.identityId = i.id
            WHERE c.jid = ?
          `,
          params: [jid],
          explanation: 'Get chat name to confirm read action'
        });
        const rows = JSON.parse(nameRes.text).rows || [];
        const chatName = rows[0]?.chatName || jid;

        await reply(`✓ Marked **${chatName}** as read.`);
      } else {
        throw new Error(res.detail || 'Unknown error');
      }
    } catch (err) {
      ctx.log.error(`Failed to mark chat ${jid} as read:`, err.message);
      if (ctx.ui) {
        ctx.ui.toast(`Error: ${err.message}`, 'error');
      }
    }
  }

  // --- Mark all chats read ---
  async function handleMarkAllRead() {
    if (!ctx.tools) return;
    try {
      const chatsResult = await ctx.tools.call('queryDatabase', {
        sql: 'SELECT jid FROM Chat WHERE unreadCount > 0 AND isArchived = 0',
        explanation: 'Get all unread chats to mark read'
      });
      const unreadChats = JSON.parse(chatsResult.text).rows || [];
      if (unreadChats.length === 0) {
        await reply('No unread chats to mark as read.');
        return;
      }

      await reply(`Marking ${unreadChats.length} chats as read...`);
      let successCount = 0;

      for (const chat of unreadChats) {
        try {
          const resText = await ctx.tools.call('chatAction', {
            action: 'mark_read',
            jid: chat.jid
          });
          const res = JSON.parse(resText.text);
          if (res && res.success) {
            successCount++;
          }
        } catch (e) {
          ctx.log.error(`Failed to mark chat ${chat.jid} read:`, e.message);
        }
      }

      if (ctx.ui) {
        ctx.ui.toast(`Marked ${successCount} chats as read!`, 'success');
      }
      await reply(`✓ Marked **${successCount}** chats as read.`);

    } catch (err) {
      ctx.log.error('Failed to mark all chats as read:', err.message);
      if (ctx.ui) {
        ctx.ui.toast(`Error: ${err.message}`, 'error');
      }
    }
  }
};

function sanitizeText(str) {
  if (!str) return '';
  let sanitized = str.replace(/\\/g, '/');
  if (typeof sanitized.toWellFormed === 'function') {
    sanitized = sanitized.toWellFormed();
  } else {
    sanitized = sanitized.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|([^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/g, '$1\uFFFD');
  }
  return sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}
