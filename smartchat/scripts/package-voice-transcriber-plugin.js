const path = require('path');
const { packagePlugin } = require('../packages/sdk/dist/cli/package');

const pluginDir = path.join(__dirname, '../plugins/voice-transcriber-plugin');
const outPath = path.join(__dirname, '../plugins/voice-transcriber.scext');

console.log('[Package Plugin] Packaging voice-transcriber plugin using @smartchat/sdk CLI tool...');

packagePlugin({ pluginDir, outPath })
  .then((createdPath) => {
    console.log(`[Package Plugin] Successfully created package: ${createdPath}`);
  })
  .catch((err) => {
    console.error('[Package Plugin] Failed to package plugin:', err);
    process.exit(1);
  });
