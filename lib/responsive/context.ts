import type { DomElement, PageSnapshot } from '@/lib/types/dom';
import type { ResponsiveCategory, ResponsiveTestResult, Severity, TestStatus } from '@/lib/types/tests';
import type { Tolerances } from '@/lib/config/tolerances';

export interface ResponsiveContext {
  snapshot: PageSnapshot;
  /** The widest analysed viewport, used as the reference for cross-viewport
   *  checks. Null when this snapshot *is* the widest one. */
  baseline: PageSnapshot | null;
  tolerances: Tolerances;
  byIndex: Map<number, DomElement>;
  /** Baseline elements keyed by selector, for identity across viewports. */
  baselineBySelector: Map<string, DomElement>;
  nextId: () => string;
}

export interface ResponsiveTestInput {
  category: ResponsiveCategory;
  check: string;
  title: string;
  element: string;
  selector?: string;
  expected: string;
  actual: string;
  difference: string;
  delta?: number;
  status: TestStatus;
  severity: Severity;
  message?: string;
  /** Element to highlight on the evidence screenshot. */
  highlight?: DomElement;
}

export function buildResponsiveTest(
  ctx: ResponsiveContext,
  input: ResponsiveTestInput,
): ResponsiveTestResult {
  const test: ResponsiveTestResult = {
    kind: 'responsive',
    id: ctx.nextId(),
    title: input.title,
    check: input.check,
    category: input.category,
    element: input.element,
    selector: input.selector,
    expected: input.expected,
    actual: input.actual,
    difference: input.difference,
    delta: input.delta,
    severity: input.severity,
    status: input.status,
    message: input.message,
    viewportId: ctx.snapshot.viewport.id,
    viewportLabel: ctx.snapshot.viewport.label,
  };

  // Evidence is recorded in document coordinates and the screenshot is taken
  // later, while the page is still open — only then is it known which findings
  // are worth capturing, and where on the page to point the camera.
  const target = input.highlight;
  if (target && input.status !== 'PASS' && input.status !== 'SKIPPED') {
    test.evidence = {
      highlight: {
        x: Math.max(0, target.rect.x),
        y: Math.max(0, target.rect.y),
        width: Math.max(1, target.rect.width),
        height: Math.max(1, target.rect.height),
      },
      caption: `${ctx.snapshot.viewport.label} · ${target.label}`,
    };
  }

  return test;
}

/** Elements worth testing: visible, reasonably sized, semantically relevant. */
export function meaningfulElements(ctx: ResponsiveContext, minSignificance = 0.45): DomElement[] {
  return ctx.snapshot.elements.filter(
    (el) => el.significance >= minSignificance && el.rect.width >= 8 && el.rect.height >= 8,
  );
}

export function isAncestorOf(ancestor: DomElement, node: DomElement, ctx: ResponsiveContext): boolean {
  let index: number | null = node.parentIndex;
  let guard = 0;
  while (index !== null && index !== undefined && guard++ < 50) {
    if (index === ancestor.index) return true;
    index = ctx.byIndex.get(index)?.parentIndex ?? null;
  }
  return false;
}

export function parentOf(el: DomElement, ctx: ResponsiveContext): DomElement | null {
  if (el.parentIndex === null || el.parentIndex === undefined) return null;
  return ctx.byIndex.get(el.parentIndex) ?? null;
}

/** True when this element or any ancestor clips overflow on the X axis. */
export function isHorizontallyClipped(el: DomElement, ctx: ResponsiveContext): boolean {
  if (el.clippedByAncestor) return true;
  let current: DomElement | null = parentOf(el, ctx);
  let guard = 0;
  while (current && guard++ < 30) {
    const ox = current.styles.overflowX;
    if (ox === 'hidden' || ox === 'clip' || ox === 'auto' || ox === 'scroll') return true;
    current = parentOf(current, ctx);
  }
  return false;
}

/**
 * The width the page is actually laid out at.
 *
 * On a mobile device this is NOT the device width: without a `<meta name="viewport">`
 * tag Chromium falls back to a ~980px layout viewport and scales the result down.
 * Element geometry is reported in that coordinate space, so every geometric
 * comparison has to use it rather than the configured device width.
 */
export function layoutViewportWidth(ctx: ResponsiveContext): number {
  const measured = ctx.snapshot.metrics.clientWidth;
  return measured > 0 ? measured : ctx.snapshot.viewport.width;
}

export function round(n: number, decimals = 1): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

export function px(n: number, decimals = 0): string {
  return `${round(n, decimals)}px`;
}
