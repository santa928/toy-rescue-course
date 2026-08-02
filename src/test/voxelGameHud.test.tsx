import { renderToStaticMarkup } from 'react-dom/server';
import type { RefObject } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { VehicleMissionSnapshot } from '../voxel-game/domain/VehicleMissionCoordinator';
import type { VehicleColorEffectSnapshot } from '../voxel-game/domain/VehicleColorEffectRuntime';
import type { DriveCommand } from '../voxel-game/input/controlState';
import type { VoxelGameControls } from '../voxel-game/input/useVoxelGameControls';
import { VoxelGameHud } from '../voxel-game/ui/VoxelGameHud';
import type { VehicleTelemetryRef } from '../voxel-game/scene/VehicleController';

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

const policeGuidance = {
  completionLabel: 'クリア 0/3',
  instructionLabel: 'あおいゲートを サイレンでとおる',
  targetLabel: 'つぎの ゲート',
  targetPosition: [0, 0.7, 17] as const,
};

const bulldozerGuidance = {
  completionLabel: 'クリア 0/3',
  instructionLabel: 'がれきへ ブレードでぶつかる',
  targetLabel: 'つぎの がれき',
  targetPosition: [-29.5, 0.8, 12.5] as const,
};

const excavatorGuidance = {
  completionLabel: 'クリア 0/3',
  instructionLabel: 'つちのまえで とまり バケットをおす',
  targetLabel: 'つぎの つち',
  targetPosition: [-29.5, 0.65, 12.5] as const,
};

const ambulanceGuidance = {
  completionLabel: 'クリア 0/1',
  instructionLabel: 'ひとのそばで とまり てあてをおす',
  targetLabel: 'けがをした ひと',
  targetPosition: [-4, 0.7, -24] as const,
};

const vehicleTelemetryRef = {
  current: {
    forward: [0, 0, 1] as const,
    id: 'police' as const,
    mass: 1,
    position: [0, 0.8, 6] as const,
    resetCount: 0,
    speed: 0,
  },
} satisfies VehicleTelemetryRef;

describe('VoxelGameHud', () => {
  it('車庫では5台の選択状態とブルドーザー固有の主操作を公開する', () => {
    const html = renderToStaticMarkup(<VoxelGameHud
      audio={audioOff}
      canSwitchVehicle
      colorEffect={inactiveColorEffect}
      controls={createControls()}
      fullscreen={false}
      fullscreenAvailable
      guidance={bulldozerGuidance}
      mission={bulldozerMission}
      onToggleAudio={vi.fn()}
      onSelectVehicle={vi.fn()}
      onToggleFullscreen={vi.fn()}
      selectedVehicleId="bulldozer"
      telemetryRef={vehicleTelemetryRef}
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
    expect(html).toContain('がれきへ ブレードでぶつかる');
    expect(html).toContain('1しゅうめ・クリア 0/3');
    expect(html).toContain('aria-label="きたのがれきをかたづけよう。がれきへ ブレードでぶつかる。1しゅうめ・クリア 0/3"');
  });

  it('パトカー固有の巡回仕事、3地点進捗、サイレン操作を公開する', () => {
    const html = renderToStaticMarkup(<VoxelGameHud
      audio={audioOff}
      canSwitchVehicle
      colorEffect={inactiveColorEffect}
      controls={createControls()}
      fullscreen={false}
      fullscreenAvailable
      guidance={policeGuidance}
      mission={policeMission}
      onToggleAudio={vi.fn()}
      onSelectVehicle={vi.fn()}
      onToggleFullscreen={vi.fn()}
      selectedVehicleId="police"
      telemetryRef={vehicleTelemetryRef}
    />);

    expect(html).toContain('aria-label="サイレンを鳴らす"');
    expect(html).toContain('まんなかを みまわろう');
    expect(html).toContain('あおいゲートを サイレンでとおる');
    expect(html).toContain('1しゅうめ・クリア 0/3');
    expect(html).toContain('data-vehicle="police"');
    expect(html).toContain('あおいゲートを サイレンでとおる');
    expect(html).toContain('クリア 0/3');
    expect(html).toContain('aria-label="おしごとマップ。つぎの ゲート"');
    expect(html).toContain('class="mission-map__target"');
  });

  it('救急車固有の仕事、1体進捗、手当て操作を公開する', () => {
    const html = renderToStaticMarkup(<VoxelGameHud
      audio={audioOff}
      canSwitchVehicle
      colorEffect={inactiveColorEffect}
      controls={createControls()}
      fullscreen={false}
      fullscreenAvailable
      guidance={ambulanceGuidance}
      mission={ambulanceMission}
      onToggleAudio={vi.fn()}
      onSelectVehicle={vi.fn()}
      onToggleFullscreen={vi.fn()}
      selectedVehicleId="ambulance"
      telemetryRef={vehicleTelemetryRef}
    />);

    expect(html).toContain('aria-label="手当てをする"');
    expect(html).toContain('いけのそばで てあてしよう');
    expect(html).toContain('ひとのそばで とまり てあてをおす');
    expect(html).toContain('1しゅうめ・クリア 0/1');
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
      guidance={excavatorGuidance}
      mission={excavatorMission}
      onToggleAudio={vi.fn()}
      onSelectVehicle={vi.fn()}
      onToggleFullscreen={vi.fn()}
      selectedVehicleId="excavator"
      telemetryRef={vehicleTelemetryRef}
    />);

    expect(html).toContain('aria-label="バケットを動かす"');
    expect(html).toContain('きたのつちをほろう');
    expect(html).toContain('つちのまえで とまり バケットをおす');
    expect(html).toContain('1しゅうめ・クリア 0/3');
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
      guidance={bulldozerGuidance}
      mission={bulldozerMission}
      onToggleAudio={vi.fn()}
      onSelectVehicle={vi.fn()}
      onToggleFullscreen={vi.fn()}
      selectedVehicleId="bulldozer"
      telemetryRef={vehicleTelemetryRef}
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
      guidance={bulldozerGuidance}
      mission={bulldozerMission}
      onToggleAudio={vi.fn()}
      onSelectVehicle={vi.fn()}
      onToggleFullscreen={vi.fn()}
      selectedVehicleId="bulldozer"
      telemetryRef={vehicleTelemetryRef}
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
      guidance={bulldozerGuidance}
      mission={bulldozerMission}
      onSelectVehicle={vi.fn()}
      onToggleAudio={vi.fn()}
      onToggleFullscreen={vi.fn()}
      selectedVehicleId="bulldozer"
      telemetryRef={vehicleTelemetryRef}
    />);
    const onHtml = renderToStaticMarkup(<VoxelGameHud
      audio={{ ...audioOff, contextState: 'running', enabled: true }}
      canSwitchVehicle
      colorEffect={inactiveColorEffect}
      controls={createControls()}
      fullscreen={false}
      fullscreenAvailable
      guidance={bulldozerGuidance}
      mission={bulldozerMission}
      onSelectVehicle={vi.fn()}
      onToggleAudio={vi.fn()}
      onToggleFullscreen={vi.fn()}
      selectedVehicleId="bulldozer"
      telemetryRef={vehicleTelemetryRef}
    />);
    const unavailableHtml = renderToStaticMarkup(<VoxelGameHud
      audio={{ ...audioOff, available: false, contextState: 'unavailable' }}
      canSwitchVehicle
      colorEffect={inactiveColorEffect}
      controls={createControls()}
      fullscreen={false}
      fullscreenAvailable
      guidance={bulldozerGuidance}
      mission={bulldozerMission}
      onSelectVehicle={vi.fn()}
      onToggleAudio={vi.fn()}
      onToggleFullscreen={vi.fn()}
      selectedVehicleId="bulldozer"
      telemetryRef={vehicleTelemetryRef}
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
