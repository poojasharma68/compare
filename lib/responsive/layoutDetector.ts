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

const MAX_PER_CHECK = 4;

/**
 * Structural responsive failures: containers that cannot shrink, grids and flex
 * rows that refuse to reflow, children escaping their parent, and fixed
 * dimensions that are a risk at this width.
 *
 * Per the spec, a fixed dimension that causes a real layout problem FAILs,
 * while one that currently causes no visible problem is only a WARNING.
 */
export function detectLayoutProblems(ctx: ResponsiveContext): ResponsiveTestResult[] {
  const tests: ResponsiveTestResult[] = [];

  tests.push(...detectViewportMeta(ctx));
  tests.push(...detectFixedWidthContainers(ctx));
  tests.push(...detectGridOverflow(ctx));
  tests.push(...detectFlexOverflow(ctx));
  tests.push(...detectEscapingChildren(ctx));
  tests.push(...detectExcessiveWhitespace(ctx));

  if (tests.every((t) => t.status === 'PASS')) return tests;
  return tests;
}

/* ------------------------------ fixed widths ------------------------------ */

function detectFixedWidthContainers(ctx: ResponsiveContext): ResponsiveTestResult[] {
  const viewportWidth = layoutViewportWidth(ctx);
  const documentOverflows =
    ctx.snapshot.metrics.scrollWidth - ctx.snapshot.metrics.clientWidth > ctx.tolerances.OVERFLOW_TOLERANCE;

  const flagged = ctx.snapshot.elements
    .filter((el) => el.significance >= 0.35)
    .filter((el) => el.rect.width > viewportWidth + 1)
    .filter((el) => !isHorizontallyClipped(el, ctx))
    .map((el) => ({ el, evidence: fixedWidthEvidence(el, ctx) }))
    .filter((entry): entry is { el: DomElement; evidence: string } => entry.evidence !== null);

  // As with overflow, report the outermost offender only: a child that is wide
  // because its container is wide is a symptom, not the cause.
  const flaggedIndexes = new Set(flagged.map((entry) => entry.el.index));
  const suspects = flagged
    .filter((entry) => !hasFlaggedAncestor(entry.el, flaggedIndexes, ctx))
    .sort((a, b) => b.el.rect.width - a.el.rect.width);

  if (suspects.length === 0) {
    return [
      buildResponsiveTest(ctx, {
        category: 'Layout',
        check: 'layout.fixedWidth',
        title: 'No fixed-width containers wider than the viewport',
        element: 'all containers',
        expected: 'Containers adapt to the viewport width',
        actual: 'No fixed-width container exceeds the viewport',
        difference: 'none',
        status: 'PASS',
        severity: 'none',
      }),
    ];
  }

  return suspects.slice(0, MAX_PER_CHECK).map(({ el, evidence }) => {
    const excess = el.rect.width - viewportWidth;
    // The distinction the spec asks for: does it actually break anything?
    const causesProblem = documentOverflows && el.rect.right > viewportWidth + ctx.tolerances.OVERFLOW_TOLERANCE;

    return buildResponsiveTest(ctx, {
      category: 'Layout',
      check: 'layout.fixedWidth',
      title: causesProblem ? 'Fixed-width container overflows the viewport' : 'Fixed-width container detected',
      element: el.label,
      selector: el.selector,
      expected: `Width at most ${px(viewportWidth)}`,
      actual: `${px(el.rect.width)} (${evidence})`,
      difference: `${px(excess)} wider than the viewport`,
      delta: round(excess),
      status: causesProblem ? 'FAIL' : 'WARNING',
      severity: causesProblem ? (excess > viewportWidth * 0.15 ? 'critical' : 'major') : 'minor',
      message: causesProblem
        ? `${el.label} is ${px(el.rect.width)} wide at a ${px(viewportWidth)} viewport and is pushing the page sideways.`
        : `${el.label} is wider than the viewport but is not currently causing visible overflow. It remains a risk at narrower widths.`,
      highlight: el,
    });
  });
}

function hasFlaggedAncestor(el: DomElement, flagged: Set<number>, ctx: ResponsiveContext): boolean {
  let ancestor = parentOf(el, ctx);
  let guard = 0;
  while (ancestor && guard++ < 40) {
    if (flagged.has(ancestor.index)) return true;
    ancestor = parentOf(ancestor, ctx);
  }
  return false;
}

/** Explains *why* an element looks fixed-width, or null if it just looks fluid. */
function fixedWidthEvidence(el: DomElement, ctx: ResponsiveContext): string | null {
  if (el.hasInlineFixedWidth) return 'inline fixed px width';
  if (el.styles.minWidth && el.styles.minWidth !== 'auto' && el.styles.minWidth !== '0px') {
    return `min-width: ${el.styles.minWidth}`;
  }

  // Cross-viewport proof: the same element is the same width at a very
  // different viewport, so its width does not depend on the viewport at all.
  const baseline = ctx.baselineBySelector.get(el.selector);
  if (baseline && ctx.baseline) {
    const widthDelta = Math.abs(baseline.rect.width - el.rect.width);
    const viewportDelta = Math.abs(ctx.baseline.viewport.width - ctx.snapshot.viewport.width);
    if (viewportDelta > 200 && widthDelta <= 2) {
      return `identical width at ${ctx.baseline.viewport.label}`;
    }
  }

  // Anything else is just an element sitting inside an over-wide parent.
  // That is the parent's bug, not this element's.
  return null;
}

/* --------------------------------- grids --------------------------------- */

function detectGridOverflow(ctx: ResponsiveContext): ResponsiveTestResult[] {
  const findings: ResponsiveTestResult[] = [];

  for (const el of ctx.snapshot.elements) {
    if (findings.length >= MAX_PER_CHECK) break;
    if (!el.styles.display.includes('grid')) continue;

    const columns = parseTrackList(el.styles.gridTemplateColumns);
    if (columns.length < 2) continue;

    // Measure where the children actually land rather than reconstructing the
    // track maths. Computed track sizes already account for gaps, so adding
    // them back double-counts and flags healthy `auto-fit` grids.
    const children = el.childIndexes
      .map((i) => ctx.byIndex.get(i))
      .filter((c): c is DomElement => Boolean(c));
    if (children.length === 0) continue;

    const contentRight = el.rect.right - el.styles.paddingRight;
    const overhang = children.reduce((worst, c) => Math.max(worst, c.rect.right - contentRight), 0);
    if (overhang <= 2) continue;

    findings.push(
      buildResponsiveTest(ctx, {
        category: 'Layout',
        check: 'layout.gridOverflow',
        title: 'Grid columns exceed their container',
        element: el.label,
        selector: el.selector,
        expected: `${columns.length} columns fitting in ${px(el.clientWidth || el.rect.width)}`,
        actual: `A column extends ${px(overhang)} past the grid's content box`,
        difference: `${px(overhang)} over`,
        delta: round(overhang),
        status: 'FAIL',
        severity: overhang > 60 ? 'major' : 'minor',
        message: `The grid keeps ${columns.length} columns at this viewport. Consider \`repeat(auto-fit, minmax(...))\` or a breakpoint that reduces the column count.`,
        highlight: el,
      }),
    );
  }

  return findings;
}

/** Computed `grid-template-columns` resolves to a px list — parse it back. */
function parseTrackList(value: string): number[] {
  if (!value || value === 'none') return [];
  return value
    .split(/\s+/)
    .map((token) => parseFloat(token))
    .filter((n) => Number.isFinite(n) && n > 0);
}

/* ---------------------------------- flex ---------------------------------- */

function detectFlexOverflow(ctx: ResponsiveContext): ResponsiveTestResult[] {
  const findings: ResponsiveTestResult[] = [];

  for (const el of ctx.snapshot.elements) {
    if (findings.length >= MAX_PER_CHECK) break;
    if (!el.styles.display.includes('flex')) continue;
    if (el.styles.flexWrap !== 'nowrap') continue;
    if (!el.styles.flexDirection.startsWith('row')) continue;
    // A row inside a horizontal scroller is a carousel. Its children are
    // supposed to extend past the visible box, so this is not a layout break.
    if (hasScrollableAncestorX(el, ctx)) continue;

    const children = el.childIndexes
      .map((i) => ctx.byIndex.get(i))
      .filter((c): c is DomElement => Boolean(c));
    if (children.length < 2) continue;

    const childWidth = children.reduce(
      (sum, c) => sum + c.rect.width + c.styles.marginLeft + c.styles.marginRight,
      0,
    );
    const gaps = (el.styles.gap ?? 0) * (children.length - 1);
    const required = childWidth + gaps;
    const available = el.clientWidth || el.rect.width;

    if (required > available + 4) {
      findings.push(
        buildResponsiveTest(ctx, {
          category: 'Layout',
          check: 'layout.flexOverflow',
          title: 'Flex children overflow their row',
          element: el.label,
          selector: el.selector,
          expected: `${children.length} children fitting in ${px(available)}`,
          actual: `Children occupy ${px(required)} with \`flex-wrap: nowrap\``,
          difference: `${px(required - available)} over`,
          delta: round(required - available),
          status: 'FAIL',
          severity: required - available > 80 ? 'major' : 'minor',
          message: `This row cannot wrap, so its children are squeezed or pushed outside. \`flex-wrap: wrap\` or a column direction at this breakpoint would fix it.`,
          highlight: el,
        }),
      );
    }
  }

  return findings;
}

/** True when this element or an ancestor scrolls horizontally. */
function hasScrollableAncestorX(el: DomElement, ctx: ResponsiveContext): boolean {
  let current: DomElement | null = el;
  let guard = 0;
  while (current && guard++ < 20) {
    const ox = current.styles.overflowX;
    if (ox === 'auto' || ox === 'scroll') return true;
    current = parentOf(current, ctx);
  }
  return false;
}

/* --------------------------- escaping children ---------------------------- */

function detectEscapingChildren(ctx: ResponsiveContext): ResponsiveTestResult[] {
  const findings: ResponsiveTestResult[] = [];

  for (const el of ctx.snapshot.elements) {
    if (findings.length >= MAX_PER_CHECK) break;
    if (el.significance < 0.4) continue;
    if (el.styles.position === 'absolute' || el.styles.position === 'fixed') continue;

    const parent = parentOf(el, ctx);
    if (!parent || parent.clipsOverflow) continue;
    if (parent.rect.width <= 0) continue;
    // Grid and non-wrapping flex containers have their own, more actionable
    // checks above; reporting each escaping child again is pure duplication.
    const parentDisplay = parent.styles.display;
    if (parentDisplay.includes('grid')) continue;
    if (parentDisplay.includes('flex') && parent.styles.flexWrap === 'nowrap') continue;

    const rightEdge = parent.rect.right - parent.styles.paddingRight;
    const spill = el.rect.right - rightEdge;
    // Ignore small spills and elements deliberately pulled out with margins.
    if (spill <= 6 || el.styles.marginRight < -1) continue;
    if (spill > parent.rect.width) continue;

    findings.push(
      buildResponsiveTest(ctx, {
        category: 'Layout',
        check: 'layout.childEscapesContainer',
        title: 'Child extends outside its container',
        element: el.label,
        selector: el.selector,
        expected: `Right edge at or before ${px(rightEdge)} (inside ${parent.label})`,
        actual: `Right edge at ${px(el.rect.right)}`,
        difference: `${px(spill)} outside`,
        delta: round(spill),
        status: 'FAIL',
        severity: spill > 32 ? 'major' : 'minor',
        message: `${el.label} extends ${px(spill)} past the content box of ${parent.label}.`,
        highlight: el,
      }),
    );
  }

  return findings;
}

/* ---------------------------- excessive whitespace ------------------------ */

function detectExcessiveWhitespace(ctx: ResponsiveContext): ResponsiveTestResult[] {
  const threshold = ctx.tolerances.EXCESSIVE_WHITESPACE;
  const sections = ctx.snapshot.elements
    .filter((el) => el.significance >= 0.55 && el.rect.width >= layoutViewportWidth(ctx) * 0.5)
    .filter((el) => el.styles.position !== 'absolute' && el.styles.position !== 'fixed')
    .sort((a, b) => a.rect.y - b.rect.y);

  const findings: ResponsiveTestResult[] = [];

  for (let i = 0; i < sections.length - 1 && findings.length < 2; i++) {
    const current = sections[i];
    const next = sections[i + 1];
    // Only siblings: a nested element naturally starts inside its parent.
    if (current.parentIndex !== next.parentIndex) continue;

    const gap = next.rect.y - current.rect.bottom;
    if (gap > threshold) {
      findings.push(
        buildResponsiveTest(ctx, {
          category: 'Layout',
          check: 'layout.excessiveWhitespace',
          title: 'Excessive vertical whitespace',
          element: `${current.label} → ${next.label}`,
          selector: current.selector,
          expected: `A gap of at most ${px(threshold)}`,
          actual: `${px(gap)} of empty space`,
          difference: `${px(gap - threshold)} over`,
          delta: round(gap - threshold),
          status: 'WARNING',
          severity: 'minor',
          message: `There is ${px(gap)} of empty space between these sections at this viewport, often a sign of a collapsed or empty element.`,
          highlight: current,
        }),
      );
    }
  }

  return findings;
}

/* ------------------------------ viewport meta ----------------------------- */

/**
 * Compares the layout viewport the browser actually used against the device
 * width being emulated. A mobile device that lays out at ~980px is the
 * signature of a missing or ineffective `<meta name="viewport">` — the single
 * highest-leverage responsive bug there is, since it invalidates every
 * breakpoint on the page.
 */
function detectViewportMeta(ctx: ResponsiveContext): ResponsiveTestResult[] {
  const deviceWidth = ctx.snapshot.viewport.width;
  const layoutWidth = layoutViewportWidth(ctx);
  const drift = layoutWidth - deviceWidth;

  // Desktop contexts have no separate layout viewport to diverge from.
  if (!ctx.snapshot.viewport.isMobile) return [];

  if (drift <= 24) {
    return [
      buildResponsiveTest(ctx, {
        category: 'Layout',
        check: 'layout.viewportMeta',
        title: 'Layout viewport matches the device',
        element: 'document',
        expected: `Laid out at the device width, ${px(deviceWidth)}`,
        actual: `Laid out at ${px(layoutWidth)}`,
        difference: 'none',
        status: 'PASS',
        severity: 'none',
      }),
    ];
  }

  return [
    buildResponsiveTest(ctx, {
      category: 'Layout',
      check: 'layout.viewportMeta',
      title: 'Page does not adopt the device width',
      element: 'document',
      expected: `Laid out at the device width, ${px(deviceWidth)}`,
      actual: `Laid out at ${px(layoutWidth)} and scaled down to fit`,
      difference: `${px(drift)} wider than the device`,
      delta: round(drift),
      status: 'FAIL',
      severity: 'critical',
      message:
        'The browser fell back to a desktop-sized layout viewport, which almost always means ' +
        '`<meta name="viewport" content="width=device-width, initial-scale=1">` is missing or overridden. ' +
        'Until that is fixed, no CSS breakpoint on this page can take effect on a real phone.',
    }),
  ];
}
