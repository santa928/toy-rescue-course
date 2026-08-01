/** node_modules内のpackage pathが指定segmentへ一致するかを判定する。 */
function includesPackage(moduleId: string, packageName: string): boolean {
  return moduleId.includes(`/node_modules/${packageName}/`);
}

/** production module IDを、責務が安定したvendor chunk名へ分類する。 */
export function resolveVendorChunk(rawModuleId: string): string | undefined {
  const moduleId = rawModuleId.replaceAll('\\', '/');
  if (!moduleId.includes('/node_modules/')) return undefined;

  if (includesPackage(moduleId, '@dimforge/rapier3d-compat')) return 'rapier-wasm';
  if (includesPackage(moduleId, '@react-three/rapier')) return 'rapier-react';

  if ([
    '@react-three/drei',
    'camera-controls',
    'maath',
    'stats-gl',
    'three-mesh-bvh',
    'troika-three-text',
    'troika-three-utils',
    'troika-worker-utils',
  ].some((packageName) => includesPackage(moduleId, packageName))) return 'drei';

  if ([
    '@react-three/fiber',
    'its-fine',
    'react-reconciler',
    'suspend-react',
    'use-sync-external-store',
    'zustand',
  ].some((packageName) => includesPackage(moduleId, packageName))) return 'r3f';

  if (includesPackage(moduleId, 'three')) return 'three';

  if ([
    'react',
    'react-dom',
    'scheduler',
  ].some((packageName) => includesPackage(moduleId, packageName))) return 'react';

  return undefined;
}
