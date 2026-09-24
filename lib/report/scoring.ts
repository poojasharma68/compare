import type { CrossBrowserPair, ScoreBreakdownEntry, ScoreResult, TestTotals, ViewportReport } from '@/lib/types/report';
import type {
  AnyTestResult,
  BrowserCategory,
  CrossBrowserTestResult,
  ResponsiveCategory,
  ResponsiveTestResult,
  UiCategory,
  UiTestResult,
} from '@/lib/types/tests';
import {
  BROWSER_METHODOLOGY,
  BROWSER_WEIGHTS,
  RESPONSIVE_METHODOLOGY,
  RESPONSIVE_WEIGHTS,
  SEVERITY_PENALTY,
  UI_METHODOLOGY,
  UI_WEIGHTS,
} from '@/lib/config/scoring';

export function emptyTotals(): TestTotals {
  return { total: 0, passed: 0, failed: 0, warnings: 0, skipped: 0, critical: 0, major: 0, minor: 0 };
}

export function tallyTotals(tests: AnyTestResult[]): TestTotals {
  const totals = emptyTotals();
  for (const test of tests) {
    totals.total++;
    if (test.status === 'PASS') totals.passed++;
    else if (test.status === 'FAIL') totals.failed++;
    else if (test.status === 'WARNING') totals.warnings++;
    else totals.skipped++;

    if (test.severity === 'critical') totals.critical++;
    else if (test.severity === 'major') totals.major++;
    else if (test.severity === 'minor') totals.minor++;
  }
  return totals;
}

export function mergeTotals(list: TestTotals[]): TestTotals {
  return list.reduce((acc, t) => {
    acc.total += t.total;
    acc.passed += t.passed;
    acc.failed += t.failed;
    acc.warnings += t.warnings;
    acc.skipped += t.skipped;
    acc.critical += t.critical;
    acc.major += t.major;
    acc.minor += t.minor;
    return acc;
  }, emptyTotals());
}

/**
 * A category's score is 100 minus the mean severity penalty of its tests.
 * Averaging rather than summing keeps the score comparable between a category
 * with 5 tests and one with 200 — otherwise the biggest category would always
 * dominate simply by being big.
 */
export function scoreCategory(tests: AnyTestResult[]): number {
  const scored = tests.filter((t) => t.status !== 'SKIPPED');
  if (scored.length === 0) return 100;
  const penalty = scored.reduce((sum, t) => sum + (SEVERITY_PENALTY[t.severity] ?? 0), 0);
  // Rounded here rather than at each render site: a score is a whole number,
  // and every consumer would otherwise have to remember to round it.
  return Math.round(clampScore(100 - (penalty / scored.length) * 100));
}

/**
 * Combines weighted category scores, renormalizing across the categories that
 * actually produced tests. A design with no borders should not be punished —
 * or rewarded — for an untestable Styling category.
 */
function combine(
  entries: ScoreBreakdownEntry[],
  methodology: string,
): ScoreResult {
  const applicable = entries.filter((e) => e.applicable);
  if (applicable.length === 0) {
    return { score: 0, breakdown: entries, methodology };
  }
  const weightSum = applicable.reduce((sum, e) => sum + e.weight, 0);
  const score = applicable.reduce((sum, e) => sum + e.score * (e.weight / weightSum), 0);
  return { score: Math.round(score), breakdown: entries, methodology };
}

export function scoreUi(tests: UiTestResult[]): ScoreResult {
  const entries: ScoreBreakdownEntry[] = (Object.keys(UI_WEIGHTS) as UiCategory[]).map((category) => {
    const categoryTests = tests.filter((t) => t.category === category);
    const totals = tallyTotals(categoryTests);
    return {
      key: category,
      label: category,
      weight: UI_WEIGHTS[category],
      score: scoreCategory(categoryTests),
      passed: totals.passed,
      failed: totals.failed,
      warnings: totals.warnings,
      applicable: categoryTests.length > 0,
    };
  });

  return combine(entries, UI_METHODOLOGY);
}

export function scoreResponsiveViewport(tests: ResponsiveTestResult[]): {
  score: number;
  categoryScores: ViewportReport['categoryScores'];
} {
  const categoryScores = (Object.keys(RESPONSIVE_WEIGHTS) as ResponsiveCategory[]).map((category) => {
    const categoryTests = tests.filter((t) => t.category === category);
    return {
      category,
      score: scoreCategory(categoryTests),
      weight: RESPONSIVE_WEIGHTS[category],
      applicable: categoryTests.length > 0,
    };
  });

  const applicable = categoryScores.filter((c) => c.applicable);
  if (applicable.length === 0) return { score: 100, categoryScores };

  const weightSum = applicable.reduce((sum, c) => sum + c.weight, 0);
  const score = applicable.reduce((sum, c) => sum + c.score * (c.weight / weightSum), 0);

  return { score: Math.round(clampScore(score)), categoryScores };
}

/**
 * The headline responsive score is the mean of the per-viewport scores, so one
 * badly broken breakpoint cannot be averaged away by several healthy ones.
 */
export function scoreResponsive(viewports: ViewportReport[], allTests: ResponsiveTestResult[]): ScoreResult {
  const entries: ScoreBreakdownEntry[] = (Object.keys(RESPONSIVE_WEIGHTS) as ResponsiveCategory[]).map((category) => {
    const categoryTests = allTests.filter((t) => t.category === category);
    const totals = tallyTotals(categoryTests);
    return {
      key: category,
      label: category,
      weight: RESPONSIVE_WEIGHTS[category],
      score: scoreCategory(categoryTests),
      passed: totals.passed,
      failed: totals.failed,
      warnings: totals.warnings,
      applicable: categoryTests.length > 0,
    };
  });

  const methodology = RESPONSIVE_METHODOLOGY;
  if (viewports.length === 0) return combine(entries, methodology);

  const mean = viewports.reduce((sum, v) => sum + v.score, 0) / viewports.length;
  return { score: Math.round(clampScore(mean)), breakdown: entries, methodology };
}

export function scoreCrossBrowserPair(tests: CrossBrowserTestResult[]): {
  score: number;
  categoryScores: CrossBrowserPair['categoryScores'];
} {
  const categoryScores = (Object.keys(BROWSER_WEIGHTS) as BrowserCategory[]).map((category) => {
    const categoryTests = tests.filter((t) => t.category === category && t.status !== 'SKIPPED');
    return {
      category,
      score: scoreCategory(categoryTests),
      weight: BROWSER_WEIGHTS[category],
      applicable: categoryTests.length > 0,
    };
  });

  const applicable = categoryScores.filter((c) => c.applicable);
  if (applicable.length === 0) return { score: 100, categoryScores };
  const weightSum = applicable.reduce((sum, c) => sum + c.weight, 0);
  const score = applicable.reduce((sum, c) => sum + c.score * (c.weight / weightSum), 0);
  return { score: Math.round(clampScore(score)), categoryScores };
}

/** Mean of the per-comparison scores, mirroring the responsive headline. */
export function scoreCrossBrowser(pairs: CrossBrowserPair[], allTests: CrossBrowserTestResult[]): ScoreResult {
  const entries: ScoreBreakdownEntry[] = (Object.keys(BROWSER_WEIGHTS) as BrowserCategory[]).map((category) => {
    const categoryTests = allTests.filter((t) => t.category === category && t.status !== 'SKIPPED');
    const totals = tallyTotals(categoryTests);
    return {
      key: category,
      label: category,
      weight: BROWSER_WEIGHTS[category],
      score: scoreCategory(categoryTests),
      passed: totals.passed,
      failed: totals.failed,
      warnings: totals.warnings,
      applicable: categoryTests.length > 0,
    };
  });

  if (pairs.length === 0) return combine(entries, BROWSER_METHODOLOGY);
  const mean = pairs.reduce((sum, p) => sum + p.score, 0) / pairs.length;
  return { score: Math.round(clampScore(mean)), breakdown: entries, methodology: BROWSER_METHODOLOGY };
}

export function viewportStatus(tests: AnyTestResult[]): 'PASS' | 'WARNING' | 'FAIL' {
  if (tests.some((t) => t.status === 'FAIL')) return 'FAIL';
  if (tests.some((t) => t.status === 'WARNING')) return 'WARNING';
  return 'PASS';
}

function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}
