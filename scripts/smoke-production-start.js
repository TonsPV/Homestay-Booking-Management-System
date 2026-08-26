const net = require('node:net');
const { spawn } = require('node:child_process');

const port = Number(process.env.PRODUCTION_SMOKE_PORT || 3100);
const entrypoint = 'dist/main.js';
const timeoutMs = Number(process.env.PRODUCTION_SMOKE_TIMEOUT_MS || 20_000);

const child = spawn(process.execPath, [entrypoint], {
  env: {
    ...process.env,
    APP_PORT: String(port),
    EXPIRATION_SCHEDULERS_ENABLED: 'false',
    SWAGGER_ENABLED: 'false',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let output = '';
let settled = false;
let pollTimer;
let timeoutTimer;

const finish = (error) => {
  if (settled) return;
  settled = true;
  clearInterval(pollTimer);
  clearTimeout(timeoutTimer);

  if (!child.killed) {
    child.kill('SIGTERM');
  }

  if (error) {
    console.error(error.message);
    if (output.trim()) console.error(output.trim());
    process.exitCode = 1;
  }
};

child.stdout.on('data', (chunk) => {
  output += chunk.toString();
});
child.stderr.on('data', (chunk) => {
  output += chunk.toString();
});
child.on('error', (error) => {
  finish(new Error(`Production smoke process failed: ${error.message}`));
});
child.on('exit', (code, signal) => {
  if (!settled) {
    finish(
      new Error(
        `Production smoke process exited before listening (code=${code}, signal=${signal}).`,
      ),
    );
  }
});

const probe = () => {
  const socket = net.createConnection({ host: '127.0.0.1', port });
  socket.setTimeout(500);
  socket.once('connect', () => {
    socket.destroy();
    console.log(`Production artifact listened on 127.0.0.1:${port}.`);
    finish();
  });
  socket.once('error', () => socket.destroy());
  socket.once('timeout', () => socket.destroy());
};

pollTimer = setInterval(probe, 100);
timeoutTimer = setTimeout(() => {
  finish(
    new Error(
      `Production artifact did not listen within ${timeoutMs}ms (${entrypoint}).`,
    ),
  );
}, timeoutMs);

probe();
