import type { UiTestResult } from '@/lib/types/tests';
import { colorDistance, formatRgba, isTransparent, parseColor, type Rgba } from '@/lib/utils/color';
import { buildTest, capSeverity, fmt, type ComparisonContext, type MatchedPair } from './context';

const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };

/**
 * Text, background and border colour.
 *
 * Differences are measured as CIE76 ΔE rather than per-channel so the result
 * tracks what a person would actually notice. Backgrounds resolve through
 * transparent ancestors first: a design frame's fill is frequently implemented
 * on a parent element, and flagging that would be noise, not a defect.
 */
export function compareColor(pair: MatchedPair, ctx: ComparisonContext): UiTestResult[] {
  const tests: UiTestResult[] = [];
  const { node, el } = pair;
  const t = ctx.tolerances;

  if (node.type === 'TEXT' && node.color) {
    const expected = parseColor(node.color);
    const actual = parseColor(el.styles.color);
    if (expected && actual) {
      tests.push(
        colorTest(ctx, pair, {
          check: 'color.text',
          title: 'Text colour',
          expected,
          actual,
          tolerance: t.COLOR_TOLERANCE,
        }),
      );
    }
  }

  if (node.backgroundColor) {
    const expected = parseColor(node.backgroundColor);
    if (expected && !isTransparent(expected)) {
      const resolved = resolveBackground(pair, ctx);
      if (resolved.color && !isTransparent(resolved.color)) {
        tests.push(
          colorTest(ctx, pair, {
            check: 'color.background',
            title: 'Background colour',
            expected,
            actual: resolved.color,
            tolerance: t.COLOR_TOLERANCE,
            note: resolved.inheritedFrom
              ? `The element itself is transparent; measured the background inherited from ${resolved.inheritedFrom}.`
              : undefined,
            // An inherited match is correct enough that it should never be loud.
            maxSeverity: resolved.inheritedFrom ? 'minor' : undefined,
          }),
        );
      } else if (!el.styles.backgroundImage) {
        tests.push(
          buildTest(ctx, {
            category: 'Color',
            check: 'color.background',
            title: 'Background colour',
            pair,
            expected: formatRgba(expected),
            actual: 'transparent',
            difference: 'no background rendered',
            status: 'FAIL',
            severity: 'major',
            message: 'The design fills this surface, but neither the element nor any ancestor paints a background.',
          }),
        );
      }
    }
  }

  if (node.border?.color && (node.border.width ?? 0) > 0) {
    const expected = parseColor(node.border.color);
    const hasDomBorder = maxBorderWidth(el) > 0;
    const actual = parseColor(el.styles.borderColor);
    if (expected && hasDomBorder && actual) {
      tests.push(
        colorTest(ctx, pair, {
          check: 'color.border',
          title: 'Border colour',
          expected,
          actual,
          tolerance: t.COLOR_TOLERANCE,
        }),
      );
    }
  }

  return tests;
}

function colorTest(
  ctx: ComparisonContext,
  pair: MatchedPair,
  options: {
    check: string;
    title: string;
    expected: Rgba;
    actual: Rgba;
    tolerance: number;
    note?: string;
    maxSeverity?: 'minor' | 'major';
  },
): UiTestResult {
  const deltaE = colorDistance(options.expected, options.actual);
  const alphaDelta = Math.abs(options.expected.a - options.actual.a);
  const t = ctx.tolerances;

  let severity: 'none' | 'minor' | 'major' | 'critical';
  if (deltaE <= options.tolerance && alphaDelta <= t.ALPHA_TOLERANCE) severity = 'none';
  else if (deltaE <= options.tolerance * t.MINOR_MULTIPLIER) severity = 'minor';
  else if (deltaE <= options.tolerance * t.MAJOR_MULTIPLIER) severity = 'major';
  else severity = 'critical';

  severity = capSeverity(severity, options.maxSeverity);
  const status = severity === 'none' ? 'PASS' : severity === 'minor' ? 'WARNING' : 'FAIL';

  return buildTest(ctx, {
    category: 'Color',
    check: options.check,
    title: options.title,
    pair,
    expected: formatRgba(options.expected),
    actual: formatRgba(options.actual),
    difference: severity === 'none' ? `ΔE ${fmt(deltaE, 1)} (within tolerance)` : `ΔE ${fmt(deltaE, 1)}`,
    delta: Number(deltaE.toFixed(2)),
    status,
    severity,
    message: options.note,
  });
}

/**
 * Walks up the DOM until a non-transparent background is found, so an element
 * that correctly inherits its surface colour is not reported as missing one.
 */
function resolveBackground(
  pair: MatchedPair,
  ctx: ComparisonContext,
): { color: Rgba | null; inheritedFrom: string | null } {
  const own = parseColor(pair.el.styles.backgroundColor);
  if (own && !isTransparent(own)) return { color: own, inheritedFrom: null };

  let parentIndex = pair.el.parentIndex;
  let guard = 0;
  while (parentIndex !== null && parentIndex !== undefined && guard++ < 12) {
    const parent = ctx.domByIndex.get(parentIndex);
    if (!parent) break;
    const color = parseColor(parent.styles.backgroundColor);
    if (color && !isTransparent(color)) return { color, inheritedFrom: parent.label };
    parentIndex = parent.parentIndex;
  }

  // Nothing paints a background anywhere up the tree: the page background wins.
  return { color: guard > 0 ? WHITE : null, inheritedFrom: guard > 0 ? 'the page background' : null };
}

function maxBorderWidth(el: MatchedPair['el']): number {
  return Math.max(
    el.styles.borderTopWidth,
    el.styles.borderRightWidth,
    el.styles.borderBottomWidth,
    el.styles.borderLeftWidth,
  );
}
