import type { DomElement } from '@/lib/types/dom';
import type { ResponsiveTestResult } from '@/lib/types/tests';
import { buildResponsiveTest, layoutViewportWidth, type ResponsiveContext } from './context';

const MAX_REPORTED = 6;

const NAV_HINT = /(nav|menu|header)/i;
const TOGGLE_HINT = /(hamburger|burger|menu-toggle|menu-button|nav-toggle|mobile-menu|drawer|offcanvas|menu-icon)/i;

/**
 * Elements that appear or disappear between viewports.
 *
 * Hiding content at small sizes is usually a deliberate responsive decision, so
 * the default verdict here is WARNING, exactly as the spec requires. Only the
 * loss of genuinely primary content — a page's `main`, its `h1` — is treated as
 * a failure, because that is never intentional.
 */
export function detectVisibility(ctx: ResponsiveContext): ResponsiveTestResult[] {
  if (!ctx.baseline) {
    return [
      buildResponsiveTest(ctx, {
        category: 'Visibility',
        check: 'visibility.reference',
        title: 'Reference viewport',
        element: 'document',
        expected: 'Baseline for cross-viewport comparison',
        actual: 'This is the widest viewport analysed, so it defines the baseline',
        difference: 'n/a',
        status: 'PASS',
        severity: 'none',
      }),
    ];
  }

  const tests: ResponsiveTestResult[] = [];
  const currentSelectors = new Set(ctx.snapshot.elements.map((el) => el.selector));
  const menuToggle = findMenuToggle(ctx);

  const hidden = [...ctx.baselineBySelector.values()]
    .filter((el) => !currentSelectors.has(el.selector))
    .filter((el) => el.significance >= 0.55)
    .filter((el) => Boolean(el.ownText) || el.isImage || el.isInteractive || isLandmark(el));

  const hiddenSelectors = new Set(hidden.map((el) => el.selector));
  const baselineByIndex = new Map(ctx.baseline.elements.map((e) => [e.index, e]));

  const disappeared = hidden
    // Hiding a nav hides its links too. Reporting each one turns a single
    // responsive decision into a wall of warnings, so only the outermost
    // hidden element is reported.
    .filter((el) => !hasHiddenAncestor(el, hiddenSelectors, baselineByIndex))
    // A menu toggle appearing exactly where a navigation disappeared is the
    // standard mobile pattern, not a defect.
    .filter((el) => !(menuToggle && isNavigation(el)))
    .sort((a, b) => b.significance - a.significance);

  if (menuToggle && hidden.some(isNavigation)) {
    tests.push(
      buildResponsiveTest(ctx, {
        category: 'Visibility',
        check: 'visibility.mobileMenu',
        title: 'Navigation collapses into a menu',
        element: menuToggle.label,
        selector: menuToggle.selector,
        expected: 'A menu control replaces the full navigation at this width',
        actual: `Navigation is hidden and ${menuToggle.label} is shown`,
        difference: 'none',
        status: 'PASS',
        severity: 'none',
        message: 'The desktop navigation is hidden and a menu control is visible in its place.',
      }),
    );
  }

  // Several siblings hidden together is one responsive decision, not six.
  const groups = groupBySiblings(disappeared);

  for (const group of groups.slice(0, MAX_REPORTED)) {
    const el = group[0];
    const siblingCount = group.length;
    const critical = isPrimaryContent(el) && siblingCount === 1;
    tests.push(
      buildResponsiveTest(ctx, {
        category: 'Visibility',
        check: 'visibility.hidden',
        title: critical
          ? 'Primary content is hidden'
          : siblingCount > 1
            ? `${siblingCount} sibling elements hidden at this viewport`
            : 'Element hidden at this viewport',
        element: siblingCount > 1 ? `${el.label} and ${siblingCount - 1} more` : el.label,
        selector: el.selector,
        expected: `Visible, as ${siblingCount > 1 ? 'they are' : 'it is'} at ${ctx.baseline.viewport.label}`,
        actual: `Not rendered or not visible at this viewport`,
        difference: siblingCount > 1 ? `${siblingCount} hidden` : 'hidden',
        status: critical ? 'FAIL' : 'WARNING',
        severity: critical ? 'major' : 'minor',
        message: critical
          ? `${el.label} carries primary page content but disappears at this viewport.`
          : `${
              siblingCount > 1 ? `${siblingCount} sibling elements are` : `${el.label} is`
            } visible at ${ctx.baseline.viewport.label} but not here. This is usually intentional — confirm the content is still reachable.`,
      }),
    );
  }

  const navFinding = checkDesktopNav(ctx, currentSelectors);
  if (navFinding) tests.push(navFinding);

  if (tests.length === 0) {
    tests.push(
      buildResponsiveTest(ctx, {
        category: 'Visibility',
        check: 'visibility.consistent',
        title: 'Content visibility is consistent',
        element: 'document',
        expected: `Same meaningful content as ${ctx.baseline.viewport.label}`,
        actual: 'No unexpected appearances or disappearances',
        difference: 'none',
        status: 'PASS',
        severity: 'none',
      }),
    );
  }

  return tests;
}

/**
 * The classic responsive bug: a full desktop navigation still rendered at phone
 * width with no mobile menu in sight. Reported as a warning, since the
 * structure alone cannot prove intent.
 */
function checkDesktopNav(ctx: ResponsiveContext, currentSelectors: Set<string>): ResponsiveTestResult | null {
  const viewport = ctx.snapshot.viewport;
  if (viewport.width > 480) return null;
  const layoutWidth = layoutViewportWidth(ctx);

  const navs = ctx.snapshot.elements.filter(
    (el) => (el.tag === 'nav' || NAV_HINT.test(`${el.id ?? ''} ${el.classList.join(' ')}`)) && el.rect.width > 0,
  );
  if (navs.length === 0) return null;

  const wideNav = navs.find((nav) => {
    const links = countInteractiveDescendants(nav, ctx);
    return links >= 4 && nav.rect.width >= layoutWidth * 0.6 && nav.rect.height < 140;
  });
  if (!wideNav) return null;

  const hasToggle = ctx.snapshot.elements.some(
    (el) =>
      el.isInteractive &&
      el.rect.width <= 80 &&
      el.rect.height <= 80 &&
      TOGGLE_HINT.test(`${el.id ?? ''} ${el.classList.join(' ')} ${el.role ?? ''} ${el.ownText}`),
  );
  if (hasToggle) return null;

  // If the same nav is not present at the baseline, there is nothing to compare.
  if (ctx.baseline && !currentSelectors.has(wideNav.selector)) return null;

  return buildResponsiveTest(ctx, {
    category: 'Visibility',
    check: 'visibility.desktopNav',
    title: 'Desktop navigation still shown at mobile width',
    element: wideNav.label,
    selector: wideNav.selector,
    expected: 'A collapsed menu at mobile width',
    actual: `A ${Math.round(wideNav.rect.width)}px-wide navigation with ${countInteractiveDescendants(
      wideNav,
      ctx,
    )} links and no visible menu toggle`,
    difference: 'no mobile menu detected',
    status: 'WARNING',
    severity: 'minor',
    message:
      'The full navigation renders at phone width and no menu toggle was found. If this is deliberate, ignore it — the structure alone cannot confirm intent.',
    highlight: wideNav,
  });
}

/**
 * Finds a visible menu control at this viewport: a small interactive element
 * named like a menu toggle, or one whose only content is a hamburger glyph.
 */
function findMenuToggle(ctx: ResponsiveContext): DomElement | null {
  return (
    ctx.snapshot.elements.find(
      (el) =>
        el.isInteractive &&
        el.rect.width > 0 &&
        el.rect.width <= 96 &&
        el.rect.height <= 96 &&
        (TOGGLE_HINT.test(`${el.id ?? ''} ${el.classList.join(' ')} ${el.role ?? ''}`) ||
          /^(menu|≡|☰|»|nav)$/i.test(el.ownText.trim()) ||
          /(menu|navigation)/i.test(el.ariaLabel ?? '')),
    ) ?? null
  );
}

/** Buckets hidden elements by shared parent, preserving significance order. */
function groupBySiblings(elements: DomElement[]): DomElement[][] {
  const byParent = new Map<number | string, DomElement[]>();
  for (const el of elements) {
    const key = el.parentIndex ?? `root:${el.tag}`;
    const bucket = byParent.get(key);
    if (bucket) bucket.push(el);
    else byParent.set(key, [el]);
  }
  return [...byParent.values()].sort((a, b) => b[0].significance - a[0].significance);
}

function isNavigation(el: DomElement): boolean {
  return el.tag === 'nav' || el.tag === 'a' || NAV_HINT.test(`${el.id ?? ''} ${el.classList.join(' ')}`);
}

/**
 * The baseline snapshot owns the hierarchy here, since these elements do not
 * exist in the current one.
 */
function hasHiddenAncestor(
  el: DomElement,
  hidden: Set<string>,
  byIndex: Map<number, DomElement>,
): boolean {
  let parentIndex = el.parentIndex;
  let guard = 0;
  while (parentIndex !== null && parentIndex !== undefined && guard++ < 40) {
    const parent = byIndex.get(parentIndex);
    if (!parent) break;
    if (hidden.has(parent.selector)) return true;
    parentIndex = parent.parentIndex;
  }
  return false;
}

function countInteractiveDescendants(el: DomElement, ctx: ResponsiveContext): number {
  let count = 0;
  const stack = [...el.childIndexes];
  let guard = 0;
  while (stack.length && guard++ < 400) {
    const child = ctx.byIndex.get(stack.pop() as number);
    if (!child) continue;
    if (child.isInteractive) count++;
    stack.push(...child.childIndexes);
  }
  return count;
}

function isLandmark(el: DomElement): boolean {
  return ['nav', 'header', 'footer', 'main', 'section', 'aside', 'form'].includes(el.tag);
}

function isPrimaryContent(el: DomElement): boolean {
  if (el.tag === 'main' || el.tag === 'h1') return true;
  return el.significance >= 0.85 && Boolean(el.ownText);
}
