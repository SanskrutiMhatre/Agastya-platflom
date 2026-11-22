// Builds packaging/assets/agastya.ico (and agastya-256.png) from agastya.svg using a locally installed Chrome/Chromium.
// Only needed when the artwork changes; the generated .ico is committed so a release build does not need a browser.
//   node packaging/assets/make-icon.mjs            (set CHROMIUM_PATH if Chrome is not found automatically)
// The artwork is a neutral placeholder. Replace agastya.svg with the organisation's mark and run this again.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const require = createRequire(path.join(root, 'frontend', 'node_modules') + path.sep);
const { chromium } = require('playwright-core');

const chrome = process.env.CHROMIUM_PATH
  || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p));
if (!chrome) { console.error('No Chrome/Edge found; set CHROMIUM_PATH.'); process.exit(1); }

const svg = fs.readFileSync(path.join(here, 'agastya.svg'), 'utf8');
const sizes = [16, 24, 32, 48, 64, 128, 256];
const browser = await chromium.launch({ executablePath: chrome });
const png = {};
for (const n of sizes) {
  const page = await browser.newPage({ viewport: { width: n, height: n }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block;width:${n}px;height:${n}px}</style>${svg}`);
  png[n] = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: n, height: n } });
  await page.close();
}
await browser.close();

// ICO container with PNG-compressed images (supported by Windows Vista and later).
const count = sizes.length;
const head = Buffer.alloc(6 + 16 * count);
head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(count, 4);
let offset = head.length;
sizes.forEach((n, i) => {
  const e = 6 + 16 * i;
  head.writeUInt8(n === 256 ? 0 : n, e); head.writeUInt8(n === 256 ? 0 : n, e + 1);
  head.writeUInt8(0, e + 2); head.writeUInt8(0, e + 3);
  head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
  head.writeUInt32LE(png[n].length, e + 8); head.writeUInt32LE(offset, e + 12);
  offset += png[n].length;
});
fs.writeFileSync(path.join(here, 'agastya.ico'), Buffer.concat([head, ...sizes.map((n) => png[n])]));
fs.writeFileSync(path.join(here, 'agastya-256.png'), png[256]);
console.log('wrote agastya.ico (' + sizes.join(', ') + ' px) and agastya-256.png');
