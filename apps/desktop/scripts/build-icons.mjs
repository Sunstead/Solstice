#!/usr/bin/env node
/**
 * Builds every icon except the macOS ones, from the flat design,
 * src/assets/icons/app/icon_square.svg:
 *
 *   src-tauri/icons/*            Windows, Linux, iOS and Android (via `tauri icon`)
 *   public/favicon.svg           the browser tab
 *   public/apple-touch-icon.png  iOS home screen
 *   public/icon-192.png, icon-512.png, manifest.webmanifest   installing the web app
 *
 * The macOS icons come from the Icon Composer document beside it (mac.icon,
 * the same design in Liquid Glass) through scripts/build-mac-icon.sh, which
 * needs a Mac; the App icons workflow runs both. Outputs are committed, so
 * this only needs re-running when the icon changes:
 *
 *   npm run icons -w @solstice/desktop
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const icons = path.join(app, 'src-tauri/icons');
const pub = path.join(app, 'public');

// Inkscape's metadata and editor state aren't needed to draw it.
const flat = readFileSync(path.join(app, 'src/assets/icons/app/icon_square.svg'), 'utf8')
  .replace(/<\?xml[^>]*\?>\s*/, '')
  .replace(/<!--[\s\S]*?-->\s*/g, '')
  .replace(/<sodipodi:namedview\b[^>]*?(\/>|>[\s\S]*?<\/sodipodi:namedview>)\s*/g, '')
  .replace(/<metadata[\s\S]*?<\/metadata>\s*/g, '');

/** The page colour behind the icon, for the web manifest: its darkest stop. */
const background = '#301109';

/**
 * iOS rounds home screen icons itself and fills transparent corners with
 * black, so that one gets the background's gradient behind it.
 */
const square = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs><linearGradient id="fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6e1b14"/><stop offset="1" stop-color="${background}"/></linearGradient></defs>
  <rect width="1024" height="1024" fill="url(#fill)"/>
  <image width="1024" height="1024" xlink:href="data:image/svg+xml;base64,${Buffer.from(flat).toString('base64')}"/>
</svg>`;

function png(svg, width, file) {
  const out = new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().asPng();
  writeFileSync(file, out);
}

const tmp = mkdtempSync(path.join(tmpdir(), 'solstice-icons-'));
try {
  // Windows, Linux and mobile, through Tauri's own generator. The .icns it
  // writes is dropped: macOS gets its icons from build-mac-icon.sh.
  const master = path.join(tmp, 'icon-1024.png');
  png(flat, 1024, master);
  const out = path.join(tmp, 'out');
  execFileSync('npx', ['tauri', 'icon', master, '--output', out], { cwd: app, stdio: 'inherit', shell: true });
  const copy = (dir, rel = '') => {
    for (const name of readdirSync(path.join(dir, rel))) {
      const r = path.join(rel, name);
      if (statSync(path.join(dir, r)).isDirectory()) copy(dir, r);
      else if (!name.endsWith('.icns')) copyFileSync(path.join(dir, r), path.join(icons, r));
    }
  };
  copy(out);

  // The web app.
  writeFileSync(path.join(pub, 'favicon.svg'), flat);
  png(square, 180, path.join(pub, 'apple-touch-icon.png'));
  png(flat, 192, path.join(pub, 'icon-192.png'));
  png(flat, 512, path.join(pub, 'icon-512.png'));
  writeFileSync(
    path.join(pub, 'manifest.webmanifest'),
    `${JSON.stringify(
      {
        name: 'Solstice',
        short_name: 'Solstice',
        start_url: '/',
        display: 'standalone',
        background_color: background,
        theme_color: background,
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      null,
      2,
    )}\n`,
  );
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
console.log('wrote src-tauri/icons and the web icons');
