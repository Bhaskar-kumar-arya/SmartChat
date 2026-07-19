module.exports = {
  activate: async (ctx) => {
    ctx.log.info('Omni Bot Activated! This extension uses all capabilities.');

    // 1. Storage API
    let activationCount = await ctx.storage.get('activation_count') || 0;
    activationCount++;
    await ctx.storage.set('activation_count', activationCount);
    ctx.log.info(`Omni Bot activated ${activationCount} times.`);

    // 2. Scheduler API - onCron defined in manifest
    ctx.scheduler.onCron('omni-heartbeat', () => {
      ctx.log.info('Omni Bot heartbeat (cron job triggered).');
    });

    // 3. Tools API - Register a custom tool
    if (ctx.tools) {
      try {
        ctx.tools.register({
          name: 'omni_greet',
          description: 'A custom tool provided by Omni Bot to greet someone.',
          schema: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Name of the person to greet' }
            },
            required: ['name']
          },
          execute: async (args) => {
            return { text: `Omni Bot says: Hello, ${args.name}! Welcome to SmartChat.` };
          }
        });
        ctx.log.info('Omni Bot registered custom tool "omni_greet".');
      } catch (err) {
        ctx.log.error('Failed to register tool:', err);
      }
    }

    // 4. Events API - Listen for WhatsApp events (if permitted, though we don't need a specific one for this demo, just let's log any incoming text message event)
    if (ctx.events) {
      ctx.events.on('message:incoming', async (payload) => {
        ctx.log.info(`[Events API] Message incoming intercepted by OmniBot. From: ${payload.senderJid}`);
        if (!payload.fromMe && payload.textContent) {
          const senderName = payload.enriched?.participantName || payload.senderJid.split('@')[0];
          await ctx.dedicatedChat.send({
            type: 'text',
            text: `📩 **New message from ${senderName}**:\n"${payload.textContent}"`
          });
        }
      });
      
      // The dedicated chat messages are received through 'extension:chat-message' 
      ctx.events.on('extension:chat-message', async (msg) => {
        const text = (msg.text || '').trim();
        ctx.log.info(`[DedicatedChat] Received message: ${text}`);

        try {
          if (text === '/ping') {
            await ctx.dedicatedChat.send({ type: 'text', text: 'Pong! 🏓 Omni Bot is fully operational.' });

          } else if (text === '/test-tools') {
            if (!ctx.tools) throw new Error("Tools API not available");
            const toolsList = ctx.tools.list();
            await ctx.dedicatedChat.send({
              type: 'text',
              text: `🛠️ Tools API is available. Found ${toolsList.length} tools. Tools: ${toolsList.join(', ')}`
            });

          } else if (text === '/test-contacts') {
            if (!ctx.contacts) throw new Error("Contacts API not available");
            const selfJid = await ctx.contacts.getSelfJid();
            await ctx.dedicatedChat.send({
              type: 'text',
              text: `👤 Contacts API is available. Your self JID is: ${selfJid}`
            });

          } else if (text === '/test-chats') {
            if (!ctx.chats) throw new Error("Chats API not available");
            const chats = await ctx.chats.list(5);
            await ctx.dedicatedChat.send({
              type: 'text',
              text: `💬 Chats API is available. You have ${chats.length} recent chats (showing up to 5).`
            });

          } else if (text === '/test-ui') {
            if (!ctx.ui) throw new Error("UI API not available");
            ctx.ui.toast('UI API test successful! 🍞', 'success');
            await ctx.ui.notify({
              title: 'Omni Bot',
              body: 'Native OS Notification works too!'
            });
            await ctx.dedicatedChat.send({ type: 'text', text: '🖥️ UI API tested (Toast and Notification triggered).' });

          } else if (text === '/test-storage') {
            const count = await ctx.storage.get('activation_count');
            await ctx.dedicatedChat.send({
              type: 'text',
              text: `💾 Storage API is available. This extension has been activated ${count} times.`
            });

          } else if (text === '/test-scheduler') {
            await ctx.dedicatedChat.send({ type: 'text', text: '⏳ Scheduler API test: I will message you back in 2 seconds...' });
            ctx.scheduler.setTimeout(2000, async () => {
              await ctx.dedicatedChat.send({ type: 'text', text: '⏰ Beep! 2 seconds passed.' });
            });
          } else {
            await ctx.dedicatedChat.send({
              type: 'text',
              text: `Unrecognized command: "${text}". Try typing / to see available commands from Omni Bot.`
            });
          }
        } catch (error) {
          ctx.log.error(`Error processing command ${text}:`, error);
          await ctx.dedicatedChat.send({
            type: 'text',
            text: `❌ Error testing capability: ${error.message}`
          });
        }
      });
    }
  },

  deactivate: async (ctx) => {
    console.log('Omni Bot Deactivated! Cleaning up...');
  }
};
