import { describe, expect, it } from 'vitest';
import { resolveVendorChunk } from './vendorChunk';

describe('resolveVendorChunk', () => {
  it.each([
    ['/app/node_modules/@dimforge/rapier3d-compat/rapier.mjs', 'rapier-wasm'],
    ['/app/node_modules/@react-three/rapier/dist/index.js', 'rapier-react'],
    ['/app/node_modules/@react-three/drei/index.js', 'drei'],
    ['/app/node_modules/camera-controls/dist/index.js', 'drei'],
    ['/app/node_modules/@react-three/fiber/dist/index.js', 'r3f'],
    ['/app/node_modules/react-reconciler/index.js', 'r3f'],
    ['/app/node_modules/three/build/three.module.js', 'three'],
    ['/app/node_modules/react-dom/client.js', 'react'],
    ['C:\\app\\node_modules\\scheduler\\index.js', 'react'],
  ])('%sを%sへ分類する', (moduleId, expected) => {
    expect(resolveVendorChunk(moduleId)).toBe(expected);
  });

  it('game固有moduleと未知vendorをentry側へ残す', () => {
    expect(resolveVendorChunk('/app/src/voxel-game/main.tsx')).toBeUndefined();
    expect(resolveVendorChunk('/app/node_modules/unknown-package/index.js')).toBeUndefined();
  });
});
