import assert from 'node:assert/strict';

export const HUD_CAPTURE_TARGETS = Object.freeze({
  fullscreen: {
    labelSelector: '.fullscreen-button > span:last-child',
    selector: '.fullscreen-button',
  },
  joystick: {
    labelSelector: '.touch-joystick__label',
    selector: '.touch-joystick',
  },
  mission: {
    labelSelector: '.mission-pill__label',
    selector: '.mission-pill',
  },
  spray: {
    labelSelector: '.spray-button__label',
    selector: '.spray-button',
  },
});

const MINIMUM_BACKGROUND_MATCH_RATIO = 0.08;
const MINIMUM_EDGE_MATCH_RATIO = 0.2;

/** CSS rgb色へcomputed brightness filterを適用し、保存画像で期待する8-bit RGBを返す。 */
export function resolveRenderedCssColor(color, filter = 'none') {
  const channels = color.match(/\d+(?:\.\d+)?/g)?.slice(0, 3).map(Number);
  assert(channels?.length === 3, `Unsupported CSS color: ${color}`);
  const brightness = filter.match(/brightness\(([\d.]+)\)/)?.[1];
  const multiplier = brightness === undefined ? 1 : Number.parseFloat(brightness);
  return channels.map((channel) => Math.min(255, Math.round(channel * multiplier)));
}

/** capture直前のHUDが非空label・可視style・viewport内boxを安定して持つか検証する。 */
export function assertHudCaptureReadiness(readiness, viewport) {
  assert(readiness.stableSamples >= 2,
    `HUD capture state did not stabilize: ${readiness.stableSamples} matching samples.`);
  for (const [name, control] of Object.entries(readiness.controls)) {
    assert(control.label.trim().length > 0, `${name} label is empty.`);
    assert(
      control.display !== 'none'
        && control.visibility === 'visible'
        && Number.parseFloat(control.opacity) > 0,
      `${name} is not visibly painted: ${JSON.stringify(control)}`,
    );
    assert(control.box.width > 0 && control.box.height > 0,
      `${name} has no painted area: ${JSON.stringify(control.box)}`);
    assert(
      control.box.left >= 0
        && control.box.top >= 0
        && control.box.right <= viewport.width
        && control.box.bottom <= viewport.height,
      `${name} exceeds viewport ${viewport.width}x${viewport.height}: ${JSON.stringify(control.box)}`,
    );
    assert(Object.values(control.borderWidths).every((width) => width > 0),
      `${name} has a missing border width: ${JSON.stringify(control.borderWidths)}`);
  }
}

/** 保存PNG内の各HUD背景と上下左右の枠色が実画素として残っているか検証する。 */
export function assertHudPixelProof(proof) {
  for (const [name, control] of Object.entries(proof.controls)) {
    assert(control.backgroundMatchRatio >= MINIMUM_BACKGROUND_MATCH_RATIO,
      `${name} background is not painted: ${control.backgroundMatchRatio}.`);
    for (const [edge, ratio] of Object.entries(control.edgeMatchRatios)) {
      assert(ratio >= MINIMUM_EDGE_MATCH_RATIO,
        `${name} ${edge} edge is not painted: ${ratio}.`);
    }
  }
}

/** document.fontsと連続rAF sampleを使い、固定待ちなしでHUDの安定したcapture状態を返す。 */
export async function waitForHudCaptureReadiness(page) {
  const readiness = await page.evaluate(async (targets) => {
    await document.fonts.ready;
    const readSample = () => {
      const controls = {};
      for (const [name, target] of Object.entries(targets)) {
        const element = document.querySelector(target.selector);
        const label = document.querySelector(target.labelSelector);
        if (!element || !label) throw new Error(`${name} HUD element is missing.`);
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        controls[name] = {
          backgroundColor: style.backgroundColor,
          borderColor: style.borderTopColor,
          borderWidths: {
            bottom: Number.parseFloat(style.borderBottomWidth),
            left: Number.parseFloat(style.borderLeftWidth),
            right: Number.parseFloat(style.borderRightWidth),
            top: Number.parseFloat(style.borderTopWidth),
          },
          box: {
            bottom: box.bottom,
            height: box.height,
            left: box.left,
            right: box.right,
            top: box.top,
            width: box.width,
          },
          display: style.display,
          filter: style.filter,
          label: label.textContent ?? '',
          opacity: style.opacity,
          visibility: style.visibility,
        };
      }
      return controls;
    };
    let previous = '';
    let stableSamples = 0;
    let controls = {};
    for (let frame = 0; frame < 12 && stableSamples < 2; frame += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      controls = readSample();
      const signature = JSON.stringify(controls);
      stableSamples = signature === previous ? stableSamples + 1 : 1;
      previous = signature;
    }
    return { controls, stableSamples };
  }, HUD_CAPTURE_TARGETS);
  const viewport = page.viewportSize();
  assert(viewport, 'Screenshot viewport is unavailable.');
  assertHudCaptureReadiness(readiness, viewport);
  return readiness;
}

/** screenshot bufferをbrowser Canvasでdecodeし、HUD背景と四辺のCSS色一致率を返す。 */
export async function readHudPixelProof(page, screenshotBuffer, readiness) {
  const renderedControls = Object.fromEntries(Object.entries(readiness.controls).map(([name, control]) => [
    name,
    {
      ...control,
      renderedBackgroundColor: resolveRenderedCssColor(control.backgroundColor, control.filter),
      renderedBorderColor: resolveRenderedCssColor(control.borderColor, control.filter),
    },
  ]));
  return page.evaluate(async ({ dataUrl, controls }) => {
    const image = await createImageBitmap(await (await fetch(dataUrl)).blob());
    const canvas = new OffscreenCanvas(image.width, image.height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Screenshot pixel Canvas is unavailable.');
    context.drawImage(image, 0, 0);
    const result = {};
    for (const [name, control] of Object.entries(controls)) {
      const x = Math.floor(control.box.left);
      const y = Math.floor(control.box.top);
      const width = Math.max(1, Math.ceil(control.box.right) - x);
      const height = Math.max(1, Math.ceil(control.box.bottom) - y);
      const pixels = context.getImageData(x, y, width, height).data;
      const background = control.renderedBackgroundColor;
      const border = control.renderedBorderColor;
      const matches = (offset, expected) => (
        Math.abs(pixels[offset] - expected[0]) <= 3
        && Math.abs(pixels[offset + 1] - expected[1]) <= 3
        && Math.abs(pixels[offset + 2] - expected[2]) <= 3
        && pixels[offset + 3] === 255
      );
      let backgroundMatches = 0;
      for (let offset = 0; offset < pixels.length; offset += 4) {
        if (matches(offset, background)) backgroundMatches += 1;
      }
      const countEdge = (edge) => {
        const borderWidth = Math.max(1, Math.ceil(control.borderWidths[edge]));
        const depth = Math.min(
          edge === 'top' || edge === 'bottom' ? height : width,
          borderWidth * 2,
        );
        const horizontal = edge === 'top' || edge === 'bottom';
        const crossStart = Math.floor((horizontal ? width : height) * 0.35);
        const crossEnd = Math.ceil((horizontal ? width : height) * 0.65);
        let matchesCount = 0;
        let sampleCount = 0;
        for (let primary = 0; primary < depth; primary += 1) {
          for (let cross = crossStart; cross < crossEnd; cross += 1) {
            const pixelX = horizontal
              ? cross
              : edge === 'left' ? primary : width - primary - 1;
            const pixelY = horizontal
              ? edge === 'top' ? primary : height - primary - 1
              : cross;
            const offset = (pixelY * width + pixelX) * 4;
            if (matches(offset, border)) matchesCount += 1;
            sampleCount += 1;
          }
        }
        return matchesCount / sampleCount;
      };
      result[name] = {
        backgroundMatchRatio: backgroundMatches / (width * height),
        edgeMatchRatios: {
          bottom: countEdge('bottom'),
          left: countEdge('left'),
          right: countEdge('right'),
          top: countEdge('top'),
        },
      };
    }
    return { controls: result };
  }, {
    controls: renderedControls,
    dataUrl: `data:image/png;base64,${screenshotBuffer.toString('base64')}`,
  });
}
