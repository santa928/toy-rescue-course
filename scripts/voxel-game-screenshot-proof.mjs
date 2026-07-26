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
const MINIMUM_LABEL_CONTRAST_RATIO = 4.5;
const MINIMUM_LABEL_DISTINCT_PIXEL_RATIO = 0.08;
const MINIMUM_LABEL_FOREGROUND_PIXEL_RATIO = 0.04;
const LABEL_COLOR_TOLERANCE = 24;

/** computed rgb/rgba色をalpha付きchannelへ変換する。 */
function parseCssColor(color) {
  const channels = color.match(/\d+(?:\.\d+)?/g)?.map(Number);
  assert(channels && channels.length >= 3 && channels.length <= 4, `Unsupported CSS color: ${color}`);
  return [channels[0], channels[1], channels[2], channels[3] ?? 1];
}

/** 前景RGBAを不透明背景RGBへ合成する。 */
function compositeColor(foreground, background, opacity = 1) {
  const alpha = Math.max(0, Math.min(1, foreground[3] * opacity));
  return foreground.slice(0, 3).map((channel, index) => (
    channel * alpha + background[index] * (1 - alpha)
  ));
}

/** RGB channelへcomputed brightness filterを適用する。 */
function applyBrightnessFilter(channels, filter = 'none') {
  const brightness = filter.match(/brightness\(([\d.]+)\)/)?.[1];
  const multiplier = brightness === undefined ? 1 : Number.parseFloat(brightness);
  return channels.map((channel) => Math.min(255, Math.round(channel * multiplier)));
}

/** CSS rgb色へcomputed brightness filterを適用し、保存画像で期待する8-bit RGBを返す。 */
export function resolveRenderedCssColor(color, filter = 'none') {
  return applyBrightnessFilter(parseCssColor(color).slice(0, 3), filter);
}

/** labelのopacity・透明背景・親filterを反映した保存画像上の前景/背景RGBを返す。 */
function resolveRenderedLabelColors(control) {
  const parentBackground = parseCssColor(control.backgroundColor).slice(0, 3);
  const labelBackground = compositeColor(
    parseCssColor(control.labelStyle.backgroundColor),
    parentBackground,
  );
  const labelForeground = compositeColor(
    parseCssColor(control.labelStyle.color),
    labelBackground,
  );
  const labelOpacity = Number.parseFloat(control.labelStyle.opacity);
  const effectiveBackground = labelBackground.map((channel, index) => (
    parentBackground[index] + (channel - parentBackground[index]) * labelOpacity
  ));
  const effectiveForeground = labelForeground.map((channel, index) => (
    parentBackground[index] + (channel - parentBackground[index]) * labelOpacity
  ));
  return {
    background: applyBrightnessFilter(effectiveBackground, control.filter),
    foreground: applyBrightnessFilter(effectiveForeground, control.filter),
  };
}

/** WCAG相対輝度による2色のcontrast ratioを返す。 */
function contrastRatio(first, second) {
  const luminance = (channels) => channels
    .map((channel) => channel / 255)
    .map((channel) => (
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    ))
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
  const firstLuminance = luminance(first);
  const secondLuminance = luminance(second);
  return (Math.max(firstLuminance, secondLuminance) + 0.05)
    / (Math.min(firstLuminance, secondLuminance) + 0.05);
}

/** label bboxの保存RGBAから期待前景と背景差の文字画素率を数える。 */
export function analyzeHudLabelPixels(
  pixels,
  width,
  height,
  foreground,
  background,
) {
  assert.equal(pixels.length, width * height * 4, 'HUD label pixel buffer size is invalid.');
  let distinctFromBackground = 0;
  let foregroundMatches = 0;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const opaque = pixels[offset + 3] >= 250;
    const matchesForeground = opaque && foreground.every(
      (channel, index) => Math.abs(pixels[offset + index] - channel) <= LABEL_COLOR_TOLERANCE,
    );
    const differsFromBackground = opaque && background.some(
      (channel, index) => Math.abs(pixels[offset + index] - channel) > LABEL_COLOR_TOLERANCE,
    );
    if (matchesForeground) foregroundMatches += 1;
    if (differsFromBackground) distinctFromBackground += 1;
  }
  const pixelCount = width * height;
  return {
    distinctFromBackgroundRatio: distinctFromBackground / pixelCount,
    foregroundMatchRatio: foregroundMatches / pixelCount,
    height,
    width,
  };
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
    const label = control.labelStyle;
    assert(label && control.label.trim().length > 0, `${name} label is empty.`);
    assert(
      label.display !== 'none'
        && label.visibility === 'visible'
        && Number.parseFloat(label.opacity) > 0,
      `${name} label is not visibly painted: ${JSON.stringify(label)}`,
    );
    assert(label.box.width > 0 && label.box.height > 0,
      `${name} label has no painted area: ${JSON.stringify(label.box)}`);
    assert(
      label.box.left >= 0
        && label.box.top >= 0
        && label.box.right <= viewport.width
        && label.box.bottom <= viewport.height,
      `${name} label exceeds viewport ${viewport.width}x${viewport.height}: ${JSON.stringify(label.box)}`,
    );
    const containmentTolerance = 0.5;
    assert(
      label.box.left >= control.box.left - containmentTolerance
        && label.box.top >= control.box.top - containmentTolerance
        && label.box.right <= control.box.right + containmentTolerance
        && label.box.bottom <= control.box.bottom + containmentTolerance,
      `${name} label exceeds its control: ${JSON.stringify({
        control: control.box,
        label: label.box,
      })}`,
    );
    const renderedColors = resolveRenderedLabelColors(control);
    const ratio = contrastRatio(renderedColors.foreground, renderedColors.background);
    assert(ratio >= MINIMUM_LABEL_CONTRAST_RATIO,
      `${name} label contrast is insufficient: ${ratio}.`);
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
    assert(
      control.label.foregroundMatchRatio >= MINIMUM_LABEL_FOREGROUND_PIXEL_RATIO
        || control.label.distinctFromBackgroundRatio >= MINIMUM_LABEL_DISTINCT_PIXEL_RATIO,
      `${name} label text is not painted: ${JSON.stringify(control.label)}.`,
    );
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
        const labelBox = label.getBoundingClientRect();
        const style = getComputedStyle(element);
        const labelStyle = getComputedStyle(label);
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
          labelStyle: {
            backgroundColor: labelStyle.backgroundColor,
            box: {
              bottom: labelBox.bottom,
              height: labelBox.height,
              left: labelBox.left,
              right: labelBox.right,
              top: labelBox.top,
              width: labelBox.width,
            },
            color: labelStyle.color,
            display: labelStyle.display,
            opacity: labelStyle.opacity,
            visibility: labelStyle.visibility,
          },
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
  readiness.controls = Object.fromEntries(
    Object.entries(readiness.controls).map(([name, control]) => {
      const renderedColors = resolveRenderedLabelColors(control);
      return [name, {
        ...control,
        labelStyle: {
          ...control.labelStyle,
          contrastRatio: contrastRatio(renderedColors.foreground, renderedColors.background),
          renderedBackgroundColor: renderedColors.background,
          renderedColor: renderedColors.foreground,
        },
      }];
    }),
  );
  assertHudCaptureReadiness(readiness, viewport);
  return readiness;
}

/** screenshot bufferをdecodeし、HUD背景・四辺・label文字の実画素率を返す。 */
export async function readHudPixelProof(page, screenshotBuffer, readiness) {
  const renderedControls = Object.fromEntries(Object.entries(readiness.controls).map(([name, control]) => [
    name,
    {
      ...control,
      renderedBackgroundColor: resolveRenderedCssColor(control.backgroundColor, control.filter),
      renderedBorderColor: resolveRenderedCssColor(control.borderColor, control.filter),
      renderedLabelBackgroundColor: control.labelStyle.renderedBackgroundColor,
      renderedLabelColor: control.labelStyle.renderedColor,
    },
  ]));
  const decoded = await page.evaluate(async ({ dataUrl, controls }) => {
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
      const labelX = Math.floor(control.labelStyle.box.left);
      const labelY = Math.floor(control.labelStyle.box.top);
      const labelWidth = Math.max(1, Math.ceil(control.labelStyle.box.right) - labelX);
      const labelHeight = Math.max(1, Math.ceil(control.labelStyle.box.bottom) - labelY);
      const labelPixels = context.getImageData(labelX, labelY, labelWidth, labelHeight).data;
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
        labelHeight,
        labelPixels: Array.from(labelPixels),
        labelWidth,
      };
    }
    return { controls: result };
  }, {
    controls: renderedControls,
    dataUrl: `data:image/png;base64,${screenshotBuffer.toString('base64')}`,
  });
  return {
    controls: Object.fromEntries(Object.entries(decoded.controls).map(([name, control]) => {
      const rendered = renderedControls[name];
      const label = analyzeHudLabelPixels(
        Uint8ClampedArray.from(control.labelPixels),
        control.labelWidth,
        control.labelHeight,
        rendered.renderedLabelColor,
        rendered.renderedLabelBackgroundColor,
      );
      return [name, {
        backgroundMatchRatio: control.backgroundMatchRatio,
        edgeMatchRatios: control.edgeMatchRatios,
        label: {
          ...label,
          expectedBackgroundColor: rendered.renderedLabelBackgroundColor,
          expectedForegroundColor: rendered.renderedLabelColor,
        },
      }];
    })),
  };
}
