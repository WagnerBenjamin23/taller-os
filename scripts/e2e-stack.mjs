// Uses the same local Supabase + Vite + Wrangler configuration as development/CI.
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
let status;
try {
  status = JSON.parse(
    execFileSync(`${root}/node_modules/.bin/supabase`, ['status', '-o', 'json'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  );
} catch {
  throw new Error('E2E requiere Supabase LOCAL iniciado con Docker; no hay fallback simulado.');
}
for (const [value, port] of [
  [status.API_URL, '54321'],
  [status.DB_URL, '54322'],
]) {
  const url = new URL(value);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.port !== port)
    throw new Error('E2E sólo admite el stack Supabase local descartable.');
}
const env = {
  ...process.env,
  WRANGLER_SEND_METRICS: 'false',
  VITE_SUPABASE_URL: status.API_URL,
  VITE_SUPABASE_PUBLISHABLE_KEY: status.ANON_KEY,
};
try {
  execFileSync(process.execPath, [`${root}/node_modules/vite/bin/vite.js`, 'build'], {
    cwd: `${root}/apps/web`,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
} catch {
  throw new Error('No se pudo compilar assets locales para el E2E.');
}
const children = [];
let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    try {
      if (process.platform === 'win32') child.kill('SIGTERM');
      else process.kill(-child.pid, 'SIGTERM');
    } catch {
      /*already stopped*/
    }
  }
  process.exit(code);
}
function launch(args, cwd) {
  const child = spawn(process.execPath, args, {
    cwd,
    env,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  // Drain output without exposing URLs, credentials, tokens or request bodies.
  child.stdout.resume();
  child.stderr.resume();
  child.on('error', () => stop(1));
  child.on('exit', (code) => {
    if (!stopping) stop(code || 1);
  });
}
launch(
  [
    `${root}/node_modules/wrangler/bin/wrangler.js`,
    'dev',
    '--env=',
    '--local',
    '--ip',
    '127.0.0.1',
    '--port',
    '8787',
    '--var',
    `SUPABASE_URL:${status.API_URL}`,
    '--var',
    `SUPABASE_PUBLISHABLE_KEY:${status.ANON_KEY}`,
  ],
  `${root}/apps/api`,
);
launch(
  [
    `${root}/node_modules/vite/bin/vite.js`,
    '--host',
    '127.0.0.1',
    '--port',
    '5173',
    '--strictPort',
  ],
  `${root}/apps/web`,
);
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
