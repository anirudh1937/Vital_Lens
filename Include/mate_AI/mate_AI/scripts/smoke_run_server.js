const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const cwd = path.resolve(__dirname, '..');
const child = spawn(process.execPath, ['server.js'], {
  cwd,
  env: { ...process.env, PORT: '3001' },
  stdio: ['ignore', 'pipe', 'pipe']
});

child.stdout.on('data', (d) => process.stdout.write(d));
child.stderr.on('data', (d) => process.stderr.write(d));

function stop(code = 0) {
  if (!child.killed) child.kill();
  process.exit(code);
}

setTimeout(() => {
  http
    .get('http://localhost:3001/api/rag/status', (res) => {
      let body = '';
      res.on('data', (c) => {
        body += c.toString();
      });
      res.on('end', () => {
        console.log(`SMOKE_STATUS ${res.statusCode}`);
        console.log(body);
        stop(0);
      });
    })
    .on('error', (err) => {
      console.error(`SMOKE_ERROR ${err.message}`);
      stop(1);
    });
}, 1400);

setTimeout(() => {
  console.error('SMOKE_ERROR timeout waiting for server response');
  stop(1);
}, 10000);
