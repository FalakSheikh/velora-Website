'use strict';
// Starts Velora and explains problems in plain words (most failures are an old Node.js version).
const { spawnSync } = require('child_process');
const real = process.versions.node.split('.').map(Number);
const v = process.env.FAKE_NODE_VERSION ? process.env.FAKE_NODE_VERSION.split('.').map(Number) : real;
const [maj, min] = v;

if (maj < 22 || (maj === 22 && min < 5)) {
  console.error(`
  Velora needs Node.js 22 or newer, but this computer has Node.js ${v.join('.')}.

  Fix (2 minutes):
    1. Go to https://nodejs.org and download the "LTS" version. Install it.
    2. Close VS Code completely and open it again.
    3. In the terminal run:  node -v     (it must say v22 or higher)
    4. Run:  node start.js
`);
  process.exit(1);
}
// Node 22.5 to 22.12 and 23.0 to 23.3 need a switch for the built-in database.
const needsFlag = (maj === 22 && min < 13) || (maj === 23 && min < 4);
if (needsFlag && !process.execArgv.includes('--experimental-sqlite')) {
  const r = spawnSync(process.execPath, ['--experimental-sqlite', '--no-warnings', __filename, ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exit(r.status === null ? 1 : r.status);
}
process.removeAllListeners('warning');
try {
  process.env.VELORA_START = '1';
  require('./server.js');
} catch (e) {
  console.error('\n  Velora could not start:\n  ' + (e && e.message) + '\n\n  Check that you opened the velora-backend folder in VS Code (the one that contains server.js).\n');
  process.exit(1);
}
process.on('uncaughtException', (e) => {
  if (e && e.code === 'EADDRINUSE') console.error('\n  Port ' + (process.env.PORT || 3000) + ' is already in use. Close the other Velora window (Ctrl+C) or run:  set PORT=3001  and start again.\n');
  else console.error(e);
  process.exit(1);
});
