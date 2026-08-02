import { useEffect, useRef } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import type { VehicleMissionGuidance } from '../domain/missionGuidance';
import type { VehicleId } from '../domain/vehicleDefinitions';
import { PRODUCTION_WORLD_MAP } from '../scene/productionWorldMap';
import type { VehicleTelemetryRef } from '../scene/VehicleController';
import { projectWorldToMissionMap } from './missionMap';

interface MissionMiniMapProps {
  readonly guidance: VehicleMissionGuidance;
  readonly telemetryRef: VehicleTelemetryRef;
  readonly vehicleId: VehicleId;
}

/** map投影結果を絶対配置用の百分率styleへ変換する。 */
function toMarkerStyle(position: readonly [number, number, number]): CSSProperties {
  const projected = projectWorldToMissionMap(position, PRODUCTION_WORLD_MAP.bounds);
  return { left: `${projected.leftPercent}%`, top: `${projected.topPercent}%` };
}

/** world地区境界をマップ内の絶対配置styleへ変換する。 */
function toDistrictStyle(bounds: typeof PRODUCTION_WORLD_MAP.districts[number]['bounds']): CSSProperties {
  const topLeft = projectWorldToMissionMap(
    [bounds.minX, 0, bounds.minZ],
    PRODUCTION_WORLD_MAP.bounds,
  );
  const bottomRight = projectWorldToMissionMap(
    [bounds.maxX, 0, bounds.maxZ],
    PRODUCTION_WORLD_MAP.bounds,
  );
  return {
    height: `${bottomRight.topPercent - topLeft.topPercent}%`,
    left: `${topLeft.leftPercent}%`,
    top: `${topLeft.topPercent}%`,
    width: `${bottomRight.leftPercent - topLeft.leftPercent}%`,
  };
}

/** 現在地と次ターゲットを玩具の道路標識として常時同期する小型マップ。 */
export function MissionMiniMap({
  guidance,
  telemetryRef,
  vehicleId,
}: MissionMiniMapProps): ReactElement {
  const playerMarkerRef = useRef<HTMLSpanElement>(null);
  const distanceRef = useRef<HTMLSpanElement>(null);
  const initialPosition = telemetryRef.current.position;
  const initialDistance = Math.round(Math.hypot(
    guidance.targetPosition[0] - initialPosition[0],
    guidance.targetPosition[2] - initialPosition[2],
  ));

  useEffect(() => {
    let animationFrameId = 0;
    /** React再描画を発生させず、現在地markerと目的地までの距離だけを更新する。 */
    const syncMarker = (): void => {
      const marker = playerMarkerRef.current;
      const distance = distanceRef.current;
      const position = telemetryRef.current.position;
      const projected = projectWorldToMissionMap(position, PRODUCTION_WORLD_MAP.bounds);
      if (marker) {
        marker.style.left = `${projected.leftPercent}%`;
        marker.style.top = `${projected.topPercent}%`;
      }
      if (distance) {
        distance.textContent = `${Math.round(Math.hypot(
          guidance.targetPosition[0] - position[0],
          guidance.targetPosition[2] - position[2],
        ))}m`;
      }
      animationFrameId = window.requestAnimationFrame(syncMarker);
    };
    animationFrameId = window.requestAnimationFrame(syncMarker);
    return () => window.cancelAnimationFrame(animationFrameId);
  }, [guidance.targetPosition, telemetryRef]);

  return (
    <section
      aria-label={`おしごとマップ。${guidance.targetLabel}`}
      className="mission-map"
      data-vehicle={vehicleId}
    >
      <span className="mission-map__caption">
        <span>{guidance.targetLabel}</span>
        <span aria-label="目的地までの距離" ref={distanceRef}>{initialDistance}m</span>
      </span>
      <span aria-hidden="true" className="mission-map__board">
        {PRODUCTION_WORLD_MAP.districts.map((district) => (
          <span
            className="mission-map__district"
            data-district={district.id}
            key={district.id}
            style={toDistrictStyle(district.bounds)}
          />
        ))}
        <span className="mission-map__garage" style={toMarkerStyle(PRODUCTION_WORLD_MAP.landmarks.garage)} />
        <span className="mission-map__target" style={toMarkerStyle(guidance.targetPosition)} />
        <span
          className="mission-map__player"
          ref={playerMarkerRef}
          style={toMarkerStyle(initialPosition)}
        />
      </span>
    </section>
  );
}
