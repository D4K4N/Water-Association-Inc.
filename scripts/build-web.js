/**
 * Dicklum Water Association, Inc. - Hybrid APK Web Bundle Builder
 * Packages all offline HTML, CSS, JS, MapLibre GL, Leaflet, html2pdf, and Diclum Map Tiles
 * into `./www` for Capacitor Android `.apk` packaging.
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT_DIR, 'www');

const FILES_TO_COPY = [
  'index.html',
  'manifest.webmanifest',
  'version.json',
  'sw.js'
];

const DIRS_TO_COPY = [
  'css',
  'js',
  'vendor',
  'assets'
];

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

function main() {
  if (fs.existsSync(OUT_DIR)) {
    fs.rmSync(OUT_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const file of FILES_TO_COPY) {
    const src = path.join(ROOT_DIR, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(OUT_DIR, file));
    }
  }

  for (const dir of DIRS_TO_COPY) {
    copyRecursive(path.join(ROOT_DIR, dir), path.join(OUT_DIR, dir));
  }

  console.log('[build-web] Successfully assembled 100% offline Hybrid APK bundle in ./www');
}

main();
