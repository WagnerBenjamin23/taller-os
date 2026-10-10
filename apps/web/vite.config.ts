import { defineConfig, loadEnv } from 'vite';
import { readFile, writeFile } from 'node:fs/promises';
import { securityHeaders } from './security-headers';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'supabase-auth-csp',
      async closeBundle() {
        const env = loadEnv(mode, process.cwd(), 'VITE_');
        const template = await readFile('public/_headers', 'utf8');
        await writeFile('dist/_headers', securityHeaders(template, env.VITE_SUPABASE_URL));
      },
    },
  ],
  server: { port: 5173, strictPort: true, proxy: { '/api': 'http://127.0.0.1:8787' } },
  build: { sourcemap: false },
}));
