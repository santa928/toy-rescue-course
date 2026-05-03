import { describe, expect, it } from 'vitest';
import { applyColorEffect, tickColorEffect } from '../game/simulation/colorEffect';

describe('colorEffect', () => {
  it('色を受けると指定秒数だけ有効になる', () => {
    const effect = applyColorEffect(null, 'blue', 5);

    expect(effect).toEqual({ color: 'blue', remainingSeconds: 5 });
  });

  it('残り時間が0になると元の色へ戻る', () => {
    const effect = applyColorEffect(null, 'red', 3);
    const active = tickColorEffect(effect, 1);
    const expired = tickColorEffect(active, 2);

    expect(active).toEqual({ color: 'red', remainingSeconds: 2 });
    expect(expired).toBeNull();
  });
});
