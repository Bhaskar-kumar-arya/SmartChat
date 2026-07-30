const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const pluginDir = path.join(__dirname, '../plugins/voice-transcriber-plugin');
const outputPath = path.join(__dirname, '../plugins/voice-transcriber.scext');

console.log('[Package Plugin] Packaging voice-transcriber plugin...');

try {
  if (!fs.existsSync(pluginDir)) {
    throw new Error(`Plugin directory not found: ${pluginDir}`);
  }

  const zip = new AdmZip();

  const manifestPath = path.join(pluginDir, 'manifest.json');
  const indexPath = path.join(pluginDir, 'index.js');

  if (!fs.existsSync(manifestPath)) {
    throw new Error(`manifest.json not found at ${manifestPath}`);
  }
  if (!fs.existsSync(indexPath)) {
    throw new Error(`index.js not found at ${indexPath}`);
  }

  zip.addFile('manifest.json', fs.readFileSync(manifestPath));
  zip.addFile('index.js', fs.readFileSync(indexPath));

  const pkgPath = path.join(pluginDir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    zip.addFile('package.json', fs.readFileSync(pkgPath));
  }

  const nodeModulesPath = path.join(pluginDir, 'node_modules');
  if (fs.existsSync(nodeModulesPath)) {
    zip.addLocalFolder(nodeModulesPath, 'node_modules');
  }

  zip.writeZip(outputPath);
  console.log(`[Package Plugin] Successfully created package: ${outputPath}`);
} catch (error) {
  console.error('[Package Plugin] Failed to package plugin:', error);
  process.exit(1);
}
