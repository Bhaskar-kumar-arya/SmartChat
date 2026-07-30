const path = require('path')
const { packagePlugin } = require('../packages/sdk/dist/cli/package')

const pluginDir = path.join(__dirname, '../plugins/declarative-modal-test-plugin')
const outPath = path.join(__dirname, '../plugins/declarative-modal-test.scext')

console.log('[Package Plugin] Packaging declarative-modal-test plugin using @smartchat/sdk CLI tool...')

packagePlugin({ pluginDir, outPath })
  .then((createdPath) => {
    console.log(`[Package Plugin] Successfully created package: ${createdPath}`)
  })
  .catch((err) => {
    console.error('[Package Plugin] Failed to package plugin:', err)
    process.exit(1)
  })
