module.exports = {
  activate: async (ctx) => {
    ctx.log.info('Comprehensive Bot Activated! Initializing tests...')

    // 1. Storage Test (Initialize Counter)
    let count = await ctx.storage.get('msg_counter') || 0;
    ctx.log.info(`Current storage counter: ${count}`)

    // 2. Chat Handler
    ctx.events.on('extension:chat-message', async (msg) => {
      ctx.log.info('Received command:', msg.text)

      // Increment persistent counter
      count++;
      await ctx.storage.set('msg_counter', count);

      if (msg.text === '/ping') {
        await ctx.dedicatedChat.send({
          type: 'text',
          text: 'Pong! 🏓 The IPC bridge is fully operational.'
        })

      } else if (msg.text === '/card') {
        await ctx.dedicatedChat.send({
          type: 'card',
          title: 'Extension System Test',
          body: 'This card demonstrates rich UI components rendered seamlessly inside SmartChat via the extension backend.',
          buttons: [
            { id: 'btn_success', label: '✅ Success' },
            { id: 'btn_fail', label: '❌ Fail' }
          ]
        })

      } else if (msg.text === '/toast') {
        ctx.ui.toast('Hello from the Comprehensive Bot! 🍞', 'success')
        await ctx.dedicatedChat.send({ type: 'text', text: 'Sent a toast!' })

      } else if (msg.text === '/notify') {
        await ctx.ui.notify({
          title: 'Comprehensive Bot',
          body: 'This is a native OS notification triggered by the extension!'
        })
        await ctx.dedicatedChat.send({ type: 'text', text: 'Sent an OS notification!' })

      } else if (msg.text === '/counter') {
        await ctx.dedicatedChat.send({
          type: 'text',
          text: `You have sent ${count} messages to this bot. This state is preserved in SQLite!`
        })

      } else if (msg.text === '/timer') {
        await ctx.dedicatedChat.send({ type: 'text', text: 'Timer started. I will message you in 3 seconds.' })
        
        // 3. Scheduler Test
        ctx.scheduler.setTimeout(3000, async () => {
          await ctx.dedicatedChat.send({
            type: 'text',
            text: '⏰ Beep! 3 seconds have passed. Scheduler works!'
          })
          // Also bring the chat to focus if the user navigated away!
          ctx.dedicatedChat.focus()
        })

      } else if (msg.text.startsWith('__button:')) {
        const btn = msg.text.replace('__button:', '')
        const mood = btn === 'btn_success' ? 'glad it worked!' : 'sorry to hear that.'
        await ctx.dedicatedChat.send({
          type: 'text',
          text: `You clicked ${btn}. I'm ${mood}`
        })

      } else {
        await ctx.dedicatedChat.send({
          type: 'text',
          text: `Unrecognized input: "${msg.text}". Try typing / to see available commands.`
        })
      }
    })

    // 4. Background Job Test
    ctx.scheduler.setInterval(15000, () => {
      ctx.log.info('[Background Task] 15 seconds passed...')
    })
  },
  deactivate: async (ctx) => {
    // Note: ctx.log might not be fully available during deactivate depending on host setup, but we'll try!
    console.log('Comprehensive Bot Deactivated! Cleaning up...')
  }
}
