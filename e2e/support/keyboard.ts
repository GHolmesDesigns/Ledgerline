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
    document
      .querySelectorAll(
        'a[href], button, input:not([type="hidden"]), select, textarea, summary, [tabindex="0"]',
      )
      .forEach((element, index) => element.setAttribute('data-kb-id', String(index)));
  });
  const withoutIndicator: string[] = [];
  const visited = new Set<string>();
  const repeatedDates = new Map<string, number>();
  let firstStop: string | null = null;
  let stops = 0;
  for (; stops < 400; stops += 1) {
    await page.keyboard.press('Tab');
    const stop = await page.evaluate(() => {
      const element = document.activeElement;
      if (!element || element === document.body) return null;
      const style = getComputedStyle(element);
      const circle = element.querySelector('circle');
      const indicator =
        (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) ||
        (!!circle && parseFloat(getComputedStyle(circle).strokeWidth) >= 5);
      const label =
        element.getAttribute('aria-label') ||
        (element.textContent ?? '').trim().slice(0, 40) ||
        element.tagName.toLowerCase();
      return {
        indicator,
        label: `${element.tagName.toLowerCase()} "${label}"`,
        key: element.getAttribute('data-kb-id') ?? '',
        isDate: element instanceof HTMLInputElement && element.type === 'date',
      };
    });
    if (!stop) break;
    if (visited.has(stop.key)) {
      if (stop.key === firstStop || !stop.isDate) break;
      const repeats = (repeatedDates.get(stop.key) ?? 0) + 1;
      repeatedDates.set(stop.key, repeats);
      if (repeats > 4) break;
      continue;
    }
    if (firstStop === null) firstStop = stop.key;
    visited.add(stop.key);
    if (!stop.indicator) withoutIndicator.push(stop.label);
  }
  const unreached = await page.evaluate(
    (visitedIds: string[]) => {
      const selector =
        'a[href], button:not([disabled]), input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex="0"]';
      return [...document.querySelectorAll<HTMLElement>(selector)]
        .filter((element) => {
          const box = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          const closedSection = element.closest('details:not([open])');
          return (
            box.width > 0 &&
            box.height > 0 &&
            style.visibility !== 'hidden' &&
            (!closedSection || element.tagName === 'SUMMARY')
          );
        })
        .filter((element) => !visitedIds.includes(element.getAttribute('data-kb-id') ?? ''))
        .map(
          (element) =>
            `${element.tagName.toLowerCase()} "${
              element.getAttribute('aria-label') ||
              (element.textContent ?? '').trim().slice(0, 40) ||
              element.tagName
            }"`,
        );
    },
    [...visited],
  );
  await page.evaluate(() =>
    document
      .querySelectorAll('[data-kb-id]')
      .forEach((element) => element.removeAttribute('data-kb-id')),
  );
  return { stops, withoutIndicator, unreached };
}
