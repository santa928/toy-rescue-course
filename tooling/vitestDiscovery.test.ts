import { configDefaults } from 'vitest/config';
import { describe, expect, it } from 'vitest';
import viteConfig from '../vite.config';
import {
  shouldCollectWorkspaceTestPath,
  WORKTREE_TEST_EXCLUDE,
} from './vitestDiscovery';

/** defineConfigへ渡した静的設定からtest除外だけを安全に読む。 */
function readStaticTestExclude(): readonly string[] {
  if (typeof viteConfig === 'function' || viteConfig instanceof Promise) {
    throw new Error('Tooling config test requires a static Vite config.');
  }
  return viteConfig.test?.exclude ?? [];
}

describe('Vitest test discovery', () => {
  it('既定除外を維持し、worktree配下を収集しない', () => {
    const exclude = readStaticTestExclude();

    expect(exclude).toEqual(expect.arrayContaining(configDefaults.exclude));
    expect(exclude).toContain(WORKTREE_TEST_EXCLUDE);
  });

  it('root testだけを収集対象とし、Unix／Windowsのworktree pathを拒否する', () => {
    expect(shouldCollectWorkspaceTestPath('/app/src/test/world.test.ts')).toBe(true);
    expect(shouldCollectWorkspaceTestPath('/app/src/test/hud.spec.tsx')).toBe(true);
    expect(shouldCollectWorkspaceTestPath('/app/src/game.ts')).toBe(false);
    expect(shouldCollectWorkspaceTestPath('/app/.worktrees/task/src/test/world.test.ts')).toBe(false);
    expect(shouldCollectWorkspaceTestPath('C:\\app\\.worktrees\\task\\src\\test\\hud.spec.tsx'))
      .toBe(false);
  });
});
