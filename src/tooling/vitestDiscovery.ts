import { configDefaults } from 'vitest/config';

/** 別worktreeのtestを現在checkoutから重複収集しないglob。 */
export const WORKTREE_TEST_EXCLUDE = '**/.worktrees/**';

/** Vitest既定値を失わずにプロジェクト固有の除外を加えた設定。 */
export const VITEST_EXCLUDE = [
  ...configDefaults.exclude,
  WORKTREE_TEST_EXCLUDE,
] as const;

/** pathが現在checkoutで収集対象となるtest／spec fileかをpureに判定する。 */
export function shouldCollectWorkspaceTestPath(filePath: string): boolean {
  const normalizedPath = filePath.replaceAll('\\', '/');
  if (normalizedPath.split('/').includes('.worktrees')) return false;
  return /(?:^|\/)[^/]+\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/.test(normalizedPath);
}
