import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { parse } from 'smol-toml';
import ts from 'typescript';
const supabase = parse(await readFile(new URL('../supabase/config.toml', import.meta.url), 'utf8'));
assert.equal(supabase.project_id, 'talleros-local');
assert.equal(supabase.api.port, 54321);
assert.equal(supabase.db.port, 54322);
assert.equal(supabase.auth.site_url, 'http://127.0.0.1:5173');
assert(!supabase.api.schemas.includes('private'));
assert.equal(supabase.auth.email.enable_confirmations, true);
const parsedWrangler = ts.parseConfigFileTextToJson(
  'wrangler.jsonc',
  await readFile(new URL('../apps/api/wrangler.jsonc', import.meta.url), 'utf8'),
);
assert.equal(parsedWrangler.error, undefined);
const wrangler = parsedWrangler.config;
assert.equal(wrangler.assets.not_found_handling, 'single-page-application');
assert.deepEqual(wrangler.assets.run_worker_first, ['/api', '/api/*']);
assert.equal(wrangler.workers_dev, false);
assert.equal(wrangler.env.production.vars.ENVIRONMENT, 'production');
console.log('Configuración validada estáticamente; no demuestra que Supabase esté iniciado.');
