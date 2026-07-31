import { Children, isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { VoxelGameRuntime } from '../voxel-game/domain/VoxelGameRuntime';
import * as WaterAndFireModule from '../voxel-game/scene/WaterAndFire';
import {
  createFireVoxelFrame,
  getActiveFireVoxelCount,
} from '../voxel-game/scene/fireVfx';
import {
  CELEBRATION_STAR_CENTERS,
  FIRE_HAZARD_BOX,
  FIRE_LAYER_POSITIONS,
  FireHazardCollider,
  ROUTE_BOXES,
  advanceWaterVfxClock,
  createFireBatchScratch,
  getFireLayerCount,
  isFireHazardEnabled,
  isWaterVfxResetEvent,
  resolveWaterAndFireFrame,
  syncColliderEnabled,
  updateFireBatch,
} from '../voxel-game/scene/WaterAndFire';
import { FIRE_SPRAY_TARGET_POSITION } from '../voxel-game/scene/worldLayout';

const fireHazardLifecycle = vi.hoisted(() => ({
  effects: [] as (() => void)[],
  layoutEffects: [] as (() => void)[],
  refCursor: 0,
  refs: [] as { current: unknown }[],
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useEffect: (effect: () => void): void => {
      fireHazardLifecycle.effects.push(effect);
    },
    useLayoutEffect: (effect: () => void): void => {
      fireHazardLifecycle.layoutEffects.push(effect);
    },
    useRef: <Value,>(initialValue: Value): { current: Value } => {
      const index = fireHazardLifecycle.refCursor;
      fireHazardLifecycle.refCursor += 1;
      const ref = fireHazardLifecycle.refs[index] ?? { current: initialValue };
      fireHazardLifecycle.refs[index] = ref;
      return ref as { current: Value };
    },
  };
});

interface FireHazardColliderElementProps {
  readonly ref?: FireHazardTestRef;
}

interface TestCollider {
  isEnabled(): boolean;
  setEnabled(enabled: boolean): void;
}

type FireHazardTestRef = ((collider: TestCollider | null) => void) | {
  current: TestCollider | null;
};

type FireFrameUpdateMode = 'skip' | 'update' | 'zero';

type FireAnchorLayoutFactory = (
  sprayTarget: readonly [number, number, number],
) => {
  readonly hazardBox: typeof FIRE_HAZARD_BOX;
  readonly layerPositions: typeof FIRE_LAYER_POSITIONS;
};

/** componentを再renderし、ref再attachなしで低頻度effectだけを進める。 */
function renderFireHazardCollider(enabled: boolean): FireHazardTestRef {
  fireHazardLifecycle.effects.length = 0;
  fireHazardLifecycle.layoutEffects.length = 0;
  fireHazardLifecycle.refCursor = 0;
  const rigidBody = FireHazardCollider({ enabled }) as ReactElement<{ readonly children?: ReactNode }>;
  const child = Children.only(rigidBody.props.children);
  expect(isValidElement<FireHazardColliderElementProps>(child)).toBe(true);
  const colliderElement = child as ReactElement<FireHazardColliderElementProps>;

  for (const effect of fireHazardLifecycle.layoutEffects.splice(0)) effect();
  for (const effect of fireHazardLifecycle.effects.splice(0)) effect();

  const ref = colliderElement.props.ref;
  expect(ref).toBeDefined();
  return ref as FireHazardTestRef;
}

/** 初回render後に遅延生成された実Rapier colliderをcomponent refへattachする。 */
function attachFireHazardCollider(ref: FireHazardTestRef, collider: TestCollider): void {
  if (typeof ref === 'function') {
    ref(collider);
  } else {
    ref.current = collider;
  }
}

describe('WaterAndFire', () => {
  it('中央車庫から東の火災地区へ12個の非solid道しるべを置く', () => {
    expect(ROUTE_BOXES.map(({ position }) => position)).toEqual([
      [0, 0.26, 3], [0, 0.26, 0], [4, 0.26, 0], [8, 0.26, 0],
      [12, 0.26, 0], [16, 0.26, 0], [20, 0.26, 0], [24, 0.26, 0],
      [28, 0.26, 0], [30, 0.26, -4], [30, 0.26, -8], [28, 0.26, -13],
    ]);
    expect(ROUTE_BOXES.every(({ scale }) => scale[1] <= 0.14)).toBe(true);
  });

  it.each([
    [1, true],
    [0.01, true],
    [0, false],
    [Number.NaN, false],
  ])('fireIntensity %sからhazard enabled=%sを決める', (intensity, expected) => {
    expect(isFireHazardEnabled(intensity)).toBe(expected);
  });

  it('Rapier colliderのenabled差分だけを同期する', () => {
    const setEnabled = vi.fn();
    const collider = { isEnabled: () => false, setEnabled };

    syncColliderEnabled(collider, true);
    expect(setEnabled).toHaveBeenCalledOnce();
    expect(setEnabled).toHaveBeenCalledWith(true);

    setEnabled.mockClear();
    syncColliderEnabled({ isEnabled: () => true, setEnabled }, true);
    expect(setEnabled).not.toHaveBeenCalled();
  });

  it('遅延ref attachで初期falseを反映し、その後もfalse→true→falseを同期する', () => {
    fireHazardLifecycle.refs.length = 0;
    const enabledHistory: boolean[] = [];
    let colliderEnabled = true;
    const collider = {
      isEnabled: () => colliderEnabled,
      setEnabled: (enabled: boolean) => {
        colliderEnabled = enabled;
        enabledHistory.push(enabled);
      },
    };

    const initialRef = renderFireHazardCollider(false);
    attachFireHazardCollider(initialRef, collider);
    expect(enabledHistory).toEqual([false]);
    expect(colliderEnabled).toBe(false);

    renderFireHazardCollider(true);
    expect(enabledHistory).toEqual([false, true]);
    expect(colliderEnabled).toBe(true);

    renderFireHazardCollider(false);
    expect(enabledHistory).toEqual([false, true, false]);
    expect(colliderEnabled).toBe(false);
  });

  it('本番火災地区へhazardと3層の炎を同じ相対形状で移す', () => {
    expect(FIRE_HAZARD_BOX).toEqual({
      position: [26.9, 0.9, -16.1],
      scale: [1.2, 1.8, 1.2],
    });
    expect(FIRE_LAYER_POSITIONS).toEqual([
      [26.9, 0.75, -16.1],
      [26.95, 1.5, -16.02],
      [26.9, 2.15, -16.1],
    ]);
  });

  it('spray target変更へhazardと3層の相対配置を追従させる', () => {
    const createLayout = (
      WaterAndFireModule as typeof WaterAndFireModule & {
        readonly createFireAnchorLayout?: FireAnchorLayoutFactory;
      }
    ).createFireAnchorLayout;
    expect(createLayout).toBeTypeOf('function');
    if (!createLayout) return;

    expect(createLayout(FIRE_SPRAY_TARGET_POSITION)).toEqual({
      hazardBox: FIRE_HAZARD_BOX,
      layerPositions: FIRE_LAYER_POSITIONS,
    });
    expect(createLayout([10, 4, 20])).toEqual({
      hazardBox: {
        position: [10, 3.45, 20],
        scale: [1.2, 1.8, 1.2],
      },
      layerPositions: [
        [10, 3.3, 20],
        [10.05, 4.05, 20.08],
        [10, 4.7, 20],
      ],
    });
  });

  it('火cubeを建物のcamera側外壁面へ置き、3層すべてを遮蔽させない', () => {
    expect(FIRE_LAYER_POSITIONS).toHaveLength(3);
    expect(FIRE_LAYER_POSITIONS.every(([x]) => x >= 26.75)).toBe(true);
    expect(FIRE_LAYER_POSITIONS.map(([, y]) => y)).toEqual([0.75, 1.5, 2.15]);
    expect(FIRE_LAYER_POSITIONS.map(([, , z]) => z)).toEqual([-16.1, -16.02, -16.1]);
  });

  it('6組の成功星を火災現場上空かつcamera安全矩形へ置く', () => {
    expect(CELEBRATION_STAR_CENTERS).toEqual([
      [24.8, 1, -11],
      [22.5, 1.2, -11.4],
      [31, 1, -11.8],
      [24, 1.8, -12.2],
      [31.25, 3, -15],
      [28.8, 1.7, -13],
    ]);
  });

  it.each([
    [1, 3],
    [0.67, 3],
    [0.66, 2],
    [0.34, 2],
    [0.33, 1],
    [0.01, 1],
    [0, 0],
  ])('火の強さ%fを純ボクセル%f層へ変換する', (intensity, expectedLayers) => {
    expect(getFireLayerCount(intensity)).toBe(expectedLayers);
  });

  it.each([
    [1, 3, 18], [0.66, 2, 12], [0.33, 1, 6], [0, 0, 0],
  ])('火の強さ%fは既存%s層・新VFX%s個へ一致する', (
    intensity,
    expectedLayers,
    expectedVoxels,
  ) => {
    const layerCount = getFireLayerCount(intensity);
    expect(layerCount).toBe(expectedLayers);
    expect(getActiveFireVoxelCount(layerCount)).toBe(expectedVoxels);
  });

  it('stage 0初回だけzero転送し、継続時はskip、再点火時はupdateする', () => {
    const selectUpdateMode = (
      WaterAndFireModule as typeof WaterAndFireModule & {
        readonly selectFireFrameUpdateMode?: (
          previousLayerCount: number,
          nextLayerCount: number,
        ) => FireFrameUpdateMode;
      }
    ).selectFireFrameUpdateMode;
    expect(selectUpdateMode).toBeTypeOf('function');
    if (!selectUpdateMode) return;

    expect([
      selectUpdateMode(3, 0),
      selectUpdateMode(0, 0),
      selectUpdateMode(0, 2),
      selectUpdateMode(2, 1),
    ]).toEqual(['zero', 'skip', 'update', 'update']);
  });

  it('全18 transformからouter 6 slotだけを固定batch順へ転送する', () => {
    const setMatrixAt = vi.fn();
    const mesh = {
      instanceMatrix: { needsUpdate: false },
      setMatrixAt,
      visible: false,
    } as unknown as THREE.InstancedMesh;
    const frame = createFireVoxelFrame({ elapsedSeconds: 0.2, layerCount: 3 });

    updateFireBatch(mesh, 'outer', frame.instances, createFireBatchScratch());

    expect(setMatrixAt).toHaveBeenCalledTimes(6);
    expect(mesh.visible).toBe(true);
    expect(mesh.instanceMatrix.needsUpdate).toBe(true);
  });

  it('消火後も固定batch全slotへzero scale matrixを書き、batchを非表示にする', () => {
    const setMatrixAt = vi.fn();
    const mesh = {
      instanceMatrix: { needsUpdate: false },
      setMatrixAt,
      visible: true,
    } as unknown as THREE.InstancedMesh;
    const frame = createFireVoxelFrame({ elapsedSeconds: 0.2, layerCount: 0 });

    updateFireBatch(mesh, 'middle', frame.instances, createFireBatchScratch());

    expect(setMatrixAt).toHaveBeenCalledTimes(8);
    expect(mesh.visible).toBe(false);
    expect(mesh.instanceMatrix.needsUpdate).toBe(true);
  });

  it('見える炎から水平7unit内でおおむね正面ならtargetedな消火signalを作る', () => {
    const command = { moveX: 0, moveY: 0, spray: true } as const;
    const forgiving = resolveWaterAndFireFrame(
      {
        forward: [0, 0, -1],
        mass: 1.4,
        position: [29.5, 0.8, -10.2],
        resetCount: 0,
        speed: 0,
      },
      command,
      0.4,
      0.1,
    );
    const outside = resolveWaterAndFireFrame(
      {
        forward: [0, 0, -1],
        mass: 1.4,
        position: [29.5, 0.8, -7],
        resetCount: 0,
        speed: 0,
      },
      command,
    );
    const behind = resolveWaterAndFireFrame(
      {
        forward: [0, 0, 1],
        mass: 1.4,
        position: [29.5, 0.8, -10.2],
        resetCount: 0,
        speed: 0,
      },
      command,
    );

    expect(forgiving).toMatchObject({
      sprayActive: true,
      sprayElapsedSeconds: 0.4,
      sprayOnFire: true,
      splashElapsedSeconds: 0.1,
      targeted: true,
    });
    expect(forgiving.distance).toBeGreaterThan(5);
    expect(outside).toMatchObject({ sprayOnFire: false, targeted: false });
    expect(behind).toMatchObject({ sprayOnFire: false, targeted: false });
  });

  it('targeted放水signalだけが2500msの消火chainを完了する', () => {
    const runtime = new VoxelGameRuntime([]);
    const frame = resolveWaterAndFireFrame(
      {
        forward: [0, 0, -1],
        mass: 1.4,
        position: [29.5, 0.8, -10.2],
        resetCount: 0,
        speed: 0,
      },
      { moveX: 0, moveY: 0, spray: true },
    );

    runtime.setSignals({ sprayActive: frame.sprayActive, sprayOnFire: frame.sprayOnFire });
    runtime.advance(2_500);

    expect(runtime.getSnapshot()).toMatchObject({ fireIntensity: 0, missionPhase: 'celebrating' });
  });

  it('放水を押し続けたvehicle resetCount変化では時計をdeltaから再開する', () => {
    const resetEvent = isWaterVfxResetEvent(0, 1, 'assigned', 'assigned');

    expect(resetEvent).toBe(true);
    expect(advanceWaterVfxClock({
      deltaSeconds: 0.016,
      resetEvent,
      sprayActive: true,
      sprayElapsedSeconds: 0.8,
      sprayOnFire: true,
      splashElapsedSeconds: 0.18,
    })).toEqual({ sprayElapsedSeconds: 0.016, splashElapsedSeconds: 0.016 });
  });

  it('放水を押し続けたfreeRoamからassignedへの遷移では時計をdeltaから再開する', () => {
    const resetEvent = isWaterVfxResetEvent(4, 4, 'freeRoam', 'assigned');

    expect(resetEvent).toBe(true);
    expect(advanceWaterVfxClock({
      deltaSeconds: 0.016,
      resetEvent,
      sprayActive: true,
      sprayElapsedSeconds: 0.8,
      sprayOnFire: true,
      splashElapsedSeconds: 0.18,
    })).toEqual({ sprayElapsedSeconds: 0.016, splashElapsedSeconds: 0.016 });
  });

  it('通常の放水は時計を累積し、飛沫は0.22秒で循環する', () => {
    expect(advanceWaterVfxClock({
      deltaSeconds: 0.05,
      resetEvent: false,
      sprayActive: true,
      sprayElapsedSeconds: 0.4,
      sprayOnFire: true,
      splashElapsedSeconds: 0.2,
    })).toEqual({ sprayElapsedSeconds: 0.45, splashElapsedSeconds: 0.03 });
  });

  it('放水停止時は両方の時計を0へ戻す', () => {
    expect(advanceWaterVfxClock({
      deltaSeconds: 0.016,
      resetEvent: false,
      sprayActive: false,
      sprayElapsedSeconds: 0.8,
      sprayOnFire: false,
      splashElapsedSeconds: 0.18,
    })).toEqual({ sprayElapsedSeconds: 0, splashElapsedSeconds: 0 });
  });
});
