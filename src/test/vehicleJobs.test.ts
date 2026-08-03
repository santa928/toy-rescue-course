import { describe, expect, it } from 'vitest';
import {
  VEHICLE_JOBS,
  getVehicleJobs,
  validateDecorationClearanceFromVehicleJobs,
  validateVehicleJobs,
  type VehicleJobRegistry,
} from '../voxel-game/domain/vehicleJobs';
import {
  PRODUCTION_WORLD_MAP,
  resolveWorldDistrict,
  type WorldBoxDefinition,
} from '../voxel-game/scene/productionWorldMap';
import { getVehicleDefinition } from '../voxel-game/domain/vehicleDefinitions';
import { flattenDecorationBoxes } from '../voxel-game/scene/worldStreetscape';

describe('vehicle jobs', () => {
  it('消防車へ道路から見える3つの実在火災仕事を定義する', () => {
    const jobs = VEHICLE_JOBS['fire-truck'];

    expect(getVehicleJobs('fire-truck')).toBe(jobs);
    expect(jobs.map(({ id, label, sprayTarget }) => ({ id, label, sprayTarget }))).toEqual([
      {
        id: 'fire-side',
        label: 'よこの火をけそう',
        sprayTarget: [26.9, 1.45, -16.1],
      },
      {
        id: 'fire-hydrant',
        label: 'しょうかせんのそばをけそう',
        sprayTarget: [18.5, 1.45, -10.5],
      },
      {
        id: 'fire-planter',
        label: 'おはなのそばをけそう',
        sprayTarget: [25.5, 1.45, -8],
      },
    ]);
    expect(jobs.every((job) => (
      job.kind === 'fire-rescue'
      && job.vehicleId === 'fire-truck'
      && job.destinationDistrict === 'fire'
      && resolveWorldDistrict(job.sprayTarget) === 'fire'
      && job.routeMarkers.length === 12
      && job.celebrationStarCenters.length === 6
    ))).toBe(true);
  });

  it('屋外火災は建物の南側で見え、最後の道しるべが東から火を向く', () => {
    const fireBuilding = PRODUCTION_WORLD_MAP.visualBoxes
      .find(({ id }) => id === 'fire-building-body');
    expect(fireBuilding).toBeDefined();
    if (!fireBuilding) return;
    const southEdge = fireBuilding.position[2] + fireBuilding.scale[2] / 2;
    const [colliderHalfX, , colliderHalfZ] = getVehicleDefinition('fire-truck')
      .collider.halfExtents;
    const turningCorridorSupport = Math.hypot(colliderHalfX, colliderHalfZ);
    const corridorReserve = 0.5;

    for (const job of VEHICLE_JOBS['fire-truck'].slice(1)) {
      const approachStart = job.routeMarkers.at(-2);
      const approachEnd = job.routeMarkers.at(-1);

      expect(job.sprayTarget[2]).toBeGreaterThan(southEdge);
      expect(job.sprayTarget[2] - turningCorridorSupport)
        .toBeGreaterThan(southEdge + corridorReserve);
      expect(approachStart?.[2]).toBe(job.sprayTarget[2]);
      expect(approachEnd?.[2]).toBe(job.sprayTarget[2]);
      expect(approachStart?.[0]).toBeGreaterThan(approachEnd?.[0] ?? Number.POSITIVE_INFINITY);
      expect(approachEnd?.[0]).toBeGreaterThan(job.sprayTarget[0]);
    }
  });

  it('ブルドーザーへ木・石・箱を含む3つの実在工事仕事を定義する', () => {
    const jobs = getVehicleJobs('bulldozer');

    expect(jobs.map(({ id }) => id)).toEqual([
      'debris-north',
      'debris-south',
      'debris-west',
    ]);
    expect(jobs.every((job) => (
      job.kind === 'debris-clearance'
      && job.vehicleId === 'bulldozer'
      && job.destinationDistrict === 'blocks'
      && job.routeMarkers.length === 7
      && job.debris.length === 3
      && job.debris.every(({ position }) => resolveWorldDistrict(position) === 'blocks')
      && new Set(job.debris.map(({ palette }) => palette)).size === 3
    ))).toBe(true);
  });

  it('ショベルカーへ西地区の3つの土掘り仕事を定義する', () => {
    const jobs = getVehicleJobs('excavator');

    expect(jobs.map(({ id }) => id)).toEqual([
      'soil-north',
      'soil-south',
      'soil-west',
    ]);
    expect(jobs.every((job) => (
      job.kind === 'soil-digging'
      && job.vehicleId === 'excavator'
      && job.destinationDistrict === 'blocks'
      && job.targetKind === 'soil'
      && job.routeMarkers.length === 7
      && job.targets.length === 3
      && job.targets.every(({ position }) => resolveWorldDistrict(position) === 'blocks')
      && job.interaction.contactRadius === 1.6
      && job.interaction.holdDurationMs === 700
      && job.interaction.maximumSpeed === 0.45
    ))).toBe(true);
  });

  it('救急車へ公園の1体を手当てする3仕事を定義する', () => {
    const jobs = getVehicleJobs('ambulance');

    expect(jobs.map(({ id }) => id)).toEqual([
      'patient-pond',
      'patient-playground',
      'patient-picnic',
    ]);
    expect(jobs.every((job) => (
      job.kind === 'patient-care'
      && job.vehicleId === 'ambulance'
      && job.destinationDistrict === 'park'
      && job.targetKind === 'patient'
      && job.routeMarkers.length === 7
      && job.targets.length === 1
      && job.targets.every(({ position }) => resolveWorldDistrict(position) === 'park')
      && job.interaction.contactRadius === 1.8
      && job.interaction.forwardOffset === 0
      && job.interaction.holdDurationMs === 1_200
      && job.interaction.maximumSpeed === 0.35
    ))).toBe(true);
  });

  it('パトカーへ南地区の3地点を巡回する3仕事を定義する', () => {
    const jobs = getVehicleJobs('police');

    expect(jobs.map(({ id }) => id)).toEqual([
      'patrol-main',
      'patrol-pools',
      'patrol-showers',
    ]);
    expect(jobs.every((job) => (
      job.kind === 'patrol'
      && job.vehicleId === 'police'
      && job.destinationDistrict === 'south'
      && job.targetKind === 'checkpoint'
      && job.routeMarkers.length === 7
      && job.targets.length === 3
      && job.targets.every(({ position }) => resolveWorldDistrict(position) === 'south')
      && job.interaction.contactRadius === 1.5
      && job.interaction.forwardOffset === 0
      && job.interaction.holdDurationMs === 250
      && job.interaction.minimumSpeed === 0.35
      && job.interaction.maximumSpeed === 5.5
    ))).toBe(true);
  });

  it('全仕事を一意なIDと短い仕事札で公開し、canonical定義を検証する', () => {
    const jobs = [
      ...VEHICLE_JOBS['fire-truck'],
      ...VEHICLE_JOBS.bulldozer,
      ...VEHICLE_JOBS.excavator,
      ...VEHICLE_JOBS.ambulance,
      ...VEHICLE_JOBS.police,
    ];

    expect(new Set(jobs.map(({ id }) => id)).size).toBe(jobs.length);
    expect(jobs.every(({ label }) => label.length > 0 && label.length <= 18)).toBe(true);
    expect(validateVehicleJobs(VEHICLE_JOBS)).toEqual([]);
  });

  it('15仕事の実targetから新solidを1.5unit離し、非solidは通過可能にする', () => {
    const jobs = [
      ...VEHICLE_JOBS['fire-truck'],
      ...VEHICLE_JOBS.bulldozer,
      ...VEHICLE_JOBS.excavator,
      ...VEHICLE_JOBS.ambulance,
      ...VEHICLE_JOBS.police,
    ];
    const decorationBoxes = flattenDecorationBoxes(PRODUCTION_WORLD_MAP.decorationClusters);
    const patient = VEHICLE_JOBS.ambulance[0].targets[0];
    const blocker = {
      color: '#86552f',
      id: 'test-job-blocker',
      position: patient.position,
      scale: [0.6, 1.8, 0.6],
      solid: true,
    } as const satisfies WorldBoxDefinition;
    const passThrough = { ...blocker, id: 'test-job-pass-through', solid: false } as const;

    expect(validateDecorationClearanceFromVehicleJobs(jobs, decorationBoxes)).toEqual([]);
    expect(validateDecorationClearanceFromVehicleJobs(jobs, [blocker])).toEqual([
      'Decoration solid test-job-blocker overlaps vehicle job patient-pond target patient-pond-a',
    ]);
    expect(validateDecorationClearanceFromVehicleJobs(jobs, [passThrough])).toEqual([]);
  });

  it('未知の車種IDを初期消防車の仕事へ安全に戻す', () => {
    expect(getVehicleJobs('unknown')).toBe(VEHICLE_JOBS['fire-truck']);
    expect(getVehicleJobs(null)).toBe(VEHICLE_JOBS['fire-truck']);
  });

  it('重複ID、空文言、車種不一致、対象不足を決定的なerrorへ変換する', () => {
    const fireJob = VEHICLE_JOBS['fire-truck'][0];
    const bulldozerJob = VEHICLE_JOBS.bulldozer[0];
    const invalidRegistry = {
      'fire-truck': [
        fireJob,
        { ...fireJob, id: fireJob.id, label: '' },
      ],
      bulldozer: [
        {
          ...bulldozerJob,
          debris: bulldozerJob.debris.slice(0, 2),
          vehicleId: 'fire-truck',
        },
      ],
      excavator: VEHICLE_JOBS.excavator,
      ambulance: VEHICLE_JOBS.ambulance,
      police: VEHICLE_JOBS.police,
    } as unknown as VehicleJobRegistry;

    expect(validateVehicleJobs(invalidRegistry)).toEqual([
      'Vehicle fire-truck must have exactly 3 jobs',
      'Duplicate vehicle job id: fire-side',
      'Vehicle job fire-side must have a non-empty label',
      'Vehicle bulldozer must have exactly 3 jobs',
      'Vehicle job debris-north belongs to fire-truck, expected bulldozer',
      'Bulldozer job debris-north must have exactly 3 debris',
      'Bulldozer job debris-north must include timber, stone, and crate',
    ]);
  });
});
