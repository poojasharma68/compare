import type { UiTestResult } from '@/lib/types/tests';
import { buildTest, nearestMatchedAncestor, numericTest, type ComparisonContext, type MatchedPair } from './context';
import { fmt } from './context';

/** A design node this wide relative to its container is treated as full-bleed. */
const FULL_BLEED_RATIO = 0.9;

/**
 * Position, size and alignment.
 *
 * Two decisions shape everything here:
 *
 * 1. Positions are compared relative to the nearest matched ancestor wherever
 *    one exists. Absolute page coordinates drift for entirely legitimate
 *    reasons — one extra paragraph high on the page shifts everything below it
 *    — so a relative basis is the only one that yields actionable findings.
 *
 * 2. Elements that fill their container in the design are compared
 *    proportionally rather than in absolute pixels. A container that is 1200px
 *    in a 1200px frame and 1280px in a 1280px viewport is correct, not 80px
 *    wrong, and flagging it would bury the real findings.
 */
export function compareLayout(pair: MatchedPair, ctx: ComparisonContext): UiTestResult[] {
  const tests: UiTestResult[] = [];
  const { node, el } = pair;
  const t = ctx.tolerances;
  const scale = ctx.scale;
  const drift = Math.abs(scale - 1);

  const anchor = nearestMatchedAncestor(ctx, node);
  const basis = anchor ? `relative to "${anchor.node.name}"` : 'relative to the page origin';

  const expectedX = anchor ? (node.x - anchor.node.x) * scale : node.x * scale + ctx.originX;
  const actualX = anchor ? el.rect.x - anchor.el.rect.x : el.rect.x;

  tests.push(
    numericTest(ctx, {
      category: 'Layout',
      check: 'layout.positionX',
      title: 'Horizontal position',
      pair,
      expected: expectedX,
      actual: actualX,
      // Scaling multiplies coordinates, so it also multiplies uncertainty.
      tolerance: t.POSITION_TOLERANCE + Math.abs(expectedX) * drift,
      note: `Measured ${basis}.`,
    }),
  );

  // Vertical position is only asserted relative to a matched ancestor.
  //
  // An element's absolute Y is the sum of every margin, line wrap and image
  // above it, so on a real page it differs from the design by construction —
  // one extra line of copy near the top shifts the entire rest of the document.
  // Reporting that produces a warning on nearly every element while telling a
  // developer nothing they can act on. Measured against its own container, the
  // same number becomes a genuine spacing defect.
  if (anchor) {
    const expectedY = (node.y - anchor.node.y) * scale;
    const actualY = el.rect.y - anchor.el.rect.y;
    tests.push(
      numericTest(ctx, {
        category: 'Layout',
        check: 'layout.positionY',
        title: 'Vertical position',
        pair,
        expected: expectedY,
        actual: actualY,
        tolerance: t.POSITION_TOLERANCE + Math.abs(expectedY) * drift,
        note: `Measured ${basis}.`,
      }),
    );
  }

  const width = compareWidth(pair, ctx, anchor);
  if (width) tests.push(width);

  const height = compareHeight(pair, ctx);
  if (height) tests.push(height);

  const alignment = compareAlignment(pair, ctx, anchor);
  if (alignment) tests.push(alignment);

  return tests;
}

/**
 * Width, compared absolutely for sized elements and proportionally for ones
 * that fill their container.
 */
function compareWidth(
  pair: MatchedPair,
  ctx: ComparisonContext,
  anchor: MatchedPair | null,
): UiTestResult | null {
  const { node, el } = pair;
  const t = ctx.tolerances;
  const drift = Math.abs(ctx.scale - 1);

  // A hugging width is whatever the content produced, not a value anyone
  // specified. Asserting it would be testing the copy, not the build.
  if (node.widthSizing === 'hug') return null;

  const designContainer = anchor ? anchor.node.width : ctx.design.rootWidth;
  // With no matched ancestor, the design's container is the frame — so the
  // page-side container has to be the frame's mapped width, not the viewport.
  // Comparing a share of 1200px against a share of 1280px would report every
  // full-width element as too narrow.
  const domContainer = anchor ? anchor.el.rect.width : ctx.design.rootWidth * ctx.scale;
  const fillsContainer =
    domContainer > 0 &&
    (node.widthSizing === 'fill' ||
      (designContainer > 0 && node.width / designContainer >= FULL_BLEED_RATIO));

  if (fillsContainer) {
    const expectedRatio = (node.width / designContainer) * 100;
    const actualRatio = (el.rect.width / domContainer) * 100;
    return numericTest(ctx, {
      category: 'Layout',
      check: 'layout.width',
      title: 'Width (proportional)',
      pair,
      expected: expectedRatio,
      actual: actualRatio,
      // 2% of the container, floored so narrow containers stay sane.
      tolerance: Math.max(1.5, (t.SIZE_TOLERANCE / Math.max(domContainer, 1)) * 100 + 1.5),
      unit: '%',
      decimals: 1,
      note: `This element fills its container in the design, so it is compared as a share of ${
        anchor ? `"${anchor.node.name}"` : 'the frame'
      } (${fmt(node.width)}px of ${fmt(designContainer)}px) rather than in absolute pixels.`,
    });
  }

  const expectedW = node.width * ctx.scale;
  return numericTest(ctx, {
    category: 'Layout',
    check: 'layout.width',
    title: 'Width',
    pair,
    expected: expectedW,
    actual: el.rect.width,
    tolerance: t.SIZE_TOLERANCE + expectedW * (t.SIZE_RELATIVE_TOLERANCE + drift),
  });
}

/**
 * Height, but only where the design actually fixes one.
 *
 * Most heights in a design are a consequence of the content inside them: a
 * paragraph is as tall as its copy, a card as tall as its longest child. Real
 * copy is never the same length as the placeholder copy in a mockup, so
 * asserting those heights reports a difference on almost every element while
 * saying nothing a developer can act on. Figma already records the distinction
 * as Fixed / Hug / Fill, so we honour it and check only fixed heights.
 */
function compareHeight(pair: MatchedPair, ctx: ComparisonContext): UiTestResult | null {
  const { node, el } = pair;
  const t = ctx.tolerances;
  const drift = Math.abs(ctx.scale - 1);

  if (node.heightSizing === 'hug' || node.heightSizing === 'fill') return null;
  // Text with no explicit sizing information: assume the copy drives it.
  if (node.heightSizing === 'unknown' && node.type === 'TEXT') return null;
  // A container whose children decide its height is in the same position.
  if (node.heightSizing === 'unknown' && node.childIds.length > 0 && node.type !== 'IMAGE') return null;

  const expectedH = node.height * ctx.scale;
  return numericTest(ctx, {
    category: 'Layout',
    check: 'layout.height',
    title: 'Height',
    pair,
    expected: expectedH,
    actual: el.rect.height,
    tolerance: t.SIZE_TOLERANCE + expectedH * (t.SIZE_RELATIVE_TOLERANCE + drift),
    note:
      node.heightSizing === 'fixed'
        ? 'The design fixes this height, so it is treated as a specification.'
        : undefined,
  });
}

type Alignment = 'left' | 'center' | 'right' | 'stretch';

/**
 * Compares how the element sits inside its container. Only runs with a matched
 * ancestor — alignment is meaningless without a reference box.
 */
function compareAlignment(
  pair: MatchedPair,
  ctx: ComparisonContext,
  anchor: MatchedPair | null,
): UiTestResult | null {
  if (!anchor) return null;
  const t = ctx.tolerances;

  const designAlign = classifyAlignment(
    pair.node.x - anchor.node.x,
    anchor.node.width - (pair.node.x - anchor.node.x) - pair.node.width,
    pair.node.width,
    anchor.node.width,
    t.ALIGNMENT_TOLERANCE / Math.max(ctx.scale, 0.2),
  );
  const domAlign = classifyAlignment(
    pair.el.rect.x - anchor.el.rect.x,
    anchor.el.rect.width - (pair.el.rect.x - anchor.el.rect.x) - pair.el.rect.width,
    pair.el.rect.width,
    anchor.el.rect.width,
    t.ALIGNMENT_TOLERANCE,
  );

  if (!designAlign || !domAlign) return null;

  const matches = designAlign === domAlign;
  return buildTest(ctx, {
    category: 'Layout',
    check: 'layout.alignment',
    title: 'Alignment within container',
    pair,
    expected: `${designAlign} within "${anchor.node.name}"`,
    actual: `${domAlign} within ${anchor.el.label}`,
    difference: matches ? 'exact' : `${designAlign} → ${domAlign}`,
    status: matches ? 'PASS' : 'FAIL',
    severity: matches ? 'none' : 'major',
    message: matches
      ? undefined
      : `The design aligns this ${designAlign}, the page renders it ${domAlign}.`,
  });
}

function classifyAlignment(
  leftGap: number,
  rightGap: number,
  width: number,
  containerWidth: number,
  tolerance: number,
): Alignment | null {
  if (containerWidth <= 0 || width <= 0) return null;
  if (width >= containerWidth - tolerance * 2) return 'stretch';
  if (Math.abs(leftGap - rightGap) <= tolerance) return 'center';
  if (leftGap <= tolerance) return 'left';
  if (rightGap <= tolerance) return 'right';
  // Not pinned to any edge and not centred — no meaningful alignment to check.
  return null;
}
