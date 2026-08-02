import { describe, expect, it } from 'vitest';
import { isHudLayoutSafe, type HudLayoutRects } from '../voxel-game/ui/hudLayout';

const safeDesktop: HudLayoutRects = {
  colorEffect: { bottom: 108, left: 430, right: 594, top: 74 },
  fullscreen: { bottom: 60, left: 916, right: 1010, top: 12 },
  mission: { bottom: 64, left: 372, right: 652, top: 12 },
  missionMap: { bottom: 264, left: 886, right: 1010, top: 124 },
  selector: { bottom: 60, left: 14, right: 246, top: 12 },
  viewport: { height: 768, width: 1024 },
};

describe('hudLayout', () => {
  it('車両選択・仕事・色札・全画面がviewport内で安全に離れた配置を受け入れる', () => {
    expect(isHudLayoutSafe(safeDesktop, 8)).toBe(true);
  });

  it('車両選択と仕事表示が重なる配置を拒否する', () => {
    expect(isHudLayoutSafe({
      ...safeDesktop,
      mission: { ...safeDesktop.mission, left: 230 },
    }, 8)).toBe(false);
  });

  it('主要HUDがviewport外へはみ出す配置を拒否する', () => {
    expect(isHudLayoutSafe({
      ...safeDesktop,
      fullscreen: { ...safeDesktop.fullscreen, right: 1030 },
    }, 8)).toBe(false);
  });

  it('おしごとマップが全画面ボタンへ重なる配置を拒否する', () => {
    expect(isHudLayoutSafe({
      ...safeDesktop,
      missionMap: { ...safeDesktop.missionMap, bottom: 195, top: 55 },
    }, 8)).toBe(false);
  });

  it('車両選択が非表示でも仕事と全画面の安全余白を検証する', () => {
    expect(isHudLayoutSafe({ ...safeDesktop, selector: null }, 8)).toBe(true);
  });

  it('仕事pillと色札の縦gapが10px未満なら他要素と離れていても拒否する', () => {
    expect(isHudLayoutSafe({
      ...safeDesktop,
      colorEffect: { ...safeDesktop.colorEffect!, top: 73 },
    }, 8)).toBe(false);
  });

  it('色札が非表示なら既存3矩形だけを検証し、表示中のviewport逸脱は拒否する', () => {
    expect(isHudLayoutSafe({ ...safeDesktop, colorEffect: null }, 8)).toBe(true);
    expect(isHudLayoutSafe({
      ...safeDesktop,
      colorEffect: { ...safeDesktop.colorEffect!, bottom: 780 },
    }, 8)).toBe(false);
  });
});
