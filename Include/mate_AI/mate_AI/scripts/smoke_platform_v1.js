const { spawn } = require('child_process');
const path = require('path');

const cwd = path.resolve(__dirname, '..');
const baseUrl = 'http://127.0.0.1:3001';
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

async function run() {
  await new Promise((resolve) => setTimeout(resolve, 1400));

  const capsRes = await fetch(`${baseUrl}/api/platform/v1/capabilities`);
  if (!capsRes.ok) throw new Error(`capabilities failed: ${capsRes.status}`);
  const caps = await capsRes.json();
  console.log('PLATFORM_CAPS', caps.version, caps.features && caps.features.sessions);

  const sessionRes = await fetch(`${baseUrl}/api/platform/v1/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      productId: 'mate-host-app',
      userId: 'platform-smoke-user',
      workspaceId: 'ws_smoke'
    })
  });
  if (!sessionRes.ok) throw new Error(`create session failed: ${sessionRes.status}`);
  const session = await sessionRes.json();
  if (!session || !session.token) throw new Error('session token missing');
  console.log('PLATFORM_SESSION_OK', Boolean(session.token));

  const validateRes = await fetch(`${baseUrl}/api/platform/v1/sessions/validate`, {
    headers: { Authorization: `Bearer ${session.token}` }
  });
  if (!validateRes.ok) throw new Error(`validate failed: ${validateRes.status}`);
  const validate = await validateRes.json();
  if (!validate || !validate.valid) throw new Error('session validate returned invalid');
  console.log('PLATFORM_VALIDATE_OK', validate.valid);

  stop(0);
}

run().catch((err) => {
  console.error('PLATFORM_SMOKE_ERROR', err && err.message ? err.message : err);
  stop(1);
});

setTimeout(() => {
  console.error('PLATFORM_SMOKE_ERROR timeout waiting for checks');
  stop(1);
}, 15000);
