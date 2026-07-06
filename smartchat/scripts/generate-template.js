const { execSync } = require('child_process');
const { join } = require('path');
const { copyFileSync, existsSync, unlinkSync } = require('fs');

const tempDbPath = join(__dirname, '../temp_template.db');
const targetDbPath = join(__dirname, '../resources/template.db');

try {
  console.log('[Generate Template] Generating clean database template matching the current Prisma schema...');

  // 1. Clean up any leftover temp database files
  const filesToDelete = [tempDbPath, `${tempDbPath}-journal`, `${tempDbPath}-wal`, `${tempDbPath}-shm`];
  filesToDelete.forEach(file => {
    if (existsSync(file)) {
      try {
        unlinkSync(file);
      } catch (err) {
        // Ignore
      }
    }
  });

  // 2. Run prisma db push with custom DATABASE_URL pointing to the absolute path of temp sqlite file
  console.log('[Generate Template] Pushing schema to temp database...');
  execSync('npx prisma db push --accept-data-loss', {
    env: {
      ...process.env,
      DATABASE_URL: `file:${tempDbPath}`
    },
    stdio: 'inherit'
  });

  // 3. Copy the temp database to the target template.db path
  console.log(`[Generate Template] Copying temp database to ${targetDbPath}...`);
  copyFileSync(tempDbPath, targetDbPath);

  // 4. Clean up temp files
  filesToDelete.forEach(file => {
    if (existsSync(file)) {
      try {
        unlinkSync(file);
      } catch (err) {
        // Ignore
      }
    }
  });

  console.log('[Generate Template] Clean database template successfully generated!');
} catch (error) {
  console.error('[Generate Template] Failed to generate database template:', error);
  process.exit(1);
}
