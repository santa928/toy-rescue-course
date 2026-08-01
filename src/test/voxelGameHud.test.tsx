import { renderToStaticMarkup } from 'react-dom/server';
import type { RefObject } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { VehicleMissionSnapshot } from '../voxel-game/domain/VehicleMissionCoordinator';
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
  objectiveLabel: 'こうじげんばへ いこう',
  phase: 'assigned',
  progress: { current: 0, target: 3 },
  routeVisible: true,
  vehicleId: 'bulldozer',
};

describe('VoxelGameHud', () => {
  it('車庫では2台の選択状態とブルドーザー固有の主操作を公開する', () => {
    const html = renderToStaticMarkup(<VoxelGameHud
      canSwitchVehicle
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
      controls={createControls()}
      fullscreen={false}
      fullscreenAvailable
      mission={bulldozerMission}
      onSelectVehicle={vi.fn()}
      onToggleFullscreen={vi.fn()}
      selectedVehicleId="bulldozer"
    />);

    expect(html).not.toContain('aria-label="のりものをえらぶ"');
  });
});
