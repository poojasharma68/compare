import type { DomElement } from '@/lib/types/dom';
import type { ResponsiveTestResult } from '@/lib/types/tests';
import {
  buildResponsiveTest,
  isHorizontallyClipped,
  layoutViewportWidth,
  parentOf,
  px,
  round,
  type ResponsiveContext,
} from './context';

const MAX_REPORTED = 5;

/**
 * Horizontal overflow at two levels:
 *  1. the document — the symptom a user feels as a sideways scrollbar;
 *  2. the outermost element responsible for it.
 *
 * Only the outermost element of each overflow chain is reported. When a
 * 1200px-wide shell pushes the page sideways, every one of its children is also
 * "outside the viewport" — reporting all of them turns one CSS bug into a dozen
 * findings and buries the one line that needs changing.
 */
export function detectOverflow(ctx: ResponsiveContext): ResponsiveTestResult[] {
  const tests: ResponsiveTestResult[] = [];
  const { metrics } = ctx.snapshot;
  const tol = ctx.tolerances.OVERFLOW_TOLERANCE;
  const layoutWidth = layoutViewportWidth(ctx);

  const documentOverflow = metrics.scrollWidth - metrics.clientWidth;
  const overflows = documentOverflow > tol;

  tests.push(
    buildResponsiveTest(ctx, {
      category: 'Overflow',
      check: 'overflow.document',
      title: 'Horizontal page overflow',
      element: 'document',
      expected: 'No horizontal overflow',
      actual: overflows
        ? `${px(documentOverflow)} overflow (document ${px(metrics.scrollWidth)} vs layout viewport ${px(
            metrics.clientWidth,
          )})`
        : `No overflow (document ${px(metrics.scrollWidth)})`,
      difference: overflows ? `+${px(documentOverflow)}` : 'none',
      delta: round(documentOverflow),
      status: overflows ? 'FAIL' : 'PASS',
      severity: overflows ? overflowSeverity(documentOverflow, layoutWidth) : 'none',
      message: overflows
        ? 'The page scrolls sideways at this viewport. Users see content cut off and a horizontal scrollbar.'
        : undefined,
    }),
  );

  const culprits = findCulprits(ctx, tol, layoutWidth);

  if (culprits.length === 0) {
    tests.push(
      buildResponsiveTest(ctx, {
        category: 'Overflow',
        check: 'overflow.elements',
        title: 'Elements within viewport bounds',
        element: 'all elements',
        expected: 'Every element stays inside the viewport',
        actual: 'No element extends past the viewport edge',
        difference: 'none',
        status: 'PASS',
        severity: 'none',
      }),
    );
    return tests;
  }

  for (const culprit of culprits.slice(0, MAX_REPORTED)) {
    const { el, overhang, direction, descendants } = culprit;
    tests.push(
      buildResponsiveTest(ctx, {
        category: 'Overflow',
        check: 'overflow.element',
        title: 'Element extends outside viewport',
        element: el.label,
        selector: el.selector,
        expected: `Stays within 0–${px(layoutWidth)}`,
        actual:
          direction === 'right'
            ? `Right edge at ${px(el.rect.right)}, ${px(overhang)} past the viewport`
            : `Left edge at ${px(el.rect.left)}, ${px(overhang)} before the viewport`,
        difference: `${px(overhang)} outside`,
        delta: round(overhang),
        status: 'FAIL',
        severity: overflowSeverity(overhang, layoutWidth),
        message:
          `${el.label} extends ${px(overhang)} outside the ${px(layoutWidth)} layout viewport and is not clipped by any ancestor.` +
          (descendants > 0
            ? ` ${descendants} nested element${descendants === 1 ? '' : 's'} overflow with it and are not listed separately.`
            : ''),
        highlight: el,
      }),
    );
  }

  return tests;
}

interface Culprit {
  el: DomElement;
  overhang: number;
  direction: 'left' | 'right';
  /** How many nested elements were folded into this finding. */
  descendants: number;
}

function findCulprits(ctx: ResponsiveContext, tol: number, layoutWidth: number): Culprit[] {
  const overflowing = new Map<number, Culprit>();

  for (const el of ctx.snapshot.elements) {
    if (el.significance < 0.3) continue;
    if (isHorizontallyClipped(el, ctx)) continue;
    // Off-canvas drawers are translated out on purpose; they are a layout
    // decision rather than a defect unless they push the document wide.
    if (el.styles.transform && el.styles.position === 'fixed') continue;

    const rightOver = el.rect.right - layoutWidth;
    const leftOver = -el.rect.left;
    const overhang = Math.max(rightOver, leftOver);
    if (overhang <= tol) continue;

    overflowing.set(el.index, {
      el,
      overhang,
      direction: rightOver >= leftOver ? 'right' : 'left',
      descendants: 0,
    });
  }

  // Keep the outermost offender per chain: a child that overflows only because
  // its parent is too wide is a symptom, and the parent is the fix.
  const culprits: Culprit[] = [];
  for (const culprit of overflowing.values()) {
    // Walk all the way up: attribute the finding to the highest overflowing
    // ancestor so nested chains collapse into one root cause, not several.
    let ancestor = parentOf(culprit.el, ctx);
    let covered: Culprit | null = null;
    let guard = 0;

    while (ancestor && guard++ < 40) {
      const match = overflowing.get(ancestor.index);
      if (match && match.overhang >= culprit.overhang - 1) covered = match;
      ancestor = parentOf(ancestor, ctx);
    }

    if (covered) covered.descendants++;
    else culprits.push(culprit);
  }

  return culprits.sort((a, b) => b.overhang - a.overhang);
}

function overflowSeverity(overhang: number, layoutWidth: number): 'minor' | 'major' | 'critical' {
  const ratio = overhang / Math.max(1, layoutWidth);
  if (ratio >= 0.15 || overhang >= 120) return 'critical';
  if (ratio >= 0.04 || overhang >= 24) return 'major';
  return 'minor';
}
