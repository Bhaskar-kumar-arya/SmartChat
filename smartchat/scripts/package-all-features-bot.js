const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const botDir = path.join(__dirname, '../src/main/tests/extensions/fixtures/all-features-bot');
const outputPath = path.join(__dirname, '../src/main/tests/extensions/fixtures/all-features-bot.scext');

console.log('[Package Bot] Packaging all-features-bot...');

try {
  const zip = new AdmZip();
  
  // Read manifest.json and index.js
  const manifest = fs.readFileSync(path.join(botDir, 'manifest.json'));
  const index = fs.readFileSync(path.join(botDir, 'index.js'));
  
  zip.addFile('manifest.json', manifest);
  zip.addFile('index.js', index);

  // Add package.json if it exists
  const pkgPath = path.join(botDir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    zip.addFile('package.json', fs.readFileSync(pkgPath));
  }
  
  // Add node_modules if it exists
  const nodeModulesPath = path.join(botDir, 'node_modules');
  if (fs.existsSync(nodeModulesPath)) {
    zip.addLocalFolder(nodeModulesPath, 'node_modules');
  }
  
  zip.writeZip(outputPath);
  console.log(`[Package Bot] Successfully created: ${outputPath}`);
} catch (error) {
  console.error('[Package Bot] Failed to package bot:', error);
  process.exit(1);
}
