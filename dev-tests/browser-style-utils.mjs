import assert from 'node:assert/strict';

// Check rendered text, including a deliberately conflicting native option style.
// Do not bind verification to a particular hex palette or CSS declaration.
export async function assertReadable(page, selector) {
  const samples = await page.locator(selector).evaluateAll(elements => elements.map(element => {
    const style = getComputedStyle(element);
    let background = style.backgroundColor, parent = element.parentElement;
    while (background === 'rgba(0, 0, 0, 0)' && parent) {
      background = getComputedStyle(parent).backgroundColor; parent = parent.parentElement;
    }
    return { color: style.color, background, path: [element, element.parentElement, element.parentElement?.parentElement].filter(Boolean).map(node => ({class:node.className,background:getComputedStyle(node).backgroundColor})) };
  }));
  assert.ok(samples.length, `Missing contrast target: ${selector}`);
  const luminance = color => {
    const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
    assert.equal(channels?.length, 3, `Unsupported rendered color: ${color}`);
    return channels.map(value => {
      const normalized = value / 255;
      return normalized <= .04045 ? normalized / 12.92 : ((normalized + .055) / 1.055) ** 2.4;
    }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
  };
  for (const { color, background, path } of samples) {
    const levels = [luminance(color), luminance(background)].sort((a, b) => a - b);
    assert.ok((levels[1] + .05) / (levels[0] + .05) >= 4.5,
      `Unreadable text in ${selector}: ${color} on ${background}; ${JSON.stringify(path)}`);
  }
}

export async function assertTheme(page, panel, theme) {
  await page.evaluate(value => { document.body.classList.remove('theme-light', 'theme-dark'); document.body.classList.add(`theme-${value}`); }, theme);
  await page.waitForTimeout(120); // The action buttons have a 90 ms background transition.
  assert.equal(await page.locator(panel).evaluate(element => getComputedStyle(element).colorScheme), theme);
  await assertReadable(page, panel);
}
