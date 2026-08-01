import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BUILD_BUDGETS,
  evaluateBuildBudgets,
  evaluateBuildEntrypoints,
  resolveDistAssetPath,
} from './verify-build-budgets.mjs';

const requiredFiles = [
  { isEntry: false, name: 'react-a.js', size: 10 },
  { isEntry: false, name: 'three-a.js', size: 10 },
  { isEntry: false, name: 'r3f-a.js', size: 10 },
  { isEntry: false, name: 'drei-a.js', size: 10 },
  { isEntry: false, name: 'rapier-react-a.js', size: 10 },
  { isEntry: false, name: 'rapier-wasm-a.js', size: 10 },
  { isEntry: true, name: 'game-a.js', size: 10 },
];

test('境界以内のentryとvendorを受け入れる', () => {
  assert.deepEqual(evaluateBuildBudgets(requiredFiles), []);
});

test('entry、通常chunk、Three、Rapierを別予算で拒否する', () => {
  const violations = evaluateBuildBudgets([
    ...requiredFiles,
    { isEntry: true, name: 'oversized-entry.js', size: BUILD_BUDGETS.entryBytes + 1 },
    { isEntry: false, name: 'oversized-vendor.js', size: BUILD_BUDGETS.regularChunkBytes + 1 },
    { isEntry: false, name: 'three-too-large.js', size: BUILD_BUDGETS.threeBytes + 1 },
    { isEntry: false, name: 'rapier-wasm-too-large.js', size: BUILD_BUDGETS.rapierBytes + 1 },
  ]);

  assert.equal(violations.length, 4);
  assert(violations.some((violation) => violation.includes('oversized-entry.js')));
  assert(violations.some((violation) => violation.includes('oversized-vendor.js')));
  assert(violations.some((violation) => violation.includes('three-too-large.js')));
  assert(violations.some((violation) => violation.includes('rapier-wasm-too-large.js')));
});

test('必須vendor chunk欠落をすべて報告する', () => {
  const violations = evaluateBuildBudgets([{ isEntry: true, name: 'game-a.js', size: 10 }]);
  assert.equal(violations.filter((violation) => violation.includes('missing')).length, 6);
});

test('root、互換URL、Vehicle Labのmodule asset実在を受け入れる', () => {
  const entries = ['index.html', 'voxel-game.html', 'vehicle-lab.html'].map((htmlName) => ({
    htmlName,
    moduleScripts: [{ exists: true, src: '/assets/main.js' }],
  }));
  assert.deepEqual(evaluateBuildEntrypoints(entries), []);
});

test('HTML entry欠落、module script欠落、asset欠落を報告する', () => {
  const violations = evaluateBuildEntrypoints([
    { htmlName: 'index.html', moduleScripts: [] },
    {
      htmlName: 'voxel-game.html',
      moduleScripts: [{ exists: false, src: '/assets/missing.js' }],
    },
  ]);

  assert.equal(violations.length, 3);
  assert(violations.some((violation) => violation.includes('index.html')));
  assert(violations.some((violation) => violation.includes('missing.js')));
  assert(violations.some((violation) => violation.includes('vehicle-lab.html')));
});

test('rootとGitHub Pagesのasset URLを同じdist相対pathへ解決する', () => {
  assert.equal(resolveDistAssetPath('/assets/main.js'), 'assets/main.js');
  assert.equal(
    resolveDistAssetPath('/toy-rescue-course/assets/main.js'),
    'assets/main.js',
  );
  assert.equal(resolveDistAssetPath('./assets/main.js'), 'assets/main.js');
});
