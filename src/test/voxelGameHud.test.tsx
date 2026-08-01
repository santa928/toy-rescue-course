import { renderToStaticMarkup } from 'react-dom/server';
import type { RefObject } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { VehicleMissionSnapshot } from '../voxel-game/domain/VehicleMissionCoordinator';
import type { VehicleColorEffectSnapshot } from '../voxel-game/domain/VehicleColorEffectRuntime';
import type { DriveCommand } from '../voxel-game/input/controlState';
import type { VoxelGameControls } from '../voxel-game/input/useVoxelGameControls';
import { VoxelGameHud } from '../voxel-game/ui/VoxelGameHud';

/** DOM eventなしでHUDの文言とariaを描画する最小controlsを返す。 */
function createControls(): VoxelGameControls {
  const commandRef = {
    current: { moveX: 0, moveY: 0, primaryAction: false },
  } satisfies RefObject<DriveCommand>;
  return {
    commandRef,
    primaryActionPressed: false,
    reset: vi.fn(),
    setPrimaryAction: vi.fn(),
    setTouchStick: vi.fn(),
  };
}

const bulldozerMission: VehicleMissionSnapshot = {
  destinationDistrict: 'blocks',
  id: 'debris-clearance',
  jobCycle: 1,
  jobId: 'debris-north',
  jobLabel: 'きたのがれきをかたづけよう',
  objectiveLabel: 'こうじげんばへ いこう',
  phase: 'assigned',
  progress: { current: 0, target: 3 },
  routeVisible: true,
  vehicleId: 'bulldozer',
};

const inactiveColorEffect: VehicleColorEffectSnapshot = {
  active: false,
  activationCount: 0,
  colorHex: null,
  colorId: null,
  contactSourceId: null,
  remainingMilliseconds: 0,
  remainingSeconds: 0,
  sourceId: null,
  sourceKind: null,
  vehicleId: null,
};

describe('VoxelGameHud', () => {
  it('車庫では2台の選択状態とブルドーザー固有の主操作を公開する', () => {
    const html = renderToStaticMarkup(<VoxelGameHud
      canSwitchVehicle
      colorEffect={inactiveColorEffect}
      controls={createControls()}
      fullscreen={false}
      fullscreenAvailable
      mission={bulldozerMission}
      onSelectVehicle={vi.fn()}
      onToggleFullscreen={vi.fn()}
      selectedVehicleId="bulldozer"
    />);

    expect(html).toContain('aria-label="のりものをえらぶ"');
    expect(html).toContain('しょうぼうしゃ');
    expect(html).toContain('ブルドーザー');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-label="ブレードを動かす"');
    expect(html).toContain('こうじげんばへ いこう');
  });

  it('車庫外では乗り換えUIを隠す', () => {
    const html = renderToStaticMarkup(<VoxelGameHud
      canSwitchVehicle={false}
      colorEffect={inactiveColorEffect}
      controls={createControls()}
      fullscreen={false}
      fullscreenAvailable
      mission={bulldozerMission}
      onSelectVehicle={vi.fn()}
      onToggleFullscreen={vi.fn()}
      selectedVehicleId="bulldozer"
    />);

    expect(html).not.toContain('aria-label="のりものをえらぶ"');
    expect(html).not.toContain('color-effect-pill');
  });

  it('一時色が有効な間だけ色と残秒を仕事pill下のaria-liveへ表示する', () => {
    const html = renderToStaticMarkup(<VoxelGameHud
      canSwitchVehicle={false}
      colorEffect={{
        ...inactiveColorEffect,
        active: true,
        activationCount: 2,
        colorHex: '#3b82f6',
        colorId: 'blue',
        remainingMilliseconds: 8_240,
        remainingSeconds: 9,
        sourceId: 'shower-blue',
        sourceKind: 'shower',
        vehicleId: 'bulldozer',
      }}
      controls={createControls()}
      fullscreen={false}
      fullscreenAvailable
      mission={bulldozerMission}
      onSelectVehicle={vi.fn()}
      onToggleFullscreen={vi.fn()}
      selectedVehicleId="bulldozer"
    />);

    expect(html).toContain('class="status-stack"');
    expect(html).toContain('class="color-effect-pill"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('あお 9びょう');
    expect(html).toContain('data-color="blue"');
  });
});
