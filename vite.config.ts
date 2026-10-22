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
  // BASE_PATH=/ builds for the game server (its own domain); GitHub Pages keeps the repository path.
  base: command === 'build' ? process.env.BASE_PATH ?? PAGES_BASE : '/',
  // A short build stamp on the title screen, so it is obvious which version is loaded.
  define: { __BUILD__: JSON.stringify(`${(process.env.GITHUB_SHA ?? 'local').slice(0, 7)} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`) },
  publicDir: false,
  plugins: [assetsPlugin()],
  // In development the game server (npm run server, port 8787) is reached through Vite, same origin.
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': { target: `http://127.0.0.1:${process.env.GAME_SERVER_PORT ?? 8787}`, changeOrigin: false },
      '/health': { target: `http://127.0.0.1:${process.env.GAME_SERVER_PORT ?? 8787}` },
      '/u/': { target: `http://127.0.0.1:${process.env.GAME_SERVER_PORT ?? 8787}` },
      '^/mod$': { target: `http://127.0.0.1:${process.env.GAME_SERVER_PORT ?? 8787}` },
      '/ws': { target: `ws://127.0.0.1:${process.env.GAME_SERVER_PORT ?? 8787}`, ws: true },
    },
  },
  build: { target: 'es2022', assetsInlineLimit: 0 },
  test: { environment: 'node', include: ['src/**/*.test.ts', 'server/**/*.test.ts'] },
}));
