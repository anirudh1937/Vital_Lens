const { spawn } = require('child_process');
const path = require('path');

const cwd = path.join(__dirname, '..');
const child = spawn('node', ['server.js'], {
  cwd,
  stdio: 'inherit'
});

child.on('exit', (code, signal) => {
  console.log(`server exited code=${code} signal=${signal}`);
});
