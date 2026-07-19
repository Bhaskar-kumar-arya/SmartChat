module.exports = {
  activate: async (ctx) => {
    ctx.log.info('Hello Bot activated!')

    // Register a message handler via events bridge
    ctx.events.on('extension:chat-message', async (msg) => {
      ctx.log.info('Received message:', msg.text)

      if (msg.text === '/hello') {
        await ctx.dedicatedChat.send({
          type: 'text',
          text: 'Hello from the extension bot! 🚀'
        })
      } else if (msg.text === '/card') {
        await ctx.dedicatedChat.send({
          type: 'card',
          title: 'Interactive Card',
          body: 'This is a rich card sent by the extension via the new Phase 09 renderer.',
          buttons: [
            { id: 'btn_yes', label: 'Yes' },
            { id: 'btn_no', label: 'No' }
          ]
        })
      } else if (msg.text.startsWith('__button:')) {
        const btn = msg.text.replace('__button:', '')
        await ctx.dedicatedChat.send({
          type: 'text',
          text: `You clicked button: ${btn}`
        })
      } else {
        await ctx.dedicatedChat.send({
          type: 'text',
          text: `You said: "${msg.text}". Try typing /hello or /card.`
        })
      }
    })
  },
  deactivate: async () => {
    console.log('Hello Bot deactivated!')
  }
}
