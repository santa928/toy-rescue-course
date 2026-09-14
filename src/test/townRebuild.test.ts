import { describe, expect, it } from 'vitest';
import { Box3, Euler, Matrix4, Quaternion, Ray, Vector3 } from 'three';
import { PRODUCTION_WORLD_MAP } from '../voxel-game/scene/productionWorldMap';
import { WORLD_SOLID_BOXES } from '../voxel-game/scene/worldCollisionLayout';
import { VEHICLE_DEFINITIONS } from '../voxel-game/domain/vehicleDefinitions';
import { WORLD_CAMERA_OFFSET } from '../voxel-game/scene/worldCameraConfig';
import { VEHICLE_JOBS } from '../voxel-game/domain/vehicleJobs';
import { createRescueDepot } from '../voxel-game/scene/toyTownArchitecture';
import { createRoadMarkings } from '../voxel-game/scene/worldRoadMarkings';
import { flattenDecorationBoxes } from '../voxel-game/scene/worldStreetscape';

import { FIRE_TRUCK_RENDER_PLAN } from '../vehicle-lab/scene/VoxelFireTruck';
import { BULLDOZER_RENDER_PLAN, getBulldozerActionPose } from '../vehicle-lab/scene/VoxelBulldozer';
import { EXCAVATOR_RENDER_PLAN, getExcavatorActionPose } from '../vehicle-lab/scene/VoxelExcavator';
import { AMBULANCE_RENDER_PLAN, getAmbulanceActionPose } from '../vehicle-lab/scene/VoxelAmbulance';
import { POLICE_RENDER_PLAN, getPoliceActionPose } from '../vehicle-lab/scene/VoxelPolice';

/** 描画・衝突共通boxのAABBを返す。 */
function bounds(box: { position: readonly number[]; scale: readonly number[]; rotation?: readonly number[] }): Box3 {
  const [rx, ry, rz] = box.rotation ?? [0, 0, 0];
  const matrix = new Matrix4().compose(new Vector3(...box.position),
    new Quaternion().setFromEuler(new Euler(rx, ry, rz)), new Vector3(1, 1, 1));
  return new Box3().setFromCenterAndSize(new Vector3(), new Vector3(...box.scale)).applyMatrix4(matrix);
}

const depot = createRescueDepot();
const spawn = PRODUCTION_WORLD_MAP.landmarks.garage;

describe('玩具街の造形と通行', () => {
  it('全5モデルの実voxel外接をHUD用の外接定義が包含する', () => {
    const plans = [FIRE_TRUCK_RENDER_PLAN, BULLDOZER_RENDER_PLAN, EXCAVATOR_RENDER_PLAN, AMBULANCE_RENDER_PLAN, POLICE_RENDER_PLAN];
    for (const [index, plan] of plans.entries()) {
      const definition = VEHICLE_DEFINITIONS[index];
      const halfEdge = plan.voxelSize * 0.94 / 2;
      for (const batch of plan.batches) for (const position of batch.positions) {
        for (const axis of [0, 1, 2]) {
          const center = position[axis] + plan.offset[axis];
          const min = definition.visualBounds.offset[axis] - definition.visualBounds.scale[axis] / 2;
          const max = definition.visualBounds.offset[axis] + definition.visualBounds.scale[axis] / 2;
          expect(center - halfEdge, `${definition.id} min axis ${axis}`).toBeGreaterThanOrEqual(min);
          expect(center + halfEdge, `${definition.id} max axis ${axis}`).toBeLessThanOrEqual(max);
        }
      }
    }
  });

  it('最大アクション中の道具と灯火もHUD用外接からはみ出さない', () => {
    const plans = [FIRE_TRUCK_RENDER_PLAN, BULLDOZER_RENDER_PLAN, EXCAVATOR_RENDER_PLAN, AMBULANCE_RENDER_PLAN, POLICE_RENDER_PLAN];
    const axis = new Vector3(1, 0, 0);
    const pivot = new Vector3(0.12, 0.72, -1.92);
    for (const [index, plan] of plans.entries()) {
      const model = VEHICLE_DEFINITIONS[index];
      const envelope = new Box3();
      const times = [
        ...Array.from({ length: 101 }, (_, step) => step / 100),
        // poseのphase端点・直前と、灯火のsin拡大ピークを明示する。
        ...[0.1, 0.15, 0.27, 0.43, 0.55, 0.25, 0.5, 0.72, 0.9, 0.18, 0.22]
          .flatMap(time => [time - 0.000001, time]),
        0.09, 0.11,
      ];
      for (const t of times) {
        const bull = getBulldozerActionPose(true, t);
        const excavator = getExcavatorActionPose(true, t);
        const ambulance = getAmbulanceActionPose(true, t);
        const police = getPoliceActionPose(true, t);
        for (const batch of plan.batches) for (const position of batch.positions) {
          for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
            const e = plan.voxelSize * 0.94 / 2;
            const point = new Vector3(position[0] + x * e, position[1] + y * e, position[2] + z * e);
            if (index === 1) {
              if (batch.paletteId === 'blade') point.y += bull.bladeY;
              point.y *= bull.bodyScaleY;
            }
            if (index === 2 && (batch.paletteId === 'arm' || batch.paletteId === 'bucket')) {
              if (batch.paletteId === 'bucket') point.sub(pivot).applyAxisAngle(axis, excavator.bucketRotationX).add(pivot);
              point.y += excavator.armY;
            }
            if (index === 3) {
              if (batch.paletteId === 'beacon') point.multiplyScalar(ambulance.beaconScale);
              if (batch.paletteId === 'cross') point.multiplyScalar(ambulance.crossScale);
            }
            if (index === 4) {
              if (batch.paletteId === 'redBeacon') point.multiplyScalar(police.redScale);
              if (batch.paletteId === 'blueBeacon') point.multiplyScalar(police.blueScale);
            }
            point.add(new Vector3(...plan.offset));
            envelope.expandByPoint(point);
          }
        }
      }
      const declared = bounds({ position: model.visualBounds.offset, scale: model.visualBounds.scale });
      expect(declared.containsBox(envelope), `${model.id}: ${JSON.stringify(envelope)}`).toBe(true);
    }
  });

  it('車庫の3壁・梁・軒・段屋根が接続している', () => {
    const find = (id: string) => depot.find(box => box.id === id)!;
    const eaves = bounds(find('garage-roof-eaves'));
    for (const id of ['garage-back-wall', 'garage-left-wall', 'garage-right-wall', 'garage-header']) {
      expect(eaves.clone().expandByScalar(0.001).intersectsBox(bounds(find(id))), id).toBe(true);
    }
    expect(bounds(find('garage-header')).intersectsBox(bounds(find('garage-left-wall')))).toBe(true);
    expect(bounds(find('garage-header')).intersectsBox(bounds(find('garage-right-wall')))).toBe(true);
    expect(eaves.clone().expandByScalar(0.001).intersectsBox(bounds(find('garage-roof-middle')))).toBe(true);
  });

  it.each(VEHICLE_DEFINITIONS)('$idが前庭で旋回し中央交差点へ抜けられる', vehicle => {
    const radius = Math.hypot(vehicle.collider.halfExtents[0], vehicle.collider.halfExtents[2]);
    for (const z of [0, 1, 2, 3, 4, 5, spawn[2]]) {
      for (const solid of WORLD_SOLID_BOXES) {
        const b = bounds(solid);
        const dx = Math.max(b.min.x - spawn[0], spawn[0] - b.max.x, 0);
        const dz = Math.max(b.min.z - z, z - b.max.z, 0);
        expect(Math.hypot(dx, dz), `${vehicle.id} z=${z} ${solid.id}`).toBeGreaterThan(radius);
      }
    }
  });

  it.each(VEHICLE_DEFINITIONS)('$idが車庫内部で向きを変えられる', vehicle => {
    const left = bounds(depot.find(box => box.id === 'garage-left-wall')!);
    const right = bounds(depot.find(box => box.id === 'garage-right-wall')!);
    const back = bounds(depot.find(box => box.id === 'garage-back-wall')!);
    const radius = Math.hypot(vehicle.collider.halfExtents[0], vehicle.collider.halfExtents[2]);
    expect(left.min.z - right.max.z).toBeGreaterThan(radius * 2 + 0.5);
    expect(left.max.x - back.max.x).toBeGreaterThan(radius * 2 + 0.5);
    const header = bounds(depot.find(box => box.id === 'garage-header')!);
    expect(header.min.y).toBeGreaterThan(vehicle.visualBounds.offset[1] + vehicle.visualBounds.scale[1] / 2 + 0.15);
  });

  it('東向きの車庫開口と乗換前庭が同じ敷地で接続する', () => {
    const header = bounds(depot.find(box => box.id === 'garage-header')!);
    const court = bounds(depot.find(box => box.id === 'garage-forecourt')!);
    const doorThreshold = new Vector3(header.max.x, court.min.y, header.getCenter(new Vector3()).z);
    expect(court.containsPoint(doorThreshold)).toBe(true);
    expect(header.max.x).toBeLessThan(spawn[0]);
    expect(header.min.z).toBeGreaterThan(2.5);
  });

  it('前庭と駐車線がタイヤを覆う高い床にならない', () => {
    for (const part of depot.filter(box => box.id === 'garage-forecourt' || box.id.startsWith('garage-parking-'))) {
      expect(bounds(part).max.y, part.id).toBeLessThanOrEqual(0.08);
    }
  });

  it.each(VEHICLE_DEFINITIONS)('$idの車体全頂点を車庫が隠さない', ({ visualBounds }) => {
    const eye = new Vector3(spawn[0] + WORLD_CAMERA_OFFSET[0], WORLD_CAMERA_OFFSET[1], spawn[2] + WORLD_CAMERA_OFFSET[2]);
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
      const target = new Vector3(spawn[0] + visualBounds.offset[0] + x * visualBounds.scale[0] / 2,
        visualBounds.offset[1] + y * visualBounds.scale[1] / 2,
        spawn[2] + visualBounds.offset[2] + z * visualBounds.scale[2] / 2);
      const ray = new Ray(eye, target.clone().sub(eye).normalize());
      for (const part of depot.filter(box => box.scale[1] > 0.1)) {
        const hit = ray.intersectBox(bounds(part), new Vector3());
        expect(hit === null || eye.distanceTo(hit) >= eye.distanceTo(target), part.id).toBe(true);
      }
    }
  });

  it('15仕事の最後の進入点から最初の対象までをsolidが遮らない', () => {
    const jobs = Object.values(VEHICLE_JOBS).flat();
    expect(jobs).toHaveLength(15);
    for (const job of jobs) {
      const last = job.routeMarkers.at(-1)!;
      const targetPosition = 'sprayTarget' in job ? job.sprayTarget : 'debris' in job ? job.debris[0].position : job.targets[0].position;
      const target = new Vector3(...targetPosition);
      const eye = new Vector3(last[0], target.y, last[2]);
      const ray = new Ray(eye, target.clone().sub(eye).normalize());
      for (const solid of WORLD_SOLID_BOXES) {
        expect(bounds(solid).containsPoint(target), `${job.id}: target inside ${solid.id}`).toBe(false);
        const hit = ray.intersectBox(bounds(solid), new Vector3());
        expect(hit === null || eye.distanceTo(hit) >= eye.distanceTo(target), `${job.id}: ${solid.id}`).toBe(true);
      }
    }
  });

  it('救急の案内名に対応する池・遊具・ピクニックを対象のすぐそばに置く', () => {
    const scenery = [...PRODUCTION_WORLD_MAP.visualBoxes,
      ...flattenDecorationBoxes(PRODUCTION_WORLD_MAP.decorationClusters)];
    for (const [jobId, landmarkId] of [
      ['patient-pond', 'park-pond'],
      ['patient-playground', 'playground-plank'],
      ['patient-picnic', 'park-picnic-blanket'],
    ]) {
      const job = VEHICLE_JOBS.ambulance.find(candidate => candidate.id === jobId)!;
      const landmark = scenery.find(candidate => candidate.id === landmarkId)!;
      const [x, , z] = job.targets[0].position;
      const gapX = Math.max(0, Math.abs(x - landmark.position[0]) - landmark.scale[0] / 2);
      const gapZ = Math.max(0, Math.abs(z - landmark.position[2]) - landmark.scale[2] / 2);
      expect(Math.hypot(gapX, gapZ), jobId).toBeLessThan(3);
    }
  });

  it('移設した車庫の壁が全15仕事の出発案内を横切らない', () => {
    for (const job of Object.values(VEHICLE_JOBS).flat()) {
      const route = [spawn, ...job.routeMarkers];
      for (let index = 1; index < route.length; index += 1) {
        const start = new Vector3(route[index - 1][0], 0.8, route[index - 1][2]);
        const end = new Vector3(route[index][0], 0.8, route[index][2]);
        const ray = new Ray(start, end.clone().sub(start).normalize());
        for (const wall of depot.filter(part => part.solid)) {
          // 車幅・車長の半径を含め、黄色い案内線だけが壁を避ける偽の通路を拒む。
          const hit = ray.intersectBox(bounds(wall).expandByVector(new Vector3(1.7, 0, 1.7)), new Vector3());
          expect(hit === null || start.distanceTo(hit) >= start.distanceTo(end), `${job.id}: ${wall.id} segment ${index}`).toBe(true);
        }
      }
    }
  });

  it('南の巡回路と積み木広場は遊びに関係ない小物で塞がない', () => {
    const boxes = [...PRODUCTION_WORLD_MAP.visualBoxes,
      ...flattenDecorationBoxes(PRODUCTION_WORLD_MAP.decorationClusters)];
    for (const area of [
      new Box3(new Vector3(-2.5, 0.2, 14), new Vector3(2.5, 3, 34)),
      new Box3(new Vector3(-30, 0.2, -10), new Vector3(-14, 3, 16)),
    ]) {
      expect(boxes.filter(box => bounds(box).intersectsBox(area)).map(box => box.id)).toEqual([]);
    }
  });

  it('全15仕事の出発から道しるべまで、車幅を含む経路を固定障害物で塞がない', () => {
    for (const job of Object.values(VEHICLE_JOBS).flat()) {
      const route = [spawn, ...job.routeMarkers];
      for (let index = 1; index < route.length; index += 1) {
        const start = new Vector3(route[index - 1][0], 0, route[index - 1][2]);
        const end = new Vector3(route[index][0], 0, route[index][2]);
        if (start.equals(end)) continue;
        const ray = new Ray(start, end.clone().sub(start).normalize());
        for (const solid of WORLD_SOLID_BOXES) {
          const obstacle = bounds(solid);
          obstacle.expandByVector(new Vector3(1.45, 0, 1.7));
          obstacle.min.y = -1;
          obstacle.max.y = 1;
          expect(obstacle.containsPoint(start) || obstacle.containsPoint(end),
            `${job.id}: inside ${solid.id} segment ${index}`).toBe(false);
          const hit = ray.intersectBox(obstacle, new Vector3());
          expect(hit === null || start.distanceTo(hit) >= start.distanceTo(end),
            `${job.id}: ${solid.id} segment ${index}`).toBe(true);
        }
      }
    }
  });

  it('帰庫前庭を道路と中央線が横切らず、全交差点で中央線が途切れる', () => {
    const forecourt = new Box3(new Vector3(-2.5, 0, 2.51), new Vector3(2.5, 1, 9.99));
    expect(PRODUCTION_WORLD_MAP.roads.every(road => !bounds(road).intersectsBox(forecourt))).toBe(true);
    const markings = createRoadMarkings(PRODUCTION_WORLD_MAP.roads);
    expect(markings.length).toBeGreaterThan(25);
    for (const marking of markings) {
      const horizontal = marking.scale[0] > marking.scale[2];
      for (const road of PRODUCTION_WORLD_MAP.roads) {
        if ((road.scale[0] > road.scale[2]) === horizontal) continue;
        const roadBounds = bounds(road);
        roadBounds.min.y = 0;
        roadBounds.max.y = 1;
        expect(bounds(marking).intersectsBox(roadBounds), road.id).toBe(false);
      }
    }
  });
});
