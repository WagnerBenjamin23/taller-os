import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const command = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
const child = spawn(
  process.execPath,
  [command, 'dev', '--env=', '--local', '--ip', '127.0.0.1', '--port', '8791'],
  {
    cwd: `${root}/apps/api`,
    detached: process.platform !== 'win32',
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
let output = '';
for (const stream of [child.stdout, child.stderr])
  stream.on('data', (chunk) => {
    output = (output + chunk.toString()).slice(-12000);
  });
const base = 'http://127.0.0.1:8791';
async function get(path, options) {
  return fetch(`${base}${path}`, { ...options, signal: AbortSignal.timeout(3000) });
}
try {
  let ready = false;
  for (let i = 0; i < 150; i++) {
    if (child.exitCode !== null) throw new Error(`Wrangler terminó: ${child.exitCode}`);
    try {
      ready = (await get('/api/v1/health')).status === 200;
    } catch {
      /* Esperar startup local. */
    }
    if (ready) break;
    await delay(200);
  }
  assert(ready, 'Wrangler no inició dentro del límite.');
  const health = await get('/api/v1/health');
  assert.deepEqual(await health.json(), {
    status: 'ok',
    service: 'talleros-api',
    version: '0.1.0',
    phase: 1,
  });
  assert.equal(health.headers.get('cache-control'), 'no-store');
  for (const path of ['/api', '/api/not-found']) {
    const missing = await get(path);
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error.code, 'NOT_FOUND');
  }
  assert.equal((await get('/api/v1/health', { method: 'POST' })).status, 405);
  assert.equal(
    (await get('/api/v1/health', { headers: { Origin: 'https://untrusted.test' } })).status,
    403,
  );
  assert.equal(await (await get('/api/v1/health', { method: 'HEAD' })).text(), '');
  const html = await get('/');
  assert.equal(html.status, 200);
  assert.match(html.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
  assert.equal(html.headers.get('x-content-type-options'), 'nosniff');
  const body = await html.text();
  assert.match(body, /<div id="root"><\/div>/);
  const script = body.match(/src="([^"]+\.js)"/)[1];
  const asset = await get(script);
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('cache-control') ?? '', /immutable/);
  const spa = await get('/technical-fallback');
  assert.equal(spa.status, 200);
  assert.match(await spa.text(), /<div id="root"><\/div>/);
  console.log('Smoke aprobado: Worker/workerd, API, HTML, assets, CSP y routing SPA.');
} catch (error) {
  console.error(output);
  throw error;
} finally {
  if (child.exitCode === null) {
    if (process.platform === 'win32') child.kill('SIGTERM');
    else {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        /* Ya finalizó. */
      }
    }
    await Promise.race([new Promise((resolve) => child.once('exit', resolve)), delay(3000)]);
    if (child.exitCode === null && process.platform !== 'win32') {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        /* Ya finalizó. */
      }
    }
  }
}
