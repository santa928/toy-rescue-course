import { Component, useCallback, useEffect, useRef, useState } from 'react';
import type { ErrorInfo, ReactElement, ReactNode } from 'react';
import { Canvas } from '@react-three/fiber';
import { FIRE_TRUCK_RENDER_PLAN } from './scene/VoxelFireTruck';
import {
  VehicleShowroom,
  type VehicleLabCameraPreset,
  type VehicleLabView,
} from './scene/VehicleShowroom';

interface ErrorBoundaryProps {
  readonly children: ReactNode;
}

interface ErrorBoundaryState {
  readonly hasError: boolean;
}

const FIXED_VIEWS: readonly { readonly id: Exclude<VehicleLabView, 'perspective'>; readonly label: string }[] = [
  { id: 'front', label: '正面' },
  { id: 'left', label: '左' },
  { id: 'back', label: '背面' },
  { id: 'right', label: '右' },
];

/** Canvas内の例外を幼児向け画面へ技術情報を漏らさず表示する。 */
class VehicleLabErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = { hasError: false };

  public static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('Vehicle Lab failed to render', error, errorInfo);
  }

  public render(): ReactNode {
    if (this.state.hasError) {
      return <div className="vehicle-lab-error">消防車を表示できませんでした。ページを開き直してください。</div>;
    }
    return this.props.children;
  }
}

/** 消防車の展示Canvas、説明、固定方向操作を構成する。 */
export function VehicleLabApp(): ReactElement {
  const [autoRotate, setAutoRotate] = useState(true);
  const [view, setView] = useState<VehicleLabView>('perspective');
  const [cameraPreset, setCameraPreset] = useState<VehicleLabCameraPreset | null>(null);
  const cameraPresetRequestId = useRef(0);

  /** UIまたは公開APIからのpreset要求を、同一viewでも必ずカメラへ適用する。 */
  const applyCameraPreset = useCallback((nextView: VehicleLabView) => {
    setAutoRotate(false);
    setView(nextView);
    cameraPresetRequestId.current += 1;
    setCameraPreset({ requestId: cameraPresetRequestId.current, view: nextView });
  }, []);

  /** zoomを含む任意のユーザー操作開始時に初期自動回転だけを停止する。 */
  const handleInteractionStart = useCallback(() => {
    setAutoRotate(false);
  }, []);

  /** 実回転後のカメラを維持したまま、UIとtelemetryを自由視点へ切り替える。 */
  const handleFreeOrbit = useCallback(() => {
    setAutoRotate(false);
    setView('perspective');
    setCameraPreset(null);
  }, []);

  /** 固定方向ボタンの要求をカメラpresetとして適用する。 */
  const selectFixedView = useCallback((nextView: Exclude<VehicleLabView, 'perspective'>) => {
    applyCameraPreset(nextView);
  }, [applyCameraPreset]);

  /** window APIをマウント中に一度だけ登録し、telemetryの実測値を保持する。 */
  useEffect(() => {
    window.__vehicleLabTelemetry = {
      cameraPosition: [6.5, 4.8, 8],
      cameraZoom: 72,
      renderedFrames: 0,
      rendererCalls: 0,
      vehicleDrawCalls: FIRE_TRUCK_RENDER_PLAN.drawCalls,
      view: 'perspective',
      voxelCount: FIRE_TRUCK_RENDER_PLAN.voxelCount,
    };
    window.render_vehicle_lab_to_text = () => JSON.stringify(window.__vehicleLabTelemetry);
    window.set_vehicle_lab_view = applyCameraPreset;

    return () => {
      delete window.__vehicleLabTelemetry;
      delete window.render_vehicle_lab_to_text;
      delete window.set_vehicle_lab_view;
    };
  }, [applyCameraPreset]);

  /** viewだけを更新し、rendererが蓄積したテレメトリー値を維持する。 */
  useEffect(() => {
    const telemetry = window.__vehicleLabTelemetry;
    if (!telemetry) {
      return;
    }
    window.__vehicleLabTelemetry = { ...telemetry, view };
  }, [view]);

  return (
    <main className="vehicle-lab-shell">
      <header className="vehicle-lab-header">
        <div>
          <span className="vehicle-lab-kicker">VEHICLE LAB</span>
          <h1>純ボクセル消防車</h1>
        </div>
        <p>ドラッグで回転・ピンチまたはホイールで拡大</p>
      </header>

      <section className="vehicle-lab-canvas" aria-label="純ボクセル消防車の3D展示">
        <VehicleLabErrorBoundary>
          <Canvas
            dpr={[1, 1.75]}
            fallback={<div className="vehicle-lab-error">このブラウザでは3D表示を利用できません。</div>}
            gl={{ antialias: true, powerPreference: 'high-performance' }}
            shadows
          >
            <VehicleShowroom
              autoRotate={autoRotate}
              cameraPreset={cameraPreset}
              onFreeOrbit={handleFreeOrbit}
              onInteractionStart={handleInteractionStart}
            />
          </Canvas>
        </VehicleLabErrorBoundary>
      </section>

      <footer className="vehicle-lab-footer">
        <div className="vehicle-view-buttons" aria-label="消防車を見る方向" role="group">
          {FIXED_VIEWS.map(({ id, label }) => (
            <button
              aria-pressed={view === id}
              className={view === id ? 'is-active' : undefined}
              key={id}
              onClick={() => selectFixedView(id)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
        <span>{FIRE_TRUCK_RENDER_PLAN.voxelCount} voxels</span>
      </footer>
    </main>
  );
}
