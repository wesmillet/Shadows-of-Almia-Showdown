import { defineConfig, type Plugin } from 'vite';
import { cpSync, existsSync, createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

/**
 * Serves the repository's /assets folder at /assets/* in the dev server and
 * copies it into dist/assets on build. Keeping the art at the repository root
 * (rather than under public/) keeps the folder layout the README documents.
 */
function assetsPlugin(): Plugin {
  const root = resolve(__dirname, 'assets');
  const types: Record<string, string> = {
    '.png': 'image/png',
    '.xml': 'application/xml',
    '.json': 'application/json',
    '.txt': 'text/plain; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
    '.ttf': 'font/ttf',
  };
  return {
    name: 'showdown-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0] ?? '';
        if (!url.startsWith('/assets/')) return next();
        const rel = normalize(decodeURIComponent(url.slice('/assets/'.length)));
        const file = join(root, rel);
        if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
          res.statusCode = 404;
          res.end('not found');
          return;
        }
        res.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-cache');
        createReadStream(file).pipe(res);
      });
    },
    closeBundle() {
      cpSync(root, resolve(__dirname, 'dist', 'assets'), { recursive: true });
    },
  };
}

/** Served from https://wesmillet.github.io/Shadows-of-Almia-Showdown/ on GitHub Pages. */
const PAGES_BASE = '/Shadows-of-Almia-Showdown/';

export default defineConfig(({ command }) => ({
  base: command === 'build' ? PAGES_BASE : '/',
  publicDir: false,
  plugins: [assetsPlugin()],
  server: { port: 5173, host: true },
  build: { target: 'es2022', assetsInlineLimit: 0 },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
}));
