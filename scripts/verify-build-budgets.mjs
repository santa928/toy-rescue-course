import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BUILD_BUDGETS = Object.freeze({
  entryBytes: 350_000,
  rapierBytes: 2_250_000,
  regularChunkBytes: 600_000,
  threeBytes: 750_000,
});

const REQUIRED_CHUNK_PREFIXES = [
  'react-',
  'three-',
  'r3f-',
  'drei-',
  'rapier-react-',
  'rapier-wasm-',
];

const REQUIRED_HTML_ENTRIES = ['index.html', 'voxel-game.html', 'vehicle-lab.html'];

/** build artifact一覧を責務別予算と必須vendor境界へ照合する。 */
export function evaluateBuildBudgets(files) {
  const violations = [];
  for (const prefix of REQUIRED_CHUNK_PREFIXES) {
    if (!files.some(({ name }) => name.startsWith(prefix))) {
      violations.push(`missing required vendor chunk: ${prefix}*.js`);
    }
  }
  for (const file of files) {
    const budget = file.name.startsWith('rapier-wasm-')
      ? BUILD_BUDGETS.rapierBytes
      : file.name.startsWith('three-')
        ? BUILD_BUDGETS.threeBytes
        : file.isEntry
          ? BUILD_BUDGETS.entryBytes
          : BUILD_BUDGETS.regularChunkBytes;
    if (file.size > budget) {
      violations.push(`${file.name}: ${file.size} bytes exceeds ${budget} bytes`);
    }
  }
  return violations;
}

/** HTML entryごとのmodule scriptが存在するbuild assetを参照しているか検証する。 */
export function evaluateBuildEntrypoints(entries) {
  const violations = [];
  for (const htmlName of REQUIRED_HTML_ENTRIES) {
    const entry = entries.find((candidate) => candidate.htmlName === htmlName);
    if (!entry) {
      violations.push(`missing required HTML entry: ${htmlName}`);
      continue;
    }
    if (entry.moduleScripts.length === 0) {
      violations.push(`missing module script in HTML entry: ${htmlName}`);
    }
    for (const script of entry.moduleScripts) {
      if (!script.exists) violations.push(`missing entry asset: ${htmlName} -> ${script.src}`);
    }
  }
  return violations;
}

/** root配信とGitHub Pagesのbase付きURLをdist相対asset pathへ変換する。 */
export function resolveDistAssetPath(sourceUrl) {
  const pathname = new URL(sourceUrl, 'https://build.invalid/').pathname;
  const assetsMarker = '/assets/';
  const assetsIndex = pathname.indexOf(assetsMarker);
  if (assetsIndex >= 0) return pathname.slice(assetsIndex + 1);
  return pathname.replace(/^\//, '');
}

/** Vite manifestとdist/assetsからbudget検証用のJS file一覧を読む。 */
export function readBuildArtifacts(distDirectory = 'dist') {
  const manifestPath = path.join(distDirectory, '.vite', 'manifest.json');
  assert(fs.existsSync(manifestPath), `Vite manifest is missing: ${manifestPath}`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const entryFiles = new Set(
    Object.values(manifest)
      .filter(({ isEntry }) => isEntry)
      .map(({ file }) => path.basename(file)),
  );
  const assetsDirectory = path.join(distDirectory, 'assets');
  return fs.readdirSync(assetsDirectory)
    .filter((name) => name.endsWith('.js'))
    .map((name) => ({
      isEntry: entryFiles.has(name),
      name,
      size: fs.statSync(path.join(assetsDirectory, name)).size,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

/** distの3 HTML entryからmodule script URLとasset実在性を読む。 */
export function readBuildEntrypoints(distDirectory = 'dist') {
  return REQUIRED_HTML_ENTRIES
    .filter((htmlName) => fs.existsSync(path.join(distDirectory, htmlName)))
    .map((htmlName) => {
      const html = fs.readFileSync(path.join(distDirectory, htmlName), 'utf8');
      const moduleScripts = [...html.matchAll(/<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']+)["'][^>]*>/g)]
        .map(([, src]) => {
          const relativeAssetPath = resolveDistAssetPath(src);
          return {
            exists: fs.existsSync(path.join(distDirectory, relativeAssetPath)),
            src,
          };
        });
      return { htmlName, moduleScripts };
    });
}

/** standalone実行時にbudget違反を終了code 1でCIへ伝える。 */
function verifyBuildBudgets() {
  const files = readBuildArtifacts();
  const entries = readBuildEntrypoints();
  const violations = [...evaluateBuildBudgets(files), ...evaluateBuildEntrypoints(entries)];
  if (violations.length > 0) {
    throw new Error(`Build budget verification failed:\n${violations.join('\n')}`);
  }
  console.log(JSON.stringify({ budgets: BUILD_BUDGETS, entries, files }, null, 2));
}

const currentFilePath = fileURLToPath(import.meta.url);
const invokedFilePath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedFilePath === currentFilePath) verifyBuildBudgets();
