import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
const require = createRequire(import.meta.url);
mkdirSync('public', { recursive: true });
for (const name of ['style.css', 'login.js', 'work.js']) copyFileSync(name, 'public/' + name);
const browser = resolve(dirname(require.resolve('@simplewebauthn/browser')), '../dist/bundle/index.umd.min.js');
copyFileSync(browser, 'public/passkey-lib.js');
