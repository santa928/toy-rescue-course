import { describe, expect, it } from 'vitest';
import { isHudLayoutSafe, type HudLayoutRects } from '../voxel-game/ui/hudLayout';

const safeDesktop: HudLayoutRects = {
  fullscreen: { bottom: 60, left: 916, right: 1010, top: 12 },
  mission: { bottom: 64, left: 372, right: 652, top: 12 },
  selector: { bottom: 60, left: 14, right: 246, top: 12 },
  viewport: { height: 768, width: 1024 },
};

describe('hudLayout', () => {
  it('車両選択・仕事・全画面がviewport内で8px以上離れた配置を受け入れる', () => {
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

  it('車両選択が非表示でも仕事と全画面の安全余白を検証する', () => {
    expect(isHudLayoutSafe({ ...safeDesktop, selector: null }, 8)).toBe(true);
  });
});
