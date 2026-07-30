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

ctx.contributions.registerChatAction('test-form-action', async (actionCtx) => {
  ctx.log.info('Executing test-form-action', actionCtx);

  const result = await ctx.ui.showForm({
    title: 'Configure Options',
    fields: [
      { id: 'name', type: 'text', label: 'Name', required: true, defaultValue: 'SmartChat User' },
      { id: 'mode', type: 'select', label: 'Mode', options: [{ label: 'Fast', value: 'fast' }, { label: 'Deep', value: 'deep' }] },
      { id: 'notify', type: 'checkbox', label: 'Enable Notifications', defaultValue: true }
    ],
    submitLabel: 'Save Options'
  });

  if (result) {
    ctx.log.info('Form submitted:', result);
    if (ctx.ui.notify) {
      await ctx.ui.notify({ title: 'Form Saved', body: `Saved name: ${result.name}` });
    }
    if (ctx.ui.toast) {
      ctx.ui.toast(`Form submitted! Name: ${result.name}`, 'success');
    }
  } else {
    ctx.log.info('Form dismissed / cancelled');
    if (ctx.ui.toast) {
      ctx.ui.toast('Form dismissed by user', 'info');
    }
  }
});

ctx.contributions.registerChatAction('test-confirm-action', async (actionCtx) => {
  ctx.log.info('Executing test-confirm-action', actionCtx);

  const confirmed = await ctx.ui.showConfirm({
    title: 'Confirm Operation',
    body: 'Do you want to proceed with this operation?',
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
  ctx.log.info('Executing test-alert-action', actionCtx);

  await ctx.ui.showAlert({
    title: 'System Notification',
    body: 'This is an alert modal rendered by SmartChat microkernel Tier 1 API.',
    label: 'Understood'
  });

  ctx.log.info('Alert modal dismissed by user');
  if (ctx.ui.toast) {
    ctx.ui.toast('Alert dismissed by user', 'info');
  }
});
