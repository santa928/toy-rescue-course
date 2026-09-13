import { describe, expect, it } from 'vitest';
import { Box3, Ray, Vector3 } from 'three';
import { PRODUCTION_WORLD_MAP } from '../voxel-game/scene/productionWorldMap';
import { WORLD_SOLID_BOXES } from '../voxel-game/scene/worldCollisionLayout';
import { VEHICLE_DEFINITIONS } from '../voxel-game/domain/vehicleDefinitions';
import { resolveActionHoldProgress } from '../voxel-game/ui/ActionHoldProgress';
import { buildMissionGuidance } from '../voxel-game/domain/missionGuidance';
import { VehicleMissionCoordinator } from '../voxel-game/domain/VehicleMissionCoordinator';

describe('初見体験の回帰', () => {
  it('車庫の描画と衝突が同じ形状定義を共有する', () => {
    for (const rendered of PRODUCTION_WORLD_MAP.visualBoxes.filter(box => box.solid)) {
      expect(WORLD_SOLID_BOXES.find(box => box.id === rendered.id)).toBe(rendered);
    }
  });

  it.each(VEHICLE_DEFINITIONS)('$idの初期車体中央からカメラへの視線を車庫が遮らない', ({ visualBounds }) => {
    const eye = new Vector3(10, 12, 18);
    const target = new Vector3(visualBounds.offset[0], visualBounds.offset[1], 6 + visualBounds.offset[2]);
    const distance = eye.distanceTo(target);
    const ray = new Ray(eye, target.clone().sub(eye).normalize());
    for (const box of PRODUCTION_WORLD_MAP.visualBoxes.filter(({ id }) => id.startsWith('garage-'))) {
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
