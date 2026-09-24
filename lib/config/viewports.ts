import type { ViewportSpec } from '@/lib/types/dom';
import { browserLabel, type BrowserName } from './browsers';

export type ViewportGroup = 'mobile' | 'tablet' | 'desktop';

export interface CustomViewport {
  width: number;
  height: number;
}

export const CUSTOM_VIEWPORT_LIMITS = { minWidth: 240, maxWidth: 3840, minHeight: 240, maxHeight: 2400, max: 6 };

/** Default viewport matrix. Users pick groups; each group expands to these. */
export const VIEWPORTS: ViewportSpec[] = [
  { id: 'm-375x667', label: '375 × 667', width: 375, height: 667, group: 'mobile', isMobile: true, deviceScaleFactor: 2 },
  { id: 'm-390x844', label: '390 × 844', width: 390, height: 844, group: 'mobile', isMobile: true, deviceScaleFactor: 3 },
  { id: 'm-414x896', label: '414 × 896', width: 414, height: 896, group: 'mobile', isMobile: true, deviceScaleFactor: 2 },

  { id: 't-768x1024', label: '768 × 1024', width: 768, height: 1024, group: 'tablet', isMobile: true, deviceScaleFactor: 2 },
  { id: 't-820x1180', label: '820 × 1180', width: 820, height: 1180, group: 'tablet', isMobile: true, deviceScaleFactor: 2 },

  { id: 'd-1024x768', label: '1024 × 768', width: 1024, height: 768, group: 'desktop', isMobile: false, deviceScaleFactor: 1 },
  { id: 'd-1280x720', label: '1280 × 720', width: 1280, height: 720, group: 'desktop', isMobile: false, deviceScaleFactor: 1 },
  { id: 'd-1440x900', label: '1440 × 900', width: 1440, height: 900, group: 'desktop', isMobile: false, deviceScaleFactor: 1 },
  { id: 'd-1920x1080', label: '1920 × 1080', width: 1920, height: 1080, group: 'desktop', isMobile: false, deviceScaleFactor: 1 },
];

export const VIEWPORT_GROUPS: Array<{ id: ViewportGroup; label: string; hint: string }> = [
  { id: 'mobile', label: 'Mobile', hint: '375 · 390 · 414' },
  { id: 'tablet', label: 'Tablet', hint: '768 · 820' },
  { id: 'desktop', label: 'Desktop', hint: '1024 · 1280 · 1440 · 1920' },
];

/** Buckets an arbitrary width the same way the preset matrix is grouped. */
export function groupForWidth(width: number): ViewportGroup {
  if (width < 600) return 'mobile';
  if (width < 1024) return 'tablet';
  return 'desktop';
}

/** Turns a user-entered dimension into a full viewport spec. */
export function customViewportSpec({ width, height }: CustomViewport): ViewportSpec {
  const group = groupForWidth(width);
  return {
    id: `c-${width}x${height}`,
    label: `${width} × ${height}`,
    width,
    height,
    group,
    isMobile: group !== 'desktop',
    deviceScaleFactor: group === 'desktop' ? 1 : 2,
    custom: true,
  };
}

export function viewportsForGroups(groups: string[], custom: CustomViewport[] = []): ViewportSpec[] {
  const set = new Set(groups);
  const picked = VIEWPORTS.filter((v) => set.has(v.group));

  // A custom size that duplicates a preset (or another custom entry) would
  // only run the same page load twice.
  const taken = new Set(picked.map((v) => `${v.width}x${v.height}`));
  for (const size of custom) {
    const key = `${size.width}x${size.height}`;
    if (taken.has(key)) continue;
    taken.add(key);
    picked.push(customViewportSpec(size));
  }

  // Widest first: the desktop pass doubles as the Figma reference and as the
  // baseline that narrower viewports are diffed against.
  return picked.sort((a, b) => b.width - a.width || b.height - a.height);
}

/**
 * The spec for one browser pass over a viewport. With several browsers the id
 * and label carry the browser, so every per-pass structure (evidence ids, test
 * captions, report cards) stays unambiguous without special-casing.
 */
export function passSpec(viewport: ViewportSpec, browser: BrowserName, multiBrowser: boolean): ViewportSpec {
  if (!multiBrowser) return { ...viewport, browser };
  return {
    ...viewport,
    id: `${browser}-${viewport.id}`,
    label: `${viewport.label} · ${browserLabel(browser)}`,
    baseId: viewport.id,
    baseLabel: viewport.label,
    browser,
  };
}

export function getViewport(id: string): ViewportSpec | undefined {
  return VIEWPORTS.find((v) => v.id === id);
}

/**
 * Picks the viewport the Figma frame should be compared against: the widest
 * non-mobile viewport closest to the frame width, falling back to the widest
 * selected viewport of any kind.
 */
export function pickReferenceViewport(
  selected: ViewportSpec[],
  frameWidth: number,
): ViewportSpec | undefined {
  if (selected.length === 0) return undefined;
  const desktops = selected.filter((v) => v.group === 'desktop');
  const pool = desktops.length > 0 ? desktops : selected;
  return pool.reduce((best, v) =>
    Math.abs(v.width - frameWidth) < Math.abs(best.width - frameWidth) ? v : best,
  );
}
