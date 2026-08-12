const path = require('path')
const fs = require('fs')
const AdmZip = require('adm-zip')

const pluginDir = path.join(__dirname, '../plugins/codetantra-otp-relay-plugin')
const outPath = path.join(__dirname, '../plugins/codetantra-otp-relay.scext')
const sdkSourceDir = path.join(__dirname, '../packages/sdk')
const sdkTargetDir = path.join(pluginDir, 'node_modules/@smartchat/sdk')

const appDataDir = process.env.APPDATA || ''
const installedExtDir = appDataDir ? path.join(appDataDir, 'smartchat', 'extensions', 'com.smartchat.codetantra-otp-relay') : null

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

  if (installedExtDir && fs.existsSync(installedExtDir)) {
    fs.cpSync(pluginDir, installedExtDir, { recursive: true })
    console.log(`[Package Plugin] Synced updated files to installed directory: ${installedExtDir}`)
  }
} catch (err) {
  console.error('[Package Plugin] Failed to package plugin:', err)
  process.exit(1)
}
