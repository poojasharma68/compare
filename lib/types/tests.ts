/** Strongly typed test-result model shared by both engines. */

export type TestStatus = 'PASS' | 'FAIL' | 'WARNING' | 'SKIPPED';
export type Severity = 'none' | 'minor' | 'major' | 'critical';

export type UiCategory =
  | 'Layout'
  | 'Spacing'
  | 'Typography'
  | 'Color'
  | 'Styling'
  | 'Structure';

export type ResponsiveCategory =
  | 'Overflow'
  | 'Overlap'
  | 'Clipping'
  | 'Wrapping'
  | 'Visibility'
  | 'Layout'
  | 'Image';

/** What a cross-browser comparison found to differ between two engines. */
export type BrowserCategory = 'Page' | 'Presence' | 'Size' | 'Position' | 'Text';

export type BrowserEngine = 'chromium' | 'firefox' | 'webkit';

export interface TestEvidence {
  /** Evidence screenshot id, resolvable via /api/evidence/[runId]/[shotId]. */
  screenshotId?: string;
  /** CSS-pixel size of the captured region, used to map highlights onto it. */
  pageWidth?: number;
  pageHeight?: number;
  /** Document-relative rect to highlight, in CSS pixels. */
  highlight?: { x: number; y: number; width: number; height: number };
  caption?: string;
}

export interface BaseTestResult {
  id: string;
  title: string;
  /** Machine-readable check name, e.g. `typography.fontSize`. */
  check: string;
  element: string;
  selector?: string;
  expected: string;
  actual: string;
  difference: string;
  /** Signed numeric delta where one exists — powers sorting and charts. */
  delta?: number;
  severity: Severity;
  status: TestStatus;
  message?: string;
  evidence?: TestEvidence;
}

export interface UiTestResult extends BaseTestResult {
  kind: 'ui';
  category: UiCategory;
  figmaNodeId?: string;
  figmaNodeName?: string;
  confidence?: number;
}

export interface ResponsiveTestResult extends BaseTestResult {
  kind: 'responsive';
  category: ResponsiveCategory;
  viewportId: string;
  viewportLabel: string;
  browser?: BrowserEngine;
}

/**
 * One difference between how the reference browser and another browser render
 * the same page at the same viewport.
 */
export interface CrossBrowserTestResult extends BaseTestResult {
  kind: 'browser';
  category: BrowserCategory;
  /** The browser that renders differently. */
  browser: BrowserEngine;
  /** The browser it was compared against. */
  referenceBrowser: BrowserEngine;
  viewportId: string;
  viewportLabel: string;
}

export type AnyTestResult = UiTestResult | ResponsiveTestResult | CrossBrowserTestResult;

/** A Figma node ↔ DOM element pairing produced by the matching engine. */
export interface ElementMatch {
  figmaNodeId: string;
  figmaNodeName: string;
  domIndex: number;
  domSelector: string;
  domLabel: string;
  confidence: number;
  /** Per-signal contributions, surfaced in the UI for transparency. */
  signals: Record<string, number>;
}

export interface MatchingSummary {
  matches: ElementMatch[];
  /**
   * Figma nodes above the significance bar that could not be confidently
   * located. `uncertain` marks the middle case: something plausible was found,
   * but not convincingly enough to assert anything about it.
   */
  missing: Array<{
    figmaNodeId: string;
    name: string;
    type: string;
    reason: string;
    uncertain?: boolean;
    confidence?: number;
  }>;
  /** Meaningful DOM elements with no Figma counterpart. */
  extra: Array<{ domIndex: number; selector: string; label: string; reason: string }>;
  consideredFigmaNodes: number;
  consideredDomElements: number;
  averageConfidence: number;
  /** Where the design frame was found to sit on the page. */
  registration: FrameRegistration;
}

/**
 * The design frame's fitted placement in page coordinates.
 *
 * A frame is often a single section rather than a whole page, in which case it
 * maps to a band partway down the document. Everything outside that band
 * belongs to a different design and must not be judged against this one.
 */
export interface FrameRegistration {
  /** Page-space band the design frame covers, in CSS pixels. */
  top: number;
  bottom: number;
  /** Horizontal offset applied to design coordinates. */
  offsetX: number;
  /** Vertical stretch between design and page. 1 means they agree. */
  slopeY: number;
  /** Confident matches the fit was derived from. */
  anchors: number;
}
