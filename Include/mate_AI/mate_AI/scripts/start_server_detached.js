const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const cwd = path.resolve(__dirname, '..');
const logFile = path.join(cwd, 'server.out.log');
const errFile = path.join(cwd, 'server.err.log');
const out = fs.openSync(logFile, 'a');
const err = fs.openSync(errFile, 'a');

const child = spawn(process.execPath, ['server.js'], {
  cwd,
  detached: true,
  stdio: ['ignore', out, err],
  env: { ...process.env, PORT: process.env.PORT || '3000' }
});

child.unref();
console.log(`DETACHED_PID ${child.pid}`);
console.log(`LOG_OUT ${logFile}`);
console.log(`LOG_ERR ${errFile}`);
