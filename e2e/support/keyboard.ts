import { expect, type Locator, type Page } from '@playwright/test';

/** Presses Tab until `target` has focus. Fails if the control cannot be reached. */
export async function tabTo(page: Page, target: Locator, maxPresses = 250) {
  await expect(target).toBeVisible();
  for (let presses = 0; presses <= maxPresses; presses += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`Could not reach ${target} with the Tab key in ${maxPresses} presses.`);
}

/** The focused control must show an outline, or a thicker ring for an SVG map pin. */
export async function expectFocusVisible(target: Locator) {
  const visible = await target.evaluate((element) => {
    const style = getComputedStyle(element);
    if (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) return true;
    const circle = element.querySelector('circle');
    return !!circle && parseFloat(getComputedStyle(circle).strokeWidth) >= 5;
  });
  expect(visible, 'the focused control shows a focus indicator').toBe(true);
}

/** Moves to a control with Tab, checks its focus indicator, then activates it. */
export async function pressWithKeyboard(page: Page, target: Locator, key = 'Enter') {
  await tabTo(page, target);
  await expectFocusVisible(target);
  await page.keyboard.press(key);
}

/**
 * Tabs through the whole page from the top. Returns every control the Tab key stopped on
 * without a visible focus indicator, and every visible control it never reached.
 */
export async function sweepTabOrder(page: Page) {
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    // Tab continues from the focused element, so park focus on the page itself first.
    document.body.setAttribute('tabindex', '-1');
    document.body.focus();
    document.body.removeAttribute('tabindex');
    document.querySelectorAll('[data-kb-seen]').forEach((element) => {
      element.removeAttribute('data-kb-seen');
    });
  });
  const withoutIndicator: string[] = [];
  let stops = 0;
  for (; stops < 400; stops += 1) {
    await page.keyboard.press('Tab');
    const stop = await page.evaluate(() => {
      const element = document.activeElement;
      if (!element || element === document.body || element.hasAttribute('data-kb-seen')) {
        return null;
      }
      element.setAttribute('data-kb-seen', '');
      const style = getComputedStyle(element);
      const circle = element.querySelector('circle');
      const indicator =
        (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) ||
        (!!circle && parseFloat(getComputedStyle(circle).strokeWidth) >= 5);
      const label =
        element.getAttribute('aria-label') ||
        (element.textContent ?? '').trim().slice(0, 40) ||
        element.tagName.toLowerCase();
      return { indicator, label: `${element.tagName.toLowerCase()} "${label}"` };
    });
    if (!stop) break;
    if (!stop.indicator) withoutIndicator.push(stop.label);
  }
  const unreached = await page.evaluate(() => {
    const selector =
      'a[href], button:not([disabled]), input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex="0"]';
    return [...document.querySelectorAll<HTMLElement>(selector)]
      .filter((element) => {
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return box.width > 0 && box.height > 0 && style.visibility !== 'hidden';
      })
      .filter((element) => !element.hasAttribute('data-kb-seen'))
      .map(
        (element) =>
          `${element.tagName.toLowerCase()} "${
            element.getAttribute('aria-label') ||
            (element.textContent ?? '').trim().slice(0, 40) ||
            element.tagName
          }"`,
      );
  });
  return { stops, withoutIndicator, unreached };
}
