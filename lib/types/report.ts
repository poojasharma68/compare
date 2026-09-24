import type { DesignTree } from './figma';
import type { EvidenceShot, PageSnapshot, ViewportSpec } from './dom';
import type {
  BrowserCategory,
  BrowserEngine,
  CrossBrowserTestResult,
  MatchingSummary,
  ResponsiveCategory,
  ResponsiveTestResult,
  UiCategory,
  UiTestResult,
} from './tests';

export interface ScoreBreakdownEntry {
  key: string;
  label: string;
  weight: number;
  /** 0–100 for this dimension. */
  score: number;
  passed: number;
  failed: number;
  warnings: number;
  /** Null when nothing in this dimension was testable. */
  applicable: boolean;
}

export interface ScoreResult {
  /** 0–100, weights renormalized across applicable dimensions only. */
  score: number;
  breakdown: ScoreBreakdownEntry[];
  methodology: string;
}

export interface TestTotals {
  total: number;
  passed: number;
  failed: number;
  warnings: number;
  skipped: number;
  critical: number;
  major: number;
  minor: number;
}

export interface ViewportReport {
  viewport: ViewportSpec;
  status: 'PASS' | 'WARNING' | 'FAIL';
  score: number;
  totals: TestTotals;
  tests: ResponsiveTestResult[];
  categoryScores: Array<{ category: ResponsiveCategory; score: number; weight: number; applicable: boolean }>;
  metrics: PageSnapshot['metrics'];
  warnings: string[];
  screenshot?: EvidenceShot;
}

export interface FigmaComparisonReport {
  enabled: boolean;
  /** Set when the module was skipped or failed — module 2 still runs. */
  skippedReason?: string;
  design?: {
    fileKey: string;
    fileName: string;
    frameName: string;
    frameWidth: number;
    frameHeight: number;
    nodeCount: number;
    availableFrames: DesignTree['availableFrames'];
  };
  /** Viewport the design was compared against. */
  comparedViewport?: ViewportSpec;
  scaleFactor?: number;
  matching?: MatchingSummary;
  tests: UiTestResult[];
  totals: TestTotals;
  score: ScoreResult;
  categoryTotals: Array<{ category: UiCategory; totals: TestTotals }>;
}

export interface ResponsiveReport {
  enabled: boolean;
  skippedReason?: string;
  viewports: ViewportReport[];
  tests: ResponsiveTestResult[];
  totals: TestTotals;
  score: ScoreResult;
}

/** One browser compared against the reference browser at one viewport. */
export interface CrossBrowserPair {
  id: string;
  /** Browser-independent viewport, e.g. `375 × 667`. */
  viewportId: string;
  viewportLabel: string;
  width: number;
  height: number;
  browser: BrowserEngine;
  referenceBrowser: BrowserEngine;
  status: 'PASS' | 'WARNING' | 'FAIL';
  score: number;
  totals: TestTotals;
  tests: CrossBrowserTestResult[];
  categoryScores: Array<{ category: BrowserCategory; score: number; weight: number; applicable: boolean }>;
}

export interface CrossBrowserReport {
  enabled: boolean;
  skippedReason?: string;
  /** Browsers that were requested and actually ran, reference first. */
  browsers: BrowserEngine[];
  referenceBrowser?: BrowserEngine;
  pairs: CrossBrowserPair[];
  tests: CrossBrowserTestResult[];
  totals: TestTotals;
  score: ScoreResult;
}

export interface AuditIssueSummary {
  id: string;
  kind: 'ui' | 'responsive' | 'browser';
  title: string;
  element: string;
  severity: string;
  status: string;
  viewportLabel?: string;
  category: string;
  difference: string;
  /** How many viewports show this same issue (responsive findings only). */
  viewportCount?: number;
  /** How many browsers show this same issue. */
  browserCount?: number;
}

export interface AuditReport {
  runId: string;
  createdAt: string;
  finishedAt: string;
  durationMs: number;
  input: {
    figmaUrl: string | null;
    websiteUrl: string;
    finalUrl: string;
    viewportGroups: string[];
    viewportIds: string[];
    browsers: BrowserEngine[];
    customViewports: Array<{ width: number; height: number }>;
  };
  figma: FigmaComparisonReport;
  responsive: ResponsiveReport;
  crossBrowser: CrossBrowserReport;
  totals: TestTotals;
  topIssues: AuditIssueSummary[];
  /** Recoverable problems worth telling the user about. */
  warnings: string[];
  tolerances: Record<string, number>;
}
