import './local-db.mjs';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { createApp } from './app.mjs';
const port = Number(process.env.PORT || 3000);
const origin = process.env.APP_ORIGIN || `http://localhost:${port}`;
const require = createRequire(import.meta.url);
const browser = resolve(dirname(require.resolve('@simplewebauthn/browser')), '../dist/bundle/index.umd.min.js');
const assets = new Map([
  ['/style.css', [new URL('style.css', import.meta.url), 'text/css; charset=utf-8']],
  ['/login.js', [new URL('login.js', import.meta.url), 'text/javascript; charset=utf-8']],
  ['/work.js', [new URL('work.js', import.meta.url), 'text/javascript; charset=utf-8']],
  ['/passkey-lib.js', [browser, 'text/javascript; charset=utf-8']],
]);
const app = createServer(createApp(origin, path => {
  const asset = assets.get(path);
  return asset && { data: readFileSync(asset[0]), type: asset[1] };
}));
app.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`Chevarxona: ${origin}`));
