const { parentPort } = require('node:worker_threads');
const { WorkerPluginRuntime } = require('@smartchat/sdk');

if (!parentPort) {
  throw new Error('This plugin must be run inside a Node.js Worker thread.');
}

const manifest = require('./manifest.json');
const runtime = new WorkerPluginRuntime(parentPort, manifest);
const ctx = runtime.getContext();

ctx.onActivate(async () => {
  ctx.log.info('test-all-features plugin activating');
  await ctx.storage?.set('status', 'activated');
});

ctx.onDeactivate(async () => {
  await ctx.storage?.set('status', 'deactivated');
});

ctx.contributions.registerChatAction('test-chat-action', async (actionCtx) => {
  const targetJid = (actionCtx && actionCtx.jid) || 'test@s.whatsapp.net';
  let chatName = targetJid.split('@')[0];
  try {
    const contact = await ctx.contacts?.getByJid(targetJid);
    if (contact && contact.name) {
      chatName = contact.name;
    }
  } catch (e) {}

  const chats = await ctx.chats?.getList(1, 20);
  let messages = [];
  try {
    messages = await ctx.messages?.getMessages(targetJid, 1, 50);
  } catch (e) {}

  const msgList = Array.isArray(messages) ? messages : [];
  const count = msgList.length;
  const lastMsg = count > 0 ? (msgList[count - 1].textContent || msgList[count - 1].messageType || 'media') : 'No messages';
  const snippet = lastMsg.length > 30 ? lastMsg.slice(0, 30) + '...' : lastMsg;

  await ctx.storage?.set('last_chat_action', { targetJid, chatName, count, timestamp: Date.now() });

  const infoText = `${chatName}: ${count} messages. Latest: "${snippet}"`;

  try {
    await ctx.ui?.notify({ title: 'Plugin Chat Inspection', body: infoText });
  } catch (e) {}

  await ctx.ui?.toast(`✨ [Plugin Action] ${infoText}`, 'info');

  return { success: true, chats, messages };
});

ctx.contributions.registerMessageAction('test-message-action', async (actionCtx) => {
  const chatJid = (actionCtx && actionCtx.chatJid) || 'test@s.whatsapp.net';
  const msgId = actionCtx && actionCtx.messageId;
  if (msgId) {
    try {
      await ctx.messages?.react(chatJid, msgId, '✨');
      await ctx.ui?.notify({ title: 'Plugin Message Reaction', body: `Reacted ✨ to message ${msgId.slice(-6)}` });
      await ctx.ui?.toast('✨ [Plugin Action] Reacted ✨ to message', 'success');
    } catch (err) {
      await ctx.ui?.toast(`[Plugin Action] Could not react: ${err.message}`, 'warning');
    }
  } else {
    await ctx.ui?.toast('[Plugin Action] Executed on message', 'info');
  }
  await ctx.storage?.set('last_message_action', 'completed');
  return { success: true };
});

ctx.contributions.registerSlashCommand('test-cmd', async (args, cmdCtx) => {
  const targetJid = cmdCtx && cmdCtx.jid;
  if (targetJid) {
    try {
      await ctx.messages?.send(targetJid, 'test working');
    } catch (err) {
      console.error('[Plugin] Failed to send message:', err);
    }
  }
  try {
    await ctx.ui?.notify({ title: 'Slash Command Executed', body: 'Sent "test working" to chat!' });
  } catch (e) {}
  await ctx.ui?.toast('🚀 [Plugin] Sent "test working" to chat!', 'success');
  return { success: true };
});

ctx.contributions.registerAITool('test_plugin_tool', async (args) => {
  const query = (args && args.query) || 'demo query';
  try {
    await ctx.ui?.notify({ title: 'AI Tool Triggered', body: `Executed test_plugin_tool for query: "${query}"` });
  } catch (e) {}
  await ctx.ui?.toast(`🤖 [AI Tool] Executed test_plugin_tool with query: "${query}"`, 'info');
  return { text: `Tool test_plugin_tool executed successfully for "${query}"` };
});

ctx.contributions.registerChatBadge('test-badge', async (chatJid) => {
  return { label: 'TEST', color: '#00FF00' };
});
