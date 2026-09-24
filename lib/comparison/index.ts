import type { DesignTree } from '@/lib/types/figma';
import type { PageSnapshot } from '@/lib/types/dom';
import type { MatchingSummary, UiTestResult } from '@/lib/types/tests';
import type { Tolerances } from '@/lib/config/tolerances';
import { makeIdFactory } from '@/lib/utils/id';
import type { ComparisonContext, MatchedPair } from './context';
import { compareLayout } from './layoutComparator';
import { compareTypography } from './typographyComparator';
import { compareSiblingDistances, compareSpacing } from './spacingComparator';
import { compareColor } from './colorComparator';
import { compareStyling } from './styleComparator';
import { compareStructure } from './structureComparator';
import { compareContent } from './contentComparator';

export interface UiComparisonOptions {
  tolerances: Tolerances;
  scale: number;
}

export interface UiComparisonOutput {
  tests: UiTestResult[];
  /** Pairs actually used for comparison (above the strict threshold). */
  comparedPairs: number;
}

/**
 * Runs every UI comparator over the matched pairs and returns a flat, ordered
 * list of test results. Each comparator is independent — a failure in one never
 * stops the others, so a partial report is always better than none.
 */
export function runUiComparison(
  design: DesignTree,
  snapshot: PageSnapshot,
  matching: MatchingSummary,
  options: UiComparisonOptions,
): UiComparisonOutput {
  const nodeById = new Map(design.nodes.map((n) => [n.id, n]));
  const domByIndex = new Map(snapshot.elements.map((e) => [e.index, e]));

  const pairByNodeId = new Map<string, MatchedPair>();
  for (const match of matching.matches) {
    const node = nodeById.get(match.figmaNodeId);
    const el = domByIndex.get(match.domIndex);
    if (node && el) pairByNodeId.set(match.figmaNodeId, { node, el, match });
  }

  const origin = registerOrigin(pairByNodeId, options);
  const scaleDrift = Math.abs(options.scale - 1);
  const ctx: ComparisonContext = {
    tolerances: options.tolerances,
    scale: options.scale,
    design,
    snapshot,
    nodeById,
    domByIndex,
    pairByNodeId,
    nextId: makeIdFactory('UI'),
    nearNativeScale: scaleDrift <= 0.12,
    originX: origin.x,
    originY: origin.y,
  };

  const tests: UiTestResult[] = [];
  let comparedPairs = 0;

  // Compare in document order so the report reads top-to-bottom.
  const ordered = [...pairByNodeId.values()].sort((a, b) => a.node.y - b.node.y || a.node.x - b.node.x);

  for (const pair of ordered) {
    // Low-confidence pairs are surfaced in the matching summary but never used
    // to assert anything — a wrong pairing produces nothing but false failures.
    if (pair.match.confidence < options.tolerances.STRICT_MATCH_THRESHOLD) continue;
    comparedPairs++;

    runSafely(tests, () => compareContent(pair, ctx));
    runSafely(tests, () => compareLayout(pair, ctx));
    runSafely(tests, () => compareTypography(pair, ctx));
    runSafely(tests, () => compareSpacing(pair, ctx));
    runSafely(tests, () => compareColor(pair, ctx));
    runSafely(tests, () => compareStyling(pair, ctx));
  }

  runSafely(tests, () => compareSiblingDistances(ctx));
  runSafely(tests, () => compareStructure(matching, ctx));

  attachEvidence(tests, snapshot, domByIndex);

  return { tests, comparedPairs };
}

/**
 * Estimates where the design frame sits in page coordinates by taking the
 * median offset across confident matches. The median (not the mean) so that a
 * handful of genuinely misplaced elements cannot drag the reference frame with
 * them — which would hide the very errors we are looking for.
 */
function registerOrigin(
  pairs: Map<string, MatchedPair>,
  options: UiComparisonOptions,
): { x: number; y: number } {
  const dx: number[] = [];
  const dy: number[] = [];

  for (const pair of pairs.values()) {
    if (pair.match.confidence < options.tolerances.STRICT_MATCH_THRESHOLD) continue;
    dx.push(pair.el.rect.x - pair.node.x * options.scale);
    dy.push(pair.el.rect.y - pair.node.y * options.scale);
  }

  // Too few samples to register against: assume the frame maps to the origin.
  if (dx.length < 3) return { x: 0, y: 0 };
  return { x: median(dx), y: median(dy) };
}

function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** One comparator throwing must never lose the results of the others. */
function runSafely(sink: UiTestResult[], fn: () => UiTestResult[]): void {
  try {
    sink.push(...fn());
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[uix-ray] comparator failed:', err);
    }
  }
}

/**
 * Records, in document coordinates, which element each failing test refers to.
 * The screenshot itself is captured later while the page is still open. The
 * result is supporting evidence only — every verdict above was already decided
 * from geometry and computed styles.
 */
function attachEvidence(
  tests: UiTestResult[],
  snapshot: PageSnapshot,
  domByIndex: Map<number, PageSnapshot['elements'][number]>,
): void {
  const bySelector = new Map<string, PageSnapshot['elements'][number]>();
  for (const el of domByIndex.values()) bySelector.set(el.selector, el);

  for (const test of tests) {
    if (test.status === 'PASS' || test.status === 'SKIPPED' || !test.selector) continue;
    const el = bySelector.get(test.selector);
    if (!el) continue;

    test.evidence = {
      highlight: {
        x: Math.max(0, el.rect.x),
        y: Math.max(0, el.rect.y),
        width: Math.max(1, el.rect.width),
        height: Math.max(1, el.rect.height),
      },
      caption: `${snapshot.viewport.label} · ${el.label}`,
    };
  }
}

export type { ComparisonContext, MatchedPair } from './context';
