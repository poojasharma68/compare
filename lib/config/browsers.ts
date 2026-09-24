export type BrowserName = 'chromium' | 'firefox' | 'webkit';

/**
 * The three engines Playwright drives. Between them they cover what real users
 * run: Blink (Chrome, Edge, Opera, Samsung Internet), Gecko (Firefox) and
 * WebKit (Safari on macOS, and every browser on iOS).
 */
export const BROWSERS: Array<{ id: BrowserName; label: string; hint: string }> = [
  { id: 'chromium', label: 'Chromium', hint: 'Chrome · Edge' },
  { id: 'firefox', label: 'Firefox', hint: 'Gecko' },
  { id: 'webkit', label: 'WebKit', hint: 'Safari · iOS' },
];

export const BROWSER_NAMES = BROWSERS.map((b) => b.id) as [BrowserName, ...BrowserName[]];

export function browserLabel(name: BrowserName | undefined): string {
  return BROWSERS.find((b) => b.id === name)?.label ?? 'Chromium';
}

/**
 * Canonical run order. The first browser that launches is the reference the
 * others are compared against, so Chromium — the majority engine — leads.
 */
export function orderBrowsers(selected: string[]): BrowserName[] {
  const set = new Set(selected);
  const ordered = BROWSER_NAMES.filter((name) => set.has(name));
  return ordered.length > 0 ? ordered : ['chromium'];
}
