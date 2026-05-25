const { spawn } = require('child_process');
const path = require('path');

const cwd = path.join(__dirname, '..');
const out = require('fs').openSync(path.join(cwd, 'server.out.log'), 'a');
const err = require('fs').openSync(path.join(cwd, 'server.err.log'), 'a');
const pidFile = path.join(cwd, 'server.pid');

const child = spawn('node', ['server.js'], {
  cwd,
  detached: true,
  stdio: ['ignore', out, err]
});

child.unref();
require('fs').writeFileSync(pidFile, String(child.pid));
console.log(`started server.js pid=${child.pid}`);
