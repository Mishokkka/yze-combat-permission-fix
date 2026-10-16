import assert from 'node:assert/strict';

/**
 * Assert readable text on solid rgb(a) backgrounds, compositing ancestor and
 * text alpha. Requires an opaque backing; images, filters and element opacity
 * are outside this helper's scope. No particular palette is assumed.
 */
export async function assertReadable(page, selector) {
  const samples = await page.locator(selector).evaluateAll(elements => elements.map(element => {
    const style = getComputedStyle(element);
    const backgrounds = [];
    for (let node = element; node; node = node.parentElement) {
      backgrounds.push(getComputedStyle(node).backgroundColor);
    }
    return { color: style.color, backgrounds };
  }));
  assert.ok(samples.length, `Missing contrast target: ${selector}`);
  const parseColor = color => {
    assert.match(color, /^rgba?\(/, `Unsupported rendered color: ${color}`);
    const channels = color.match(/[\d.]+/g)?.map(Number);
    assert.ok(channels?.length === 3 || channels?.length === 4, `Unsupported rendered color: ${color}`);
    return { rgb: channels.slice(0, 3), alpha: channels[3] ?? 1 };
  };
  const luminance = channels => {
    return channels.map(value => {
      const normalized = value / 255;
      return normalized <= .04045 ? normalized / 12.92 : ((normalized + .055) / 1.055) ** 2.4;
    }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
  };
  for (const { color, backgrounds } of samples) {
    // Layers are collected nearest first: each ancestor supplies the backing
    // for the translucent layers already accumulated in front of it.
    let background = [0, 0, 0], alpha = 0, opaqueBacking = false;
    for (const layer of backgrounds) {
      const parsed = parseColor(layer);
      const contribution = (1 - alpha) * parsed.alpha;
      background = background.map((value, index) => value + contribution * parsed.rgb[index]);
      alpha += contribution;
      if (parsed.alpha === 1) { opaqueBacking = true; break; }
    }
    assert.ok(opaqueBacking, `No opaque background for ${selector}: ${backgrounds.join(' over ')}`);
    const text = parseColor(color);
    const foreground = text.rgb.map((value, index) => text.alpha * value + (1 - text.alpha) * background[index]);
    const levels = [luminance(foreground), luminance(background)].sort((a, b) => a - b);
    assert.ok((levels[1] + .05) / (levels[0] + .05) >= 4.5,
      `Unreadable text in ${selector}: ${color} on ${backgrounds.join(' over ')}`);
  }
}

/** The widget stays dark and readable under either Foundry client theme. */
export async function assertTheme(page, panel, theme) {
  await page.evaluate(value => { document.body.classList.remove('theme-light', 'theme-dark'); document.body.classList.add(`theme-${value}`); }, theme);
  await page.waitForTimeout(120); // The action buttons have a 90 ms background transition.
  assert.equal(await page.locator(panel).evaluate(element => getComputedStyle(element).colorScheme), 'dark');
  await assertReadable(page, panel);
}
