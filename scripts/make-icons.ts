/**
 * App icons rendered from one SVG with Playwright (Chromium): a smooth light route over setts.
 *
 *   pnpm icons
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const PUBLIC = path.resolve(import.meta.dirname, '../public');

function iconSvg(): string {
  const setts: string[] = [];
  const step = 64;
  for (let row = 0; row < 9; row++) {
    for (let col = -1; col < 9; col++) {
      const x = col * step + (row % 2 ? step / 2 : 0) + 6;
      const y = row * step + 6;
      setts.push(`<rect x="${x}" y="${y}" width="${step - 12}" height="${step - 12}" rx="10"/>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#123a31"/>
  <g fill="#1d5446">${setts.join('')}</g>
  <path d="M 112 412 C 200 300, 300 380, 400 112" stroke="#123a31" stroke-width="88" stroke-linecap="round" fill="none"/>
  <path d="M 112 412 C 200 300, 300 380, 400 112" stroke="#f6f1e3" stroke-width="48" stroke-linecap="round" fill="none"/>
</svg>`;
}

async function main() {
  const svg = iconSvg();
  await mkdir(path.join(PUBLIC, 'icons'), { recursive: true });
  await writeFile(path.join(PUBLIC, 'favicon.svg'), svg);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const [file, size] of [
    ['icons/icon-192.png', 192],
    ['icons/icon-512.png', 512],
    ['icons/apple-touch-icon.png', 180],
  ] as const) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<html><body style="margin:0">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
    await page.screenshot({ path: path.join(PUBLIC, file) });
    console.log(`wrote public/${file}`);
  }
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
