const { parentPort } = require('node:worker_threads');
const { WorkerPluginRuntime } = require('@smartchat/sdk');

if (!parentPort) {
  throw new Error('This plugin must be run inside a Node.js Worker thread.');
}

const manifest = require('./manifest.json');
const runtime = new WorkerPluginRuntime(parentPort, manifest);
const ctx = runtime.getContext();

ctx.onActivate(async () => {
  ctx.log.info('Declarative Modal Test Plugin worker activated');
});

const extractJid = (actionCtx) => {
  if (!actionCtx || typeof actionCtx !== 'object') return undefined;
  const obj = actionCtx;
  const nested = obj.context || {};
  return (
    nested.chatJid ||
    nested.jid ||
    obj.chatJid ||
    obj.jid
  );
};

ctx.contributions.registerChatAction('test-form-action', async (actionCtx) => {
  const targetJid = extractJid(actionCtx);
  ctx.log.info('Executing test-form-action for targetJid:', targetJid);

  const result = await ctx.ui.showForm({
    title: 'Chat Actions Manager',
    fields: [
      {
        id: 'action',
        type: 'select',
        label: 'Select Action to Perform',
        required: true,
        options: [
          { label: 'Pin Chat', value: 'pin' },
          { label: 'Unpin Chat', value: 'unpin' },
          { label: 'Mute Chat', value: 'mute' },
          { label: 'Unmute Chat', value: 'unmute' },
          { label: 'Archive Chat', value: 'archive' },
          { label: 'Mark as Read', value: 'markRead' }
        ],
        defaultValue: 'pin'
      },
      {
        id: 'muteDuration',
        type: 'select',
        label: 'Mute Duration (if Mute selected)',
        options: [
          { label: '8 Hours', value: '28800000' },
          { label: '1 Week', value: '604800000' },
          { label: 'Always', value: '-1' }
        ],
        defaultValue: '28800000'
      },
      {
        id: 'notifyUser',
        type: 'checkbox',
        label: 'Show notification on completion',
        defaultValue: true
      }
    ],
    submitLabel: 'Apply Action',
    cancelLabel: 'Cancel'
  });

  if (!result) {
    ctx.log.info('Form dismissed / cancelled by user');
    if (ctx.ui.toast) {
      ctx.ui.toast('Action cancelled', 'info');
    }
    return;
  }

  const { action, muteDuration, notifyUser } = result;
  ctx.log.info(`Executing action '${action}' on chat ${targetJid}`);

  if (targetJid && ctx.chats) {
    try {
      switch (action) {
        case 'pin':
          await ctx.chats.pin(targetJid);
          break;
        case 'unpin':
          await ctx.chats.unpin(targetJid);
          break;
        case 'mute':
          await ctx.chats.mute(targetJid, Number(muteDuration || 28800000));
          break;
        case 'unmute':
          await ctx.chats.unmute(targetJid);
          break;
        case 'archive':
          await ctx.chats.archive(targetJid);
          break;
        case 'markRead':
          await ctx.chats.markRead(targetJid);
          break;
      }
    } catch (err) {
      ctx.log.error('Failed to execute chat action:', err);
    }
  }

  const statusText = `Executed '${action}' on chat ${targetJid || 'selected chat'}`;
  if (notifyUser && ctx.ui.notify) {
    await ctx.ui.notify({ title: 'Chat Action Executed', body: statusText });
  }
  if (ctx.ui.toast) {
    ctx.ui.toast(`✨ ${statusText}`, 'success');
  }
});

ctx.contributions.registerChatAction('test-confirm-action', async (actionCtx) => {
  const targetJid = extractJid(actionCtx);
  ctx.log.info('Executing test-confirm-action', actionCtx);

  const confirmed = await ctx.ui.showConfirm({
    title: 'Confirm Operation',
    body: `Do you want to proceed with action for chat ${targetJid || 'selected'}?`,
    confirmLabel: 'Proceed',
    cancelLabel: 'Abort'
  });

  if (confirmed) {
    ctx.log.info('User confirmed action');
    if (ctx.ui.toast) {
      ctx.ui.toast('User clicked Confirm (Proceed)', 'success');
    }
  } else {
    ctx.log.info('User cancelled action');
    if (ctx.ui.toast) {
      ctx.ui.toast('User clicked Cancel / Abort', 'warning');
    }
  }
});

ctx.contributions.registerChatAction('test-alert-action', async (actionCtx) => {
  const targetJid = extractJid(actionCtx);
  ctx.log.info('Executing test-alert-action', actionCtx);

  await ctx.ui.showAlert({
    title: 'Chat Information Alert',
    body: `Target chat JID: ${targetJid || 'Unknown'}`,
    label: 'Understood'
  });

  ctx.log.info('Alert modal dismissed by user');
  if (ctx.ui.toast) {
    ctx.ui.toast('Alert dismissed by user', 'info');
  }
});
