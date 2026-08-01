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

const excavatorMission: VehicleMissionSnapshot = {
  destinationDistrict: 'blocks',
  id: 'soil-digging',
  jobCycle: 1,
  jobId: 'soil-north',
  jobLabel: 'きたのつちをほろう',
  objectiveLabel: 'つち あと3こ',
  phase: 'active',
  progress: { current: 0, target: 3 },
  routeVisible: false,
  vehicleId: 'excavator',
};

const ambulanceMission: VehicleMissionSnapshot = {
  destinationDistrict: 'park',
  id: 'patient-care',
  jobCycle: 1,
  jobId: 'patient-pond',
  jobLabel: 'いけのそばで てあてしよう',
  objectiveLabel: 'てあてをしよう',
  phase: 'active',
  progress: { current: 0, target: 1 },
  routeVisible: false,
  vehicleId: 'ambulance',
};

const policeMission: VehicleMissionSnapshot = {
  destinationDistrict: 'south',
  id: 'patrol',
  jobCycle: 1,
  jobId: 'patrol-main',
  jobLabel: 'まんなかを みまわろう',
  objectiveLabel: 'みまわり あと3かしょ',
  phase: 'active',
  progress: { current: 0, target: 3 },
  routeVisible: false,
  vehicleId: 'police',
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

const audioOff = {
  available: true,
  contextState: 'locked' as const,
  enabled: false,
  pending: false,
};

describe('VoxelGameHud', () => {
  it('車庫では5台の選択状態とブルドーザー固有の主操作を公開する', () => {
    const html = renderToStaticMarkup(<VoxelGameHud
      audio={audioOff}
      canSwitchVehicle
      colorEffect={inactiveColorEffect}
      controls={createControls()}
      fullscreen={false}
      fullscreenAvailable
      mission={bulldozerMission}
      onToggleAudio={vi.fn()}
      onSelectVehicle={vi.fn()}
      onToggleFullscreen={vi.fn()}
      selectedVehicleId="bulldozer"
    />);

    expect(html).toContain('aria-label="のりものをえらぶ"');
    expect(html).toContain('しょうぼうしゃ');
    expect(html).toContain('ブルドーザー');
    expect(html).toContain('ショベルカー');
    expect(html).toContain('きゅうきゅうしゃ');
    expect(html).toContain('パトカー');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-label="ブレードを動かす"');
    expect(html).toContain('きたのがれきをかたづけよう');
    expect(html).toContain('こうじげんばへ いこう');
    expect(html).toContain('1しゅうめ・0/3');
    expect(html).toContain('aria-label="きたのがれきをかたづけよう。こうじげんばへ いこう。1しゅうめ・0/3"');
  });

  it('パトカー固有の巡回仕事、3地点進捗、サイレン操作を公開する', () => {
    const html = renderToStaticMarkup(<VoxelGameHud
      audio={audioOff}
      canSwitchVehicle
      colorEffect={inactiveColorEffect}
      controls={createControls()}
      fullscreen={false}
      fullscreenAvailable
      mission={policeMission}
      onToggleAudio={vi.fn()}
      onSelectVehicle={vi.fn()}
      onToggleFullscreen={vi.fn()}
      selectedVehicleId="police"
    />);

    expect(html).toContain('aria-label="サイレンを鳴らす"');
    expect(html).toContain('まんなかを みまわろう');
    expect(html).toContain('みまわり あと3かしょ');
    expect(html).toContain('1しゅうめ・0/3');
    expect(html).toContain('data-vehicle="police"');
  });

  it('救急車固有の仕事、1体進捗、手当て操作を公開する', () => {
    const html = renderToStaticMarkup(<VoxelGameHud
      audio={audioOff}
      canSwitchVehicle
      colorEffect={inactiveColorEffect}
      controls={createControls()}
      fullscreen={false}
      fullscreenAvailable
      mission={ambulanceMission}
      onToggleAudio={vi.fn()}
      onSelectVehicle={vi.fn()}
      onToggleFullscreen={vi.fn()}
      selectedVehicleId="ambulance"
    />);

    expect(html).toContain('aria-label="手当てをする"');
    expect(html).toContain('いけのそばで てあてしよう');
    expect(html).toContain('てあてをしよう');
    expect(html).toContain('1しゅうめ・0/1');
    expect(html).toContain('data-vehicle="ambulance"');
  });

  it('ショベルカー固有の仕事、進捗、バケット操作を公開する', () => {
    const html = renderToStaticMarkup(<VoxelGameHud
      audio={audioOff}
      canSwitchVehicle
      colorEffect={inactiveColorEffect}
      controls={createControls()}
      fullscreen={false}
      fullscreenAvailable
      mission={excavatorMission}
      onToggleAudio={vi.fn()}
      onSelectVehicle={vi.fn()}
      onToggleFullscreen={vi.fn()}
      selectedVehicleId="excavator"
    />);

    expect(html).toContain('aria-label="バケットを動かす"');
    expect(html).toContain('きたのつちをほろう');
    expect(html).toContain('つち あと3こ');
    expect(html).toContain('1しゅうめ・0/3');
    expect(html).toContain('data-vehicle="excavator"');
  });

  it('車庫外では乗り換えUIを隠す', () => {
    const html = renderToStaticMarkup(<VoxelGameHud
      audio={audioOff}
      canSwitchVehicle={false}
      colorEffect={inactiveColorEffect}
      controls={createControls()}
      fullscreen={false}
      fullscreenAvailable
      mission={bulldozerMission}
      onToggleAudio={vi.fn()}
      onSelectVehicle={vi.fn()}
      onToggleFullscreen={vi.fn()}
      selectedVehicleId="bulldozer"
    />);

    expect(html).not.toContain('aria-label="のりものをえらぶ"');
    expect(html).not.toContain('color-effect-pill');
  });

  it('一時色が有効な間だけ色と残秒を仕事pill下のaria-liveへ表示する', () => {
    const html = renderToStaticMarkup(<VoxelGameHud
      audio={audioOff}
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
      onToggleAudio={vi.fn()}
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

  it('音と振動を明示的にオン／オフでき、非対応時は安全にdisabledへする', () => {
    const offHtml = renderToStaticMarkup(<VoxelGameHud
      audio={audioOff}
      canSwitchVehicle
      colorEffect={inactiveColorEffect}
      controls={createControls()}
      fullscreen={false}
      fullscreenAvailable
      mission={bulldozerMission}
      onSelectVehicle={vi.fn()}
      onToggleAudio={vi.fn()}
      onToggleFullscreen={vi.fn()}
      selectedVehicleId="bulldozer"
    />);
    const onHtml = renderToStaticMarkup(<VoxelGameHud
      audio={{ ...audioOff, contextState: 'running', enabled: true }}
      canSwitchVehicle
      colorEffect={inactiveColorEffect}
      controls={createControls()}
      fullscreen={false}
      fullscreenAvailable
      mission={bulldozerMission}
      onSelectVehicle={vi.fn()}
      onToggleAudio={vi.fn()}
      onToggleFullscreen={vi.fn()}
      selectedVehicleId="bulldozer"
    />);
    const unavailableHtml = renderToStaticMarkup(<VoxelGameHud
      audio={{ ...audioOff, available: false, contextState: 'unavailable' }}
      canSwitchVehicle
      colorEffect={inactiveColorEffect}
      controls={createControls()}
      fullscreen={false}
      fullscreenAvailable
      mission={bulldozerMission}
      onSelectVehicle={vi.fn()}
      onToggleAudio={vi.fn()}
      onToggleFullscreen={vi.fn()}
      selectedVehicleId="bulldozer"
    />);

    expect(offHtml).toContain('class="audio-toggle-button"');
    expect(offHtml).toContain('aria-label="おとと振動をオンにする"');
    expect(offHtml).toContain('aria-pressed="false"');
    expect(offHtml).toContain('おと オフ');
    expect(onHtml).toContain('aria-label="おとと振動をオフにする"');
    expect(onHtml).toContain('aria-pressed="true"');
    expect(onHtml).toContain('おと オン');
    expect(unavailableHtml).toContain('aria-label="おとは使えません"');
    expect(unavailableHtml).toContain('disabled=""');
    expect(unavailableHtml).toContain('おと なし');
  });
});
