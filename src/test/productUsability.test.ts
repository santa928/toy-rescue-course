import { describe, expect, it } from 'vitest';
import { Box3, Ray, Vector3 } from 'three';
import { createGarageCutawayBoxes } from '../voxel-game/scene/garageCutaway';
import { PRODUCTION_WORLD_MAP } from '../voxel-game/scene/productionWorldMap';
import { WORLD_SOLID_BOXES } from '../voxel-game/scene/worldCollisionLayout';
import { VEHICLE_DEFINITIONS } from '../voxel-game/domain/vehicleDefinitions';
import { resolveActionHoldProgress } from '../voxel-game/ui/ActionHoldProgress';
import { buildMissionGuidance } from '../voxel-game/domain/missionGuidance';
import { VehicleMissionCoordinator } from '../voxel-game/domain/VehicleMissionCoordinator';

describe('初見体験の回帰', () => {
  it('車庫の4描画部品だけを派生させ、全solid形状と足元の境界を維持する', () => {
    const original = JSON.stringify(WORLD_SOLID_BOXES);
    const canonical = PRODUCTION_WORLD_MAP.visualBoxes;
    const rendered = createGarageCutawayBoxes(canonical);
    const changed = rendered.filter((box, index) => box !== canonical[index]);
    expect(changed.map(({ id }) => id)).toEqual([
      'garage-back-wall', 'garage-right-wall', 'garage-roof-right', 'garage-roof-back',
    ]);
    expect(JSON.stringify(WORLD_SOLID_BOXES)).toBe(original);
    for (const box of changed) {
      const source = canonical.find(({ id }) => id === box.id)!;
      expect([box.position[0], box.position[2], box.scale[0], box.scale[2]])
        .toEqual([source.position[0], source.position[2], source.scale[0], source.scale[2]]);
      expect(box.scale[1]).toBeGreaterThan(0);
      expect(box.position[1] + box.scale[1] / 2).toBeLessThanOrEqual(1.2 + 1e-9);
    }
  });

  it.each(VEHICLE_DEFINITIONS)('$idの初期車体中央からカメラへの視線を車庫が遮らない', ({ visualBounds }) => {
    const eye = new Vector3(10, 12, 18);
    const target = new Vector3(visualBounds.offset[0], visualBounds.offset[1], 6 + visualBounds.offset[2]);
    const distance = eye.distanceTo(target);
    const ray = new Ray(eye, target.clone().sub(eye).normalize());
    for (const box of createGarageCutawayBoxes(PRODUCTION_WORLD_MAP.visualBoxes).filter(({ id }) => id.startsWith('garage-'))) {
      const geometry = new Box3().setFromCenterAndSize(new Vector3(...box.position), new Vector3(...box.scale));
      const hit = ray.intersectBox(geometry, new Vector3());
      expect(hit === null || eye.distanceTo(hit) >= distance, box.id).toBe(true);
    }
  });

  it('実際のholdだけでゲージを出し、中断・対象外では0へ戻す', () => {
    expect(resolveActionHoldProgress(new Float64Array([0, 350, 0]), 700)).toBe(0.5);
    expect(resolveActionHoldProgress(new Float64Array([0, 600, 0]), 1200)).toBe(0.5);
    expect(resolveActionHoldProgress(new Float64Array(3), 1200)).toBe(0);
    expect(resolveActionHoldProgress([Infinity, NaN, -1], 1200)).toBe(0);
  });

  it.each(VEHICLE_DEFINITIONS)('$idの案内が実際のボタン名を使う', ({ id, action }) => {
    const coordinator = new VehicleMissionCoordinator(['block-a'], { jobSeed: 1 });
    coordinator.selectVehicle(id, { atGarage: true, speed: 0 });
    expect(buildMissionGuidance(coordinator.getSnapshot()).instructionLabel).toContain(`「${action.label}」`);
  });
});
