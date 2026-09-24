import type { DesignNode, DesignTree } from '@/lib/types/figma';
import type { DomElement, PageSnapshot } from '@/lib/types/dom';
import type { ElementMatch, Severity, TestStatus, UiCategory, UiTestResult } from '@/lib/types/tests';
import type { Tolerances } from '@/lib/config/tolerances';
import { classifyDeviation } from '@/lib/config/tolerances';

/** A Figma node paired with the DOM element the matcher assigned to it. */
export interface MatchedPair {
  node: DesignNode;
  el: DomElement;
  match: ElementMatch;
}

export interface ComparisonContext {
  tolerances: Tolerances;
  /** designPx × scale = expected CSS px for layout geometry. */
  scale: number;
  design: DesignTree;
  snapshot: PageSnapshot;
  nodeById: Map<string, DesignNode>;
  domByIndex: Map<number, DomElement>;
  /** Figma node id → matched pair, for parent-relative comparisons. */
  pairByNodeId: Map<string, MatchedPair>;
  nextId: () => string;
  /**
   * True when the reference viewport is close enough to the design frame width
   * that absolute values (type sizes, radii) are directly comparable.
   */
  nearNativeScale: boolean;
  /**
   * Where the design frame's top-left actually lands in page coordinates.
   *
   * A frame narrower than the viewport (a centred 1200px shell on a 1280px
   * page, say) does not start at x=0. Registering the origin from the matched
   * pairs means absolute positions are compared in the same coordinate space
   * instead of being uniformly wrong by the centring offset.
   */
  originX: number;
  originY: number;
}

export interface TestInput {
  category: UiCategory;
  check: string;
  title: string;
  pair: MatchedPair;
  expected: string;
  actual: string;
  difference?: string;
  delta?: number;
  status: TestStatus;
  severity: Severity;
  message?: string;
}

export function buildTest(ctx: ComparisonContext, input: TestInput): UiTestResult {
  return {
    kind: 'ui',
    id: ctx.nextId(),
    title: input.title,
    check: input.check,
    category: input.category,
    element: input.pair.node.name,
    selector: input.pair.el.selector,
    expected: input.expected,
    actual: input.actual,
    difference: input.difference ?? '—',
    delta: input.delta,
    severity: input.severity,
    status: input.status,
    message: input.message,
    figmaNodeId: input.pair.node.id,
    figmaNodeName: input.pair.node.name,
    confidence: input.pair.match.confidence,
  };
}

/**
 * The common shape of a numeric check: measure, classify against a tolerance,
 * and render human-readable expected/actual/difference strings.
 */
export function numericTest(
  ctx: ComparisonContext,
  options: {
    category: UiCategory;
    check: string;
    title: string;
    pair: MatchedPair;
    expected: number;
    actual: number;
    tolerance: number;
    unit?: string;
    decimals?: number;
    /** Caps how bad this check is allowed to be reported as. */
    maxSeverity?: Severity;
    note?: string;
  },
): UiTestResult {
  const unit = options.unit ?? 'px';
  const decimals = options.decimals ?? 1;
  const delta = options.actual - options.expected;
  const verdict = classifyDeviation(delta, options.tolerance, ctx.tolerances);
  const severity = capSeverity(verdict.severity, options.maxSeverity);
  const status = severity === 'none' ? 'PASS' : severity === 'minor' ? 'WARNING' : 'FAIL';

  return buildTest(ctx, {
    category: options.category,
    check: options.check,
    title: options.title,
    pair: options.pair,
    expected: `${fmt(options.expected, decimals)}${unit}`,
    actual: `${fmt(options.actual, decimals)}${unit}`,
    difference:
      Math.abs(delta) < 0.05 ? 'exact' : `${delta > 0 ? '+' : '−'}${fmt(Math.abs(delta), decimals)}${unit}`,
    delta: Number(delta.toFixed(3)),
    status,
    severity,
    message: options.note,
  });
}

const SEVERITY_ORDER: Severity[] = ['none', 'minor', 'major', 'critical'];

export function capSeverity(severity: Severity, max?: Severity): Severity {
  if (!max) return severity;
  return SEVERITY_ORDER.indexOf(severity) > SEVERITY_ORDER.indexOf(max) ? max : severity;
}

export function fmt(value: number, decimals = 1): string {
  if (!Number.isFinite(value)) return '—';
  const rounded = Number(value.toFixed(decimals));
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(decimals);
}

/** Walks up the matched-pair chain to the nearest ancestor that also matched. */
export function nearestMatchedAncestor(ctx: ComparisonContext, node: DesignNode): MatchedPair | null {
  let parentId = node.parentId;
  let guard = 0;
  while (parentId && guard++ < 30) {
    const pair = ctx.pairByNodeId.get(parentId);
    if (pair) return pair;
    parentId = ctx.nodeById.get(parentId)?.parentId ?? null;
  }
  return null;
}
