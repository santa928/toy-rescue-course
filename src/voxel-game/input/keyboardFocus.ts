/** 入力欄や修飾キー付きのブラウザ操作をゲームが奪わないための共通判定。 */
export function isNativeKeyboardEvent(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return true;
  const target = event.target as Element | null;
  return typeof target?.closest === 'function'
    && target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]') !== null;
}

/** 既存ボタンやリンクへSpaceを渡し、クリック・選択を成立させる。 */
export function isNativeActivationTarget(event: KeyboardEvent): boolean {
  const target = event.target as Element | null;
  return typeof target?.closest === 'function'
    && target.closest('button, a, [role="button"], [role="checkbox"], [role="radio"]') !== null;
}
