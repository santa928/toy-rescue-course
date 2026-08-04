import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculatePlanarBoxContact,
  selectCollisionKeyboardAxis,
} from './collision-geometry.mjs';

const VEHICLE_HALF_EXTENTS = [1.45, 0.95, 1.7];

test('正面接触は接触面の貫通深さを0として返す', () => {
  const contact = calculatePlanarBoxContact(
    { forward: [0, 0, 1], position: [0, 0, 0] },
    { position: [0, 0, 2.05], scale: [0.7, 2, 0.7] },
    VEHICLE_HALF_EXTENTS,
  );

  assert(Math.abs(contact.penetrationDepth) < 1e-9);
  assert.equal(contact.intersects, true);
});

test('斜め角接触はworld Z投影ではなく最小分離軸の貫通深さを返す', () => {
  const contact = calculatePlanarBoxContact(
    {
      forward: [0.09480318298988256, 0, 0.9954960353989296],
      position: [-4.783548355102539, 0, 16.53130340576172],
    },
    { position: [-3.5, 0, 18.5], scale: [0.7, 2, 0.7] },
    VEHICLE_HALF_EXTENTS,
  );

  assert(-contact.axisClearances.worldZ > 0.12);
  assert(contact.penetrationDepth < 0.12);
  assert.equal(contact.intersects, true);
});

test('離れた箱は正の分離距離と非接触を返す', () => {
  const contact = calculatePlanarBoxContact(
    { forward: [0, 0, 1], position: [0, 0, 0] },
    { position: [0, 0, 3], scale: [0.7, 2, 0.7] },
    VEHICLE_HALF_EXTENTS,
  );

  assert(contact.separationDistance > 0.9);
  assert.equal(contact.intersects, false);
  assert.equal(contact.penetrationDepth, 0);
});

test('keyboard接近は横ずれ時だけ補正軸へ切り替える', () => {
  assert.deepEqual(selectCollisionKeyboardAxis({
    approachAxis: 'z',
    approachDirection: 1,
    obstaclePosition: [-3.5, 0, 18.5],
    perpendicularTolerance: 0.45,
    vehiclePosition: [-4.2, 0, 12],
  }), { axis: 'positiveX', correcting: true });
  assert.deepEqual(selectCollisionKeyboardAxis({
    approachAxis: 'z',
    approachDirection: 1,
    obstaclePosition: [-3.5, 0, 18.5],
    perpendicularTolerance: 0.45,
    vehiclePosition: [-3.7, 0, 12],
  }), { axis: 'positiveZ', correcting: false });
  assert.deepEqual(selectCollisionKeyboardAxis({
    approachAxis: 'x',
    approachDirection: -1,
    obstaclePosition: [-6, 0, 0],
    perpendicularTolerance: 0.45,
    vehiclePosition: [-1.5, 0, -0.8],
  }), { axis: 'positiveZ', correcting: true });
});
