const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const botDir = path.join(__dirname, '../src/main/tests/extensions/fixtures/voice-transcriber-bot');
const outputPath = path.join(__dirname, '../src/main/tests/extensions/fixtures/voice-transcriber-bot.scext');

console.log('[Package Bot] Packaging voice-transcriber-bot...');

// Programmatic patch for Windows PDF.js CMap URL trailing slash bug in pdf-to-png-converter
const patchPath = path.join(botDir, 'node_modules/pdf-to-png-converter/out/normalizePath.js');
if (fs.existsSync(patchPath)) {
  let content = fs.readFileSync(patchPath, 'utf8');
  if (!content.includes('replace(/\\\\/g')) {
    console.log('[Package Bot] Applying Windows path trailing slash patch...');
    content = content.replace(
      `const resolvedPath = (0, node_path_1.normalize)((0, node_path_1.resolve)(path));\n    if (resolvedPath.endsWith('/') || resolvedPath.endsWith(node_path_1.sep)) {\n        return resolvedPath;\n    }\n    return \`\${resolvedPath}\${node_path_1.sep}\`;`,
      `let resolvedPath = (0, node_path_1.normalize)((0, node_path_1.resolve)(path));\n    resolvedPath = resolvedPath.replace(/\\\\/g, '/');\n    if (resolvedPath.endsWith('/')) {\n        return resolvedPath;\n    }\n    return \`\${resolvedPath}/\`;`
    );
    fs.writeFileSync(patchPath, content);
  }
}

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
