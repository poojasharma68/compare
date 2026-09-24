import type { DomElement, PageSnapshot } from '@/lib/types/dom';
import type { ResponsiveTestResult } from '@/lib/types/tests';
import type { Tolerances } from '@/lib/config/tolerances';
import { makeIdFactory } from '@/lib/utils/id';
import type { ResponsiveContext } from './context';
import { detectOverflow } from './overflowDetector';
import { detectOverlap } from './overlapDetector';
import { detectClipping } from './clippingDetector';
import { detectWrapping } from './wrappingDetector';
import { detectVisibility } from './visibilityDetector';
import { detectLayoutProblems } from './layoutDetector';
import { detectImageProblems } from './imageDetector';

export interface ResponsiveRunOptions {
  tolerances: Tolerances;
  /** The widest analysed snapshot; null when this snapshot is the widest. */
  baseline: PageSnapshot | null;
  /** Shared id factory so ids stay unique across every viewport. */
  nextId: () => string;
}

/**
 * Runs every responsive detector against one viewport snapshot.
 * Detectors are fully independent: one throwing never costs the others their
 * results, and the viewport still produces a usable report.
 */
export function runResponsiveTests(
  snapshot: PageSnapshot,
  options: ResponsiveRunOptions,
): ResponsiveTestResult[] {
  const baselineBySelector = new Map<string, DomElement>();
  if (options.baseline) {
    for (const el of options.baseline.elements) baselineBySelector.set(el.selector, el);
  }

  const ctx: ResponsiveContext = {
    snapshot,
    baseline: options.baseline,
    tolerances: options.tolerances,
    byIndex: new Map(snapshot.elements.map((el) => [el.index, el])),
    baselineBySelector,
    nextId: options.nextId,
  };

  const tests: ResponsiveTestResult[] = [];
  const detectors: Array<[string, (c: ResponsiveContext) => ResponsiveTestResult[]]> = [
    ['overflow', detectOverflow],
    ['overlap', detectOverlap],
    ['clipping', detectClipping],
    ['wrapping', detectWrapping],
    ['visibility', detectVisibility],
    ['layout', detectLayoutProblems],
    ['image', detectImageProblems],
  ];

  for (const [name, detector] of detectors) {
    try {
      tests.push(...detector(ctx));
    } catch (err) {
      if (process.env.NODE_ENV !== 'production') {
        console.error(`[uix-ray] responsive detector "${name}" failed:`, err);
      }
    }
  }

  return tests;
}

export function createResponsiveIdFactory(): () => string {
  return makeIdFactory('RESP');
}

export type { ResponsiveContext } from './context';
