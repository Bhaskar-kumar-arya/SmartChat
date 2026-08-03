const path = require('path')
const fs = require('fs')
const AdmZip = require('adm-zip')

const pluginDir = path.join(__dirname, '../plugins/codetantra-otp-relay-plugin')
const outPath = path.join(__dirname, '../plugins/codetantra-otp-relay.scext')
const sdkSourceDir = path.join(__dirname, '../packages/sdk')
const sdkTargetDir = path.join(pluginDir, 'node_modules/@smartchat/sdk')

console.log('[Package Plugin] Packaging codetantra-otp-relay-plugin...')

try {
  if (fs.existsSync(path.join(sdkSourceDir, 'dist')) && fs.existsSync(path.join(sdkSourceDir, 'package.json'))) {
    fs.mkdirSync(sdkTargetDir, { recursive: true })
    fs.cpSync(path.join(sdkSourceDir, 'dist'), path.join(sdkTargetDir, 'dist'), { recursive: true })
    fs.copyFileSync(path.join(sdkSourceDir, 'package.json'), path.join(sdkTargetDir, 'package.json'))
  }

  const zip = new AdmZip()
  zip.addLocalFolder(pluginDir)
  zip.writeZip(outPath)
  console.log(`[Package Plugin] Successfully created package: ${outPath}`)
} catch (err) {
  console.error('[Package Plugin] Failed to package plugin:', err)
  process.exit(1)
}
