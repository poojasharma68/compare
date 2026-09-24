import type { DomElement, PageSnapshot } from '@/lib/types/dom';
import type { BrowserCategory, BrowserEngine, CrossBrowserTestResult, Severity, TestStatus } from '@/lib/types/tests';
import type { Tolerances } from '@/lib/config/tolerances';
import { browserLabel } from '@/lib/config/browsers';
import { makeIdFactory } from '@/lib/utils/id';

/**
 * Cross-browser comparison.
 *
 * The same page at the same viewport is measured in two engines and the
 * results are diffed element by element, keyed by selector. Everything is
 * judged relative to the reference browser: a sideways scrollbar that only
 * Firefox shows, a button WebKit never renders, a card that is 40px taller in
 * Safari. What every browser gets wrong alike is a responsive problem, and the
 * responsive suite already reports it once per browser.
 *
 * The same false-positive discipline as the responsive detectors applies:
 *  - Font rasterisation differs between engines by design, so geometry gets a
 *    proportional band rather than a pixel-exact one.
 *  - Positions are compared inside the parent, never as absolute page Y, which
 *    drifts cumulatively with every line that wraps differently above it.
 *  - Only the outermost element of a differing subtree is reported; a wrapper
 *    that is 30px wider makes every child wider too, and the wrapper is the fix.
 *  - A difference in the layout viewport itself (scrollbar gutters, missing
 *    mobile emulation) is absorbed or reported once, not blamed on each element.
 */

const MAX_PER_CHECK = 6;
/** Beyond this, the two layouts differ at the root and per-element diffs are noise. */
const MAX_LAYOUT_VIEWPORT_SLACK = 24;
/** Snapshots this close to the extraction cap may be missing elements for that reason alone. */
const EXTRACTION_CAP_GUARD = 1960;

export interface CrossBrowserOptions {
  tolerances: Tolerances;
  nextId: () => string;
}

interface Pairing {
  ref: DomElement;
  cand: DomElement;
}

interface Ctx {
  reference: PageSnapshot;
  candidate: PageSnapshot;
  refBrowser: BrowserEngine;
  browser: BrowserEngine;
  refName: string;
  candName: string;
  refByIndex: Map<number, DomElement>;
  candByIndex: Map<number, DomElement>;
  refBySelector: Map<string, DomElement>;
  candBySelector: Map<string, DomElement>;
  /** Absorbed layout viewport difference, e.g. a classic scrollbar gutter. */
  slack: number;
  tolerances: Tolerances;
  nextId: () => string;
}

interface TestInput {
  category: BrowserCategory;
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
  highlight?: DomElement;
}

export function createCrossBrowserIdFactory(): () => string {
  return makeIdFactory('XB');
}

export function runCrossBrowserTests(
  reference: PageSnapshot,
  candidate: PageSnapshot,
  options: CrossBrowserOptions,
): CrossBrowserTestResult[] {
  const ctx: Ctx = {
    reference,
    candidate,
    refBrowser: reference.viewport.browser ?? 'chromium',
    browser: candidate.viewport.browser ?? 'chromium',
    refName: browserLabel(reference.viewport.browser),
    candName: browserLabel(candidate.viewport.browser),
    refByIndex: new Map(reference.elements.map((el) => [el.index, el])),
    candByIndex: new Map(candidate.elements.map((el) => [el.index, el])),
    refBySelector: uniqueBySelector(reference.elements),
    candBySelector: uniqueBySelector(candidate.elements),
    slack: Math.abs(reference.metrics.clientWidth - candidate.metrics.clientWidth),
    tolerances: options.tolerances,
    nextId: options.nextId,
  };

  const tests: CrossBrowserTestResult[] = [];
  const checks: Array<[string, (c: Ctx) => CrossBrowserTestResult[]]> = [
    ['page', checkPage],
    ['presence', checkPresence],
    ['geometry', checkGeometry],
    ['text', checkText],
  ];

  for (const [name, check] of checks) {
    try {
      tests.push(...check(ctx));
    } catch (err) {
      if (process.env.NODE_ENV !== 'production') {
        console.error(`[uix-ray] cross-browser check "${name}" failed:`, err);
      }
    }
  }
  return tests;
}

/* --------------------------------- Page ---------------------------------- */

function checkPage(ctx: Ctx): CrossBrowserTestResult[] {
  const tests: CrossBrowserTestResult[] = [];
  const { reference: ref, candidate: cand } = ctx;
  const tol = ctx.tolerances.OVERFLOW_TOLERANCE;

  const refOverflow = ref.metrics.scrollWidth - ref.metrics.clientWidth;
  const candOverflow = cand.metrics.scrollWidth - cand.metrics.clientWidth;
  // Only overflow *this* browser adds is a cross-browser finding. Overflow in
  // the reference is already reported by the responsive suite.
  const extraOverflow = candOverflow - Math.max(0, refOverflow);
  const overflowDiffers = candOverflow > tol && extraOverflow > tol;

  tests.push(
    build(ctx, {
      category: 'Page',
      check: 'browser.overflow',
      title: overflowDiffers ? `Horizontal scroll only in ${ctx.candName}` : 'Horizontal overflow consistent',
      element: 'document',
      expected: refOverflow > tol ? `${px(refOverflow)} overflow, as in ${ctx.refName}` : `No overflow, as in ${ctx.refName}`,
      actual: candOverflow > tol ? `${px(candOverflow)} overflow` : 'No overflow',
      difference: overflowDiffers ? `+${px(extraOverflow)}` : 'none',
      delta: round(extraOverflow),
      status: overflowDiffers ? 'FAIL' : 'PASS',
      severity: overflowDiffers ? overflowSeverity(extraOverflow, cand.metrics.clientWidth) : 'none',
      message: overflowDiffers
        ? `The page scrolls sideways in ${ctx.candName} but not in ${ctx.refName}. Something renders wider in this engine — ` +
          'look for the elements flagged below, unsupported CSS, or a font that falls back to a wider face.'
        : undefined,
    }),
  );

  const heightDiff = cand.metrics.scrollHeight - ref.metrics.scrollHeight;
  const heightRatio = Math.abs(heightDiff) / Math.max(1, ref.metrics.scrollHeight);
  const heightDiffers = Math.abs(heightDiff) > 200 && heightRatio > 0.12;
  tests.push(
    build(ctx, {
      category: 'Page',
      check: 'browser.pageHeight',
      title: heightDiffers ? `Page is ${heightDiff > 0 ? 'taller' : 'shorter'} in ${ctx.candName}` : 'Page height consistent',
      element: 'document',
      expected: `${px(ref.metrics.scrollHeight)} (${ctx.refName})`,
      actual: px(cand.metrics.scrollHeight),
      difference: `${signed(heightDiff)} (${Math.round(heightRatio * 100)}%)`,
      delta: round(heightDiff),
      status: heightDiffers ? 'WARNING' : 'PASS',
      severity: heightDiffers ? (heightRatio > 0.35 ? 'major' : 'minor') : 'none',
      message: heightDiffers
        ? `The document is ${Math.round(heightRatio * 100)}% ${heightDiff > 0 ? 'taller' : 'shorter'} than in ${ctx.refName}. ` +
          'Usually text wrapping differently or a section collapsing; the element findings point at where.'
        : undefined,
    }),
  );

  if (ctx.slack > MAX_LAYOUT_VIEWPORT_SLACK) {
    tests.push(
      build(ctx, {
        category: 'Page',
        check: 'browser.layoutViewport',
        title: 'Layout viewport differs between browsers',
        element: 'document',
        expected: `${px(ref.metrics.clientWidth)} layout width (${ctx.refName})`,
        actual: `${px(cand.metrics.clientWidth)} layout width`,
        difference: signed(cand.metrics.clientWidth - ref.metrics.clientWidth),
        status: 'SKIPPED',
        severity: 'none',
        message:
          `The two browsers laid the page out at different widths, so element geometry is not comparable and was skipped. ` +
          (ctx.browser === 'firefox' && cand.viewport.isMobile
            ? 'Firefox has no mobile emulation, so a page without a viewport meta tag lays out at device width here but ~980px in Chromium. Add <meta name="viewport" content="width=device-width, initial-scale=1">.'
            : 'Check the viewport meta tag and any width set on html/body.'),
      }),
    );
  }

  return tests;
}

/* ------------------------------- Presence -------------------------------- */

function checkPresence(ctx: Ctx): CrossBrowserTestResult[] {
  const tests: CrossBrowserTestResult[] = [];
  const nearCap =
    ctx.reference.elements.length >= EXTRACTION_CAP_GUARD || ctx.candidate.elements.length >= EXTRACTION_CAP_GUARD;

  if (nearCap) {
    tests.push(
      build(ctx, {
        category: 'Presence',
        check: 'browser.presence',
        title: 'Element presence not compared',
        element: 'document',
        expected: 'Complete element snapshots in both browsers',
        actual: 'The page hit the element extraction cap',
        difference: 'n/a',
        status: 'SKIPPED',
        severity: 'none',
        message: 'This page has more elements than one snapshot captures, so an absent element could just be past the cap.',
      }),
    );
    return tests;
  }

  const missing = findAbsent(ctx.refBySelector, ctx.candBySelector, ctx.refByIndex, ctx.candidate.metrics.scrollHeight);
  const extra = findAbsent(ctx.candBySelector, ctx.refBySelector, ctx.candByIndex, ctx.reference.metrics.scrollHeight);

  for (const { el, nested } of missing.slice(0, MAX_PER_CHECK)) {
    const important = el.significance >= 0.7 || el.isInteractive || isLandmark(el);
    tests.push(
      build(ctx, {
        category: 'Presence',
        check: 'browser.missing',
        title: `Not rendered in ${ctx.candName}`,
        element: el.label,
        selector: el.selector,
        expected: `Visible, ${size(el)} (${ctx.refName})`,
        actual: 'Absent or hidden',
        difference: 'missing',
        status: important ? 'FAIL' : 'WARNING',
        severity: important ? 'major' : 'minor',
        message:
          `${el.label} renders in ${ctx.refName} but is missing or invisible in ${ctx.candName}.` +
          (nested > 0 ? ` ${nested} nested element${nested === 1 ? ' is' : 's are'} missing with it.` : '') +
          ' Common causes: a CSS feature or selector this engine does not support, a JS error only this browser throws, or user-agent sniffing.',
        // Marks where the element sits in the reference, so the capture shows the gap.
        highlight: el,
      }),
    );
  }

  for (const { el, nested } of extra.slice(0, Math.ceil(MAX_PER_CHECK / 2))) {
    tests.push(
      build(ctx, {
        category: 'Presence',
        check: 'browser.extra',
        title: `Only rendered in ${ctx.candName}`,
        element: el.label,
        selector: el.selector,
        expected: `Not shown (${ctx.refName})`,
        actual: `Visible, ${size(el)}`,
        difference: 'extra',
        status: 'WARNING',
        severity: 'minor',
        message:
          `${el.label} appears in ${ctx.candName} but not in ${ctx.refName}` +
          (nested > 0 ? `, together with ${nested} nested element${nested === 1 ? '' : 's'}` : '') +
          '. Often a fallback, an "unsupported browser" notice, or content revealed by a feature query.',
        highlight: el,
      }),
    );
  }

  if (missing.length === 0 && extra.length === 0) {
    tests.push(
      build(ctx, {
        category: 'Presence',
        check: 'browser.presence',
        title: 'Same elements rendered',
        element: 'all elements',
        expected: `The elements ${ctx.refName} renders`,
        actual: `${ctx.candBySelector.size} elements, none missing or extra`,
        difference: 'none',
        status: 'PASS',
        severity: 'none',
      }),
    );
  }

  return tests;
}

/** Significant elements in `from` with no counterpart in `to`, outermost only. */
function findAbsent(
  from: Map<string, DomElement>,
  to: Map<string, DomElement>,
  fromByIndex: Map<number, DomElement>,
  otherScrollHeight: number,
): Array<{ el: DomElement; nested: number }> {
  const absent = [...from.values()].filter(
    (el) =>
      !to.has(el.selector) &&
      el.significance >= 0.55 &&
      el.rect.width * el.rect.height >= 1600 &&
      // Content past the end of the other page is a height difference,
      // already reported once, not dozens of missing elements.
      el.rect.bottom <= otherScrollHeight &&
      (Boolean(el.ownText) || el.isImage || el.isInteractive || isLandmark(el)),
  );
  const absentIndexes = new Set(absent.map((el) => el.index));
  const outermost = new Map<number, { el: DomElement; nested: number }>();

  for (const el of absent) {
    const root = highestAncestorIn(el, absentIndexes, fromByIndex);
    if (root) {
      const entry = outermost.get(root.index);
      if (entry) entry.nested++;
      else outermost.set(root.index, { el: root, nested: 1 });
    } else if (!outermost.has(el.index)) {
      outermost.set(el.index, { el, nested: 0 });
    }
  }

  return [...outermost.values()].sort((a, b) => b.el.significance - a.el.significance);
}

/* ------------------------------- Geometry -------------------------------- */

interface GeometryFinding {
  pair: Pairing;
  kind: 'size' | 'position';
  /** How many tolerance bands the worst axis is outside. */
  excess: number;
  detail: { dw: number; dh: number; dx: number; dy: number };
}

function checkGeometry(ctx: Ctx): CrossBrowserTestResult[] {
  if (ctx.slack > MAX_LAYOUT_VIEWPORT_SLACK) return [];

  const allPairs = pairElements(ctx);

  // Width and height propagate in opposite directions, so they are attributed
  // in opposite directions. A container's width is handed down: a wrapper
  // that is 400px too wide makes every child too wide, and the wrapper is the
  // one to report. Height bubbles up: one card growing makes its grid, its
  // section and the body taller, and the card is the one to report. So width
  // goes to the outermost element that differs, height to the innermost.
  const heightChanged = new Set<number>();
  for (const { ref, cand } of allPairs) {
    if (textWrapChanged(ref, cand) || Math.abs(cand.rect.height - ref.rect.height) > heightTolerance(ref)) {
      heightChanged.add(ref.index);
    }
  }
  // An element that is missing, or only exists in the candidate, changes the
  // height of everything around it just as much.
  for (const el of ctx.refBySelector.values()) {
    if (!ctx.candBySelector.has(el.selector)) heightChanged.add(el.index);
  }
  const explainedFromBelow = new Set<number>();
  for (const index of heightChanged) markAncestors(index, ctx.refByIndex, explainedFromBelow);
  for (const el of ctx.candBySelector.values()) {
    if (ctx.refBySelector.has(el.selector)) continue;
    const anchor = nearestPairedAncestor(el, ctx);
    if (anchor) {
      heightChanged.add(anchor.index);
      explainedFromBelow.add(anchor.index);
      markAncestors(anchor.index, ctx.refByIndex, explainedFromBelow);
    }
  }

  const pairs = allPairs.filter(
    ({ ref, cand }) =>
      ref.significance >= 0.3 && ref.rect.width >= 8 && ref.rect.height >= 8 && cand.rect.width >= 1 && cand.rect.height >= 1,
  );
  // Parents first, so a wrapper that is the wrong width claims its subtree
  // before its children are considered.
  pairs.sort((a, b) => a.ref.depth - b.ref.depth);

  const flagged = new Set<number>();
  const findings: GeometryFinding[] = [];
  const folded = new Map<number, number>();

  for (const pair of pairs) {
    const { ref, cand } = pair;
    const ancestor = flaggedAncestor(ref, flagged, ctx.refByIndex);
    if (ancestor !== null) {
      folded.set(ancestor, (folded.get(ancestor) ?? 0) + 1);
      continue;
    }

    const dw = cand.rect.width - ref.rect.width;
    const dh = cand.rect.height - ref.rect.height;
    const tolW = Math.max(6, ref.rect.width * 0.06) + ctx.slack;
    // A line-count change is reported by the text check, and a height that
    // something inside explains is reported on that something instead.
    const heightIsOwn = !textWrapChanged(ref, cand) && !explainedFromBelow.has(ref.index);
    const sizeExcess = Math.max(Math.abs(dw) / tolW, heightIsOwn ? Math.abs(dh) / heightTolerance(ref) : 0);

    const offset = parentOffsets(pair, ctx);
    let posExcess = 0;
    if (offset) {
      const tolX = Math.max(6, ctx.slack / 2 + 4);
      const tolY = Math.max(16, offset.parentHeight * 0.1);
      // Anything above this element growing pushes it down; that shift is
      // the other element's finding, not this one's.
      const pushedDown = siblingAboveChanged(ref, ctx, heightChanged, explainedFromBelow);
      posExcess = Math.max(Math.abs(offset.dx) / tolX, pushedDown ? 0 : Math.abs(offset.dy) / tolY);
    }

    const detail = { dw, dh, dx: offset?.dx ?? 0, dy: offset?.dy ?? 0 };
    if (sizeExcess > 1 && sizeExcess >= posExcess) {
      findings.push({ pair, kind: 'size', excess: sizeExcess, detail });
      flagged.add(ref.index);
    } else if (posExcess > 1) {
      findings.push({ pair, kind: 'position', excess: posExcess, detail });
      flagged.add(ref.index);
    }
  }

  const tests: CrossBrowserTestResult[] = [];
  const sizeFindings = findings.filter((f) => f.kind === 'size').sort((a, b) => b.excess - a.excess);
  const positionFindings = findings.filter((f) => f.kind === 'position').sort((a, b) => b.excess - a.excess);

  for (const { finding, siblings } of groupSiblings(sizeFindings).slice(0, MAX_PER_CHECK)) {
    const { ref, cand } = finding.pair;
    const { status, severity } = grade(finding.excess);
    const nested = folded.get(ref.index) ?? 0;
    tests.push(
      build(ctx, {
        category: 'Size',
        check: 'browser.size',
        title: `Renders at a different size in ${ctx.candName}`,
        element: siblings > 0 ? `${cand.label} + ${siblings} sibling${siblings === 1 ? '' : 's'}` : cand.label,
        selector: cand.selector,
        expected: `${size(ref)} (${ctx.refName})`,
        actual: size(cand),
        difference: `${signed(finding.detail.dw)} w · ${signed(finding.detail.dh)} h`,
        delta: round(Math.max(Math.abs(finding.detail.dw), Math.abs(finding.detail.dh))),
        status,
        severity,
        message:
          `${cand.label} is ${describeSizeChange(finding.detail.dw, finding.detail.dh)} in ${ctx.candName} than in ${ctx.refName}.` +
          (siblings > 0
            ? ` ${siblings} sibling${siblings === 1 ? '' : 's'} changed by the same amount — typically one item stretching its whole grid or flex row, so start with whichever has the most content.`
            : '') +
          (nested > 0 ? ` ${nested} nested element${nested === 1 ? '' : 's'} shift with it and are not listed separately.` : '') +
          ' Look for engine-specific defaults (form controls, buttons, line-height: normal), flex/grid features with partial support, or a font that fails to load here.',
        highlight: cand,
      }),
    );
  }

  for (const finding of positionFindings.slice(0, MAX_PER_CHECK)) {
    const { ref, cand } = finding.pair;
    const { status, severity } = grade(finding.excess);
    tests.push(
      build(ctx, {
        category: 'Position',
        check: 'browser.position',
        title: `Positioned differently in ${ctx.candName}`,
        element: cand.label,
        selector: cand.selector,
        expected: `Offset matching ${ctx.refName} inside its parent`,
        actual: `Shifted ${signed(finding.detail.dx)} horizontally, ${signed(finding.detail.dy)} vertically`,
        difference: `${signed(finding.detail.dx)} x · ${signed(finding.detail.dy)} y`,
        delta: round(Math.max(Math.abs(finding.detail.dx), Math.abs(finding.detail.dy))),
        status,
        severity,
        message:
          `Relative to its parent, ${cand.label} sits in a different place in ${ctx.candName}. ` +
          'Alignment (justify/align, margin: auto), sticky or absolute positioning, and gap support are the usual suspects.',
        highlight: cand,
      }),
    );
  }

  const compared = pairs.length;
  if (sizeFindings.length === 0) {
    tests.push(passTest(ctx, 'Size', 'browser.size', 'Element sizes consistent', `${compared} elements within tolerance`));
  }
  if (positionFindings.length === 0) {
    tests.push(
      passTest(ctx, 'Position', 'browser.position', 'Element positions consistent', `${compared} elements within tolerance`),
    );
  }
  return tests;
}

/**
 * Siblings that changed by the same amount are one finding: a single item
 * growing stretches every other item in its grid or flex row with it.
 */
function groupSiblings(findings: GeometryFinding[]): Array<{ finding: GeometryFinding; siblings: number }> {
  const groups: Array<{ finding: GeometryFinding; siblings: number }> = [];
  for (const finding of findings) {
    const { ref } = finding.pair;
    const same = groups.find(
      (g) =>
        g.finding.pair.ref.parentIndex === ref.parentIndex &&
        Math.abs(g.finding.detail.dw - finding.detail.dw) <= 2 &&
        Math.abs(g.finding.detail.dh - finding.detail.dh) <= 2,
    );
    if (same) same.siblings++;
    else groups.push({ finding, siblings: 0 });
  }
  return groups;
}

/**
 * Heights of text blocks follow the font's metrics, which each engine rounds
 * differently, so the band is proportional.
 */
function heightTolerance(ref: DomElement): number {
  return Math.max(8, ref.rect.height * 0.12);
}

function textWrapChanged(ref: DomElement, cand: DomElement): boolean {
  return ref.lineCount > 0 && ref.lineCount !== cand.lineCount;
}

function markAncestors(index: number, byIndex: Map<number, DomElement>, into: Set<number>): void {
  let parent = byIndex.get(index)?.parentIndex ?? null;
  let guard = 0;
  while (parent !== null && guard++ < 50 && !into.has(parent)) {
    into.add(parent);
    parent = byIndex.get(parent)?.parentIndex ?? null;
  }
}

/** The closest ancestor of a candidate-only element that also exists in the reference. */
function nearestPairedAncestor(el: DomElement, ctx: Ctx): DomElement | null {
  let index = el.parentIndex;
  let guard = 0;
  while (index !== null && guard++ < 50) {
    const parent = ctx.candByIndex.get(index);
    if (!parent) return null;
    const ref = ctx.refBySelector.get(parent.selector);
    if (ref) return ref;
    index = parent.parentIndex;
  }
  return null;
}

function siblingAboveChanged(
  ref: DomElement,
  ctx: Ctx,
  heightChanged: Set<number>,
  explainedFromBelow: Set<number>,
): boolean {
  const parent = ref.parentIndex !== null ? ctx.refByIndex.get(ref.parentIndex) : undefined;
  if (!parent) return false;
  return parent.childIndexes.some((index) => {
    if (index === ref.index) return false;
    const sibling = ctx.refByIndex.get(index);
    if (!sibling || sibling.rect.bottom > ref.rect.top + 2) return false;
    return heightChanged.has(index) || explainedFromBelow.has(index);
  });
}

/** Offset of an element inside its parent, in each browser. */
function parentOffsets(pair: Pairing, ctx: Ctx): { dx: number; dy: number; parentHeight: number } | null {
  const refParent = pair.ref.parentIndex !== null ? ctx.refByIndex.get(pair.ref.parentIndex) : undefined;
  const candParent = pair.cand.parentIndex !== null ? ctx.candByIndex.get(pair.cand.parentIndex) : undefined;
  if (!refParent || !candParent || refParent.selector !== candParent.selector) return null;
  // Out-of-flow elements are placed by script or by the viewport, not by the
  // parent; their offsets say nothing reliable.
  if (pair.ref.positionedAncestor || pair.ref.styles.position === 'fixed' || pair.ref.styles.position === 'sticky') {
    return null;
  }

  const refX = pair.ref.rect.x - refParent.rect.x;
  const candX = pair.cand.rect.x - candParent.rect.x;
  const refY = pair.ref.rect.y - refParent.rect.y;
  const candY = pair.cand.rect.y - candParent.rect.y;
  return { dx: candX - refX, dy: candY - refY, parentHeight: refParent.rect.height };
}

/* --------------------------------- Text ---------------------------------- */

function checkText(ctx: Ctx): CrossBrowserTestResult[] {
  if (ctx.slack > MAX_LAYOUT_VIEWPORT_SLACK) return [];

  const candidates = pairElements(ctx).filter(({ ref, cand }) => ref.ownText.length >= 3 && ref.lineCount > 0 && cand.lineCount > 0);

  const wraps: Array<{ pair: Pairing; diff: number }> = [];
  const clipped: Pairing[] = [];

  for (const pair of candidates) {
    const { ref, cand } = pair;
    const diff = cand.lineCount - ref.lineCount;
    if (diff !== 0) wraps.push({ pair, diff });

    // Text that fits in the reference but is cut off here.
    const clips = (el: DomElement) =>
      el.clipsOverflow &&
      el.styles.textOverflow !== 'ellipsis' &&
      (el.scrollWidth - el.clientWidth > ctx.tolerances.CLIPPING_TOLERANCE ||
        el.scrollHeight - el.clientHeight > ctx.tolerances.CLIPPING_TOLERANCE);
    if (clips(cand) && !clips(ref)) clipped.push(pair);
  }

  const tests: CrossBrowserTestResult[] = [];
  wraps.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff) || b.pair.ref.significance - a.pair.ref.significance);

  for (const { pair, diff } of wraps.slice(0, MAX_PER_CHECK)) {
    const { ref, cand } = pair;
    const big = Math.abs(diff) >= 2;
    tests.push(
      build(ctx, {
        category: 'Text',
        check: 'browser.textWrap',
        title: `Text wraps differently in ${ctx.candName}`,
        element: cand.label,
        selector: cand.selector,
        expected: `${ref.lineCount} line${ref.lineCount === 1 ? '' : 's'} (${ctx.refName})`,
        actual: `${cand.lineCount} line${cand.lineCount === 1 ? '' : 's'}`,
        difference: `${diff > 0 ? '+' : ''}${diff} line${Math.abs(diff) === 1 ? '' : 's'}`,
        delta: diff,
        status: big ? 'FAIL' : 'WARNING',
        severity: big ? 'major' : 'minor',
        message:
          `"${truncate(ref.ownText, 60)}" breaks onto ${cand.lineCount} line${cand.lineCount === 1 ? '' : 's'} in ${ctx.candName} ` +
          `versus ${ref.lineCount} in ${ctx.refName}. Different font metrics or a fallback font; check the web font loads in this browser ` +
          'and that the container leaves some slack for wider rendering.',
        highlight: cand,
      }),
    );
  }

  for (const { cand } of clipped.slice(0, MAX_PER_CHECK)) {
    tests.push(
      build(ctx, {
        category: 'Text',
        check: 'browser.textClipped',
        title: `Text cut off in ${ctx.candName}`,
        element: cand.label,
        selector: cand.selector,
        expected: `Text fits (${ctx.refName})`,
        actual: `Content ${px(cand.scrollWidth)}×${px(cand.scrollHeight)} in a ${px(cand.clientWidth)}×${px(cand.clientHeight)} box`,
        difference: `${px(Math.max(cand.scrollWidth - cand.clientWidth, cand.scrollHeight - cand.clientHeight))} hidden`,
        status: 'FAIL',
        severity: 'major',
        message: `${cand.label} fits in ${ctx.refName} but its text overflows its clipping box in ${ctx.candName}, so part of it is invisible.`,
        highlight: cand,
      }),
    );
  }

  if (wraps.length === 0 && clipped.length === 0) {
    tests.push(
      passTest(ctx, 'Text', 'browser.textWrap', 'Text renders consistently', `${candidates.length} text elements wrap identically`),
    );
  }
  return tests;
}

/* -------------------------------- Helpers -------------------------------- */

function pairElements(ctx: Ctx): Pairing[] {
  const pairs: Pairing[] = [];
  for (const [selector, ref] of ctx.refBySelector) {
    const cand = ctx.candBySelector.get(selector);
    if (cand) pairs.push({ ref, cand });
  }
  return pairs;
}

/** Selectors are unique-ish; any that repeat cannot identify an element across browsers. */
function uniqueBySelector(elements: DomElement[]): Map<string, DomElement> {
  const map = new Map<string, DomElement>();
  const duplicated = new Set<string>();
  for (const el of elements) {
    if (map.has(el.selector)) duplicated.add(el.selector);
    else map.set(el.selector, el);
  }
  for (const selector of duplicated) map.delete(selector);
  return map;
}

function highestAncestorIn(el: DomElement, set: Set<number>, byIndex: Map<number, DomElement>): DomElement | null {
  let found: DomElement | null = null;
  let index = el.parentIndex;
  let guard = 0;
  while (index !== null && guard++ < 50) {
    const parent = byIndex.get(index);
    if (!parent) break;
    if (set.has(parent.index)) found = parent;
    index = parent.parentIndex;
  }
  return found;
}

function flaggedAncestor(el: DomElement, flagged: Set<number>, byIndex: Map<number, DomElement>): number | null {
  let index = el.parentIndex;
  let guard = 0;
  while (index !== null && guard++ < 50) {
    if (flagged.has(index)) return index;
    index = byIndex.get(index)?.parentIndex ?? null;
  }
  return null;
}

function isLandmark(el: DomElement): boolean {
  return ['main', 'nav', 'header', 'footer', 'form', 'h1', 'h2'].includes(el.tag);
}

function grade(excess: number): { status: TestStatus; severity: Severity } {
  if (excess <= 2) return { status: 'WARNING', severity: 'minor' };
  if (excess <= 5) return { status: 'FAIL', severity: 'major' };
  return { status: 'FAIL', severity: 'critical' };
}

function overflowSeverity(overhang: number, width: number): Severity {
  const ratio = overhang / Math.max(1, width);
  if (ratio >= 0.15 || overhang >= 120) return 'critical';
  if (ratio >= 0.04 || overhang >= 24) return 'major';
  return 'minor';
}

function describeSizeChange(dw: number, dh: number): string {
  const parts: string[] = [];
  if (Math.abs(dw) >= 1) parts.push(`${px(Math.abs(dw))} ${dw > 0 ? 'wider' : 'narrower'}`);
  if (Math.abs(dh) >= 1) parts.push(`${px(Math.abs(dh))} ${dh > 0 ? 'taller' : 'shorter'}`);
  return parts.join(' and ') || 'a different size';
}

function passTest(ctx: Ctx, category: BrowserCategory, check: string, title: string, actual: string): CrossBrowserTestResult {
  return build(ctx, {
    category,
    check,
    title,
    element: 'all elements',
    expected: `Matches ${ctx.refName}`,
    actual,
    difference: 'none',
    status: 'PASS',
    severity: 'none',
  });
}

function build(ctx: Ctx, input: TestInput): CrossBrowserTestResult {
  const viewport = ctx.candidate.viewport;
  const test: CrossBrowserTestResult = {
    kind: 'browser',
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
    browser: ctx.browser,
    referenceBrowser: ctx.refBrowser,
    viewportId: viewport.id,
    viewportLabel: viewport.label,
  };

  // Evidence is shot in the browser that renders differently — that is the
  // picture that shows the problem.
  const target = input.highlight;
  if (target && input.status !== 'PASS' && input.status !== 'SKIPPED') {
    test.evidence = {
      highlight: {
        x: Math.max(0, target.rect.x),
        y: Math.max(0, target.rect.y),
        width: Math.max(1, target.rect.width),
        height: Math.max(1, target.rect.height),
      },
      caption: `${viewport.label} · ${target.label}`,
    };
  }
  return test;
}

function size(el: DomElement): string {
  return `${Math.round(el.rect.width)}×${Math.round(el.rect.height)}px`;
}

function round(n: number, decimals = 1): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

function px(n: number): string {
  return `${Math.round(n)}px`;
}

function signed(n: number): string {
  const r = Math.round(n);
  return `${r > 0 ? '+' : ''}${r}px`;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
