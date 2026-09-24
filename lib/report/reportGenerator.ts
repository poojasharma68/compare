import type { DesignTree } from '@/lib/types/figma';
import type { PageSnapshot, ViewportSpec } from '@/lib/types/dom';
import type {
  AuditIssueSummary,
  AuditReport,
  CrossBrowserPair,
  CrossBrowserReport,
  FigmaComparisonReport,
  ResponsiveReport,
  ViewportReport,
} from '@/lib/types/report';
import type {
  BrowserEngine,
  CrossBrowserTestResult,
  MatchingSummary,
  ResponsiveTestResult,
  UiCategory,
  UiTestResult,
} from '@/lib/types/tests';
import type { Tolerances } from '@/lib/config/tolerances';
import {
  emptyTotals,
  mergeTotals,
  scoreCrossBrowser,
  scoreCrossBrowserPair,
  scoreResponsive,
  scoreResponsiveViewport,
  scoreUi,
  tallyTotals,
  viewportStatus,
} from './scoring';

const UI_CATEGORIES: UiCategory[] = ['Layout', 'Spacing', 'Typography', 'Color', 'Styling', 'Structure'];

const SEVERITY_RANK: Record<string, number> = { critical: 0, major: 1, minor: 2, none: 3 };

export interface BuildReportInput {
  runId: string;
  createdAt: number;
  finishedAt: number;
  input: AuditReport['input'];
  tolerances: Tolerances;
  warnings: string[];
  figma: {
    enabled: boolean;
    skippedReason?: string;
    design?: DesignTree;
    referenceSnapshot?: PageSnapshot;
    scale?: number;
    matching?: MatchingSummary;
    tests: UiTestResult[];
  };
  responsive: {
    enabled: boolean;
    skippedReason?: string;
    snapshots: PageSnapshot[];
    testsByViewport: Map<string, ResponsiveTestResult[]>;
  };
  crossBrowser: {
    enabled: boolean;
    skippedReason?: string;
    browsers: BrowserEngine[];
    referenceBrowser?: BrowserEngine;
    comparisons: Array<{ viewport: ViewportSpec; tests: CrossBrowserTestResult[] }>;
  };
}

/** Assembles the final, fully-scored report from both engines' raw output. */
export function buildReport(input: BuildReportInput): AuditReport {
  const figma = buildFigmaSection(input);
  const responsive = buildResponsiveSection(input);
  const crossBrowser = buildCrossBrowserSection(input);

  const totals = mergeTotals([figma.totals, responsive.totals, crossBrowser.totals]);

  return {
    runId: input.runId,
    createdAt: new Date(input.createdAt).toISOString(),
    finishedAt: new Date(input.finishedAt).toISOString(),
    durationMs: input.finishedAt - input.createdAt,
    input: input.input,
    figma,
    responsive,
    crossBrowser,
    totals,
    topIssues: collectTopIssues(figma.tests, responsive.tests, crossBrowser.tests),
    warnings: input.warnings,
    tolerances: input.tolerances as unknown as Record<string, number>,
  };
}

function buildFigmaSection(input: BuildReportInput): FigmaComparisonReport {
  const { figma } = input;
  const tests = figma.tests;

  const categoryTotals = UI_CATEGORIES.map((category) => ({
    category,
    totals: tallyTotals(tests.filter((t) => t.category === category)),
  }));

  return {
    enabled: figma.enabled,
    skippedReason: figma.skippedReason,
    design: figma.design
      ? {
          fileKey: figma.design.fileKey,
          fileName: figma.design.fileName,
          frameName: figma.design.rootName,
          frameWidth: figma.design.rootWidth,
          frameHeight: figma.design.rootHeight,
          nodeCount: figma.design.nodes.length,
          availableFrames: figma.design.availableFrames,
        }
      : undefined,
    comparedViewport: figma.referenceSnapshot?.viewport,
    scaleFactor: figma.scale,
    matching: figma.matching,
    tests,
    totals: tallyTotals(tests),
    score: scoreUi(tests),
    categoryTotals,
  };
}

function buildResponsiveSection(input: BuildReportInput): ResponsiveReport {
  const { responsive } = input;

  const viewports: ViewportReport[] = responsive.snapshots.map((snapshot) => {
    const tests = responsive.testsByViewport.get(snapshot.viewport.id) ?? [];
    const { score, categoryScores } = scoreResponsiveViewport(tests);
    return {
      viewport: snapshot.viewport,
      status: viewportStatus(tests),
      score,
      totals: tallyTotals(tests),
      tests,
      categoryScores,
      metrics: snapshot.metrics,
      warnings: snapshot.warnings,
      screenshot: snapshot.screenshot,
    };
  });

  // Narrow viewports first: that is where problems concentrate and where the
  // reader most wants to look.
  viewports.sort((a, b) => a.viewport.width - b.viewport.width);

  const allTests = viewports.flatMap((v) => v.tests);

  return {
    enabled: responsive.enabled,
    skippedReason: responsive.skippedReason,
    viewports,
    tests: allTests,
    totals: viewports.length ? mergeTotals(viewports.map((v) => v.totals)) : emptyTotals(),
    score: scoreResponsive(viewports, allTests),
  };
}

function buildCrossBrowserSection(input: BuildReportInput): CrossBrowserReport {
  const { crossBrowser } = input;

  const pairs: CrossBrowserPair[] = crossBrowser.comparisons.map(({ viewport, tests }) => {
    const { score, categoryScores } = scoreCrossBrowserPair(tests);
    return {
      id: viewport.id,
      viewportId: viewport.baseId ?? viewport.id,
      viewportLabel: viewport.baseLabel ?? viewport.label,
      width: viewport.width,
      height: viewport.height,
      browser: viewport.browser ?? 'chromium',
      referenceBrowser: crossBrowser.referenceBrowser ?? 'chromium',
      status: viewportStatus(tests),
      score,
      totals: tallyTotals(tests),
      tests,
      categoryScores,
    };
  });
  pairs.sort((a, b) => a.width - b.width || a.height - b.height);

  const tests = pairs.flatMap((p) => p.tests);
  return {
    enabled: crossBrowser.enabled,
    skippedReason: crossBrowser.skippedReason,
    browsers: crossBrowser.browsers,
    referenceBrowser: crossBrowser.referenceBrowser,
    pairs,
    tests,
    totals: pairs.length ? mergeTotals(pairs.map((p) => p.totals)) : emptyTotals(),
    score: scoreCrossBrowser(pairs, tests),
  };
}

/** The headline list: worst first, deduplicated, capped at a readable length. */
function collectTopIssues(
  uiTests: UiTestResult[],
  responsiveTests: ResponsiveTestResult[],
  browserTests: CrossBrowserTestResult[],
): AuditIssueSummary[] {
  const issues: AuditIssueSummary[] = [];

  for (const test of uiTests) {
    if (test.status === 'PASS' || test.status === 'SKIPPED') continue;
    issues.push({
      id: test.id,
      kind: 'ui',
      title: test.title,
      element: test.element,
      severity: test.severity,
      status: test.status,
      category: test.category,
      difference: test.difference,
    });
  }

  // The same CSS bug surfaces at every viewport (and in every browser) it
  // affects. The headline list should say "this is broken at six widths" once,
  // not list it six times and crowd out every other finding.
  const grouped = new Map<
    string,
    { test: ResponsiveTestResult | CrossBrowserTestResult; viewports: Set<string>; browsers: Set<string> }
  >();
  for (const test of [...responsiveTests, ...browserTests]) {
    if (test.status === 'PASS' || test.status === 'SKIPPED') continue;
    const key = `${test.kind}|${test.check}|${test.element}`;
    const viewportKey = test.viewportLabel.split(' · ')[0];
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {
        test,
        viewports: new Set([viewportKey]),
        browsers: new Set([test.browser ?? 'chromium']),
      });
      continue;
    }
    existing.viewports.add(viewportKey);
    existing.browsers.add(test.browser ?? 'chromium');
    // Keep the worst instance; on a tie, the larger delta.
    const better =
      (SEVERITY_RANK[test.severity] ?? 9) < (SEVERITY_RANK[existing.test.severity] ?? 9) ||
      ((SEVERITY_RANK[test.severity] ?? 9) === (SEVERITY_RANK[existing.test.severity] ?? 9) &&
        Math.abs(test.delta ?? 0) > Math.abs(existing.test.delta ?? 0));
    if (better) existing.test = test;
  }

  for (const { test, viewports, browsers } of grouped.values()) {
    issues.push({
      id: test.id,
      kind: test.kind,
      title: test.title,
      element: test.element,
      severity: test.severity,
      status: test.status,
      viewportLabel: test.viewportLabel,
      category: test.kind === 'browser' ? `Cross-browser · ${test.category}` : test.category,
      difference: test.difference,
      viewportCount: viewports.size,
      browserCount: browsers.size,
    });
  }

  return issues
    .sort((a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9))
    .slice(0, 12);
}

export function describeViewport(viewport: ViewportSpec): string {
  return `${viewport.width} × ${viewport.height}`;
}
