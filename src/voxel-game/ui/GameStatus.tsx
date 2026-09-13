import { Component, useEffect, useState } from 'react';
import type { ErrorInfo, ReactElement, ReactNode } from 'react';

const loadingStartedAt = Date.now();

/** 保存していない進捗の扱いを明示し、同じURLをユーザー操作で読み直す。 */
function RetryGame(): ReactElement {
  return <>
    <p>さいしょから やりなおします</p>
    <button type="button" onClick={() => window.location.reload()}>もういちど ひらく</button>
  </>;
}

/** 実態のない百分率を使わず、長い読み込みにも復帰手段を示すDOMの案内。 */
export function GameLoading(): ReactElement {
  const [slow, setSlow] = useState(() => Date.now() - loadingStartedAt >= 15_000);
  useEffect(() => {
    const timeout = window.setTimeout(() => setSlow(true), Math.max(0, 15_000 - (Date.now() - loadingStartedAt)));
    return () => window.clearTimeout(timeout);
  }, []);
  return <section className="game-status" aria-label="よみこみ中">
    <div className="game-status__card">
      <span aria-hidden="true" className="game-status__mark">▰ ▰ ▰</span>
      <h1 role="status">{slow ? 'よみこみに じかんが かかっています' : 'あそびばを じゅんびしています'}</h1>
      <p>はたらく くるまの おもちゃばこ</p>
      {slow && <RetryGame />}
    </div>
  </section>;
}

/** WebGLを使えないときにも、画面に残る再試行案内。 */
export function GameFailure({ reason = 'error' }: { readonly reason?: 'error' | 'webgl' | 'context' }): ReactElement {
  const title = reason === 'context' ? 'がめんが とまってしまいました'
    : reason === 'webgl' ? '3Dのがめんを ひらけませんでした'
      : 'あそびばを ひらけませんでした';
  return <section className="game-status" aria-label="あそびばのエラー">
    <div className="game-status__card">
      <h1 role="alert">{title}</h1>
      <RetryGame />
      <p className="game-status__parent">おうちのかたへ：通信状態を確認してください。くり返す場合は、ほかのタブを閉じるか、3D表示に対応したブラウザで開いてください。</p>
    </div>
  </section>;
}

/** React/非同期module/sceneの失敗ではゲーム全体を破棄し、音と入力も終了する。 */
export class GameErrorBoundary extends Component<{ readonly children: ReactNode }, { readonly error: Error | null }> {
  public state: { readonly error: Error | null } = { error: null };

  /** 捕捉した例外の詳細を画面へ流さず、失敗状態だけを保存する。 */
  public static getDerivedStateFromError(error: Error): { readonly error: Error } {
    return { error };
  }

  /** 保護者向け画面から隠した診断情報はconsoleへ残す。 */
  public componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Toy Rescue Course could not continue', error, info.componentStack);
  }

  /** 例外がない間だけゲームを表示し、失敗中は操作系をマウントしない。 */
  public render(): ReactNode {
    const error = this.state.error;
    return error ? <GameFailure reason={error.name === 'WebGLContextLostError' ? 'context'
      : error.name === 'WebGLInitializationError' || /WebGL|GL context/i.test(error.message) ? 'webgl' : 'error'} /> : this.props.children;
  }
}
