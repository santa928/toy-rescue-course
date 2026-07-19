import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  BREAKABLE_FRAGMENT_LIFETIME_MS,
  BREAKABLE_FRAGMENT_SLOTS_PER_BLOCK,
  calculateRelativeLinearSpeed,
  createActualFragmentPoolSnapshot,
  createBreakableFragmentPool,
  deactivateFragmentBody,
  isBlockRespawnAreaClear,
  isFragmentWindowActive,
  resolveBlockImpactSpeed,
} from '../voxel-game/scene/BreakableBlockPlaza';
import { BLOCK_PLAZA, BREAKABLE_BLOCKS } from '../voxel-game/scene/worldLayout';

interface ScreenRect {
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
  readonly top: number;
}

/** 実ゲームのdesktop固定cameraで、地面へ落ちたcubeのscreen矩形を返す。 */
function projectRestingCube(
  position: readonly [number, number, number],
  scale: readonly [number, number, number],
): ScreenRect {
  const camera = new THREE.OrthographicCamera(1280 / -2, 1280 / 2, 720 / 2, 720 / -2);
  camera.position.set(-5, 12, 12);
  camera.zoom = 68.44444444444444;
  camera.lookAt(new THREE.Vector3(-15, 0.8, -1.5));
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  const rect = { bottom: -Infinity, left: Infinity, right: -Infinity, top: Infinity };
  for (const xSign of [-1, 1]) {
    for (const ySign of [-1, 1]) {
      for (const zSign of [-1, 1]) {
        const corner = new THREE.Vector3(
          position[0] + scale[0] / 2 * xSign,
          position[1] + scale[1] / 2 * ySign,
          position[2] + scale[2] / 2 * zSign,
        ).project(camera);
        const x = (corner.x + 1) * 640;
        const y = (1 - corner.y) * 360;
        rect.left = Math.min(rect.left, x);
        rect.right = Math.max(rect.right, x);
        rect.top = Math.min(rect.top, y);
        rect.bottom = Math.max(rect.bottom, y);
      }
    }
  }
  return rect;
}

/** 重なる矩形は0、離れた矩形は最短pixel距離を返す。 */
function screenRectGap(first: ScreenRect, second: ScreenRect): number {
  return Math.hypot(
    Math.max(first.left - second.right, second.left - first.right, 0),
    Math.max(first.top - second.bottom, second.top - first.bottom, 0),
  );
}

describe('BreakableBlockPlaza', () => {
  it('設定値でなく実body・collider・mesh参照からpool状態とidentityを数える', () => {
    const slots = [
      {
        active: true,
        body: { handle: 11, isEnabled: () => true, isSleeping: () => false },
        collider: { handle: 21, isEnabled: () => true },
        mesh: { uuid: 'mesh-a', visible: true },
      },
      {
        active: false,
        body: { handle: 12, isEnabled: () => false, isSleeping: () => false },
        collider: { handle: 22, isEnabled: () => false },
        mesh: { uuid: 'mesh-b', visible: false },
      },
      { active: false, body: null, collider: null, mesh: null },
    ];

    expect(createActualFragmentPoolSnapshot(slots)).toEqual({
      activeFragmentCount: 1,
      bodyHandles: [11, 12],
      colliderHandles: [21, 22],
      collisionEnabledFragmentCount: 1,
      enabledBodyCount: 1,
      meshUuids: ['mesh-a', 'mesh-b'],
      mountedBodyCount: 2,
      mountedColliderCount: 2,
      mountedMeshCount: 2,
      rapierSleepingFragmentCount: 0,
      sleepingFragmentCount: 1,
      uniqueBodyHandleCount: 2,
      uniqueColliderHandleCount: 2,
      uniqueMeshUuidCount: 2,
      visibleFragmentCount: 1,
    });
  });

  it('破片body停止時に速度零・disable・sleepをすべて明示呼出しする', () => {
    const events: string[] = [];
    deactivateFragmentBody({
      setAngvel: (_velocity, wakeUp) => events.push(`angvel:${wakeUp}`),
      setEnabled: (enabled) => events.push(`enabled:${enabled}`),
      setLinvel: (_velocity, wakeUp) => events.push(`linvel:${wakeUp}`),
      sleep: () => events.push('sleep'),
    });

    expect(events).toEqual(['linvel:false', 'angvel:false', 'enabled:false', 'sleep']);
  });

  it('4 blockそれぞれへ再利用可能な6 slotを固定し、identityを重複させない', () => {
    const slots = createBreakableFragmentPool(BREAKABLE_BLOCKS);

    expect(slots).toHaveLength(24);
    expect(new Set(slots.map(({ id }) => id)).size).toBe(24);
    for (const block of BREAKABLE_BLOCKS) {
      const blockSlots = slots.filter(({ blockId }) => blockId === block.id);
      expect(blockSlots).toHaveLength(BREAKABLE_FRAGMENT_SLOTS_PER_BLOCK);
      expect(blockSlots.map(({ index }) => index)).toEqual([0, 1, 2, 3, 4, 5]);
    }
  });

  it('6片を積み木広場内側の異なる方向へ飛ばし、別blockを連鎖破壊しない速度に保つ', () => {
    const slots = createBreakableFragmentPool(BREAKABLE_BLOCKS)
      .filter(({ blockId }) => blockId === BREAKABLE_BLOCKS[0].id);

    expect(new Set(slots.map(({ velocity }) => velocity.join(','))).size).toBe(6);
    expect(slots.every(({ velocity }) => velocity[0] > 0)).toBe(true);
    expect(slots.some(({ velocity }) => velocity[1] > 0)).toBe(true);
    expect(slots.some(({ velocity }) => velocity[2] > 0)).toBe(true);
    expect(slots.some(({ velocity }) => velocity[2] < 0)).toBe(true);
    expect(slots.every(({ velocity }) => Math.hypot(...velocity) < 4)).toBe(true);
  });

  it('全4blockの6片を広場内へ収め、地面へ落ちた後も互いに10px以上分離する', () => {
    const slots = createBreakableFragmentPool(BREAKABLE_BLOCKS);
    const plazaMinX = BLOCK_PLAZA.position[0] - BLOCK_PLAZA.scale[0] / 2;
    const plazaMaxX = BLOCK_PLAZA.position[0] + BLOCK_PLAZA.scale[0] / 2;
    const plazaMinZ = BLOCK_PLAZA.position[2] - BLOCK_PLAZA.scale[2] / 2;
    const plazaMaxZ = BLOCK_PLAZA.position[2] + BLOCK_PLAZA.scale[2] / 2;

    for (const block of BREAKABLE_BLOCKS) {
      const blockSlots = slots.filter(({ blockId }) => blockId === block.id);
      const fragmentRects = blockSlots.map(({ localPosition, scale }) => {
        const worldPosition = [
          block.position[0] + localPosition[0],
          0.28,
          block.position[2] + localPosition[2],
        ] as const;
        expect(worldPosition[0] - scale[0] / 2, `${block.id} fragment leaves west`).toBeGreaterThanOrEqual(plazaMinX);
        expect(worldPosition[0] + scale[0] / 2, `${block.id} fragment leaves east`).toBeLessThanOrEqual(plazaMaxX);
        expect(worldPosition[2] - scale[2] / 2, `${block.id} fragment leaves north`).toBeGreaterThanOrEqual(plazaMinZ);
        expect(worldPosition[2] + scale[2] / 2, `${block.id} fragment leaves south`).toBeLessThanOrEqual(plazaMaxZ);
        return projectRestingCube(worldPosition, scale);
      });
      const fragmentGaps = fragmentRects.flatMap((fragmentRect, fragmentIndex) => (
        fragmentRects.slice(fragmentIndex + 1).map((other, offset) => ({
          gap: screenRectGap(fragmentRect, other),
          pair: `${block.id}:fragment-${fragmentIndex}/fragment-${fragmentIndex + offset + 1}`,
        }))
      ));
      const intactGaps = fragmentRects.flatMap((fragmentRect, fragmentIndex) => (
        BREAKABLE_BLOCKS
          .filter(({ id }) => id !== block.id)
          .map((intactBlock) => ({
            gap: screenRectGap(fragmentRect, projectRestingCube(intactBlock.position, [1.5, 1.5, 1.5])),
            pair: `${block.id}:fragment-${fragmentIndex}/${intactBlock.id}`,
          }))
      ));
      const minimum = [...fragmentGaps, ...intactGaps].reduce((current, candidate) => (
        candidate.gap < current.gap ? candidate : current
      ));

      expect(minimum.gap, minimum.pair).toBeGreaterThanOrEqual(10);
    }
  });

  it('Rapier bodyの線速度差から符号に依存しない実相対速度を返す', () => {
    expect(calculateRelativeLinearSpeed(
      { x: 1, y: -2, z: 3 },
      { x: -2, y: 2, z: 3 },
    )).toBe(5);
    expect(calculateRelativeLinearSpeed(
      { x: -2, y: 2, z: 3 },
      { x: 1, y: -2, z: 3 },
    )).toBe(5);
  });

  it('after-step collisionでは車両の前step速度を採用し、別bodyは破壊速度にしない', () => {
    expect(resolveBlockImpactSpeed({
      collisionBodyIsVehicle: true,
      eventRelativeSpeed: 0.439,
      vehiclePreviousStepSpeed: 6.2,
    })).toBe(6.2);
    expect(resolveBlockImpactSpeed({
      collisionBodyIsVehicle: false,
      eventRelativeSpeed: 3.1,
      vehiclePreviousStepSpeed: 6.2,
    })).toBe(0);
  });

  it('破片など車両以外の高速衝突は積み木の破壊速度として採用しない', () => {
    expect(resolveBlockImpactSpeed({
      collisionBodyIsVehicle: false,
      eventRelativeSpeed: 8.4,
      vehiclePreviousStepSpeed: 0,
    })).toBe(0);
  });

  it('車両とのXZ距離が3を超える場合だけ復元領域をclearにする', () => {
    expect(isBlockRespawnAreaClear([0, 0, 0], [3, 99, 0])).toBe(false);
    expect(isBlockRespawnAreaClear([0, 0, 0], [3.001, -99, 0])).toBe(true);
    expect(isBlockRespawnAreaClear([1, 0, 1], [1, 0, -2])).toBe(false);
  });

  it('runtimeの5秒timerから破壊後1.2秒未満だけfragment windowを有効にする', () => {
    expect(BREAKABLE_FRAGMENT_LIFETIME_MS).toBe(1_200);
    expect(isFragmentWindowActive('broken', 5_000)).toBe(true);
    expect(isFragmentWindowActive('broken', 3_800.001)).toBe(true);
    expect(isFragmentWindowActive('broken', 3_800.0000001)).toBe(false);
    expect(isFragmentWindowActive('broken', 3_800)).toBe(false);
    expect(isFragmentWindowActive('intact', 5_000)).toBe(false);
  });
});
