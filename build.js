const { execSync } = require('child_process');
const fs = require('fs');

console.log('🔨 Building Ram360 Attendance Sync System...');

if (!fs.existsSync('dist')) fs.mkdirSync('dist');

console.log('🚀 Creating executable...');
try {
  execSync('npx pkg -t node18-win-x64 server.js -o dist/Ram360.exe --compress GZip', { stdio: 'inherit' });
} catch {
  execSync('npx pkg -t node16-win-x64 server.js -o dist/Ram360.exe --compress GZip', { stdio: 'inherit' });
}

console.log('📄 Copying configuration files...');

// Copy .env file - CRITICAL for executable to run
if (fs.existsSync('.env')) {
  fs.copyFileSync('.env', 'dist/.env');
  console.log('✓ Copied .env');
} else {
  console.warn('⚠ WARNING: .env file not found! The executable may fail.');
}

fs.copyFileSync('sync_state.json', 'dist/sync_state.json');
fs.copyFileSync('installer.bat', 'dist/installer.bat');
if (fs.existsSync('ecosystem.config.js')) {
  fs.copyFileSync('ecosystem.config.js', 'dist/ecosystem.config.js');
}

// Create logs folder if it doesn't exist
if (!fs.existsSync('dist/logs')) {
  fs.mkdirSync('dist/logs', { recursive: true });
  console.log('✓ Created logs folder');
}

console.log('✅ Build complete!');
