/** fullscreen制御に必要なDocument APIの最小契約。 */
export interface FullscreenDocumentTarget {
  readonly documentElement: {
    readonly requestFullscreen?: () => Promise<void>;
  };
  readonly exitFullscreen?: () => Promise<void>;
  readonly fullscreenElement: Element | null;
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
}

/** keyboard eventを購読する最小契約。 */
export interface FullscreenKeyboardTarget {
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
}

/** fullscreen keyboard/change listenerへ渡す依存群。 */
export interface FullscreenControlBindings {
  readonly documentTarget: FullscreenDocumentTarget;
  readonly keyboardTarget: FullscreenKeyboardTarget;
  readonly onFullscreenChange: (fullscreen: boolean) => void;
}

/** request/exit APIの両方が使える場合だけtrueを返す。 */
export function isFullscreenAvailable(documentTarget: FullscreenDocumentTarget): boolean {
  return typeof documentTarget.documentElement.requestFullscreen === 'function'
    && typeof documentTarget.exitFullscreen === 'function';
}

/** 現在stateに応じてfullscreenを切り替え、拒否時は未処理例外を残さない。 */
export async function toggleFullscreen(documentTarget: FullscreenDocumentTarget): Promise<boolean> {
  if (!isFullscreenAvailable(documentTarget)) return false;
  try {
    if (documentTarget.fullscreenElement) {
      await documentTarget.exitFullscreen?.();
    } else {
      await documentTarget.documentElement.requestFullscreen?.();
    }
    return true;
  } catch {
    return false;
  }
}

/** F keyとfullscreenchangeを登録し、repeatを無視して安全に解除する。 */
export function bindFullscreenControls({
  documentTarget,
  keyboardTarget,
  onFullscreenChange,
}: FullscreenControlBindings): () => void {
  /** 対応する初回keydownだけでbrowser fullscreen APIを呼ぶ。 */
  const handleKeyDown = (event: Event): void => {
    const keyboardEvent = event as KeyboardEvent;
    if (keyboardEvent.code !== 'KeyF' || keyboardEvent.repeat || !isFullscreenAvailable(documentTarget)) return;
    keyboardEvent.preventDefault();
    void toggleFullscreen(documentTarget);
  };
  /** browser確定後のfullscreen stateをReact側へ通知する。 */
  const handleFullscreenChange = (): void => {
    onFullscreenChange(Boolean(documentTarget.fullscreenElement));
  };

  keyboardTarget.addEventListener('keydown', handleKeyDown);
  documentTarget.addEventListener('fullscreenchange', handleFullscreenChange);
  return () => {
    keyboardTarget.removeEventListener('keydown', handleKeyDown);
    documentTarget.removeEventListener('fullscreenchange', handleFullscreenChange);
  };
}
